import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { test } from "node:test";
import { isRecord, requestJson } from "../emr/http-test-helpers.js";
import { digest, fixtureSha256, variants } from "./d3-fixtures.js";
import { createHarness, field, one, type DbRow, type D3Scenario, type D3State } from "./d3-harness.js";

const successEvents = ["RECEIVED", "CLAIMED", "VALIDATED", "TRANSFORMED", "SENT", "TARGET_STORED", "VERIFY_STARTED", "DELIVERED"];
const immutableFields = ["event_id", "result_id", "source_system", "source_snapshot", "source_hash", "published_at"];
function immutable(row: DbRow) { return Object.fromEntries(immutableFields.map((name) => [name, row[name]])); }
function time(row: DbRow, key: string): string {
  const value = field(row, key); assert.match(value, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/); return value;
}
function ordered(...times: string[]) { for (let index = 1; index < times.length; index++) assert.ok(times[index - 1] <= times[index], "Persisted milestones must be ordered at microsecond precision"); }

function assertAck(c: D3Scenario, state: D3State) {
  const lis = state.lis.event; const exchange = one(state.middleware.exchanges, "Middleware exchange");
  assert.deepEqual(immutable(lis), immutable(c.initialEvent)); assert.equal(lis.dispatch_status, "ACK");
  assert.equal(lis.exchange_id, exchange.exchange_id); assert.equal(exchange.event_id, c.eventId);
  const ack = { accepted: true, event_id: c.eventId, exchange_id: exchange.exchange_id, source_system: "lis-demo",
    source_result_id: c.resultId, source_hash: c.envelope.source_hash };
  assert.deepEqual(lis.ack_response, ack); assert.ok(lis.acked_at);
  assert.equal(lis.lease_token, null); assert.equal(lis.lease_until, null); assert.equal(lis.next_retry_at, null);
  assert.equal(lis.last_error_code, null); assert.equal(lis.last_error_message, null);
  assert.equal(lis.dispatch_attempt_count, state.lis.attempts.length);
  assert.deepEqual(state.lis.attempts.map((row) => row.attempt_no), state.lis.attempts.map((_, index) => index + 1));
  for (const attempt of state.lis.attempts) {
    assert.equal(attempt.event_id, c.eventId); ordered(time(attempt, "started_at"), time(attempt, "sent_at"), time(attempt, "ended_at"));
    if (attempt.http_status === null) assert.equal(attempt.response_at, null);
    else ordered(time(attempt, "sent_at"), time(attempt, "response_at"), time(attempt, "ended_at"));
  }
  const last = state.lis.attempts.at(-1)!; assert.equal(last.http_status, 202); assert.equal(last.error_code, null);
  assert.deepEqual(last.response_body, ack);
  ordered(time(exchange, "received_at"), time(lis, "acked_at"));
  assert.deepEqual(exchange.source_payload, c.envelope); assert.equal(exchange.source_hash, c.envelope.source_hash);
  for (const trace of c.middlewareHttp()) {
    assert.equal(trace.method, "POST"); assert.equal(trace.path, "/api/exchanges");
    assert.equal(trace.content_type, "application/json"); assert.deepEqual(trace.request_body, c.envelope);
    if (trace.upstream_status !== null) { assert.equal(trace.upstream_status, 202); assert.deepEqual(trace.response_body, ack); }
  }
  return exchange;
}

async function assertDelivered(c: D3Scenario) {
  const state = await c.state(); const exchange = assertAck(c, state);
  assert.equal(exchange.status, "DELIVERED"); assert.equal(exchange.lease_token, null); assert.equal(exchange.lease_until, null);
  assert.equal(exchange.next_retry_at, null); assert.equal(exchange.retry_phase, null);
  assert.deepEqual(exchange.fhir_payload, c.observation); assert.equal(exchange.payload_hash, digest(c.observation));
  assert.equal(exchange.mapping_version, "lis-observation-v2"); assert.deepEqual(exchange.patient_identifier, c.observation.subject.identifier);
  const stored = one(state.emr.results, "EMR result");
  for (const [name, expected] of Object.entries(c.columns)) assert.equal(stored[name], expected, name);
  assert.deepEqual(stored.fhir_json, c.observation); assert.equal(stored.patient_key, c.patientKey);
  assert.notEqual(stored.patient_key, c.decoyKey); assert.match(field(stored, "target_id"), /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  const resolved = one(state.emr.patients.filter((patient) => patient.patient_key === stored.patient_key), "independently seeded patient");
  assert.equal(resolved.display_label, c.expectedPatientLabel);
  const link = one(state.emr.links.filter((row) => row.identifier_system === "urn:uuid:b954f2c4-cfe0-575f-86c0-c1cba88052a4" && row.identifier_value === c.patientId), "exact patient link");
  assert.equal(link.patient_key, resolved.patient_key);
  assert.deepEqual(state.middleware.attempts.map((row) => [row.phase, row.attempt_no, row.http_status, row.error_code]),
    [["SEND", 1, 201, null], ["VERIFY", 1, 200, null]]);
  assert.equal(exchange.send_attempt_count, 1); assert.equal(exchange.verify_attempt_count, 1);
  assert.deepEqual(state.middleware.events.map((row) => row.event_type), successEvents);
  ordered(...state.middleware.events.map((row) => time(row, "occurred_at")));
  for (const attempt of state.middleware.attempts) {
    assert.equal(attempt.exchange_id, exchange.exchange_id);
    ordered(time(attempt, "started_at"), time(attempt, "sent_at"), time(attempt, "response_at"), time(attempt, "ended_at"));
    const events = state.middleware.events.filter((row) => row.attempt_id === attempt.attempt_id);
    assert.deepEqual(events.map((row) => row.event_type), attempt.phase === "SEND" ? ["SENT", "TARGET_STORED"] : ["VERIFY_STARTED", "DELIVERED"]);
  }
  for (const event of state.middleware.events) {
    assert.equal(event.exchange_id, exchange.exchange_id);
    if (event.attempt_id !== null) assert.ok(state.middleware.attempts.some((attempt) => attempt.attempt_id === event.attempt_id));
  }
  const [send, verify] = state.middleware.attempts;
  ordered(time(exchange, "received_at"), time(exchange, "validated_at"), time(exchange, "mapping_started_at"),
    time(exchange, "transformed_at"), time(exchange, "first_sent_at"), time(send, "sent_at"), time(stored, "received_at"),
    time(stored, "stored_at"), time(send, "response_at"), time(send, "ended_at"), time(exchange, "target_stored_at"),
    time(verify, "started_at"), time(verify, "response_at"), time(verify, "ended_at"), time(exchange, "verified_at"));
  assert.equal(exchange.verified_at, exchange.completed_at);
  const http = c.emrHttp(); assert.deepEqual(http.map((item) => [item.method, item.path, item.upstream_status, item.transport]),
    [["POST", "/api/observations", 201, "forwarded"], ["GET", "/api/lab-results", 200, "forwarded"]]);
  assert.equal(http[0].content_type, "application/fhir+json"); assert.deepEqual(http[0].request_body, c.observation);
  const receipt = { result: "STORED", external_system: c.columns.external_system, external_id: c.resultId,
    target_id: stored.target_id, patient_key: c.patientKey };
  assert.deepEqual(http[0].response_body, receipt); assert.deepEqual(send.response_body, receipt);
  assert.deepEqual(http[1].query, { external_system: c.columns.external_system, external_id: c.resultId });
  assert.deepEqual(http[1].response_body, { items: state.emr.results });
  return state;
}

test("D3: full LIS Publish → Dispatcher → Middleware Worker/Mapper → EMR → verified read-back", { timeout: 120000 }, async (t) => {
  // Fail with the dedicated command when unconfigured; never report a skipped E2E suite as PASS.
  const h = await createHarness(t);
  const evidence: { completed: boolean; environment: Record<string, unknown>; scenarios: Record<string, unknown>[] } = {
    completed: false, environment: { node: process.version,
      postgres: (await h.pools.emr.query("show server_version")).rows[0].server_version, image: "postgres:17",
      fixture_sha256: fixtureSha256, provenance: "D3 hand-authored synthetic fixtures; no MIMIC or SPP-65 data",
      components: "Real LIS/Middleware/EMR Controllers, Services, Repositories, Dispatcher, Worker and Mapper; no mocked production dependencies",
      roles: ["lis_app", "integration_app", "emr_app"], transport: "localhost HTTP; transparent relay records real requests/responses",
      fault_injection: "stop/restart real Middleware listener; drop/hold genuine responses after upstream completion; SIGKILL Dispatcher",
      dispatcher_config: h.dispatcherConfig, worker_config: h.workerConfig,
      schema_sha256: createHash("sha256").update(readFileSync(new URL("../../../database/dacn_db_init_v2.sql", import.meta.url))).digest("hex"),
      roles_sha256: createHash("sha256").update(readFileSync(new URL("../../../database/access_roles.sql", import.meta.url))).digest("hex"),
    }, scenarios: [],
  };
  t.after(async () => {
    if (process.env.D3_EVIDENCE_PATH) await writeFile(process.env.D3_EVIDENCE_PATH,
      `${JSON.stringify(evidence, (key, value: unknown) => key === "lease_token" && value ? "[test lease redacted]" : value, 2)}\n`);
  });
  async function record(c: D3Scenario, caseId: string, state: D3State, extra: Record<string, unknown> = {}) {
    const exchange = one(state.middleware.exchanges, "recorded exchange"); const stored = state.emr.results[0];
    const safeAttempts = state.lis.attempts.map(({ lease_token, ...row }) => ({ ...row, lease_token: lease_token ? "[test lease redacted]" : null }));
    const http = (traces: ReturnType<D3Scenario["emrHttp"]>) => traces.map(({ raw_request, ...trace }) => ({ ...trace,
      request_sha256: createHash("sha256").update(raw_request).digest("hex") }));
    evidence.scenarios.push({ case_id: caseId, variant: c.name, outcome: "PASS", source_record: c.originalSource, source_catalog: c.catalog,
      expected_snapshot: c.snapshot, expected_fhir: c.observation, expected_columns: { ...c.columns, patient_key: c.patientKey },
      publish_http: c.publishHttp, initial_publish_event: c.initialEvent, event_id: c.eventId, source_hash: c.envelope.source_hash,
      lis: { event: state.lis.event, attempts: safeAttempts }, middleware: state.middleware,
      emr: { results: state.emr.results, expected_patient_key: c.patientKey, decoy_patient_key: c.decoyKey, patient_links: state.emr.links,
        resolved_patient: stored ? state.emr.patients.find((patient) => patient.patient_key === stored.patient_key) : null },
      middleware_http: http(c.middlewareHttp()), emr_http: http(c.emrHttp()),
      read_back_comparison: stored ? { row_count: 1, fields: Object.fromEntries(Object.keys(c.columns).map((name) =>
        [name, { expected: c.columns[name as keyof typeof c.columns], actual: stored[name], equal: true }])),
        patient_key_matches_seed: true, fhir_matches_independent_fixture: true, worker_get_matches_sql: true }
        : { row_count: 0, verified: false },
      final_states: { lis: state.lis.event.dispatch_status, middleware: exchange.status }, ...extra });
    t.diagnostic(`${caseId}/${c.name}: LIS ${String(state.lis.event.dispatch_status)}; Middleware ${String(exchange.status)}; EMR rows ${state.emr.results.length}`);
  }

  await t.test("D3-ENV: all real /ready endpoints validate the isolated roles; hash oracle has a fixed vector", async () => {
    const readiness: unknown[] = [];
    for (const [service, endpoint, schema, role] of [["lis", h.lis, "lis", "lis_app"],
      ["middleware", h.middleware, "integration", "integration_app"], ["emr", h.emr, "emr", "emr_app"]] as const) {
      const response = await requestJson(endpoint.baseUrl, "/ready");
      assert.deepEqual(response, { status: 200, body: { service, status: "ready", schema, database: "dacn_db", role } }); readiness.push(response);
    }
    assert.equal(digest({}), "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a");
    evidence.environment.readiness = readiness;
  });

  await t.test("D3-01: actual background entry points complete Publish → ACK → DELIVERED", async (t) => {
    const c = await h.scenario(t); const dispatcher = h.startProcess(t, "dispatcher");
    await c.waitFor((state) => state.lis.event.dispatch_status === "ACK", "Dispatcher process must commit LIS ACK");
    assert.deepEqual(await dispatcher.stop(), { code: 0, signal: null });
    const received = await c.state(); assertAck(c, received);
    assert.equal(one(received.middleware.exchanges, "received exchange").status, "RECEIVED"); assert.deepEqual(received.emr.results, []);
    const worker = h.startProcess(t, "worker");
    await c.waitFor((state) => state.middleware.exchanges[0]?.status === "DELIVERED", "Worker process must verify real EMR");
    assert.deepEqual(await worker.stop(), { code: 0, signal: null });
    assert.match(dispatcher.output(), /Started/); assert.match(worker.output(), /Started/);
    for (const output of [dispatcher.output(), worker.output()]) { assert.ok(!output.includes(c.patientId)); assert.ok(!output.includes(c.resultId)); }
    const final = await assertDelivered(c); await record(c, "D3-01", final, { checkpoint_after_ack: received,
      processes: { dispatcher_exit: 0, worker_exit: 0 } });
  });

  await t.test("D3-02: repeated Publish before and after delivery retains the same event and result", async (t) => {
    const c = await h.scenario(t); const repeated = await c.publish();
    assert.equal(repeated.status, 200); assert.deepEqual(repeated.body, c.published.body);
    assert.equal(await c.dispatcher().runOnce(), "acknowledged"); assert.equal(await c.worker().runOnce(), "processed");
    const before = await assertDelivered(c); const again = await c.publish(); assert.equal(again.status, 200);
    assert.ok(isRecord(again.body)); assert.equal(again.body.event_id, c.eventId); assert.equal(again.body.dispatch_status, "ACK");
    assert.equal(await c.dispatcher().runOnce(), "idle"); assert.equal(await c.worker().runOnce(), "idle");
    assert.deepEqual(await c.state(), before); await record(c, "D3-02", before);
  });

  await t.test("D3-03: identical real Middleware retransmission returns its original exchange_id to LIS", async (t) => {
    const c = await h.scenario(t);
    const first = await requestJson(h.middlewareWire.baseUrl, "/api/exchanges", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c.envelope) });
    assert.equal(first.status, 202); assert.ok(isRecord(first.body)); const originalId = first.body.exchange_id;
    assert.equal((await c.state()).lis.event.dispatch_status, "PENDING");
    assert.equal(await c.dispatcher().runOnce(), "acknowledged"); assert.equal((await c.state()).lis.event.exchange_id, originalId);
    assert.equal(await c.worker().runOnce(), "processed"); const final = await assertDelivered(c);
    assert.equal(final.middleware.events.filter((event) => event.event_type === "RECEIVED").length, 1);
    await record(c, "D3-03", final, { first_real_receipt: first });
  });

  await t.test("D3-04: unavailable real Middleware listener leaves no false ACK and recovers after restart", async (t) => {
    const c = await h.scenario(t); await h.middleware.close();
    try {
      assert.equal(await c.dispatcher().runOnce(), "retry_wait"); const unavailable = await c.state();
      assert.equal(unavailable.lis.event.dispatch_status, "RETRY_WAIT"); assert.equal(unavailable.lis.event.ack_response, null);
      assert.equal(unavailable.lis.event.exchange_id, null); assert.equal(unavailable.lis.attempts[0].error_code, "NETWORK_ERROR");
      assert.equal(unavailable.lis.attempts[0].http_status, null); assert.deepEqual(unavailable.middleware.exchanges, []); assert.deepEqual(unavailable.emr.results, []);
      await h.middleware.start(); await c.waitUntilDue();
      assert.equal(await c.dispatcher().runOnce(), "acknowledged"); assert.equal(await c.worker().runOnce(), "processed");
      const final = await assertDelivered(c); assert.equal(final.lis.attempts.length, 2);
      assert.equal(c.middlewareHttp()[0].raw_request, c.middlewareHttp()[1].raw_request);
      await record(c, "D3-04", final, { checkpoint_during_outage: unavailable });
    } finally { await h.middleware.start(); }
  });

  await t.test("D3-05: lost real ACK after commit retries identical bytes without resetting a delivered exchange", async (t) => {
    const c = await h.scenario(t); const lost = h.middlewareWire.fault("POST", "/api/exchanges", "drop");
    assert.equal(await c.dispatcher().runOnce(), "retry_wait"); const response = await lost.observed();
    assert.equal(response.upstream_status, 202); assert.equal(response.transport, "dropped");
    const afterLoss = await c.state(); const original = one(afterLoss.middleware.exchanges, "committed exchange before retry");
    assert.equal(afterLoss.lis.event.ack_response, null); assert.equal(afterLoss.lis.event.exchange_id, null);
    assert.equal(afterLoss.lis.attempts[0].error_code, "NETWORK_ERROR"); assert.equal(original.status, "RECEIVED");
    // Remote progress is independent of LIS receiving ACK: complete delivery before retransmission.
    assert.equal(await c.worker().runOnce(), "processed"); const deliveredBeforeAck = await c.state();
    assert.equal(deliveredBeforeAck.middleware.exchanges[0].status, "DELIVERED");
    await c.waitUntilDue(); assert.equal(await c.dispatcher().runOnce(), "acknowledged");
    const final = await assertDelivered(c); assert.equal(final.lis.event.exchange_id, original.exchange_id);
    assert.deepEqual(final.middleware, deliveredBeforeAck.middleware); assert.deepEqual(final.emr, deliveredBeforeAck.emr);
    assert.equal(c.middlewareHttp()[0].raw_request, c.middlewareHttp()[1].raw_request);
    await record(c, "D3-05", final, { checkpoint_after_lost_ack: afterLoss, delivered_before_lis_ack: true });
  });

  await t.test("D3-06: missing patient link rejects delivery and never falls back to a decoy patient", async (t) => {
    const c = await h.scenario(t, { linked: false }); assert.equal(await c.dispatcher().runOnce(), "acknowledged");
    assert.equal(await c.worker().runOnce(), "processed"); const state = await c.state(); const exchange = assertAck(c, state);
    assert.equal(exchange.status, "REJECTED"); assert.equal(exchange.verified_at, null); assert.equal(exchange.completed_at, null);
    assert.equal(exchange.verify_attempt_count, 0); assert.deepEqual(state.emr.results, []);
    assert.deepEqual(await h.rows("emr.lab_results", "patient_key=any($1::uuid[])", [[c.patientKey, c.decoyKey]]), []);
    assert.deepEqual(state.middleware.attempts.map((row) => [row.phase, row.http_status, row.error_code]), [["SEND", 422, "REMOTE_VALIDATION_ERROR"]]);
    assert.deepEqual(state.middleware.events.map((row) => row.event_type), [...successEvents.slice(0, 5), "REJECTED"]);
    assert.equal(c.emrHttp().length, 1); assert.equal(c.emrHttp()[0].upstream_status, 422);
    const body = c.emrHttp()[0].response_body; assert.ok(isRecord(body) && isRecord(body.error)); assert.equal(body.error.code, "PATIENT_NOT_LINKED");
    assert.equal(await c.worker().runOnce(), "idle"); await record(c, "D3-06", state);
  });

  await t.test("D3-07: competing actual Dispatchers create exactly one attempt, exchange and EMR result", async (t) => {
    const c = await h.scenario(t);
    assert.deepEqual((await Promise.all([c.dispatcher().runOnce(), c.dispatcher().runOnce()])).sort(), ["acknowledged", "idle"]);
    assert.equal(await c.worker().runOnce(), "processed"); const final = await assertDelivered(c);
    assert.equal(final.lis.attempts.length, 1); assert.equal(c.middlewareHttp().length, 1); await record(c, "D3-07", final);
  });

  await t.test("D3-08: killed Dispatcher recovers an expired lease in a new process without resetting history", async (t) => {
    const c = await h.scenario(t); const held = h.middlewareWire.fault("POST", "/api/exchanges", "hold");
    const config = { LIS_DISPATCHER_HTTP_TIMEOUT_MS: "1000", LIS_DISPATCHER_LEASE_MS: "2500" };
    const first = h.startProcess(t, "dispatcher", config);
    try {
      const response = await held.observed(); assert.equal(response.upstream_status, 202);
      assert.deepEqual(await first.stop("SIGKILL"), { code: null, signal: "SIGKILL" });
      const interrupted = await c.state(); assert.equal(interrupted.lis.event.dispatch_status, "IN_FLIGHT");
      assert.equal(interrupted.lis.event.ack_response, null); assert.equal(interrupted.lis.attempts[0].ended_at, null);
      const originalId = one(interrupted.middleware.exchanges, "committed exchange during interruption").exchange_id;
      held.release(); await c.waitUntilExpired();
      const restarted = h.startProcess(t, "dispatcher", config);
      await c.waitFor((state) => state.lis.event.dispatch_status === "ACK", "Restarted Dispatcher must commit ACK");
      assert.deepEqual(await restarted.stop(), { code: 0, signal: null });
      assert.equal(await c.worker().runOnce(), "processed"); const final = await assertDelivered(c);
      assert.equal(final.lis.event.exchange_id, originalId);
      assert.deepEqual(final.lis.attempts.map((row) => [row.attempt_no, row.error_code]), [[1, "LEASE_EXPIRED"], [2, null]]);
      assert.notEqual(final.lis.attempts[0].lease_token, final.lis.attempts[1].lease_token);
      assert.equal(c.middlewareHttp()[0].raw_request, c.middlewareHttp()[1].raw_request);
      await record(c, "D3-08", final, { checkpoint_after_interruption: { status: interrupted.lis.event.dispatch_status,
        attempt_count: interrupted.lis.event.dispatch_attempt_count, ended_at: interrupted.lis.attempts[0].ended_at, original_exchange_id: originalId },
        process_restart: { first_exit_signal: "SIGKILL", second_exit_code: 0, natural_lease_expiry: true, ownership_token_changed: true } });
    } finally { held.release(); }
  });

  for (const variant of variants) await t.test(`D3-09: independent clinical/FHIR comparison with ${variant} reference bounds`, async (t) => {
    const c = await h.scenario(t, { variant }); assert.equal(await c.dispatcher().runOnce(), "acknowledged");
    assert.equal(await c.worker().runOnce(), "processed"); await record(c, "D3-09", await assertDelivered(c));
  });

  await t.test("D3-10: persisted EMR result remains VERIFYING until the genuine GET response reaches Worker", async (t) => {
    const c = await h.scenario(t); assert.equal(await c.dispatcher().runOnce(), "acknowledged");
    const held = h.emrWire.fault("GET", "/api/lab-results", "hold"); const running = c.worker().runOnce();
    try {
      const read = await held.observed(); assert.equal(read.upstream_status, 200); assert.equal(read.transport, "held");
      const duringRead = await c.state(); const exchange = one(duringRead.middleware.exchanges, "verifying exchange");
      assert.equal(exchange.status, "VERIFYING"); assert.equal(exchange.verified_at, null); assert.equal(exchange.completed_at, null);
      assert.equal(duringRead.emr.results.length, 1); assert.deepEqual(read.response_body, { items: duringRead.emr.results });
      assert.equal(duringRead.middleware.attempts[1].ended_at, null); assert.equal(duringRead.middleware.attempts[1].response_at, null);
      assert.deepEqual(duringRead.middleware.events.map((event) => event.event_type), successEvents.slice(0, -1));
      held.release(); assert.equal(await running, "processed");
      await record(c, "D3-10", await assertDelivered(c), { checkpoint_before_read_back_released: duringRead });
    } finally { held.release(); await running; }
  });

  await h.assertEmpty();
  assert.equal(evidence.scenarios.length, 13);
  assert.deepEqual([...new Set(evidence.scenarios.map((scenario) => scenario.case_id))].sort(),
    Array.from({ length: 10 }, (_, index) => `D3-${String(index + 1).padStart(2, "0")}`));
  evidence.environment.cleanup_empty = true; evidence.completed = true;
});
