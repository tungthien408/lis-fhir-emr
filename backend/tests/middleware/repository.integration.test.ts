import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { count, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { exchangeAttempts, exchangeEvents, exchangeTransactions } from "../../src/middleware/schema.js";
import { hasSqlState, newExchange } from "./fixtures.js";

const testUrl = process.env.MIDDLEWARE_REPOSITORY_TEST_DATABASE_URL?.trim();
delete process.env.MIDDLEWARE_DATABASE_URL;
if (testUrl) process.env.MIDDLEWARE_DATABASE_URL = testUrl;

test("Middleware Repository integration (PostgreSQL)", {
  skip: testUrl ? false : "Set MIDDLEWARE_REPOSITORY_TEST_DATABASE_URL to a disposable database",
}, async (t) => {
  const repository = await import("../../src/middleware/repository.js");
  const { middlewareDatabase } = await import("../../src/middleware/db.js");
  const pool = new Pool({ connectionString: testUrl, max: 4, connectionTimeoutMillis: 3000 });
  const db = drizzle({ client: pool });
  const ownedIds: string[] = [];
  t.after(async () => {
    try {
      if (ownedIds.length) await db.transaction(async (tx) => {
        await tx.delete(exchangeEvents).where(inArray(exchangeEvents.exchangeId, ownedIds));
        await tx.delete(exchangeAttempts).where(inArray(exchangeAttempts.exchangeId, ownedIds));
        await tx.delete(exchangeTransactions).where(inArray(exchangeTransactions.exchangeId, ownedIds));
      });
    } finally {
      await Promise.all([pool.end(), middlewareDatabase.close()]);
    }
  });

  const identity = await pool.query<{ role: string }>("select current_user as role");
  assert.equal(identity.rows[0]?.role, "integration_app");
  for (const table of [exchangeTransactions, exchangeEvents, exchangeAttempts]) {
    const [row] = await db.select({ total: count() }).from(table);
    assert.equal(row.total, 0, "Refusing to run against a populated database");
  }

  async function create(input = newExchange()) {
    input.exchangeId ??= randomUUID();
    ownedIds.push(input.exchangeId);
    return repository.createExchange(input);
  }

  await t.test("saves the whole envelope, timestamps, RECEIVED defaults and exactly one receipt atomically", async () => {
    const input = newExchange();
    const result = await create(input);
    assert.equal(result.kind, "created");
    if (result.kind !== "created") return;
    const row = result.transaction;
    assert.equal(row.exchangeId, input.exchangeId);
    assert.equal(row.eventId, input.sourceEnvelope.event_id);
    assert.equal(row.sourceSystem, input.sourceEnvelope.source_system);
    assert.equal(row.sourceResultId, input.sourceEnvelope.source_result_id);
    assert.equal(row.sourceHash, input.sourceEnvelope.source_hash);
    assert.deepEqual(row.sourcePayload, input.sourceEnvelope);
    assert.deepEqual(row.publishedAt, new Date(input.sourceEnvelope.published_at));
    assert.ok(row.receivedAt instanceof Date);
    assert.equal(row.status, "RECEIVED");
    assert.equal(row.sendAttemptCount, 0);
    assert.equal(row.verifyAttemptCount, 0);
    assert.equal(row.fhirPayload, null);
    assert.equal(row.completedAt, null);
    const events = await repository.getExchangeEvents(row.exchangeId);
    assert.equal(events.length, 1);
    assert.equal(events[0].eventType, "RECEIVED");
    assert.equal(events[0].oldStatus, null);
    assert.equal(events[0].newStatus, "RECEIVED");
    assert.equal(events[0].attemptId, null);
    assert.deepEqual(events[0].occurredAt, row.receivedAt);
    const sameInstant = await pool.query<{ same: boolean }>(`select e.occurred_at = t.received_at as same
      from integration.exchange_events e join integration.exchange_transactions t using(exchange_id)
      where t.exchange_id = $1`, [row.exchangeId]);
    assert.equal(sameInstant.rows[0].same, true, "Receipt retains even PostgreSQL microseconds");
    const publishedInstant = await pool.query<{ same: boolean }>(`select published_at = $2::timestamptz as same
      from integration.exchange_transactions where exchange_id = $1`, [row.exchangeId, input.sourceEnvelope.published_at]);
    assert.equal(publishedInstant.rows[0].same, true, "Published instant retains PostgreSQL microseconds");
    assert.deepEqual(await repository.getExchangeById(row.exchangeId), row);
    assert.deepEqual(await repository.getExchangeByEventId(row.eventId), row);
    assert.deepEqual(await repository.getExchangeBySourceResult(row.sourceSystem, row.sourceResultId), row);
  });

  await t.test("generates an exchange UUID when omitted", async () => {
    const input = newExchange();
    const result = await repository.createExchange(input);
    assert.equal(result.kind, "created");
    if (result.kind === "created") {
      ownedIds.push(result.transaction.exchangeId);
      assert.match(result.transaction.exchangeId, /^[0-9a-f-]{36}$/);
    }
  });

  await t.test("missing identifiers and histories return undefined or empty arrays", async () => {
    assert.equal(await repository.getExchangeById(randomUUID()), undefined);
    assert.equal(await repository.getExchangeByEventId(randomUUID()), undefined);
    assert.equal(await repository.getExchangeBySourceResult("missing", "missing"), undefined);
    assert.deepEqual(await repository.getExchangeEvents(randomUUID()), []);
    assert.deepEqual(await repository.getExchangeAttempts(randomUUID()), []);
  });

  await t.test("retry preserves every field and history after later processing", async () => {
    const input = newExchange();
    await create(input);
    await db.update(exchangeTransactions).set({
      status: "DELIVERED", sendAttemptCount: 2, verifyAttemptCount: 3,
      fhirPayload: { synthetic: true }, patientIdentifier: { synthetic: true },
      payloadHash: "b".repeat(64), mappingVersion: "test-only",
      validatedAt: new Date(), verifiedAt: new Date(), completedAt: new Date(),
    }).where(eq(exchangeTransactions.exchangeId, input.exchangeId!));
    await repository.appendExchangeEvent({
      exchangeId: input.exchangeId!, eventType: "TEST_COMPLETED", newStatus: "DELIVERED",
    });
    const before = await repository.getExchangeById(input.exchangeId!);
    const events = await repository.getExchangeEvents(input.exchangeId!);
    const retried = await create({ ...input, exchangeId: randomUUID() });
    assert.equal(retried.kind, "existing");
    if (retried.kind === "existing") assert.deepEqual(retried.transaction, before);
    assert.deepEqual(await repository.getExchangeById(input.exchangeId!), before);
    assert.deepEqual(await repository.getExchangeEvents(input.exchangeId!), events);
  });

  await t.test("JSONB retry equality ignores object key order including nested objects", async () => {
    const input = newExchange();
    await create(input);
    const reordered = { ...input.sourceEnvelope };
    reordered.source_snapshot = Object.fromEntries(
      Object.entries(reordered.source_snapshot).reverse(),
    ) as typeof reordered.source_snapshot;
    assert.equal((await create({ sourceEnvelope: reordered })).kind, "existing");
  });

  await t.test("content conflicts include snapshot despite same hash, hash alone, and publish time", async () => {
    const input = newExchange();
    await create(input);
    const before = await repository.getExchangeById(input.exchangeId!);
    for (const envelope of [
      { ...input.sourceEnvelope, source_snapshot: { ...input.sourceEnvelope.source_snapshot, value_num: 9 } },
      { ...input.sourceEnvelope, source_hash: "b".repeat(64) },
      { ...input.sourceEnvelope, published_at: "2026-10-23T09:00:00Z" },
    ]) {
      const result = await create({ sourceEnvelope: envelope });
      assert.equal(result.kind, "conflict");
      if (result.kind === "conflict") assert.equal(result.reason, "content");
    }
    assert.deepEqual(await repository.getExchangeById(input.exchangeId!), before);
    assert.equal((await repository.getExchangeEvents(input.exchangeId!)).length, 1);
  });

  await t.test("collisions on either business key and split identifiers expose the correct existing rows", async () => {
    const a = newExchange(); const b = newExchange();
    await create(a); await create(b);
    for (const [envelope, eventId, sourceId] of [
      [{ ...newExchange().sourceEnvelope, event_id: a.sourceEnvelope.event_id }, a.exchangeId, undefined],
      [{ ...a.sourceEnvelope, event_id: randomUUID() }, undefined, a.exchangeId],
      [{ ...b.sourceEnvelope, event_id: a.sourceEnvelope.event_id }, a.exchangeId, b.exchangeId],
    ] as const) {
      const result = await create({ sourceEnvelope: envelope });
      assert.equal(result.kind, "conflict");
      if (result.kind === "conflict") {
        assert.equal(result.reason, "identifiers");
        assert.equal(result.byEventId?.exchangeId, eventId);
        assert.equal(result.bySourceResult?.exchangeId, sourceId);
      }
    }
  });

  for (const key of ["identical", "event_id", "source_pair"] as const) {
    await t.test(`eight concurrent inserts for ${key} create one receipt and never overwrite`, async () => {
      const base = newExchange();
      const inputs = Array.from({ length: 8 }, () => {
        const candidate = key === "event_id" ? newExchange() : structuredClone(base);
        candidate.sourceEnvelope.event_id = key === "source_pair" ? randomUUID() : base.sourceEnvelope.event_id;
        return candidate;
      });
      const results = await Promise.all(inputs.map((input) => create(input)));
      assert.equal(results.filter((result) => result.kind === "created").length, 1);
      assert.equal(results.filter((result) => result.kind === (key === "identical" ? "existing" : "conflict")).length, 7);
      const winner = results.find((result) => result.kind === "created");
      assert.ok(winner && winner.kind === "created");
      assert.equal((await repository.getExchangeEvents(winner.transaction.exchangeId)).length, 1);
      assert.deepEqual(await repository.getExchangeById(winner.transaction.exchangeId), winner.transaction);
    });
  }

  for (const commit of [true, false]) {
    await t.test(`waits for uncommitted unique-key winner to ${commit ? "commit" : "roll back"}`, async () => {
      const input = newExchange(); input.exchangeId = randomUUID(); ownedIds.push(input.exchangeId);
      const blocker = await pool.connect();
      let pending: ReturnType<typeof repository.createExchange> | undefined;
      try {
        await blocker.query("BEGIN");
        await blocker.query(`insert into integration.exchange_transactions
          (exchange_id,event_id,source_system,source_result_id,source_payload,source_hash,published_at)
          values ($1,$2,$3,$4,$5,$6,$7)`, [input.exchangeId, input.sourceEnvelope.event_id,
          input.sourceEnvelope.source_system, input.sourceEnvelope.source_result_id,
          input.sourceEnvelope, input.sourceEnvelope.source_hash, input.sourceEnvelope.published_at]);
        pending = create({ sourceEnvelope: input.sourceEnvelope });
        void pending.catch(() => undefined);
        let blocked = false;
        const deadline = Date.now() + 5000;
        while (!blocked && Date.now() < deadline) {
          const locks = await pool.query<{ blocked: boolean }>(`select exists(select 1 from pg_stat_activity
            where usename = current_user and wait_event_type = 'Lock'
            and query like 'insert into "integration"."exchange_transactions"%') as blocked`);
          blocked = locks.rows[0].blocked;
          if (!blocked) await setTimeout(10);
        }
        assert.ok(blocked, "Expected an actual PostgreSQL uniqueness wait");
        await blocker.query(commit ? "COMMIT" : "ROLLBACK");
        const result = await pending;
        assert.equal(result.kind, commit ? "existing" : "created");
        assert.equal((await repository.getExchangeEvents(result.transaction.exchangeId)).length, commit ? 0 : 1);
      } finally {
        await blocker.query("ROLLBACK"); blocker.release();
        await pending?.catch(() => undefined);
      }
    });
  }

  await t.test("AND filters and pages use received_at DESC then exchange_id ASC even with ties", async () => {
    const filterId = `B1-PAGING-${randomUUID()}`;
    const ids: string[] = [];
    for (let index = 0; index < 24; index++) {
      const input = newExchange(); input.sourceEnvelope.source_result_id = filterId;
      input.sourceEnvelope.source_snapshot.result_id = filterId;
      input.sourceEnvelope.source_system = `b1-page-system-${index}`;
      await create(input); ids.push(input.exchangeId!);
    }
    await db.update(exchangeTransactions).set({ receivedAt: new Date("2026-10-24T09:00:00Z") })
      .where(inArray(exchangeTransactions.exchangeId, ids));
    await db.update(exchangeTransactions).set({ status: "FAILED" })
      .where(eq(exchangeTransactions.exchangeId, ids[0]));
    const first = await repository.listExchanges({ sourceResultId: filterId });
    const rest = await repository.listExchanges({ sourceResultId: filterId, offset: 20 });
    assert.equal(first.length, 20);
    assert.deepEqual([...first, ...rest].map((row) => row.exchangeId), [...ids].sort());
    assert.deepEqual((await repository.listExchanges({ sourceResultId: filterId, status: "FAILED" }))
      .map((row) => row.exchangeId), [ids[0]]);
    assert.ok((await repository.listExchanges({ status: "FAILED" })).every((row) => row.status === "FAILED"));
    assert.deepEqual(await repository.listExchanges({ sourceResultId: "missing" }), []);
    assert.deepEqual(await repository.listExchanges({ sourceResultId: filterId, offset: 24 }), []);
    await db.update(exchangeTransactions).set({ receivedAt: new Date("2026-10-25T09:00:00Z") })
      .where(eq(exchangeTransactions.exchangeId, ids[0]));
    assert.equal((await repository.listExchanges({ sourceResultId: filterId, limit: 1 }))[0].exchangeId, ids[0]);
  });

  await t.test("event append and attempts retrieval are scoped and chronologically stable with ties", async () => {
    const input = newExchange(); await create(input);
    const id = input.exchangeId!;
    const time = new Date("2026-10-24T09:00:00Z");
    const attemptIds = [randomUUID(), randomUUID()].sort();
    await db.insert(exchangeAttempts).values(attemptIds.map((attemptId, index) => ({
      attemptId, exchangeId: id, phase: index === 0 ? "SEND" : "VERIFY", attemptNo: 1, startedAt: time,
    })));
    const logIds = [randomUUID(), randomUUID()].sort();
    for (const logEventId of [...logIds].reverse()) {
      await repository.appendExchangeEvent({
        exchangeId: id, logEventId, eventType: "SYNTHETIC_TEST", occurredAt: time,
        oldStatus: "RECEIVED", newStatus: "RECEIVED", attemptId: attemptIds[0], detail: { synthetic: true },
      });
    }
    const early = await repository.appendExchangeEvent({
      exchangeId: id, eventType: "TEST_EARLY", occurredAt: new Date("2026-10-20T00:00:00Z"),
    });
    const events = await repository.getExchangeEvents(id);
    assert.equal(events[0].logEventId, early.logEventId);
    assert.deepEqual(events.filter((row) => row.eventType === "SYNTHETIC_TEST").map((row) => row.logEventId), logIds);
    assert.deepEqual((await repository.getExchangeAttempts(id)).map((row) => row.attemptId), attemptIds);
    assert.deepEqual((await repository.getExchangeAttempts(id, "SEND")).map((row) => row.attemptId), [attemptIds[0]]);
    assert.deepEqual((await repository.getExchangeAttempts(id, "VERIFY")).map((row) => row.attemptId), [attemptIds[1]]);
    assert.equal((await repository.getExchangeById(id))?.status, "RECEIVED", "Appending a log does not transition status");
    const other = newExchange(); await create(other);
    await assert.rejects(repository.appendExchangeEvent({
      exchangeId: other.exchangeId!, eventType: "BAD_LINK", attemptId: attemptIds[0],
    }), (error: unknown) => hasSqlState(error, "23503"));
    assert.equal((await repository.getExchangeEvents(other.exchangeId!)).length, 1);
  });

  await t.test("receipt write failure rolls back the new exchange and leaves the connection usable", async () => {
    // No DDL or trigger required: block the receipt table from another connection,
    // then fail only the second write via a transaction-local lock_timeout.
    const blocker = await pool.connect();
    const database = middlewareDatabase.db!;
    const originalTransaction = database.transaction.bind(database);
    const { mock } = await import("node:test");
    const transactionMock = mock.method(database, "transaction", (
      operation: Parameters<typeof database.transaction>[0],
      config?: Parameters<typeof database.transaction>[1],
    ) =>
      originalTransaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '100ms'`);
        return operation(tx);
      }, config));
    const input = newExchange();
    try {
      await blocker.query("BEGIN");
      await blocker.query("LOCK integration.exchange_events IN ACCESS EXCLUSIVE MODE");
      await assert.rejects(create(input), (error: unknown) => hasSqlState(error, "55P03"));
    } finally {
      transactionMock.mock.restore();
      await blocker.query("ROLLBACK"); blocker.release();
    }
    assert.equal(await repository.getExchangeByEventId(input.sourceEnvelope.event_id), undefined);
    assert.deepEqual(await repository.getExchangeEvents(input.exchangeId!), []);
    assert.equal((await create(input)).kind, "created");
  });

  await t.test("unrelated exchange UUID collisions and invalid UUIDs fail without extra receipts", async () => {
    const input = newExchange(); await create(input);
    const collision = { ...newExchange(), exchangeId: input.exchangeId };
    await assert.rejects(create(collision), /Exchange UUID collision/);
    assert.equal(await repository.getExchangeByEventId(collision.sourceEnvelope.event_id), undefined);
    const invalid = newExchange(); invalid.sourceEnvelope.event_id = "not-a-uuid";
    await assert.rejects(create(invalid), (error: unknown) => hasSqlState(error, "22P02"));
    assert.equal(await repository.getExchangeBySourceResult(invalid.sourceEnvelope.source_system,
      invalid.sourceEnvelope.source_result_id), undefined);
    assert.equal((await repository.getExchangeEvents(input.exchangeId!)).length, 1);
  });

  await t.test("integration_app cannot read or write LIS, EMR or evaluator tables", async () => {
    for (const query of [
      "select * from lis.results limit 0", "select * from emr.lab_results limit 0",
      "delete from lis.results where false", "delete from emr.lab_results where false",
      "select * from integration.experiment_runs limit 0", "select * from integration.field_comparisons limit 0",
      "delete from integration.experiment_runs where false", "delete from integration.field_comparisons where false",
    ]) await assert.rejects(pool.query(query), (error: unknown) => hasSqlState(error, "42501"));
    assert.equal((await middlewareDatabase.check()).status, "ready");
  });
});
