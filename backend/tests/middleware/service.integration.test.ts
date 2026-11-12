import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { count, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { SourceEnvelope } from "../../src/middleware/repository.js";
import { exchangeAttempts, exchangeEvents, exchangeTransactions } from "../../src/middleware/schema.js";
import { rehash, validEnvelope } from "./service-fixtures.js";

const testUrl = process.env.MIDDLEWARE_REPOSITORY_TEST_DATABASE_URL?.trim();
delete process.env.MIDDLEWARE_DATABASE_URL;
if (testUrl) process.env.MIDDLEWARE_DATABASE_URL = testUrl;

test("Middleware acceptExchange integration (PostgreSQL)", {
  skip: testUrl ? false : "Set MIDDLEWARE_REPOSITORY_TEST_DATABASE_URL to a disposable PostgreSQL database",
}, async (t) => {
  const { acceptExchange } = await import("../../src/middleware/service.js");
  const repository = await import("../../src/middleware/repository.js");
  const { middlewareDatabase } = await import("../../src/middleware/db.js");
  const pool = new Pool({ connectionString: testUrl, max: 3, connectionTimeoutMillis: 3000 });
  const db = drizzle({ client: pool });
  const eventIds: string[] = [];
  t.after(async () => {
    try {
      if (eventIds.length) await db.transaction(async (tx) => {
        const rows = await tx.select({ id: exchangeTransactions.exchangeId }).from(exchangeTransactions)
          .where(inArray(exchangeTransactions.eventId, eventIds));
        const ids = rows.map((row) => row.id);
        if (ids.length) {
          await tx.delete(exchangeEvents).where(inArray(exchangeEvents.exchangeId, ids));
          await tx.delete(exchangeAttempts).where(inArray(exchangeAttempts.exchangeId, ids));
          await tx.delete(exchangeTransactions).where(inArray(exchangeTransactions.exchangeId, ids));
        }
      });
    } finally { await Promise.all([pool.end(), middlewareDatabase.close()]); }
  });
  assert.equal((await pool.query<{ role: string }>("select current_user as role")).rows[0].role, "integration_app");
  for (const table of [exchangeTransactions, exchangeEvents, exchangeAttempts]) {
    const [row] = await db.select({ total: count() }).from(table);
    assert.equal(row.total, 0, "Use an empty disposable database, never project data");
  }

  async function accept(input = validEnvelope()) {
    eventIds.push(input.event_id);
    return acceptExchange(input);
  }

  await t.test("valid LIS-hashed envelope is accepted only after its complete RECEIVED row and receipt exist", async () => {
    const input = validEnvelope(); const result = await accept(input);
    assert.ok(result.kind === "accepted"); assert.equal(result.created, true);
    assert.equal(result.accepted, true);
    assert.equal(result.event_id, input.event_id);
    assert.equal(result.source_system, input.source_system);
    assert.equal(result.source_result_id, input.source_result_id);
    assert.equal(result.source_hash, input.source_hash);
    const row = await repository.getExchangeById(result.exchange_id);
    assert.equal(row?.status, "RECEIVED");
    assert.deepEqual(row?.sourcePayload, input);
    assert.equal(row?.fhirPayload, null);
    const history = await repository.getExchangeEvents(result.exchange_id);
    assert.equal(history.length, 1); assert.equal(history[0].eventType, "RECEIVED");
  });

  await t.test("identical retry and reordered object keys reuse the exchange and its single receipt", async () => {
    const input = validEnvelope(); const first = await accept(input);
    assert.ok(first.kind === "accepted");
    const reordered: SourceEnvelope = { ...input, source_snapshot: Object.fromEntries(
      Object.entries(input.source_snapshot).reverse(),
    ) as SourceEnvelope["source_snapshot"] };
    const retry = await accept(reordered);
    assert.deepEqual(retry, { ...first, created: false });
    assert.equal((await repository.getExchangeEvents(first.exchange_id)).length, 1);
  });

  await t.test("invalid and tampered requests store neither transaction nor receipt", async () => {
    const cases = [validEnvelope(), validEnvelope(), validEnvelope(), validEnvelope()];
    cases[0].source_snapshot.value_num = 9;
    cases[1].source_hash = "not-a-sha256";
    cases[2].source_result_id = "mismatched-id";
    const invalidStatus: Record<string, unknown> = cases[3].source_snapshot; invalidStatus.result_status = "READY";
    const [before] = await db.select({ total: count() }).from(exchangeEvents);
    for (const input of cases) {
      const result = await accept(input);
      assert.ok(result.kind === "invalid" || result.kind === "malformed");
      assert.equal(await repository.getExchangeByEventId(input.event_id), undefined);
    }
    const [after] = await db.select({ total: count() }).from(exchangeEvents);
    assert.equal(after.total, before.total);
  });

  await t.test("same identifiers with changed, correctly rehashed content return DUPLICATE_CONFLICT", async () => {
    const input = validEnvelope(); const first = await accept(input); assert.ok(first.kind === "accepted");
    const before = await repository.getExchangeById(first.exchange_id);
    const changed = structuredClone(input); changed.source_snapshot.value_num = 9; rehash(changed);
    const result = await accept(changed);
    assert.ok(result.kind === "conflict"); assert.equal(result.error.code, "DUPLICATE_CONFLICT");
    assert.deepEqual(await repository.getExchangeById(first.exchange_id), before);
    assert.equal((await repository.getExchangeEvents(first.exchange_id)).length, 1);
  });

  await t.test("same event with another source and same source pair with another event both conflict", async () => {
    const input = validEnvelope(); const first = await accept(input); assert.ok(first.kind === "accepted");
    const otherSource = validEnvelope(); otherSource.event_id = input.event_id;
    const otherEvent = { ...input, event_id: randomUUID() };
    for (const retry of [otherSource, otherEvent]) {
      const result = await accept(retry);
      assert.ok(result.kind === "conflict"); assert.equal(result.error.code, "DUPLICATE_CONFLICT");
    }
    assert.equal(await repository.getExchangeByEventId(otherEvent.event_id), undefined);
    assert.equal((await repository.getExchangeEvents(first.exchange_id)).length, 1);
  });

  await t.test("two identifiers pointing to different exchanges conflict without changing either", async () => {
    const a = validEnvelope(); const b = validEnvelope();
    const first = await accept(a); const second = await accept(b);
    assert.ok(first.kind === "accepted" && second.kind === "accepted");
    const rows = await Promise.all([repository.getExchangeById(first.exchange_id), repository.getExchangeById(second.exchange_id)]);
    assert.equal((await accept({ ...b, event_id: a.event_id })).kind, "conflict");
    assert.deepEqual(await Promise.all([repository.getExchangeById(first.exchange_id), repository.getExchangeById(second.exchange_id)]), rows);
  });

  await t.test("equal snapshot hash does not permit a changed publication timestamp or outer content", async () => {
    const input = validEnvelope(); const first = await accept(input); assert.ok(first.kind === "accepted");
    // Exactly the same instant, but B1 compares the unmodified original envelope.
    for (const retry of [
      { ...input, published_at: "2026-10-22T16:00:00.123456+07:00" },
      { ...input, extra: "changed envelope" },
    ]) assert.equal((await accept(retry)).kind, "conflict");
    assert.equal((await repository.getExchangeEvents(first.exchange_id)).length, 1);
  });

  await t.test("eight simultaneous identical requests yield one creation and seven accepted retries", async () => {
    const input = validEnvelope();
    const results = await Promise.all(Array.from({ length: 8 }, () => accept(input)));
    assert.ok(results.every((result) => result.kind === "accepted"));
    assert.equal(results.filter((result) => result.created).length, 1);
    const ids = new Set(results.map((result) => result.exchange_id)); assert.equal(ids.size, 1);
    assert.equal((await repository.getExchangeEvents(results[0].exchange_id)).length, 1);
  });

  for (const key of ["event", "source pair"] as const) {
    await t.test(`concurrent conflicting requests on ${key} cannot both be accepted`, async () => {
      const a = validEnvelope(); const b = structuredClone(a);
      if (key === "event") { b.source_snapshot.value_num = 9; rehash(b); }
      else b.event_id = randomUUID();
      const results = await Promise.all([accept(a), accept(b)]);
      assert.equal(results.filter((result) => result.kind === "accepted").length, 1);
      assert.equal(results.filter((result) => result.kind === "conflict").length, 1);
    });
  }

  await t.test("all existing statuses, payloads, timestamps, counters, attempts and history survive retries", async () => {
    for (const status of ["RECEIVED", "PROCESSING", "VERIFYING", "RETRY_WAIT", "DELIVERED", "REJECTED", "FAILED"] as const) {
      const input = validEnvelope(); const first = await accept(input); assert.ok(first.kind === "accepted");
      const now = new Date("2026-10-25T09:00:00Z");
      await db.update(exchangeTransactions).set({
        status, retryPhase: status === "RETRY_WAIT" ? "VERIFY" : null,
        nextRetryAt: now, leaseUntil: now, leaseToken: randomUUID(),
        sendAttemptCount: 2, verifyAttemptCount: 1, fhirPayload: { synthetic: true },
        validatedAt: now, verifiedAt: status === "DELIVERED" ? now : null,
        completedAt: status === "DELIVERED" ? now : null,
      }).where(eq(exchangeTransactions.exchangeId, first.exchange_id));
      const attemptId = randomUUID();
      await db.insert(exchangeAttempts).values({ attemptId, exchangeId: first.exchange_id, attemptNo: 1, phase: "SEND" });
      await repository.appendExchangeEvent({ exchangeId: first.exchange_id, eventType: "TEST_STATE", newStatus: status, attemptId });
      const before = await repository.getExchangeById(first.exchange_id);
      const events = await repository.getExchangeEvents(first.exchange_id);
      const attempts = await repository.getExchangeAttempts(first.exchange_id);
      const retry = await accept(input);
      assert.deepEqual(retry, { ...first, created: false });
      assert.deepEqual(await repository.getExchangeById(first.exchange_id), before);
      assert.deepEqual(await repository.getExchangeEvents(first.exchange_id), events);
      assert.deepEqual(await repository.getExchangeAttempts(first.exchange_id), attempts);
    }
  });

  await t.test("numeric extremes and timestamp microseconds persist without unit/value conversion", async () => {
    for (const value of [Number.MIN_VALUE, Number.MAX_VALUE, -2.5, -0]) {
      const input = validEnvelope(); input.source_snapshot.value_num = value;
      input.source_snapshot.reference_low = null; input.source_snapshot.reference_high = null;
      input.source_snapshot.effective_at = "0004-02-29T00:00:00.000001Z";
      input.published_at = "2026-10-22T16:00:00.123456+07:00"; rehash(input);
      const result = await accept(input); assert.ok(result.kind === "accepted");
      const row = await repository.getExchangeById(result.exchange_id);
      assert.deepEqual(row?.sourcePayload, JSON.parse(JSON.stringify(input)));
      const timestamp = await pool.query<{ exact: string }>(`select
        to_char(published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as exact
        from integration.exchange_transactions where exchange_id = $1`, [result.exchange_id]);
      assert.equal(timestamp.rows[0].exact, "2026-10-22T09:00:00.123456Z");
    }
  });

  const lisUrl = process.env.LIS_REPOSITORY_TEST_DATABASE_URL?.trim();
  await t.test("accepts the actual LIS Publish Service snapshot/hash, including exact numeric and timestamp representation", {
    skip: lisUrl ? false : "Set LIS_REPOSITORY_TEST_DATABASE_URL for the actual Publish cross-service fixture",
  }, async (subtest) => {
    delete process.env.LIS_DATABASE_URL;
    process.env.LIS_DATABASE_URL = lisUrl;
    const lisService = await import("../../src/lis/service.js");
    const { lisDatabase } = await import("../../src/lis/db.js");
    const { patients, results, testCatalog, publishEvents } = await import("../../src/lis/schema.js");
    const lisPool = new Pool({ connectionString: lisUrl, connectionTimeoutMillis: 3000 });
    const lisDb = drizzle({ client: lisPool });
    const id = `B2-LIS-GOLDEN-${randomUUID()}`;
    subtest.after(async () => {
      try {
        await lisDb.transaction(async (tx) => {
          await tx.delete(publishEvents).where(eq(publishEvents.resultId, id));
          await tx.delete(results).where(eq(results.resultId, id));
          await tx.delete(testCatalog).where(eq(testCatalog.testCode, "50912"));
          await tx.delete(patients).where(eq(patients.patientId, id));
        });
      } finally { await Promise.all([lisPool.end(), lisDatabase.close()]); }
    });
    assert.equal((await lisPool.query<{ role: string }>("select current_user as role")).rows[0].role, "lis_app");
    for (const table of [patients, results, testCatalog, publishEvents]) {
      const [row] = await lisDb.select({ total: count() }).from(table);
      assert.equal(row.total, 0, "Cross-service fixture requires an empty disposable LIS database");
    }
    await lisDb.transaction(async (tx) => {
      await tx.insert(patients).values({ patientId: id, sourceSubjectId: id, displayLabel: "Synthetic B2" });
      await tx.insert(testCatalog).values({ testCode: "50912", testName: "Synthetic analyte", acceptedUnits: ["mg/dL"], catalogVersion: "b2-test" });
      await tx.insert(results).values({ resultId: id, patientId: id, testCode: "50912", valueNum: "3.4000",
        unit: "mg/dL", effectiveAt: sql`'2180-06-03T12:00:00.123456Z'::timestamptz`, resultStatus: "FINAL" });
    });
    const published = await lisService.publishResult(id); assert.ok(published.kind === "created");
    const event = published.event;
    const envelope: SourceEnvelope = { event_id: event.eventId, source_system: event.sourceSystem,
      source_result_id: event.resultId, source_snapshot: event.sourceSnapshot as SourceEnvelope["source_snapshot"],
      source_hash: event.sourceHash, published_at: event.publishedAt.toISOString() };
    const accepted = await accept(envelope); assert.ok(accepted.kind === "accepted");
    assert.equal(accepted.source_hash, event.sourceHash);
    assert.equal(envelope.source_snapshot.value_num, 3.4);
    assert.equal(envelope.source_snapshot.effective_at, "2180-06-03T12:00:00.123456Z");
    assert.deepEqual((await repository.getExchangeById(accepted.exchange_id))?.sourcePayload, envelope);
  });

  await t.test("a real receipt INSERT failure produces unavailable and rolls back the entire acceptance", async () => {
    const blocker = await pool.connect();
    const database = middlewareDatabase.db!;
    const originalTransaction = database.transaction.bind(database);
    const transactionMock = t.mock.method(database, "transaction", (
      operation: Parameters<typeof database.transaction>[0], config?: Parameters<typeof database.transaction>[1],
    ) => originalTransaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '100ms'`); return operation(tx);
    }, config));
    const input = validEnvelope();
    try {
      await blocker.query("BEGIN");
      await blocker.query("LOCK integration.exchange_events IN ACCESS EXCLUSIVE MODE");
      const result = await accept(input);
      assert.deepEqual(result, { kind: "unavailable", error: {
        code: "DEPENDENCY_UNAVAILABLE", message: "Exchange persistence is temporarily unavailable",
      } });
    } finally {
      transactionMock.mock.restore(); await blocker.query("ROLLBACK"); blocker.release();
    }
    assert.equal(await repository.getExchangeByEventId(input.event_id), undefined);
    const retry = await accept(input); assert.ok(retry.kind === "accepted"); assert.equal(retry.created, true);
    assert.equal((await repository.getExchangeEvents(retry.exchange_id)).length, 1);
  });
});
