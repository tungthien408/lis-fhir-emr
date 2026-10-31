import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { setTimeout as pause } from "node:timers/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { DispatchAcknowledgement, DispatchLease, PublishEvent } from "../../src/lis/repository.js";

const testUrl = process.env.LIS_REPOSITORY_TEST_DATABASE_URL?.trim();
const isolationToken = process.env.LIS_REPOSITORY_TEST_DISPOSABLE_TOKEN;
delete process.env.LIS_DATABASE_URL;
if (testUrl) process.env.LIS_DATABASE_URL = testUrl;

function sqlState(error: unknown, state: string): boolean {
  return error !== null && typeof error === "object"
    && (("code" in error && error.code === state) || ("cause" in error && sqlState(error.cause, state)));
}
function lease(event: PublishEvent): DispatchLease {
  assert.ok(event.leaseToken); return { eventId: event.eventId, leaseToken: event.leaseToken };
}
function acknowledgement(event: PublishEvent): DispatchAcknowledgement {
  return { accepted: true, event_id: event.eventId, exchange_id: randomUUID(), source_system: event.sourceSystem,
    source_result_id: event.resultId, source_hash: event.sourceHash };
}

/** All concurrency/constraints below run on actual PostgreSQL, never an outbox fake. */
test("D1 LIS Dispatcher Repository (isolated PostgreSQL)", {
  skip: testUrl ? false : "Run npm run test:lis-dispatch:postgres for disposable PostgreSQL",
  timeout: 60000,
}, async (t) => {
  assert.ok(isolationToken, "D1 requires the disposable database runner before any fixture writes");
  const repository = await import("../../src/lis/repository.js");
  const { publishResult } = await import("../../src/lis/service.js");
  const { lisDatabase } = await import("../../src/lis/db.js");
  const pool = new Pool({ connectionString: testUrl, max: 4, connectionTimeoutMillis: 3000 });
  t.after(async () => { await Promise.all([pool.end(), lisDatabase.close()]); });
  const identity = (await pool.query(`select current_user as role, current_database() as database,
    shobj_description(oid,'pg_database') as marker from pg_database where datname=current_database()`)).rows[0];
  assert.equal(identity.role, "lis_app"); assert.equal(identity.database, "dacn_db");
  assert.equal(identity.marker, `spp66-disposable:${isolationToken}`, "Refuse writes to an unmarked database");
  for (const table of ["dispatch_attempts", "publish_events", "results", "test_catalog", "patients"]) {
    assert.equal((await pool.query(`select count(*)::int as total from lis.${table}`)).rows[0].total, 0,
      "Refuse to run Dispatcher claims against an existing outbox");
  }

  async function fixture(t: TestContext) {
    const prefix = `D1-SYNTHETIC-${randomUUID()}`; const resultId = `${prefix}-R`;
    const patientId = `${prefix}-P`; const testCode = `${prefix}-T`;
    t.after(async () => {
      await pool.query("delete from lis.dispatch_attempts where event_id in (select event_id from lis.publish_events where result_id=$1)", [resultId]);
      await pool.query("delete from lis.publish_events where result_id=$1", [resultId]);
      await pool.query("delete from lis.results where result_id=$1", [resultId]);
      await pool.query("delete from lis.test_catalog where test_code=$1", [testCode]);
      await pool.query("delete from lis.patients where patient_id=$1", [patientId]);
    });
    await pool.query("insert into lis.patients(patient_id,source_subject_id,display_label) values ($1,$1,'D1 synthetic only')", [patientId]);
    await pool.query("insert into lis.test_catalog(test_code,test_name,accepted_units,catalog_version) values ($1,'D1 synthetic analyte','[\"mg/dL\"]','d1-synthetic')", [testCode]);
    await pool.query(`insert into lis.results(result_id,patient_id,test_code,value_num,unit,effective_at,result_status)
      values ($1,$2,$3,0.30000000000000004,'mg/dL','2026-10-30T08:00:00.123456Z','FINAL')`, [resultId, patientId, testCode]);
    const published = await publishResult(resultId); assert.ok(published.kind === "created");
    const event = published.event;
    const row = async () => { const found = await repository.getPublishEventByEventId(event.eventId); assert.ok(found); return found; };
    const immutable = async () => (await pool.query(`select event_id, result_id, source_system, source_snapshot, source_hash,
      published_at::text from lis.publish_events where event_id=$1`, [event.eventId])).rows[0];
    return { event, row, resultId, immutable,
      history: () => repository.getDispatchAttempts(event.eventId),
      expire: () => pool.query("update lis.publish_events set lease_until=clock_timestamp()-interval '1 second' where event_id=$1", [event.eventId]),
      async claim(leaseMs = 15000) {
        const claimed = await repository.claimPublishEvent(leaseMs); assert.equal(claimed?.eventId, event.eventId); assert.ok(claimed);
        return { event: claimed, lease: lease(claimed) };
      },
      async start(owned: DispatchLease, leaseMs = 15000, budget = 4) {
        const started = await repository.beginDispatchAttempt(owned, leaseMs, budget); assert.ok(started.kind === "started"); return started;
      },
      async ack(owned: DispatchLease, attemptId: string) {
        assert.equal(await repository.markDispatchAttemptSent(owned, attemptId), true);
        const ack = acknowledgement(event);
        assert.equal(await repository.finishDispatchAttempt(owned, attemptId, { kind: "ack", httpStatus: 202, acknowledgement: ack }), "completed");
        return ack;
      },
    };
  }

  async function waitForLock(pattern: string) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await pool.query(`select exists(select 1 from pg_stat_activity
        where usename=current_user and wait_event_type='Lock' and query like $1) as waiting`, [pattern]);
      if (result.rows[0].waiting) return;
      await pause(10);
    }
    assert.fail("Expected an actual PostgreSQL lock wait");
  }

  await t.test("PENDING claim assigns a fresh lease using database time, without starting an attempt", async (t) => {
    const c = await fixture(t); const before = await c.immutable(); const claimed = await c.claim();
    assert.equal(claimed.event.dispatchStatus, "IN_FLIGHT"); assert.ok(claimed.event.leaseUntil);
    const timing = (await pool.query("select lease_until > clock_timestamp() as live from lis.publish_events where event_id=$1", [c.event.eventId])).rows[0];
    assert.equal(timing.live, true); assert.equal(claimed.event.dispatchAttemptCount, 0);
    assert.deepEqual(await c.history(), []); assert.deepEqual(await c.immutable(), before);
  });

  await t.test("RETRY_WAIT must be due; active IN_FLIGHT and malformed missing-expiry leases are not claimed", async (t) => {
    const c = await fixture(t);
    await pool.query("update lis.publish_events set dispatch_status='RETRY_WAIT',next_retry_at=clock_timestamp()+interval '1 hour' where event_id=$1", [c.event.eventId]);
    assert.equal(await repository.claimPublishEvent(15000), undefined);
    await pool.query("update lis.publish_events set next_retry_at=clock_timestamp()-interval '1 second' where event_id=$1", [c.event.eventId]);
    await c.claim(); assert.equal(await repository.claimPublishEvent(15000), undefined);
    await pool.query("update lis.publish_events set lease_until=null where event_id=$1", [c.event.eventId]);
    assert.equal(await repository.claimPublishEvent(15000), undefined);
  });

  await t.test("ACK, BLOCKED and FAILED are never eligible even with expired lease metadata", async (t) => {
    const c = await fixture(t);
    for (const status of ["ACK", "BLOCKED", "FAILED"]) {
      await pool.query(`update lis.publish_events set dispatch_status=$2,exchange_id=$3,acked_at=clock_timestamp(),ack_response='{}',
        lease_token=$4,lease_until=clock_timestamp()-interval '1 second' where event_id=$1`, [c.event.eventId, status, randomUUID(), randomUUID()]);
      assert.equal(await repository.claimPublishEvent(15000), undefined);
    }
  });

  await t.test("two competing Dispatchers claim one event exactly once", async (t) => {
    const c = await fixture(t);
    const claims = await Promise.all([repository.claimPublishEvent(15000), repository.claimPublishEvent(15000)]);
    assert.equal(claims.filter(Boolean).length, 1); assert.equal(claims.find(Boolean)?.eventId, c.event.eventId);
    assert.equal((await c.row()).leaseToken, claims.find(Boolean)?.leaseToken);
  });

  await t.test("SKIP LOCKED skips an externally locked event and claims the other eligible event", async (t) => {
    const first = await fixture(t); const second = await fixture(t); const blocker = await pool.connect();
    try {
      await blocker.query("begin"); await blocker.query("select event_id from lis.publish_events where event_id=$1 for update", [first.event.eventId]);
      assert.equal((await repository.claimPublishEvent(15000))?.eventId, second.event.eventId);
      assert.equal(await repository.claimPublishEvent(15000), undefined);
    } finally { await blocker.query("rollback"); blocker.release(); }
    assert.equal((await repository.claimPublishEvent(15000))?.eventId, first.event.eventId);
  });

  await t.test("concurrent attempt starts reserve one monotonic number and one counter increment", async (t) => {
    const c = await fixture(t); const claimed = await c.claim();
    const started = await Promise.all([repository.beginDispatchAttempt(claimed.lease, 15000, 4), repository.beginDispatchAttempt(claimed.lease, 15000, 4)]);
    assert.deepEqual(started.map((outcome) => outcome.kind).sort(), ["attempt_active", "started"]);
    const attempts = await c.history(); assert.equal(attempts.length, 1); assert.equal(attempts[0].attemptNo, 1);
    assert.equal(attempts[0].leaseToken, claimed.lease.leaseToken); assert.ok(attempts[0].startedAt);
    assert.equal(attempts[0].sentAt, null); assert.equal((await c.row()).dispatchAttemptCount, 1);
    assert.equal(await repository.markDispatchAttemptSent(claimed.lease, attempts[0].dispatchAttemptId), true);
    const sent = await c.history(); assert.ok(sent[0].sentAt);
    assert.equal(await repository.markDispatchAttemptSent(claimed.lease, attempts[0].dispatchAttemptId), true);
    assert.deepEqual(await c.history(), sent);
    await assert.rejects(pool.query("insert into lis.dispatch_attempts(dispatch_attempt_id,event_id,attempt_no) values ($1,$2,1)",
      [randomUUID(), c.event.eventId]), (error: unknown) => sqlState(error, "23505"));
  });

  await t.test("ACK commits receipt, required fields and completed attempt together, and clears lease/errors", async (t) => {
    const c = await fixture(t); const before = await c.immutable(); const claimed = await c.claim(); const started = await c.start(claimed.lease);
    const ack = await c.ack(claimed.lease, started.attempt.dispatchAttemptId);
    const row = await c.row(); assert.equal(row.dispatchStatus, "ACK"); assert.equal(row.exchangeId, ack.exchange_id);
    assert.ok(row.ackedAt); assert.deepEqual(row.ackResponse, ack);
    assert.equal(row.leaseToken, null); assert.equal(row.leaseUntil, null); assert.equal(row.nextRetryAt, null);
    assert.equal(row.lastErrorCode, null); assert.equal(row.lastErrorMessage, null);
    const [attempt] = await c.history(); assert.ok(attempt.sentAt && attempt.responseAt && attempt.endedAt);
    assert.equal(attempt.httpStatus, 202); assert.deepEqual(attempt.responseBody, ack); assert.equal(attempt.errorCode, null);
    assert.deepEqual(await c.immutable(), before);
    await assert.rejects(pool.query("update lis.publish_events set acked_at=null where event_id=$1", [row.eventId]),
      (error: unknown) => sqlState(error, "23514"));
    const retriedPublish = await publishResult(c.resultId); assert.ok(retriedPublish.kind === "existing");
    assert.deepEqual(retriedPublish.event, row);
  });

  await t.test("ACK requires matching identifiers/hash and a recorded send; arbitrary response extras are excluded", async (t) => {
    const c = await fixture(t); const claimed = await c.claim(); const started = await c.start(claimed.lease);
    const id = started.attempt.dispatchAttemptId; const ack = acknowledgement(c.event);
    assert.equal(await repository.finishDispatchAttempt(claimed.lease, id, { kind: "ack", httpStatus: 202, acknowledgement: ack }), "attempt_not_sent");
    await repository.markDispatchAttemptSent(claimed.lease, id);
    for (const bad of [{ ...ack, accepted: false }, { ...ack, event_id: randomUUID() }, { ...ack, exchange_id: "bad" },
      { ...ack, source_system: "wrong" }, { ...ack, source_result_id: "wrong" }, { ...ack, source_hash: "b".repeat(64) }]) {
      assert.equal(await repository.finishDispatchAttempt(claimed.lease, id,
        { kind: "ack", httpStatus: 202, acknowledgement: bad as DispatchAcknowledgement }), "invalid_ack");
    }
    assert.equal((await c.row()).dispatchStatus, "IN_FLIGHT"); assert.equal((await c.history())[0].endedAt, null);
    assert.equal(await repository.finishDispatchAttempt(claimed.lease, id, { kind: "ack", httpStatus: 202,
      acknowledgement: { ...ack, private_diagnostic: "Must not be persisted" } as DispatchAcknowledgement }), "completed");
    assert.deepEqual((await c.row()).ackResponse, ack); assert.deepEqual((await c.history())[0].responseBody, ack);
  });

  await t.test("retry uses server time, preserves the envelope, and the next real attempt gets number 2", async (t) => {
    const c = await fixture(t); const before = await c.immutable(); const first = await c.claim(); const a1 = await c.start(first.lease);
    await repository.markDispatchAttemptSent(first.lease, a1.attempt.dispatchAttemptId);
    assert.equal(await repository.finishDispatchAttempt(first.lease, a1.attempt.dispatchAttemptId,
      { kind: "retry", httpStatus: 503, code: "HTTP_TEMPORARY", delayMs: 3600000 }), "completed");
    const waiting = await c.row(); assert.equal(waiting.dispatchStatus, "RETRY_WAIT"); assert.ok(waiting.nextRetryAt);
    assert.equal(waiting.leaseToken, null); assert.equal(waiting.lastErrorCode, "HTTP_TEMPORARY");
    assert.equal((await pool.query("select next_retry_at > clock_timestamp()+interval '59 minutes' as bounded from lis.publish_events where event_id=$1", [c.event.eventId])).rows[0].bounded, true);
    assert.equal(await repository.claimPublishEvent(15000), undefined);
    await pool.query("update lis.publish_events set next_retry_at=clock_timestamp()-interval '1 second' where event_id=$1", [c.event.eventId]);
    const second = await c.claim(); assert.notEqual(first.lease.leaseToken, second.lease.leaseToken); const a2 = await c.start(second.lease);
    assert.equal(a2.attempt.attemptNo, 2); assert.equal((await c.row()).dispatchAttemptCount, 2);
    await c.ack(second.lease, a2.attempt.dispatchAttemptId); assert.deepEqual(await c.immutable(), before);
    assert.deepEqual((await c.history()).map((attempt) => [attempt.attemptNo, attempt.httpStatus]), [[1, 503], [2, 202]]);
  });

  await t.test("network failure records no invented HTTP response; BLOCKED and FAILED release ownership", async (t) => {
    for (const status of ["BLOCKED", "FAILED"] as const) {
      const c = await fixture(t); const owned = await c.claim(); const started = await c.start(owned.lease);
      assert.equal(await repository.finishDispatchAttempt(owned.lease, started.attempt.dispatchAttemptId,
        { kind: "terminal", status, code: "VALIDATION_ERROR" }), "completed");
      const [attempt] = await c.history(); assert.ok(attempt.endedAt); assert.equal(attempt.sentAt, null);
      assert.equal(attempt.responseAt, null); assert.equal(attempt.httpStatus, null);
      assert.deepEqual(attempt.responseBody, { outcome: "terminal", code: "VALIDATION_ERROR" });
      assert.equal((await c.row()).dispatchStatus, status); assert.equal((await c.row()).leaseToken, null);
      assert.equal(await repository.claimPublishEvent(15000), undefined);
    }
    const c = await fixture(t); const owned = await c.claim(); const started = await c.start(owned.lease);
    await repository.markDispatchAttemptSent(owned.lease, started.attempt.dispatchAttemptId);
    assert.equal(await repository.finishDispatchAttempt(owned.lease, started.attempt.dispatchAttemptId,
      { kind: "retry", delayMs: 1000, code: "NETWORK_ERROR" }), "completed");
    const [attempt] = await c.history(); assert.ok(attempt.sentAt && attempt.endedAt);
    assert.equal(attempt.responseAt, null); assert.equal(attempt.httpStatus, null);
    assert.deepEqual(attempt.responseBody, { outcome: "retry", code: "NETWORK_ERROR" });
  });

  await t.test("expired claim before any attempt is recovered without inventing history", async (t) => {
    const c = await fixture(t); const original = await c.claim(); await c.expire(); const recovered = await c.claim();
    assert.notEqual(recovered.lease.leaseToken, original.lease.leaseToken);
    assert.deepEqual(await c.history(), []); assert.equal((await c.row()).dispatchAttemptCount, 0);
    assert.deepEqual(await repository.beginDispatchAttempt(original.lease, 15000, 4), { kind: "stale_lease" });
    assert.equal((await c.start(recovered.lease)).attempt.attemptNo, 1);
  });

  await t.test("crashed attempt is abandoned; new lease increments number; old owner cannot overwrite the final ACK", async (t) => {
    const c = await fixture(t); const before = await c.immutable(); const old = await c.claim(); const a1 = await c.start(old.lease);
    await repository.markDispatchAttemptSent(old.lease, a1.attempt.dispatchAttemptId);
    await c.expire(); const recovered = await c.claim(); const history = await c.history();
    assert.equal(history[0].errorCode, "LEASE_EXPIRED"); assert.ok(history[0].endedAt);
    assert.equal(history[0].responseAt, null); assert.deepEqual(history[0].responseBody, { outcome: "ABANDONED" });
    const a2 = await c.start(recovered.lease); assert.equal(a2.attempt.attemptNo, 2);
    assert.equal(await repository.finishDispatchAttempt(old.lease, a1.attempt.dispatchAttemptId,
      { kind: "ack", httpStatus: 202, acknowledgement: acknowledgement(c.event) }), "stale_lease");
    await c.ack(recovered.lease, a2.attempt.dispatchAttemptId); const saved = await c.row(); const attempts = await c.history();
    for (const result of [
      { kind: "retry", delayMs: 1000, code: "NETWORK_ERROR" },
      { kind: "terminal", status: "FAILED", code: "HTTP_PERMANENT" },
      { kind: "ack", httpStatus: 202, acknowledgement: acknowledgement(c.event) },
    ] as const) assert.equal(await repository.finishDispatchAttempt(old.lease, a1.attempt.dispatchAttemptId, result), "stale_lease");
    assert.equal(await repository.markDispatchAttemptSent(old.lease, a1.attempt.dispatchAttemptId), false);
    assert.deepEqual(await repository.beginDispatchAttempt(old.lease, 15000, 4), { kind: "stale_lease" });
    assert.deepEqual(await c.row(), saved); assert.deepEqual(await c.history(), attempts); assert.deepEqual(await c.immutable(), before);
  });

  await t.test("expired owner is rejected even before a replacement exists", async (t) => {
    const c = await fixture(t); const old = await c.claim(); const attempt = await c.start(old.lease); await c.expire();
    const before = await c.history();
    assert.equal(await repository.markDispatchAttemptSent(old.lease, attempt.attempt.dispatchAttemptId), false);
    assert.equal(await repository.finishDispatchAttempt(old.lease, attempt.attempt.dispatchAttemptId,
      { kind: "retry", delayMs: 1000, code: "NETWORK_ERROR" }), "stale_lease");
    assert.deepEqual(await c.history(), before);
  });

  await t.test("foreign event/attempt tokens cannot finish another event's history", async (t) => {
    const first = await fixture(t); const a = await first.claim(); const started = await first.start(a.lease);
    const second = await fixture(t); const b = await second.claim();
    assert.equal(await repository.markDispatchAttemptSent(b.lease, started.attempt.dispatchAttemptId), false);
    assert.equal(await repository.finishDispatchAttempt(b.lease, started.attempt.dispatchAttemptId,
      { kind: "retry", delayMs: 1000, code: "NETWORK_ERROR" }), "attempt_not_active");
    assert.equal((await first.history())[0].endedAt, null); assert.deepEqual(await second.history(), []);
  });

  await t.test("interrupted last allowed attempt cannot reset the budget through repeated recovery", async (t) => {
    const c = await fixture(t); const first = await c.claim(); await c.start(first.lease, 15000, 1);
    await c.expire(); const recovered = await c.claim();
    assert.deepEqual(await repository.beginDispatchAttempt(recovered.lease, 15000, 1), { kind: "exhausted" });
    assert.equal((await c.row()).dispatchStatus, "FAILED"); assert.equal((await c.row()).lastErrorCode, "RETRY_EXHAUSTED");
    assert.equal((await c.row()).dispatchAttemptCount, 1); assert.equal((await c.history()).length, 1);
    assert.equal(await repository.claimPublishEvent(15000), undefined);
  });

  await t.test("counter/history drift fails closed instead of recycling an old attempt number", async (t) => {
    const c = await fixture(t); const owned = await c.claim();
    await pool.query("update lis.publish_events set dispatch_attempt_count=2 where event_id=$1", [c.event.eventId]);
    await assert.rejects(repository.beginDispatchAttempt(owned.lease, 15000, 4), /history is inconsistent/);
    assert.deepEqual(await c.history(), []); assert.equal((await c.row()).dispatchAttemptCount, 2);
  });

  await t.test("a completion waiting for an event lock rechecks expiry after the wait", async (t) => {
    const c = await fixture(t); const owned = await c.claim(); const started = await c.start(owned.lease);
    await repository.markDispatchAttemptSent(owned.lease, started.attempt.dispatchAttemptId);
    const blocker = await pool.connect();
    try {
      await blocker.query("begin");
      await blocker.query("select event_id from lis.publish_events where event_id=$1 for update", [c.event.eventId]);
      const pending = repository.finishDispatchAttempt(owned.lease, started.attempt.dispatchAttemptId,
        { kind: "ack", httpStatus: 202, acknowledgement: acknowledgement(c.event) });
      void pending.catch(() => undefined); await waitForLock('select%"lis"."publish_events"%for update%');
      await blocker.query("update lis.publish_events set lease_until=clock_timestamp()-interval '1 second' where event_id=$1", [c.event.eventId]);
      await blocker.query("commit"); assert.equal(await pending, "stale_lease");
      assert.equal((await c.history())[0].endedAt, null); assert.equal((await c.row()).dispatchStatus, "IN_FLIGHT");
    } finally { await blocker.query("rollback"); blocker.release(); }
  });

  await t.test("expiry during an attempt-row lock wait rolls back both attempt completion and ACK", async (t) => {
    const c = await fixture(t); const owned = await c.claim(); const started = await c.start(owned.lease);
    await repository.markDispatchAttemptSent(owned.lease, started.attempt.dispatchAttemptId);
    await pool.query("update lis.publish_events set lease_until=clock_timestamp()+interval '300 milliseconds' where event_id=$1", [c.event.eventId]);
    const blocker = await pool.connect();
    try {
      await blocker.query("begin"); await blocker.query("select dispatch_attempt_id from lis.dispatch_attempts where dispatch_attempt_id=$1 for update", [started.attempt.dispatchAttemptId]);
      const pending = repository.finishDispatchAttempt(owned.lease, started.attempt.dispatchAttemptId,
        { kind: "ack", httpStatus: 202, acknowledgement: acknowledgement(c.event) });
      void pending.catch(() => undefined); await waitForLock('select%"lis"."dispatch_attempts"%for update%');
      for (let n = 0; n < 100; n++) {
        if ((await pool.query("select lease_until<=clock_timestamp() as expired from lis.publish_events where event_id=$1", [c.event.eventId])).rows[0].expired) break;
        await pause(10);
      }
      await blocker.query("commit"); assert.equal(await pending, "stale_lease");
      assert.equal((await c.history())[0].endedAt, null); assert.equal((await c.row()).ackResponse, null);
    } finally { await blocker.query("rollback"); blocker.release(); }
  });

  await t.test("a database failure after the attempt UPDATE rolls back ACK and attempt atomically", async (t) => {
    const c = await fixture(t); const owned = await c.claim(); const started = await c.start(owned.lease);
    await repository.markDispatchAttemptSent(owned.lease, started.attempt.dispatchAttemptId);
    const eventBefore = await c.row(); const attemptsBefore = await c.history(); const blocker = await pool.connect();
    try {
      await blocker.query("begin"); await blocker.query("lock table lis.publish_events in share mode");
      await assert.rejects(repository.finishDispatchAttempt(owned.lease, started.attempt.dispatchAttemptId,
        { kind: "ack", httpStatus: 202, acknowledgement: acknowledgement(c.event) }), (error: unknown) => sqlState(error, "55P03"));
      await blocker.query("rollback");
      assert.deepEqual(await c.row(), eventBefore); assert.deepEqual(await c.history(), attemptsBefore);
    } finally { await blocker.query("rollback"); blocker.release(); }
    await c.ack(owned.lease, started.attempt.dispatchAttemptId);
  });

  await t.test("failed attempt INSERT rolls back its counter increment and lease renewal", async (t) => {
    const c = await fixture(t); const owned = await c.claim(); const before = await c.row(); const blocker = await pool.connect();
    try {
      await blocker.query("begin"); await blocker.query("lock table lis.dispatch_attempts in share mode");
      await assert.rejects(repository.beginDispatchAttempt(owned.lease, 15000, 4), (error: unknown) => sqlState(error, "55P03"));
      await blocker.query("rollback"); assert.deepEqual(await c.row(), before); assert.deepEqual(await c.history(), []);
    } finally { await blocker.query("rollback"); blocker.release(); }
    assert.equal((await c.start(owned.lease)).attempt.attemptNo, 1);
  });

  await t.test("LIS role has no Middleware/EMR access and a database outage is not a stale-lease result", async (t) => {
    for (const table of ["integration.exchange_transactions", "emr.lab_results"]) {
      await assert.rejects(pool.query(`select 1 from ${table}`), (error: unknown) => sqlState(error, "42501"));
    }
    const c = await fixture(t); const owned = await c.claim(); const started = await c.start(owned.lease);
    const original = lisDatabase.db; const closed = new Pool({ connectionString: testUrl }); await closed.end();
    lisDatabase.db = drizzle({ client: closed });
    try {
      for (const operation of [() => repository.claimPublishEvent(15000),
        () => repository.beginDispatchAttempt(owned.lease, 15000, 4),
        () => repository.markDispatchAttemptSent(owned.lease, started.attempt.dispatchAttemptId),
        () => repository.finishDispatchAttempt(owned.lease, started.attempt.dispatchAttemptId,
          { kind: "retry", code: "NETWORK_ERROR", delayMs: 1000 }), () => c.history()]) await assert.rejects(operation);
    } finally { lisDatabase.db = original; }
    assert.equal((await c.history())[0].endedAt, null);
  });
});
