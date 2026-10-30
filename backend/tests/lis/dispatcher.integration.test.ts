import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { setTimeout as pause } from "node:timers/promises";
import { Pool } from "pg";
import { dispatcherConfig, expectedEnvelope, fakeMiddleware, gate } from "./dispatcher-test-support.js";
import type { DispatcherConfig } from "../../src/lis/dispatcher-config.js";

const testUrl = process.env.LIS_REPOSITORY_TEST_DATABASE_URL?.trim();
const isolationToken = process.env.LIS_REPOSITORY_TEST_DISPOSABLE_TOKEN;
delete process.env.LIS_DATABASE_URL;
if (testUrl) process.env.LIS_DATABASE_URL = testUrl;

test("D2 LIS Dispatcher + D1 Repository (isolated PostgreSQL, fake Middleware HTTP)", {
  skip: testUrl ? false : "Run npm run test:lis-dispatch:postgres for disposable PostgreSQL",
  timeout: 90000,
}, async (t) => {
  assert.ok(isolationToken, "D2 requires a disposable database before any claims or writes");
  const { LisDispatcher } = await import("../../src/lis/dispatcher.js");
  const repository = await import("../../src/lis/repository.js");
  const { publishResult } = await import("../../src/lis/service.js");
  const { lisDatabase } = await import("../../src/lis/db.js");
  const pool = new Pool({ connectionString: testUrl, max: 4, connectionTimeoutMillis: 3000 });
  t.after(async () => { await Promise.all([pool.end(), lisDatabase.close()]); });
  const identity = (await pool.query(`select current_user as role,current_database() as database,
    shobj_description(oid,'pg_database') as marker from pg_database where datname=current_database()`)).rows[0];
  assert.equal(identity.role, "lis_app"); assert.equal(identity.database, "dacn_db");
  assert.equal(identity.marker, `spp66-disposable:${isolationToken}`);
  for (const table of ["dispatch_attempts", "publish_events", "results", "test_catalog", "patients"]) {
    assert.equal((await pool.query(`select count(*)::int as total from lis.${table}`)).rows[0].total, 0,
      "Refuse to run a Dispatcher against a pre-existing outbox");
  }

  async function fixture(t: TestContext) {
    const id = `D2-SYNTHETIC-${randomUUID()}`; const resultId = `${id}-R`; const patientId = `${id}-P`; const testCode = `${id}-T`;
    t.after(async () => {
      await pool.query("delete from lis.dispatch_attempts where event_id in (select event_id from lis.publish_events where result_id=$1)", [resultId]);
      await pool.query("delete from lis.publish_events where result_id=$1", [resultId]);
      await pool.query("delete from lis.results where result_id=$1", [resultId]);
      await pool.query("delete from lis.test_catalog where test_code=$1", [testCode]);
      await pool.query("delete from lis.patients where patient_id=$1", [patientId]);
    });
    await pool.query("insert into lis.patients(patient_id,source_subject_id,display_label) values ($1,$1,'D2 synthetic only')", [patientId]);
    await pool.query(`insert into lis.test_catalog(test_code,test_name,fluid,category,accepted_units,catalog_version)
      values ($1,'D2 synthetic analyte','Blood','Chemistry','["mg/dL"]','d2-synthetic')`, [testCode]);
    await pool.query(`insert into lis.results(result_id,patient_id,test_code,value_num,unit,reference_high,effective_at,result_status)
      values ($1,$2,$3,0.30000000000000004,'mg/dL',4.5,'2026-10-30T08:00:00.123456Z','FINAL')`, [resultId, patientId, testCode]);
    const published = await publishResult(resultId); assert.equal(published.kind, "created");
    assert.ok(published.kind === "created"); const event = published.event;
    const row = async () => { const saved = await repository.getPublishEventByEventId(event.eventId); assert.ok(saved); return saved; };
    return { event, row, resultId,
      history: () => repository.getDispatchAttempts(event.eventId),
      immutable: async () => (await pool.query(`select event_id,result_id,source_system,source_snapshot,source_hash,published_at::text
        from lis.publish_events where event_id=$1`, [event.eventId])).rows[0],
      due: () => pool.query("update lis.publish_events set next_retry_at=clock_timestamp()-interval '1 second' where event_id=$1", [event.eventId]),
      expire: () => pool.query("update lis.publish_events set lease_until=clock_timestamp()-interval '1 second' where event_id=$1", [event.eventId]),
    };
  }
  async function eventually(check: () => Promise<boolean>, message: string, ms = 5000) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) { if (await check()) return; await pause(10); }
    assert.fail(message);
  }
  function startProcess(t: TestContext, config: DispatcherConfig) {
    const child = spawn(process.execPath, ["--import", "tsx", "src/lis/dispatcher-main.ts"], {
      env: { ...process.env, LIS_DATABASE_URL: testUrl, MIDDLEWARE_BASE_URL: config.middlewareBaseUrl,
        LIS_DISPATCHER_HTTP_TIMEOUT_MS: String(config.httpTimeoutMs), LIS_DISPATCHER_LEASE_MS: String(config.leaseMs),
        LIS_DISPATCHER_POLL_MS: String(config.pollMs), LIS_DISPATCHER_MAX_ATTEMPTS: String(config.maxAttempts),
        LIS_DISPATCHER_RETRY_DELAYS_MS: config.retryDelaysMs.join(",") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once("error", reject); child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await exited; });
    return { child, exited, output: () => output };
  }

  await t.test("real A2 event becomes ACK with exact original outbox despite changed source result", async (t) => {
    const c = await fixture(t); const original = await c.immutable(); const server = await fakeMiddleware(t);
    await pool.query("update lis.results set value_num=99,result_status='READY' where result_id=$1", [c.resultId]);
    const dispatcher = new LisDispatcher(dispatcherConfig(server.url));
    assert.equal(await dispatcher.runOnce(), "acknowledged");
    assert.deepEqual(server.requests[0].body, expectedEnvelope(c.event));
    assert.deepEqual(await c.immutable(), original);
    const saved = await c.row(); const ack = server.stored.get(c.event.eventId)?.ack;
    assert.equal(saved.dispatchStatus, "ACK"); assert.equal(saved.exchangeId, ack?.exchange_id); assert.deepEqual(saved.ackResponse, ack);
    assert.ok(saved.ackedAt); assert.equal(saved.dispatchAttemptCount, 1);
    assert.equal(saved.leaseToken, null); assert.equal(saved.leaseUntil, null); assert.equal(saved.nextRetryAt, null);
    const [attempt] = await c.history(); assert.equal(attempt.attemptNo, 1); assert.equal(attempt.httpStatus, 202);
    assert.ok(attempt.startedAt && attempt.sentAt && attempt.responseAt && attempt.endedAt);
    assert.ok(attempt.startedAt <= attempt.sentAt && attempt.sentAt <= attempt.responseAt && attempt.responseAt <= attempt.endedAt);
    assert.deepEqual(attempt.responseBody, ack); assert.equal(attempt.errorCode, null);
    assert.equal(await dispatcher.runOnce(), "idle");
    const again = await publishResult(c.resultId); assert.ok(again.kind === "existing"); assert.deepEqual(again.event, saved);
  });

  for (const patch of [{ event_id: randomUUID() }, { source_hash: "b".repeat(64) }, { exchange_id: "invalid" },
    { accepted: false }, { source_system: "wrong" }, { source_result_id: "wrong" }]) {
    await t.test(`invalid 202 ${Object.keys(patch)[0]} persists FAILED audit and never ACK`, async (t) => {
      const c = await fixture(t); const before = await c.immutable();
      const server = await fakeMiddleware(t, (req) => ({ status: 202, body: { ...req.accept().body, ...patch } }));
      assert.equal(await new LisDispatcher(dispatcherConfig(server.url)).runOnce(), "failed");
      const saved = await c.row(); assert.equal(saved.dispatchStatus, "FAILED"); assert.equal(saved.ackedAt, null);
      assert.equal(saved.exchangeId, null); assert.equal(saved.ackResponse, null); assert.equal(saved.lastErrorCode, "INVALID_ACK");
      const [attempt] = await c.history(); assert.equal(attempt.httpStatus, 202); assert.ok(attempt.endedAt);
      assert.deepEqual(attempt.responseBody, { outcome: "terminal", code: "INVALID_ACK" }); assert.deepEqual(await c.immutable(), before);
    });
  }

  for (const status of [409, 422]) {
    await t.test(`HTTP ${status} persists BLOCKED and is never automatically reclaimed`, async (t) => {
      const c = await fixture(t); const server = await fakeMiddleware(t, () => ({ status, body: { diagnostic: "PRIVATE-D2" } }));
      const dispatcher = new LisDispatcher(dispatcherConfig(server.url));
      assert.equal(await dispatcher.runOnce(), "blocked"); assert.equal(await dispatcher.runOnce(), "idle");
      assert.equal((await c.row()).dispatchStatus, "BLOCKED"); assert.equal((await c.row()).ackResponse, null);
      const [attempt] = await c.history(); assert.equal(attempt.httpStatus, status); assert.ok(attempt.endedAt);
      assert.equal(JSON.stringify(attempt).includes("PRIVATE-D2"), false); assert.equal(server.requests.length, 1);
    });
  }

  for (const status of [408, 429, 503]) {
    await t.test(`HTTP ${status}: database schedules retry; new instance resumes with attempt 2`, async (t) => {
      const c = await fixture(t); const original = await c.immutable();
      const server = await fakeMiddleware(t, (req) => req.number === 1 ? { status, body: {} } : undefined);
      const config = dispatcherConfig(server.url, { retryDelaysMs: [60000, 120000] });
      assert.equal(await new LisDispatcher(config).runOnce(), "retry_wait");
      const row = await c.row(); assert.equal(row.dispatchStatus, "RETRY_WAIT"); assert.equal(row.leaseToken, null);
      assert.equal((await pool.query("select next_retry_at > clock_timestamp()+interval '55 seconds' as waiting from lis.publish_events where event_id=$1", [c.event.eventId])).rows[0].waiting, true);
      assert.equal(await new LisDispatcher(config).runOnce(), "idle"); await c.due();
      assert.equal(await new LisDispatcher(config).runOnce(), "acknowledged");
      assert.deepEqual((await c.history()).map((r) => [r.attemptNo, r.httpStatus]), [[1, status], [2, 202]]);
      assert.equal((await c.row()).dispatchAttemptCount, 2); assert.deepEqual(await c.immutable(), original);
      assert.equal(server.requests[0].raw, server.requests[1].raw);
    });
  }

  await t.test("lost response after remote commit retries identical bytes and saves the original exchange_id", async (t) => {
    const c = await fixture(t); const original = await c.immutable();
    const server = await fakeMiddleware(t, (req) => { if (req.number === 1) { req.accept(); return { drop: true }; } });
    const config = dispatcherConfig(server.url, { retryDelaysMs: [60000, 120000] });
    assert.equal(await new LisDispatcher(config).runOnce(), "retry_wait");
    const exchangeId = server.stored.get(c.event.eventId)?.ack.exchange_id; assert.ok(exchangeId);
    const [lost] = await c.history(); assert.equal(lost.httpStatus, null); assert.equal(lost.responseAt, null);
    assert.equal(lost.errorCode, "NETWORK_ERROR"); assert.equal((await c.row()).ackResponse, null);
    await c.due(); assert.equal(await new LisDispatcher(config).runOnce(), "acknowledged");
    assert.equal((await c.row()).exchangeId, exchangeId); assert.equal(server.stored.size, 1);
    assert.equal(server.requests[0].raw, server.requests[1].raw); assert.deepEqual(await c.immutable(), original);
  });

  await t.test("timeout persists audit, and a later valid ACK clears the previous error", async (t) => {
    const c = await fixture(t); const server = await fakeMiddleware(t, (req) => req.number === 1 ? { hang: "body" } : undefined);
    const config = dispatcherConfig(server.url, { httpTimeoutMs: 150, retryDelaysMs: [60000, 120000] });
    assert.equal(await new LisDispatcher(config).runOnce(), "retry_wait");
    const [first] = await c.history(); assert.equal(first.errorCode, "HTTP_TIMEOUT"); assert.equal(first.httpStatus, 202);
    assert.equal((await c.row()).ackedAt, null); await c.due();
    assert.equal(await new LisDispatcher(config).runOnce(), "acknowledged");
    assert.equal((await c.row()).lastErrorCode, null); assert.equal((await c.row()).lastErrorMessage, null);
  });

  await t.test("retry budget survives new instances, terminates at the bound and cannot hot-loop", async (t) => {
    const c = await fixture(t); const server = await fakeMiddleware(t, () => ({ status: 500, body: {} }));
    const config = dispatcherConfig(server.url, { maxAttempts: 2, retryDelaysMs: [60000] });
    assert.equal(await new LisDispatcher(config).runOnce(), "retry_wait"); await c.due();
    assert.equal(await new LisDispatcher(config).runOnce(), "failed");
    assert.equal(await new LisDispatcher(config).runOnce(), "idle");
    const saved = await c.row(); assert.equal(saved.dispatchStatus, "FAILED"); assert.equal(saved.dispatchAttemptCount, 2);
    assert.equal(saved.nextRetryAt, null); assert.equal(saved.leaseToken, null); assert.equal(saved.ackResponse, null);
    assert.deepEqual((await c.history()).map((r) => [r.attemptNo, r.errorCode]), [[1, "HTTP_TEMPORARY"], [2, "HTTP_TEMPORARY"]]);
    assert.equal(server.requests.length, 2);
  });

  await t.test("two competing Dispatchers produce one HTTP attempt for the same live event", async (t) => {
    const c = await fixture(t); const server = await fakeMiddleware(t); const config = dispatcherConfig(server.url);
    const outcomes = await Promise.all([new LisDispatcher(config).runOnce(), new LisDispatcher(config).runOnce()]);
    assert.deepEqual(outcomes.sort(), ["acknowledged", "idle"]);
    assert.equal(server.requests.length, 1); assert.equal((await c.row()).dispatchAttemptCount, 1);
    assert.equal((await c.history()).length, 1);
  });

  for (const oldStatus of [202, 200]) {
    await t.test(`stale process cannot overwrite a new owner's ACK with ${oldStatus === 202 ? "ACK" : "FAILED"}`, async (t) => {
      const c = await fixture(t); const received = gate(); const release = gate();
      const server = await fakeMiddleware(t, async (req) => {
        if (req.number === 1) { const accepted = req.accept(); received.resolve(); await release.promise; return { ...accepted, status: oldStatus }; }
      });
      const config = dispatcherConfig(server.url, { httpTimeoutMs: 5000 });
      const old = new LisDispatcher(config).runOnce();
      t.after(() => release.resolve()); await received.promise; await c.expire();
      assert.equal(await new LisDispatcher(config).runOnce(), "acknowledged");
      const saved = await c.row(); const history = await c.history();
      assert.deepEqual(history.map((r) => [r.attemptNo, r.errorCode]), [[1, "LEASE_EXPIRED"], [2, null]]);
      assert.notEqual(history[0].leaseToken, history[1].leaseToken);
      release.resolve(); assert.equal(await old, "not_completed");
      assert.deepEqual(await c.row(), saved); assert.deepEqual(await c.history(), history);
      assert.equal(server.stored.size, 1); assert.equal(server.requests[0].raw, server.requests[1].raw);
    });
  }

  await t.test("actual ACK write failure rolls back, reports no success, and recovers the original receipt", async (t) => {
    const c = await fixture(t); const blocker = await pool.connect();
    try {
      const server = await fakeMiddleware(t, async (req) => {
        if (req.number === 1) { await blocker.query("begin"); await blocker.query("lock table lis.publish_events in share mode"); }
        return req.accept();
      });
      const dispatcher = new LisDispatcher(dispatcherConfig(server.url));
      await assert.rejects(dispatcher.runOnce());
      assert.equal((await c.row()).dispatchStatus, "IN_FLIGHT"); assert.equal((await c.row()).ackResponse, null);
      assert.equal((await c.history())[0].endedAt, null);
      const originalId = server.stored.get(c.event.eventId)?.ack.exchange_id; assert.ok(originalId);
      await blocker.query("rollback"); await c.expire();
      assert.equal(await dispatcher.runOnce(), "acknowledged"); assert.equal((await c.row()).exchangeId, originalId);
      assert.deepEqual((await c.history()).map((r) => r.errorCode), ["LEASE_EXPIRED", null]);
    } finally { await blocker.query("rollback"); blocker.release(); }
  });

  await t.test("real process crash, natural lease expiry, restart and graceful SIGTERM", async (t) => {
    const c = await fixture(t); const original = await c.immutable(); const received = gate();
    const server = await fakeMiddleware(t, (req) => {
      if (req.number === 1) { req.accept(); received.resolve(); return { hang: "headers" }; }
    });
    const config = dispatcherConfig(server.url, { httpTimeoutMs: 300, leaseMs: 1500 });
    const first = startProcess(t, config); await received.promise;
    first.child.kill("SIGKILL"); assert.equal((await first.exited).signal, "SIGKILL");
    assert.equal((await c.row()).dispatchStatus, "IN_FLIGHT"); assert.equal((await c.history())[0].endedAt, null);
    await eventually(async () => (await pool.query("select lease_until <= clock_timestamp() as expired from lis.publish_events where event_id=$1", [c.event.eventId])).rows[0].expired === true,
      "The crashed process lease must naturally expire");
    const second = startProcess(t, config);
    await eventually(async () => (await c.row()).dispatchStatus === "ACK", "The restarted process must persist ACK");
    second.child.kill("SIGTERM"); assert.deepEqual(await second.exited, { code: 0, signal: null });
    assert.match(second.output(), /Started/); assert.equal(second.output().includes(c.resultId), false);
    assert.deepEqual((await c.history()).map((r) => [r.attemptNo, r.errorCode]), [[1, "LEASE_EXPIRED"], [2, null]]);
    assert.equal((await c.row()).exchangeId, server.stored.get(c.event.eventId)?.ack.exchange_id);
    assert.deepEqual(await c.immutable(), original); assert.equal(server.stored.size, 1);
    assert.equal(server.requests[0].raw, server.requests[1].raw);
  });
});
