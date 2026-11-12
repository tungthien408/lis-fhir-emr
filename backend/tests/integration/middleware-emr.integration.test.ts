import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { setTimeout as pause } from "node:timers/promises";
import { test } from "node:test";
import { hashCanonicalJson } from "../../src/middleware/canonical-json.js";
import { storageReceipt, verifyReadBack } from "../../src/middleware/worker-verification.js";
import { assertError, requestJson } from "../emr/http-test-helpers.js";
import { createHarness, type C4Harness, type C4Scenario } from "./c4-harness.js";
import { createFixture, variants } from "./c4-fixtures.js";

const configured = process.env.C4_DATABASE_ISOLATION_TOKEN !== undefined;
const successEvents = ["RECEIVED", "CLAIMED", "VALIDATED", "TRANSFORMED", "SENT", "TARGET_STORED", "VERIFY_STARTED", "DELIVERED"];
type AttemptAnswer = readonly [phase: "SEND" | "VERIFY", number: number, http: number, error: string | null];

/** Compare independent fixture answers against a separate SQL connection AND actual GET. */
async function assertStored(c: C4Scenario) {
  const rows = await c.dbRows(); assert.equal(rows.length, 1);
  const actual = rows[0];
  for (const [field, expected] of Object.entries(c.columns)) assert.equal(actual[field], expected, field);
  assert.equal(actual.patient_key, c.patientKey); assert.notEqual(actual.patient_key, c.decoyPatientKey);
  assert.match(actual.target_id, /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  assert.deepEqual(actual.fhir_json, c.observation);
  for (const field of ["received_at", "stored_at"]) assert.match(actual[field], /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/);
  const read = await c.get(); assert.equal(read.status, 200); assert.deepEqual(read.body, { items: rows });
  const send = c.workerHttp.find((item) => item.method === "POST"); assert.ok(send);
  const receipt = storageReceipt(send.status, send.response_body, c.observation); assert.ok(receipt);
  assert.equal(receipt.target_id, actual.target_id); assert.equal(receipt.patient_key, c.patientKey);
  assert.deepEqual(Object.keys(send.response_body as object).sort(),
    ["result", "external_system", "external_id", "target_id", "patient_key"].sort());
  assert.deepEqual(verifyReadBack(read.body, c.observation, receipt), []);
  // Also verify the exact GET body observed during Worker's run, not only a later manual read.
  const workerRead = c.workerHttp.filter((item) => item.method === "GET").at(-1); assert.ok(workerRead);
  assert.equal(workerRead.status, 200);
  assert.deepEqual(verifyReadBack(workerRead.response_body, c.observation, receipt), []);
  return actual;
}

/** Audit counters/attempts/events must agree with the HTTP calls the Worker actually made. */
async function assertAudit(h: C4Harness, c: C4Scenario, status: string, expected: readonly AttemptAnswer[]) {
  const row = await c.row(); const attempts = await c.attempts(); const events = await c.events();
  assert.equal(row.status, status); assert.deepEqual(row.sourcePayload, c.envelope);
  assert.equal(row.sourceHash, c.envelope.source_hash); assert.deepEqual(row.fhirPayload, c.observation);
  assert.equal(row.payloadHash, hashCanonicalJson(c.observation)); assert.equal(row.mappingVersion, "lis-observation-v2");
  assert.deepEqual(row.patientIdentifier, c.observation.subject.identifier);
  assert.equal(row.sendAttemptCount, expected.filter(([phase]) => phase === "SEND").length);
  assert.equal(row.verifyAttemptCount, expected.filter(([phase]) => phase === "VERIFY").length);
  assert.deepEqual(attempts.map((item) => [item.phase, item.attemptNo, item.httpStatus, item.errorCode]), expected);
  assert.deepEqual(c.workerHttp.map((item) => [item.method === "POST" ? "SEND" : "VERIFY", item.status]),
    expected.map(([phase, , http]) => [phase, http]));
  for (const http of c.workerHttp) {
    if (http.method === "POST") {
      assert.equal(http.path, "/api/observations"); assert.equal(http.content_type, "application/fhir+json");
      assert.deepEqual(http.query, {}); assert.deepEqual(http.request_body, c.observation);
    } else {
      assert.equal(http.path, "/api/lab-results");
      assert.deepEqual(http.query, { external_system: c.columns.external_system, external_id: c.columns.external_id });
    }
  }
  for (const attempt of attempts) {
    assert.ok(attempt.startedAt && attempt.sentAt && attempt.responseAt && attempt.endedAt);
    assert.equal(attempt.exchangeId, c.id);
    const linked = events.filter((event) => event.attemptId === attempt.attemptId);
    assert.equal(linked.length, 2, "Every HTTP attempt has a start and completion event");
    assert.equal(linked[0].eventType, attempt.phase === "SEND" ? "SENT" : "VERIFY_STARTED");
  }
  for (const event of events) {
    assert.equal(event.exchangeId, c.id);
    if (event.attemptId) assert.ok(attempts.some((attempt) => attempt.attemptId === event.attemptId));
  }
  const persisted = (await h.middlewarePool.query(`select status, verified_at::text, completed_at::text,
    verified_at = completed_at as same from integration.exchange_transactions where exchange_id=$1`, [c.id])).rows[0];
  assert.equal(persisted.status, status);
  if (status === "DELIVERED") {
    assert.ok(persisted.verified_at && persisted.completed_at && persisted.same);
    assert.ok(row.targetStoredAt && row.verifiedAt && row.completedAt);
    assert.equal(events.at(-1)?.eventType, "DELIVERED");
  } else {
    assert.equal(persisted.verified_at, null); assert.equal(persisted.completed_at, null);
    assert.equal(events.some((event) => event.eventType === "DELIVERED"), false);
  }
  if (status !== "RETRY_WAIT") {
    assert.equal(row.leaseToken, null); assert.equal(row.leaseUntil, null); assert.equal(row.nextRetryAt, null);
    const before = h.requests.length; assert.equal(await c.worker.runOnce(), "idle"); assert.equal(h.requests.length, before);
  }
}

test("C4: real Middleware → HTTP → real EMR → PostgreSQL → read-back", {
  skip: configured ? false : "Run npm run test:integration:postgres (dedicated PostgreSQL, no development data)",
  timeout: 60000,
}, async (t) => {
  const h = await createHarness(t);
  const evidence: { completed: boolean; environment: Record<string, unknown>; scenarios: Record<string, unknown>[] } = {
    completed: false,
    environment: { node: process.version, postgres: (await h.emrPool.query("show server_version")).rows[0].server_version,
      fixture_sha256: h.fixtureHash, provenance: "C4 synthetic fixtures; no SPP-65 dataset",
      emr: "real Controller/Service/Repository", worker: "real Worker/Mapper/Repository", transport: "localhost HTTP",
      fault_injection: "targeted SQL on scenario-owned EMR rows before real GET; HTTP responses are never fabricated" },
    scenarios: [],
  };
  t.after(async () => {
    if (process.env.C4_EVIDENCE_PATH) await writeFile(process.env.C4_EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
  });
  async function record(c: C4Scenario, caseId: string, extra: Record<string, unknown> = {}) {
    const row = await c.row();
    evidence.scenarios.push({ case_id: caseId, outcome: "PASS", fixture: c.variant, exchange_id: c.id,
      expected_columns: { ...c.columns, patient_key: c.patientKey }, expected_fhir: c.observation,
      actual_rows: await c.dbRows(), http: c.workerHttp, status: row.status,
      verified_at: row.verifiedAt, completed_at: row.completedAt,
      attempts: (await c.attempts()).map((item) => ({ attempt_id: item.attemptId, phase: item.phase,
        attempt_no: item.attemptNo, http_status: item.httpStatus, error_code: item.errorCode,
        started_at: item.startedAt, ended_at: item.endedAt, response_body: item.responseBody })),
      events: (await c.events()).map((item) => ({ type: item.eventType, old_status: item.oldStatus,
        new_status: item.newStatus, attempt_id: item.attemptId, detail: item.detail })), ...extra });
    t.diagnostic(`${caseId}: ${row.status}; HTTP ${c.workerHttp.map((item) => `${item.method} ${item.status}`).join(" → ")}`);
  }

  await t.test("C4-CATALOG: invalid codes/units are rejected by real APIs without storing or delivering", async () => {
    for (const mode of ["unknown", "all-kg", "no-range"]) {
      const fixture = createFixture(); const input = fixture.envelope;
      input.source_snapshot.test_code = mode === "unknown" ? "99999" : "50912";
      input.source_snapshot.unit = mode === "unknown" ? "mg/dL" : "kg";
      input.source_hash = hashCanonicalJson(input.source_snapshot);
      assert.equal((await h.postExchange(input)).status, 422);
      const observation = fixture.observation;
      observation.code.coding[0].code = input.source_snapshot.test_code;
      observation.valueQuantity.unit = input.source_snapshot.unit;
      for (const range of observation.referenceRange ?? []) for (const key of ["low", "high"] as const) {
        if (range[key]) range[key].unit = observation.valueQuantity.unit;
      }
      if (mode === "no-range") delete observation.referenceRange;
      assert.equal((await h.postObservation(observation)).status, 422);
      const exchanges = await h.middlewarePool.query("select count(*)::int as n from integration.exchange_transactions where source_result_id=$1", [input.source_result_id]);
      const results = await h.emrPool.query("select count(*)::int as n from emr.lab_results where external_id=$1", [input.source_result_id]);
      assert.equal(exchanges.rows[0].n, 0); assert.equal(results.rows[0].n, 0);
    }
  });

  await t.test("C4-ENV: real /ready endpoints validate three isolated service roles and schema access", async () => {
    const ready: Record<string, unknown> = {};
    for (const [service, server, schema, role] of [
      ["lis", h.lis, "lis", "lis_app"], ["middleware", h.middleware, "integration", "integration_app"], ["emr", h.emr, "emr", "emr_app"],
    ] as const) {
      const response = await requestJson(server.baseUrl, "/ready");
      assert.deepEqual(response, { status: 200, body: { service, status: "ready", schema, database: "dacn_db", role } });
      ready[service] = response;
    }
    evidence.environment.readiness = ready;
    // Run the repository's existing readiness command against the three temporary ports.
    const child = spawn(process.execPath, ["../scripts/db-check.mjs"], { cwd: new URL("../../", import.meta.url),
      env: { ...process.env, LIS_PORT: new URL(h.lis.baseUrl).port, MIDDLEWARE_PORT: new URL(h.middleware.baseUrl).port,
        EMR_PORT: new URL(h.emr.baseUrl).port }, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    const exited = await once(child, "exit"); assert.deepEqual(exited, [0, null]);
    assert.match(output, /PASS lis/); assert.match(output, /PASS middleware/); assert.match(output, /PASS emr/);
    evidence.environment.readiness_command = { command: "node ../scripts/db-check.mjs", exit_code: 0, output };
  });

  for (const variant of variants) await t.test(`C4-01/05/06/07: ${variant} bounds, independent values, 201 → GET → DELIVERED`, async (t) => {
    const c = await h.scenario(t, { variant });
    assert.equal((await c.row()).status, "RECEIVED"); assert.deepEqual(await c.dbRows(), []);
    await c.run();
    await assertAudit(h, c, "DELIVERED", [["SEND", 1, 201, null], ["VERIFY", 1, 200, null]]);
    await assertStored(c); assert.deepEqual((await c.events()).map((event) => event.eventType), successEvents);
    for (const query of [
      { external_system: "urn:c4:another-result-namespace", external_id: c.columns.external_id },
      { external_system: c.columns.external_system, external_id: "C4-SYNTHETIC-NOT-FOUND" },
    ]) assert.deepEqual(await requestJson(h.emr.baseUrl, `/api/lab-results?${new URLSearchParams(query)}`),
      { status: 200, body: { items: [] } });
    // Repeated incoming LIS envelope must retain the delivered exchange, counts, history.
    const before = await c.row(); const events = await c.events(); const attempts = await c.attempts();
    assert.deepEqual(await h.postExchange(c.envelope), c.accepted);
    assert.deepEqual(await c.row(), before); assert.deepEqual(await c.events(), events); assert.deepEqual(await c.attempts(), attempts);
    await record(c, `C4-01/05/06/07-${variant}`);
  });

  await t.test("C4-02: real prior POST + Worker retry returns 200 ALREADY_EXISTS with the same row and UUID", async (t) => {
    const c = await h.scenario(t);
    const first = await h.postObservation(c.observation); assert.equal(first.status, 201);
    const before = await c.dbRows(); assert.equal(before.length, 1);
    await c.run(); await assertAudit(h, c, "DELIVERED", [["SEND", 1, 200, null], ["VERIFY", 1, 200, null]]);
    assert.deepEqual(c.workerHttp[0].response_body, { ...(first.body as object), result: "ALREADY_EXISTS" });
    assert.deepEqual(await c.dbRows(), before); await assertStored(c);
    await record(c, "C4-02", { prior_post: first });
  });

  await t.test("C4-03: missing correct-namespace patient link returns 422; decoy patient is never used", async (t) => {
    const c = await h.scenario(t, { linked: false }); await c.run();
    await assertAudit(h, c, "REJECTED", [["SEND", 1, 422, "REMOTE_VALIDATION_ERROR"]]);
    assertError({ status: c.workerHttp[0].status, body: c.workerHttp[0].response_body }, 422, "PATIENT_NOT_LINKED");
    assert.deepEqual(await c.dbRows(), []); assert.deepEqual(await c.get(), { status: 200, body: { items: [] } });
    const count = await h.emrPool.query("select count(*)::int as total from emr.lab_results where patient_key=any($1::uuid[])",
      [[c.patientKey, c.decoyPatientKey]]); assert.equal(count.rows[0].total, 0);
    assert.deepEqual((await c.events()).map((event) => event.eventType), [...successEvents.slice(0, 5), "REJECTED"]);
    await record(c, "C4-03");
  });

  await t.test("C4-04: same source pair with changed content returns real 409, preserves every original column", async (t) => {
    const c = await h.scenario(t); const other = structuredClone(c.observation); other.valueQuantity.value = 0.8;
    assert.equal((await h.postObservation(other)).status, 201); const before = await c.dbRows();
    await c.run(); await assertAudit(h, c, "REJECTED", [["SEND", 1, 409, "DUPLICATE_CONFLICT"]]);
    assertError({ status: c.workerHttp[0].status, body: c.workerHttp[0].response_body }, 409, "DUPLICATE_CONFLICT");
    assert.deepEqual(await c.dbRows(), before);
    assert.deepEqual(await c.get(), { status: 200, body: { items: before } });
    await record(c, "C4-04", { original_rows: before });
  });

  for (const mismatch of ["quantity", "effective_at", "patient_key", "fhir_json", "missing"] as const) {
    await t.test(`C4-08: persisted ${mismatch} mismatch gives FAILED, never DELIVERED`, async (t) => {
      const c = await h.scenario(t);
      c.beforeRead(async () => {
        const row = await c.row(); assert.equal(row.status, "VERIFYING");
        assert.equal(row.verifiedAt, null); assert.equal(row.completedAt, null);
        const pair = [c.columns.external_system, c.columns.external_id];
        if (mismatch === "quantity") {
          // This wrong decimal rounds to the expected JS number; exact strings must still detect it.
          assert.equal(Number("0.300000000000000040001"), 0.30000000000000004);
          await h.emrPool.query("update emr.lab_results set quantity=$3 where external_system=$1 and external_id=$2",
            [...pair, "0.300000000000000040001"]);
        } else if (mismatch === "effective_at") {
          await h.emrPool.query("update emr.lab_results set effective_at=effective_at + interval '1 microsecond' where external_system=$1 and external_id=$2", pair);
        } else if (mismatch === "patient_key") {
          await h.emrPool.query("update emr.lab_results set patient_key=$3 where external_system=$1 and external_id=$2", [...pair, c.decoyPatientKey]);
        } else if (mismatch === "fhir_json") {
          await h.emrPool.query("update emr.lab_results set fhir_json=jsonb_set(fhir_json,'{subject,identifier,value}',to_jsonb($3::text)) where external_system=$1 and external_id=$2",
            [...pair, "C4-SYNTHETIC-WRONG-PATIENT"]);
        } else await h.emrPool.query("delete from emr.lab_results where external_system=$1 and external_id=$2", pair);
      });
      await c.run(); await assertAudit(h, c, "FAILED", [["SEND", 1, 201, null], ["VERIFY", 1, 200, "VERIFY_MISMATCH"]]);
      const last = (await c.events()).at(-1); assert.equal(last?.eventType, "VERIFY_MISMATCH");
      assert.deepEqual((last?.detail as { fields: string[] }).fields, [mismatch === "missing" ? "items.count" : mismatch]);
      const send = c.workerHttp[0]; const receipt = storageReceipt(send.status, send.response_body, c.observation); assert.ok(receipt);
      assert.deepEqual(verifyReadBack(c.workerHttp[1].response_body, c.observation, receipt), [mismatch === "missing" ? "items.count" : mismatch]);
      await record(c, `C4-08-${mismatch}`, { injected_fault: mismatch });
    });
  }

  await t.test("C4-08: real GET dependency error waits in VERIFY; recovery repeats GET only", async (t) => {
    const c = await h.scenario(t);
    c.beforeRead(async () => {
      // PostgreSQL accepts infinity; real C1 cannot expose it as a finite ISO timestamp and fails.
      await h.emrPool.query("update emr.lab_results set effective_at='infinity' where external_system=$1 and external_id=$2",
        [c.columns.external_system, c.columns.external_id]);
    });
    await c.run(); await assertAudit(h, c, "RETRY_WAIT", [["SEND", 1, 201, null], ["VERIFY", 1, 503, "HTTP_TEMPORARY"]]);
    assert.equal((await c.dbRows())[0].effective_at, "infinity", "The real stored fault caused the read error");
    assertError({ status: c.workerHttp[1].status, body: c.workerHttp[1].response_body }, 503, "DEPENDENCY_UNAVAILABLE");
    const waiting = await c.row(); assert.equal(waiting.retryPhase, "VERIFY"); assert.ok(waiting.nextRetryAt);
    const failedRead = { status: waiting.status, retry_phase: waiting.retryPhase, verified_at: waiting.verifiedAt,
      completed_at: waiting.completedAt, events: (await c.events()).map((event) => event.eventType) };
    await h.emrPool.query("update emr.lab_results set effective_at=$3::timestamptz where external_system=$1 and external_id=$2",
      [c.columns.external_system, c.columns.external_id, c.columns.effective_at]);
    await c.waitUntilDue(); await c.run(true);
    await assertAudit(h, c, "DELIVERED", [["SEND", 1, 201, null], ["VERIFY", 1, 503, "HTTP_TEMPORARY"], ["VERIFY", 2, 200, null]]);
    await assertStored(c);
    assert.deepEqual((await c.events()).map((event) => event.eventType),
      [...successEvents.slice(0, 7), "RETRY_SCHEDULED", "CLAIMED", "VERIFY_STARTED", "DELIVERED"]);
    await record(c, "C4-08-recovery", { before_recovery: failedRead, injected_fault: "unrepresentable persisted timestamp" });
  });

  await t.test("C4-PROCESS: unchanged worker-main process delivers to real EMR and exits cleanly", async (t) => {
    const c = await h.scenario(t); const start = h.requests.length;
    const child = spawn(process.execPath, ["--import", "tsx", "src/middleware/worker-main.ts"], {
      cwd: new URL("../../", import.meta.url), env: { ...process.env, EMR_BASE_URL: h.emr.baseUrl,
        MIDDLEWARE_WORKER_POLL_MS: "10", MIDDLEWARE_WORKER_HTTP_TIMEOUT_MS: "3000", MIDDLEWARE_WORKER_LEASE_MS: "15000" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const started = performance.now();
    let output = "", startupMs: number | null = null;
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (startupMs === null && output.includes("[Middleware Worker] Started.")) startupMs = performance.now() - started;
    });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    const exited = once(child, "exit");
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
    // Cold tsx startup over a Windows bind mount can exceed the old ~10 second poll budget.
    // Keep all delivery assertions; stop immediately if the process exits before delivering.
    const deadline = started + 60000;
    while ((await c.row()).status !== "DELIVERED" && performance.now() < deadline
      && child.exitCode === null && child.signalCode === null) await pause(50);
    t.diagnostic(`Worker startup=${startupMs === null ? "not observed" : Math.round(startupMs)}ms; delivery wait=${Math.round(performance.now() - started)}ms; exit=${child.exitCode}; signal=${child.signalCode}`);
    assert.equal((await c.row()).status, "DELIVERED", `Worker did not deliver: ${output}`); child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
    try { assert.deepEqual(await exited, [0, null]); } finally { clearTimeout(timer); }
    assert.ok(output.includes("[Middleware Worker] Started."));
    assert.ok(!output.includes(c.envelope.source_snapshot.patient_id));
    c.workerHttp.push(...h.requests.slice(start));
    await assertAudit(h, c, "DELIVERED", [["SEND", 1, 201, null], ["VERIFY", 1, 200, null]]);
    await assertStored(c); await record(c, "C4-PROCESS", { worker_process_exit: 0 });
  });

  await h.assertEmpty(); // Each scenario cleaned only its own rows.
  assert.equal(evidence.scenarios.length, 14);
  evidence.completed = true;
});
