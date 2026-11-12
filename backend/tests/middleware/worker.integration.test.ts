import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as pause } from "node:timers/promises";
import { test, type TestContext } from "node:test";
import { Pool } from "pg";
import { mapObservation } from "../../src/middleware/mapper.js";
import { hashCanonicalJson } from "../../src/middleware/canonical-json.js";
import type { WorkerLease } from "../../src/middleware/repository.js";
import { rehash, validEnvelope } from "./service-fixtures.js";
import { startContractEmr } from "./worker-emr-mock.js";

const testUrl = process.env.MIDDLEWARE_REPOSITORY_TEST_DATABASE_URL?.trim();
delete process.env.MIDDLEWARE_DATABASE_URL;
if (testUrl) process.env.MIDDLEWARE_DATABASE_URL = testUrl;

test("B4B Worker: PostgreSQL + contract-faithful HTTP EMR mock (NOT real EMR)", {
  skip: testUrl ? false : "Set MIDDLEWARE_REPOSITORY_TEST_DATABASE_URL to an empty disposable PostgreSQL database",
}, async (t) => {
  const repository = await import("../../src/middleware/repository.js");
  const { acceptExchange } = await import("../../src/middleware/service.js");
  const { MiddlewareWorker } = await import("../../src/middleware/worker.js");
  const { middlewareDatabase } = await import("../../src/middleware/db.js");
  const pool = new Pool({ connectionString: testUrl, max: 3, connectionTimeoutMillis: 3000 });
  t.after(async () => { await Promise.all([pool.end(), middlewareDatabase.close()]); });
  assert.equal((await pool.query("select current_user as role")).rows[0].role, "integration_app");
  assert.equal((await pool.query("select count(*)::int as n from integration.exchange_transactions")).rows[0].n, 0,
    "Worker tests must use an empty disposable database");

  async function scenario(t: TestContext, options: { patientLinked?: boolean; timeoutMs?: number; retries?: number[] } = {}) {
    const envelope = validEnvelope();
    const mapped = mapObservation(envelope.source_snapshot); assert.ok(mapped.kind === "mapped");
    const mock = await startContractEmr(mapped.observation, options);
    const accepted = await acceptExchange(envelope); assert.ok(accepted.kind === "accepted");
    const id = accepted.exchange_id;
    t.after(async () => {
      try {
        await pool.query("delete from integration.exchange_events where exchange_id = $1", [id]);
        await pool.query("delete from integration.exchange_attempts where exchange_id = $1", [id]);
        await pool.query("delete from integration.exchange_transactions where exchange_id = $1", [id]);
      } finally { await mock.close(); }
      assert.deepEqual(mock.violations, []);
    });
    const config = { emrBaseUrl: mock.baseUrl, httpTimeoutMs: options.timeoutMs ?? 1000,
      leaseMs: 3000, pollMs: 10, retryDelaysMs: options.retries ?? [10, 20, 40] };
    const worker = new MiddlewareWorker(config);
    async function row() { const result = await repository.getExchangeById(id); assert.ok(result); return result; }
    return { id, envelope, mapped, mock, config, worker, row,
      due: () => pool.query("update integration.exchange_transactions set next_retry_at = clock_timestamp() - interval '1s' where exchange_id = $1", [id]),
      expire: () => pool.query("update integration.exchange_transactions set lease_until = clock_timestamp() - interval '1s' where exchange_id = $1", [id]),
      history: () => repository.getExchangeEvents(id), attempts: () => repository.getExchangeAttempts(id),
      async claimMapped() {
        const claimed = await repository.claimExchange(config.leaseMs); assert.equal(claimed?.exchangeId, id); assert.ok(claimed?.leaseToken);
        const lease = { exchangeId: id, leaseToken: claimed.leaseToken };
        assert.ok(await repository.saveExchangeMapping(lease, { ...mapped, payloadHash: hashCanonicalJson(mapped.observation) }));
        return lease;
      },
      async assertStatus(status: string) {
        const current = await row(); assert.equal(current.status, status);
        assert.deepEqual(current.sourcePayload, envelope); assert.equal(current.sourceHash, envelope.source_hash);
        if (status !== "DELIVERED") { assert.equal(current.completedAt, null); assert.equal(current.verifiedAt, null); }
        if (["DELIVERED", "REJECTED", "FAILED"].includes(status)) {
          assert.equal(current.leaseToken, null); assert.equal(current.leaseUntil, null);
          assert.equal(current.nextRetryAt, null); assert.equal(current.retryPhase, null);
          const count = mock.requests.length;
          assert.equal(await worker.runOnce(), "idle"); assert.equal(mock.requests.length, count);
        }
      },
    };
  }

  await t.test("201 -> confirmed store -> matching read-back -> atomic DELIVERED and complete audit", async (t) => {
    const c = await scenario(t); assert.equal(await c.worker.runOnce(), "processed");
    await c.assertStatus("DELIVERED"); const row = await c.row();
    assert.equal(row.sendAttemptCount, 1); assert.equal(row.verifyAttemptCount, 1);
    assert.deepEqual(row.fhirPayload, c.mapped.observation); assert.equal(row.payloadHash, hashCanonicalJson(c.mapped.observation));
    assert.equal(row.mappingVersion, c.mapped.mappingVersion); assert.deepEqual(row.patientIdentifier, c.mapped.observation.subject.identifier);
    for (const value of [row.validatedAt, row.mappingStartedAt, row.transformedAt, row.firstSentAt,
      row.targetStoredAt, row.verifiedAt, row.completedAt]) assert.ok(value instanceof Date);
    assert.deepEqual(c.mock.requests.map((x) => x.method), ["POST", "GET"]);
    assert.equal(c.mock.requests[1].system, c.mapped.observation.identifier[0].system);
    assert.notEqual(c.mock.requests[1].system, c.envelope.source_system);
    const attempts = await c.attempts(); assert.equal(attempts.length, 2);
    assert.deepEqual(attempts.map((x) => [x.phase, x.attemptNo, x.httpStatus, x.errorCode]), [["SEND", 1, 201, null], ["VERIFY", 1, 200, null]]);
    for (const attempt of attempts) assert.ok(attempt.sentAt && attempt.responseAt && attempt.endedAt);
    const events = await c.history();
    assert.deepEqual(events.map((x) => x.eventType), ["RECEIVED", "CLAIMED", "VALIDATED", "TRANSFORMED", "SENT", "TARGET_STORED", "VERIFY_STARTED", "DELIVERED"]);
    for (const event of events.filter((x) => x.attemptId)) assert.ok(attempts.some((a) => a.attemptId === event.attemptId && a.exchangeId === event.exchangeId));
    assert.ok((await pool.query("select verified_at = completed_at as same from integration.exchange_transactions where exchange_id = $1", [c.id])).rows[0].same);
    // A duplicate LIS retry after delivery cannot reset payload, attempts or state.
    const before = await c.row(); assert.equal((await acceptExchange(c.envelope)).kind, "accepted");
    assert.deepEqual(await c.row(), before);
  });
  await t.test("idempotent POST 200 ALREADY_EXISTS keeps target ID and verifies", async (t) => {
    const c = await scenario(t); const existing = c.mock.seed(); await c.worker.runOnce(); await c.assertStatus("DELIVERED");
    assert.equal((await c.attempts())[0].httpStatus, 200); assert.equal(c.mock.records.size, 1);
    assert.equal((await c.attempts())[0].responseBody && ((await c.attempts())[0].responseBody as { target_id: string }).target_id, existing.target_id);
  });
  await t.test("POST 409 rejects conflicting identity without overwrite or GET", async (t) => {
    const c = await scenario(t); const other = structuredClone(c.mapped.observation); other.valueQuantity.value++;
    const prior = c.mock.seed(other); await c.worker.runOnce(); await c.assertStatus("REJECTED");
    assert.deepEqual([...c.mock.records.values()], [prior]); assert.equal(c.mock.requests.length, 1);
    assert.equal((await c.attempts())[0].errorCode, "DUPLICATE_CONFLICT");
  });
  await t.test("POST 422 missing patient link rejects without GET", async (t) => {
    const c = await scenario(t, { patientLinked: false }); await c.worker.runOnce(); await c.assertStatus("REJECTED");
    assert.equal(c.mock.records.size, 0); assert.equal((await c.attempts())[0].errorCode, "REMOTE_VALIDATION_ERROR");
  });
  await t.test("POST 503 schedules SEND with bounded delay and immutable source/FHIR", async (t) => {
    const c = await scenario(t, { retries: [2000, 4000, 8000] }); c.mock.postPlans.push({ status: 503 });
    await c.worker.runOnce(); await c.assertStatus("RETRY_WAIT"); const row = await c.row();
    assert.equal(row.retryPhase, "SEND"); assert.ok(row.nextRetryAt);
    assert.ok((await pool.query("select next_retry_at > clock_timestamp() as future from integration.exchange_transactions where exchange_id = $1", [c.id])).rows[0].future);
    assert.equal(await c.worker.runOnce(), "idle"); await c.due(); await c.worker.runOnce(); await c.assertStatus("DELIVERED");
    assert.deepEqual(c.mock.requests.filter((x) => x.method === "POST").map((x) => x.body), [c.mock.requests[0].body, c.mock.requests[0].body]);
    assert.equal((await c.attempts())[0].errorMessage, "The exchange attempt did not complete successfully.");
    assert.ok(!JSON.stringify(await c.attempts()).includes("private diagnostic"));
  });
  await t.test("POST timeout AFTER storage safely resends identical FHIR and gets ALREADY_EXISTS", async (t) => {
    const c = await scenario(t, { timeoutMs: 80 }); c.mock.postPlans.push({ delayMs: 180 });
    await c.worker.runOnce(); await c.assertStatus("RETRY_WAIT"); assert.equal(c.mock.records.size, 1);
    assert.equal((await c.attempts())[0].errorCode, "HTTP_TIMEOUT");
    await c.due(); await c.worker.runOnce(); await c.assertStatus("DELIVERED");
    assert.equal((await c.attempts())[1].httpStatus, 200); assert.equal(c.mock.records.size, 1);
    assert.equal(c.mock.requests[0].body, c.mock.requests[1].body);
  });
  for (const failure of ["disconnect", "body-timeout"] as const) await t.test(`POST ${failure} remains uncertain and safely retries`, async (t) => {
    const c = await scenario(t, { timeoutMs: 100 });
    c.mock.postPlans.push(failure === "disconnect" ? { disconnect: true } : { stallBodyMs: 220 });
    await c.worker.runOnce(); await c.assertStatus("RETRY_WAIT");
    assert.equal((await c.attempts())[0].errorCode, failure === "disconnect" ? "NETWORK_ERROR" : "HTTP_TIMEOUT");
    assert.equal(c.mock.records.size, 1); await c.due(); await c.worker.runOnce(); await c.assertStatus("DELIVERED");
    assert.equal(c.mock.records.size, 1); assert.equal(c.mock.requests[0].body, c.mock.requests[1].body);
  });
  for (const phase of ["SEND", "VERIFY"] as const) {
    for (const invalid of ["json", "media-type", "oversized"] as const) await t.test(`${phase} rejects ${invalid} response without false delivery`, async (t) => {
      const c = await scenario(t);
      const plan = invalid === "json" ? { raw: "not-json" } : invalid === "media-type"
        ? { raw: "{}", contentType: "text/html" } : { raw: `{"padding":"${"x".repeat(4 * 1024 * 1024)}"}` };
      (phase === "SEND" ? c.mock.postPlans : c.mock.getPlans).push(plan);
      await c.worker.runOnce(); await c.assertStatus("FAILED");
      assert.equal((await c.attempts()).at(-1)?.errorCode, phase === "SEND" ? "INVALID_STORAGE_RESPONSE" : "INVALID_VERIFY_RESPONSE");
    });
  }
  await t.test("redirects do not forward the Observation", async (t) => {
    const c = await scenario(t); c.mock.postPlans.push({ status: 302 });
    await c.worker.runOnce(); await c.assertStatus("FAILED"); assert.equal(c.mock.requests.length, 1);
    assert.equal((await c.attempts())[0].errorCode, "HTTP_PERMANENT");
  });
  for (const temporary of ["503", "timeout"] as const) await t.test(`GET ${temporary}: restart retries VERIFY only, with persisted receipt`, async (t) => {
    const c = await scenario(t, { timeoutMs: temporary === "timeout" ? 80 : 1000 });
    c.mock.getPlans.push(temporary === "503" ? { status: 503 } : { delayMs: 180 });
    await c.worker.runOnce(); await c.assertStatus("RETRY_WAIT"); assert.equal((await c.row()).retryPhase, "VERIFY");
    await c.due(); await new MiddlewareWorker(c.config).runOnce(); await c.assertStatus("DELIVERED");
    assert.deepEqual(c.mock.requests.map((x) => x.method), ["POST", "GET", "GET"]);
    assert.equal((await c.row()).sendAttemptCount, 1); assert.equal((await c.row()).verifyAttemptCount, 2);
  });

  const mismatches: [string, (body: Record<string, unknown>) => unknown][] = [
    ["empty", () => ({ items: [] })],
    ["multiple", (body) => ({ items: [...body.items as unknown[], ...body.items as unknown[]] })],
    ...Object.entries({ patient_key: randomUUID(), target_id: randomUUID(), quantity: "3.400000000000000000000001",
      unit_text: "wrong-unit", effective_at: "2026-10-22T08:00:00.123457Z", low: "0", high: "999",
      analyte_code: "wrong-code", analyte_display: "wrong-name", analyte_context: "wrong-context",
      clinical_status: "preliminary", external_system: "lis-demo", external_id: "wrong-id", fhir_json: {} })
      .map(([field, value]): [string, (body: Record<string, unknown>) => unknown] => [field, (body) => ({
        items: [{ ...(body.items as Record<string, unknown>[])[0], [field]: value }],
      })]),
  ];
  for (const [label, transform] of mismatches) await t.test(`read-back ${label} mismatch is FAILED/VERIFY_MISMATCH, never delivered`, async (t) => {
    const c = await scenario(t); c.mock.getPlans.push({ transform }); await c.worker.runOnce(); await c.assertStatus("FAILED");
    const attempts = await c.attempts(); assert.equal(attempts[1].errorCode, "VERIFY_MISMATCH");
    const last = (await c.history()).at(-1); assert.equal(last?.eventType, "VERIFY_MISMATCH");
    assert.equal(last?.newStatus, "FAILED"); assert.equal(last?.attemptId, attempts[1].attemptId);
  });
  await t.test("equivalent timezone and decimal scale read back successfully without rounding", async (t) => {
    const c = await scenario(t); c.mock.getPlans.push({ transform: (body) => {
      const item = (body.items as Record<string, unknown>[])[0];
      // Fixture is 2026-10-22T08:00:00.123456Z: shift only the timezone representation.
      const fhir = item.fhir_json as Record<string, unknown>;
      const shifted = (item.effective_at as string).replace("T08:", "T15:").replace("Z", "+07:00");
      return { items: [{ ...item, quantity: `${item.quantity}00`, effective_at: shifted, fhir_json: { ...fhir, effectiveDateTime: shifted } }] };
    } });
    await c.worker.runOnce(); await c.assertStatus("DELIVERED");
  });

  for (const [label, transform] of Object.entries({
    wrongSystem: (body: Record<string, unknown>) => ({ ...body, external_system: "lis-demo" }),
    wrongId: (body: Record<string, unknown>) => ({ ...body, external_id: "wrong" }),
    badTarget: (body: Record<string, unknown>) => ({ ...body, target_id: "bad" }),
    missingPatient: (body: Record<string, unknown>) => ({ ...body, patient_key: undefined }),
    wrongResult: (body: Record<string, unknown>) => ({ ...body, result: "ALREADY_EXISTS" }),
  })) await t.test(`HTTP 201 with ${label} is not a confirmed storage response`, async (t) => {
    const c = await scenario(t); c.mock.postPlans.push({ transform }); await c.worker.runOnce(); await c.assertStatus("FAILED");
    assert.equal(c.mock.requests.length, 1); assert.equal((await c.row()).targetStoredAt, null);
    assert.equal((await c.attempts())[0].errorCode, "INVALID_STORAGE_RESPONSE");
  });
  for (const phase of ["SEND", "VERIFY"] as const) await t.test(`${phase} exhausts its own four-attempt budget`, async (t) => {
    const c = await scenario(t);
    (phase === "SEND" ? c.mock.postPlans : c.mock.getPlans).push(...Array.from({ length: 4 }, () => ({ status: 503 })));
    for (let i = 0; i < 4; i++) {
      await c.worker.runOnce(); await c.assertStatus(i === 3 ? "FAILED" : "RETRY_WAIT");
      if (i !== 3) await c.due();
    }
    const attempts = (await c.attempts()).filter((x) => x.phase === phase);
    assert.deepEqual(attempts.map((x) => x.attemptNo), [1, 2, 3, 4]);
    assert.equal((await c.history()).at(-1)?.eventType, "RETRY_EXHAUSTED");
    if (phase === "VERIFY") assert.equal(c.mock.requests.filter((x) => x.method === "POST").length, 1);
  });

  await t.test("expired SEND claim abandons unfinished attempt and fences the old owner", async (t) => {
    const c = await scenario(t); const old = await c.claimMapped();
    const started = await repository.beginExchangeAttempt(old, "SEND", c.config.leaseMs, 4); assert.ok(started);
    assert.equal(await c.worker.runOnce(), "idle"); await c.expire(); await c.worker.runOnce(); await c.assertStatus("DELIVERED");
    const before = await c.row(); const events = await c.history();
    assert.equal((await c.attempts())[0].errorCode, "LEASE_EXPIRED");
    assert.ok(events.some((x) => x.eventType === "ATTEMPT_ABANDONED"));
    assert.equal(await repository.finishExchangeAttempt(old, started.attempt.attemptId, { kind: "terminal", status: "FAILED", code: "HTTP_PERMANENT" }), false);
    assert.equal(await repository.failExchange(old, "FAILED", "PAYLOAD_INTEGRITY"), false);
    assert.equal(await repository.beginExchangeAttempt(old, "SEND", 3000, 4), undefined);
    assert.deepEqual(await c.row(), before); assert.deepEqual(await c.history(), events);
  });
  await t.test("crash after POST store before local commit repeats POST idempotently", async (t) => {
    const c = await scenario(t);
    const crashed = new MiddlewareWorker(c.config, { ...repository,
      finishExchangeAttempt: async (_lease, _id, result) => { assert.equal(result.kind, "stored"); throw new Error("simulated crash"); } });
    await assert.rejects(crashed.runOnce(), /simulated crash/);
    await c.assertStatus("PROCESSING"); assert.equal(c.mock.records.size, 1);
    await c.expire(); await c.worker.runOnce(); await c.assertStatus("DELIVERED");
    assert.equal(c.mock.records.size, 1); assert.equal((await c.attempts())[1].httpStatus, 200);
  });
  await t.test("crash after TARGET_STORED commit recovers VERIFY and never resends", async (t) => {
    const c = await scenario(t); const crashed = new MiddlewareWorker(c.config, { ...repository,
      getConfirmedStorage: async () => { throw new Error("simulated crash"); } });
    await assert.rejects(crashed.runOnce()); await c.assertStatus("VERIFYING");
    await c.expire(); await c.worker.runOnce(); await c.assertStatus("DELIVERED");
    assert.deepEqual(c.mock.requests.map((x) => x.method), ["POST", "GET"]);
  });
  await t.test("crash during VERIFY consumes budget and only repeats GET", async (t) => {
    const c = await scenario(t); const crashed = new MiddlewareWorker(c.config, { ...repository,
      finishExchangeAttempt: async (lease, id, result) => {
        if (result.kind === "delivered") throw new Error("simulated crash");
        return repository.finishExchangeAttempt(lease, id, result);
      } });
    await assert.rejects(crashed.runOnce()); await c.assertStatus("VERIFYING");
    await c.expire(); await c.worker.runOnce(); await c.assertStatus("DELIVERED");
    assert.deepEqual(c.mock.requests.map((x) => x.method), ["POST", "GET", "GET"]);
    assert.equal((await c.attempts())[1].errorCode, "LEASE_EXPIRED");
  });
  await t.test("crashing on the last permitted attempt cannot create unlimited retries", async (t) => {
    const c = await scenario(t, { retries: [] }); const lease = await c.claimMapped();
    assert.ok(await repository.beginExchangeAttempt(lease, "SEND", 3000, 1));
    await c.expire(); await c.worker.runOnce(); await c.assertStatus("FAILED");
    assert.equal((await c.attempts()).length, 1); assert.equal(c.mock.requests.length, 0);
  });
  await t.test("two independent Workers competing for one exchange produce one owner and one POST", async (t) => {
    const c = await scenario(t); c.mock.postPlans.push({ delayMs: 100 });
    const outcomes = await Promise.all([c.worker.runOnce(), new MiddlewareWorker(c.config).runOnce()]);
    assert.deepEqual(outcomes.sort(), ["idle", "processed"]); await c.assertStatus("DELIVERED");
    assert.deepEqual(c.mock.requests.map((x) => x.method), ["POST", "GET"]); assert.equal((await c.attempts()).length, 2);
  });
  await t.test("SKIP LOCKED skips a locked job and claims another eligible job", async (t) => {
    const first = await scenario(t); const second = await scenario(t); const blocker = await pool.connect();
    try {
      await blocker.query("begin");
      await blocker.query("select exchange_id from integration.exchange_transactions where exchange_id = $1 for update", [first.id]);
      const claimed = await repository.claimExchange(3000); assert.equal(claimed?.exchangeId, second.id);
      await blocker.query("commit");
      assert.equal((await repository.claimExchange(3000))?.exchangeId, first.id);
      assert.equal(await repository.claimExchange(3000), undefined);
    } finally { await blocker.query("rollback"); blocker.release(); }
  });
  await t.test("old in-flight HTTP response cannot override a recovered new owner", async (t) => {
    const c = await scenario(t); let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    c.mock.postPlans.push({ hold }); const oldRun = c.worker.runOnce();
    try {
      for (let i = 0; i < 100 && c.mock.records.size === 0; i++) await pause(5);
      assert.equal(c.mock.records.size, 1); await c.expire();
      await new MiddlewareWorker(c.config).runOnce(); await c.assertStatus("DELIVERED");
      const before = await c.row(); const events = await c.history();
      release(); await oldRun;
      assert.deepEqual(await c.row(), before); assert.deepEqual(await c.history(), events);
    } finally { release(); await oldRun; }
  });
  await t.test("expired token is refused even BEFORE a replacement claims it", async (t) => {
    const c = await scenario(t); const lease = await c.claimMapped(); await c.expire();
    assert.equal(await repository.beginExchangeAttempt(lease, "SEND", 3000, 4), undefined);
    assert.equal(await repository.failExchange(lease, "FAILED", "HTTP_PERMANENT"), false);
    await c.worker.runOnce(); await c.assertStatus("DELIVERED");
  });
  await t.test("tampered source hash is rejected before HTTP", async (t) => {
    const c = await scenario(t);
    await pool.query("update integration.exchange_transactions set source_hash = $2 where exchange_id = $1", [c.id, "f".repeat(64)]);
    await c.worker.runOnce(); assert.equal((await c.row()).status, "REJECTED"); assert.equal(c.mock.requests.length, 0);
    assert.equal((await c.attempts()).length, 0);
  });
  await t.test("unsupported FHIR mapping is rejected before HTTP", async (t) => {
    const c = await scenario(t); c.envelope.source_snapshot.effective_at = "2180-06-03T12:00:00+15:00"; rehash(c.envelope);
    await pool.query("update integration.exchange_transactions set source_payload = $2, source_hash = $3 where exchange_id = $1",
      [c.id, JSON.stringify(c.envelope), c.envelope.source_hash]);
    await c.worker.runOnce(); await c.assertStatus("REJECTED"); assert.equal(c.mock.requests.length, 0);
  });
  await t.test("mapped payload corruption after a retry is FAILED, never remapped/sent", async (t) => {
    for (const corrupted of ["99", "1e999"]) {
      const c = await scenario(t); c.mock.postPlans.push({ status: 503 }); await c.worker.runOnce();
      await pool.query("update integration.exchange_transactions set fhir_payload = jsonb_set(fhir_payload, '{valueQuantity,value}', $2::jsonb) where exchange_id = $1", [c.id, corrupted]);
      await c.due(); await c.worker.runOnce(); await c.assertStatus("FAILED"); assert.equal(c.mock.requests.length, 1);
    }
  });
  await t.test("VERIFY without persisted valid storage receipt fails without resending", async (t) => {
    const c = await scenario(t); c.mock.getPlans.push({ status: 503 }); await c.worker.runOnce();
    await pool.query("update integration.exchange_attempts set response_body = '{}' where exchange_id = $1 and phase = 'SEND'", [c.id]);
    await c.due(); await c.worker.runOnce(); await c.assertStatus("FAILED"); assert.equal(c.mock.requests.length, 2);
  });
  await t.test("real PostgreSQL enforces delivered timestamps and completed_at only on DELIVERED", async (t) => {
    const c = await scenario(t);
    for (const set of ["status = 'DELIVERED'", "status = 'DELIVERED', completed_at = clock_timestamp()",
      "status = 'DELIVERED', verified_at = clock_timestamp()", "status = 'FAILED', completed_at = clock_timestamp()"] ) {
      await assert.rejects(pool.query(`update integration.exchange_transactions set ${set} where exchange_id = $1`, [c.id]),
        (error: unknown) => error !== null && typeof error === "object" && "code" in error && error.code === "23514");
    }
    await c.worker.runOnce(); await c.assertStatus("DELIVERED");
  });
  await t.test("attempt/state/event roll back together when event write fails", async (t) => {
    const c = await scenario(t); const lease = await c.claimMapped();
    const started = await repository.beginExchangeAttempt(lease, "SEND", 3000, 4); assert.ok(started);
    const before = await c.row(); const attempts = await c.attempts(); const events = await c.history();
    const blocker = await pool.connect();
    try {
      await blocker.query("begin"); await blocker.query("lock table integration.exchange_events in access exclusive mode");
      await assert.rejects(repository.finishExchangeAttempt(lease, started.attempt.attemptId,
        { kind: "retry", code: "HTTP_TEMPORARY", httpStatus: 503, delayMs: 10 }));
      await blocker.query("rollback");
      assert.deepEqual(await c.row(), before); assert.deepEqual(await c.attempts(), attempts); assert.deepEqual(await c.history(), events);
    } finally { await blocker.query("rollback"); blocker.release(); }
    await c.expire(); await c.worker.runOnce(); await c.assertStatus("DELIVERED");
  });
  await t.test("lease ownership checked again after waiting for a row lock", async (t) => {
    const c = await scenario(t); const lease: WorkerLease = await c.claimMapped();
    await pool.query("update integration.exchange_transactions set lease_until = clock_timestamp() + interval '60 milliseconds' where exchange_id = $1", [c.id]);
    const blocker = await pool.connect();
    try {
      await blocker.query("begin"); await blocker.query("select exchange_id from integration.exchange_transactions where exchange_id = $1 for update", [c.id]);
      const write = repository.failExchange(lease, "FAILED", "HTTP_PERMANENT");
      await pause(100); await blocker.query("commit"); assert.equal(await write, false);
    } finally { await blocker.query("rollback"); blocker.release(); }
    await c.worker.runOnce(); await c.assertStatus("DELIVERED");
  });
  await t.test("separate worker startup processes a job and shuts down cleanly on SIGTERM", async (t) => {
    const c = await scenario(t);
    const child = spawn(process.execPath, ["--import", "tsx", "src/middleware/worker-main.ts"], {
      cwd: new URL("../../", import.meta.url),
      env: { ...process.env, MIDDLEWARE_DATABASE_URL: testUrl, EMR_BASE_URL: c.mock.baseUrl,
        MIDDLEWARE_WORKER_POLL_MS: "10", MIDDLEWARE_WORKER_LEASE_MS: "3000", MIDDLEWARE_WORKER_HTTP_TIMEOUT_MS: "1000" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    const exited = once(child, "exit");
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
    for (let i = 0; i < 500 && (await c.row()).status !== "DELIVERED"; i++) await pause(10);
    assert.equal((await c.row()).status, "DELIVERED");
    child.kill("SIGTERM");
    const killTimer = setTimeout(() => child.kill("SIGKILL"), 3000);
    try { assert.deepEqual(await exited, [0, null]); } finally { clearTimeout(killTimer); }
    assert.ok(output.includes("[Middleware Worker] Started."));
    assert.ok(!output.includes(c.envelope.source_result_id) && !output.includes(c.envelope.source_snapshot.patient_id));
  });
});
