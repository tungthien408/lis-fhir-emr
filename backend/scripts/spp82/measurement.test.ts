import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFixture } from '../../tests/e2e/d3-fixtures.js';
import { parseLoadConfig } from './load-config.js';
import { parseMeasurementConfig } from './measurement-config.js';
import { runMeasuredWorkload, type MeasurementConfig } from './measurement-runner.js';
import { calculateMetrics, completionLatency, percentile, replayJsonl } from './metrics.js';
import { getJson, observeProgress, type GetJson } from './progress-observer.js';
import { planned, type Clock, type Measurement, type RunManifest } from './run-recorder.js';
import { createReportWriter } from './report-writer.js';
const event = '00000000-0000-4000-8000-000000000001';
const exchange = '00000000-0000-4000-8000-000000000002';
const target = '00000000-0000-4000-8000-000000000003';
function fakeClock() {
  let time = 0; let skew = 0;
  const clock: Clock = {
    stamp: () => ({ utc: new Date(Date.UTC(2026, 10, 2) + time + skew).toISOString(), elapsed_ms: time }),
    sleep: async (ms) => { time += ms; await new Promise<void>((resolve) => setImmediate(resolve)); },
  };
  return { clock, advance: (ms: number) => { time += ms; }, skew: () => { skew -= 3600000; } };
}
const options: MeasurementConfig = {
  lisBaseUrl: 'http://lis.test', middlewareBaseUrl: 'http://mw.test', emrBaseUrl: 'http://emr.test',
  httpTimeoutMs: 1000, pollingIntervalMs: 10, runTimeoutMs: 100, observerConcurrency: 2,
  scenario: 'SPP-73-simulated', gitCommit: null, manifestHash: null, simulated: true,
};
function environment(state = 'DELIVERED', count = 1) {
  const f = createFixture();
  const row = { ...planned(f.resultId), event_id: event, publication: 'NEW' as const };
  row.milestones.publish_request_start = { utc: '2026-11-02T00:00:00Z', elapsed_ms: 0 };
  row.milestones.publish_response = { utc: '2026-11-02T00:00:00Z', elapsed_ms: 1 };
  const lis = { event_id: event, result_id: f.resultId, dispatch_status: 'ACK', exchange_id: exchange,
    dispatch_attempt_count: 2, last_error_code: 'HTTP_TIMEOUT', last_error_message: 'SECRET password' };
  const mw = { exchange_id: exchange, event_id: event, source_result_id: f.resultId, source_system: 'lis-demo',
    status: state, send_attempt_count: 2, verify_attempt_count: 3, retry_phase: 'VERIFY',
    source_payload: { event_id: event, source_system: 'lis-demo', source_result_id: f.resultId, source_snapshot: f.snapshot },
    fhir_payload: f.observation, completed_at: '2099-01-01T00:00:00.000000Z', events: [
      { event_type: 'VERIFY_RETRY', old_status: 'VERIFYING', new_status: 'RETRY_WAIT', occurred_at: '2099-01-01T00:00:00Z' },
    ] };
  const item = { ...f.columns, target_id: target, patient_key: f.patientKey, fhir_json: f.observation };
  const body = { items: Array.from({ length: count }, () => structuredClone(item)) };
  const urls: string[] = [];
  const get: GetJson = async (url) => { urls.push(url); return { status: 200,
    body: url.includes('publish-events') ? lis : url.includes('/api/exchanges/') ? mw : body }; };
  return { f, row, lis, mw, body, get, urls };
}
async function run(env = environment(), patch: Partial<Parameters<typeof runMeasuredWorkload>[5]> = {}, signal?: AbortSignal) {
  const time = fakeClock();
  const config = parseLoadConfig(['--confirm-publish', '--http-timeout-ms', '1000'], { LIS_BASE_URL: options.lisBaseUrl, SPP82_EXPERIMENT_TARGET: 'simulated' }, 'simulation');
  let journal = ''; let manifest!: RunManifest;
  const result = await runMeasuredWorkload(config, [{ resultId: env.f.resultId, patientId: env.f.patientId, testCode: 'synthetic' }], options,
    (value) => { manifest = value; return {
      record: (row) => { journal += JSON.stringify(row) + '\n'; },
      finish: (rows) => calculateMetrics(value, rows),
    }; }, signal, { clock: time.clock, get: env.get,
      sendPublish: async () => { time.advance(2); return { status: 202, eventId: event, receivedAt: '2099-01-01T00:00:00Z', errorCode: null }; },
      ...patch });
  return { ...result, journal, manifest };
}
test('B: full completion requires ACK, DELIVERED, strict read-back and correct identity pair', async () => {
  const env = environment(); const result = await run(env);
  assert.equal(result.rows[0].outcome, 'completed');
  assert.ok(completionLatency(result.rows[0])! >= 2);
  const query = new URL(env.urls.find((url) => url.includes('lab-results'))!).searchParams;
  assert.equal(query.get('external_system'), 'https://example.org/lis/result');
  assert.equal(query.get('external_id'), env.f.resultId);
  assert.deepEqual(calculateMetrics(result.manifest, replayJsonl(result.journal)), result.metrics);
  assert.equal(result.rows[0].observations.find((o) => o.stage === 'middleware')!.verify_attempt_count, 3);
});
test('B: ACK alone cannot complete, client timeout means unknown service outcome', async () => {
  const result = await run(environment('VERIFYING'));
  assert.equal(result.rows[0].outcome, 'timeout');
  assert.equal(result.rows[0].milestones.emr_readback_observed, undefined);
  assert.equal(calculateMetrics(result.manifest, result.rows).failure_count, 0);
});
test('B: DELIVERED observed only after several transient polls, retry evidence retained', async () => {
  const env = environment('RECEIVED'); let polls = 0;
  const get: GetJson = async (...args) => {
    if (args[0].includes('/api/exchanges/')) { polls++; env.mw.status = polls < 3 ? 'RETRY_WAIT' : 'DELIVERED'; }
    return env.get(...args);
  };
  const result = await run(env, { get });
  assert.equal(polls, 3); assert.equal(result.rows[0].outcome, 'completed');
  assert.equal(result.rows[0].observations.filter((o) => o.state === 'RETRY_WAIT').length, 2);
});
test('B: empty readback HTTP 200 is never success', async () => {
  const result = await run(environment('DELIVERED', 0));
  assert.equal(result.rows[0].outcome, 'timeout');
  assert.ok(result.rows[0].observations.some((o) => o.code === 'MISSING_READBACK'));
});
for (const state of ['FAILED', 'REJECTED']) test(`B: Middleware ${state} is terminal service failure`, async () => {
  const result = await run(environment(state));
  assert.equal(result.rows[0].outcome, 'service_failure');
  assert.ok(result.rows[0].milestones.terminal_failure_observed);
});
test('B: LIS BLOCKED is terminal', async () => {
  const env = environment(); env.lis.dispatch_status = 'BLOCKED';
  assert.equal((await run(env)).rows[0].outcome, 'service_failure');
});
test('B: failed polls are measurement uncertainty, not service failure', async () => {
  const result = await run(environment(), { get: async () => ({ status: 503, body: { error: 'SECRET' } }) });
  const metrics = calculateMetrics(result.manifest, result.rows);
  assert.equal(metrics.timeout_count, 1); assert.equal(metrics.service_failure_count, 0);
  assert.equal(metrics.latency_p50_ms, null);
});
test('B: duplicate destination rows are reported as measurement failure', async () => {
  const result = await run(environment('DELIVERED', 2));
  assert.equal(result.rows[0].reason, 'DUPLICATE_DESTINATION_ROWS');
});
test('B: readback precision mismatch is rejected using established verification', async () => {
  const env = environment(); env.body.items[0].quantity += '1';
  const result = await run(env);
  assert.equal(result.rows[0].reason, 'READBACK_MISMATCH');
});
test('B: missing event IDs and previous publications remain in denominator', async () => {
  for (const status of [200, 202]) {
    const result = await run(environment(), { sendPublish: async () => ({ status, eventId: null, receivedAt: null, errorCode: null }) });
    assert.equal(result.rows[0].outcome, status === 200 ? 'existing' : 'measurement_failure');
    assert.equal(calculateMetrics(result.manifest, result.rows).completion_rate, 0);
  }
});
test('B: ACK missing exchange ID is recorded and times out', async () => {
  const env = environment(); env.lis.exchange_id = '';
  const result = await run(env);
  assert.equal(result.rows[0].reason, 'MISSING_EXCHANGE_ID');
});
test('B: network loss after Publish is unknown, HTTP rejection is separate', async () => {
  const result = await run(environment(), { sendPublish: async () => ({ status: null, eventId: null, receivedAt: null, errorCode: 'HTTP_TIMEOUT' }) });
  assert.equal(result.rows[0].outcome, 'unknown');
  const rejected = await run(environment(), { sendPublish: async () => ({ status: 422, eventId: null, receivedAt: null, errorCode: 'HTTP_422' }) });
  assert.equal(rejected.rows[0].outcome, 'publish_rejected');
});
test('B: simulated server/client clock skew cannot change elapsed latency', async () => {
  const time = fakeClock(); const env = environment();
  const result = await run(env, { clock: time.clock, sendPublish: async () => {
    time.advance(8); time.skew(); return { status: 202, eventId: event, receivedAt: '2099-01-01', errorCode: null };
  } });
  assert.ok(completionLatency(result.rows[0])! >= 8);
  assert.ok(result.rows[0].milestones.publish_response!.utc < result.rows[0].milestones.publish_request_start!.utc);
});
test('B: pre-aborted run schedules no POST and preserves all planned rows', async () => {
  const abort = new AbortController(); abort.abort();
  const result = await run(environment(), { sendPublish: async () => { throw new Error('must not publish'); } }, abort.signal);
  assert.equal(result.rows[0].outcome, 'interrupted');
  assert.equal(result.rows[0].reason, 'NOT_STARTED');
  assert.equal(result.manifest.stop_reason, 'interrupted');
});
test('B: graceful interruption drains in-flight publication and saves unfinished state', async () => {
  const abort = new AbortController();
  const result = await run(environment(), { sendPublish: async () => {
    abort.abort(); await new Promise<void>((resolve) => setImmediate(resolve));
    return { status: 202, eventId: event, receivedAt: null, errorCode: null };
  } }, abort.signal);
  assert.equal(result.rows[0].outcome, 'interrupted'); assert.equal(result.rows[0].event_id, event);
  assert.deepEqual(replayJsonl(result.journal), JSON.parse(JSON.stringify(result.rows)));
});
test('B: p50/p95 nearest-rank and complete run throughput denominator, mixed outcomes', async () => {
  const result = await run(); const sample = result.rows[0];
  const records: Measurement[] = Array.from({ length: 20 }, (_, i) => {
    const row = structuredClone(sample); row.result_id = `R${i}`;
    for (const [index, name] of (['publish_request_start', 'publish_response', 'lis_ack_observed', 'middleware_delivered_observed', 'emr_readback_observed'] as const).entries())
      row.milestones[name]!.elapsed_ms = index === 4 ? (i + 1) * 10 : 0;
    return row;
  });
  records.push({ ...planned('failure'), outcome: 'service_failure' }, { ...planned('timeout'), outcome: 'timeout' });
  result.manifest.result_ids = records.map((r) => r.result_id); result.manifest.started.elapsed_ms = 0;
  result.manifest.ended!.elapsed_ms = 10000;
  const metrics = calculateMetrics(result.manifest, records);
  assert.equal(metrics.completion_count, 20); assert.equal(metrics.failure_count, 1); assert.equal(metrics.timeout_count, 1);
  assert.equal(metrics.completion_rate, 20 / 22); assert.equal(metrics.total_elapsed_seconds, 10);
  assert.equal(metrics.throughput_results_per_second, 2); assert.equal(metrics.latency_p50_ms, 100); assert.equal(metrics.latency_p95_ms, 190);
  assert.equal(percentile([], .5), null); assert.equal(percentile([5], .95), 5);
});
test('B: missing/out-of-order milestones never generate valid latency', async () => {
  const result = await run(); const row = result.rows[0];
  row.milestones.lis_ack_observed!.elapsed_ms = 99999; assert.equal(completionLatency(row), null);
  delete row.milestones.lis_ack_observed; assert.equal(completionLatency(row), null);
  assert.equal(calculateMetrics(result.manifest, [row]).invalid_completion_count, 1);
});
test('B: hard-kill artifacts remain incomplete; tolerate torn last JSONL line', async () => {
  const result = await run(); result.manifest.ended = null;
  assert.deepEqual(replayJsonl(result.journal + '{"broken"'), replayJsonl(result.journal));
  const metrics = calculateMetrics(result.manifest, []);
  assert.equal(metrics.incomplete_artifact, true); assert.equal(metrics.censored_count, 1);
  assert.equal(metrics.throughput_results_per_second, null);
});
test('B: output excludes clinical payloads, patient IDs, credentials, arbitrary errors', async () => {
  const env = environment(); const result = await run(env);
  for (const secret of [env.f.patientId, env.f.patientKey, 'SECRET', 'source_snapshot', 'fhir_payload', 'patient_key', 'last_error_message']) {
    assert.ok(!result.journal.includes(secret), secret);
  }
  const temp = mkdtempSync(join(tmpdir(), 'spp82-test-'));
  try {
    const path = join(temp, 'run'); const writer = createReportWriter(path, result.manifest);
    result.rows.forEach(writer.record); writer.finish(result.rows);
    assert.deepEqual(JSON.parse(readFileSync(join(path, 'metrics.json'), 'utf8')), result.metrics);
    assert.ok(readFileSync(join(path, 'summary.md'), 'utf8').includes('SIMULATED DATA'));
    assert.throws(() => createReportWriter(path, result.manifest));
  } finally { rmSync(temp, { recursive: true }); }
});
test('B: measurement configuration is opt-in, bounded and rejects credentials', () => {
  assert.equal(parseMeasurementConfig({}, 'http://lis.test', 1000), null);
  const env = { SPP82_MEASURE: '1', MIDDLEWARE_BASE_URL: 'http://mw.test', EMR_BASE_URL: 'http://emr.test' };
  assert.equal(parseMeasurementConfig(env, 'http://lis.test', 1000)!.pollingIntervalMs, 1000);
  assert.throws(() => parseMeasurementConfig({ ...env, SPP82_POLL_MS: '0' }, 'http://lis.test', 1000));
  assert.throws(() => parseMeasurementConfig({ ...env, EMR_BASE_URL: 'http://user:secret@emr.test' }, 'http://lis.test', 1000));
});
test('B: wrong event/exchange identity is not accepted', async () => {
  const env = environment(); env.mw.event_id = target;
  await observeProgress(env.row, options, fakeClock().clock, new AbortController().signal, () => {}, env.get);
  assert.equal(env.row.outcome, 'pending'); assert.equal(env.row.milestones.middleware_delivered_observed, undefined);
});

test('B: HTTP observer rejects non-JSON, redirects, malformed JSON and transport failures', async (t) => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  for (const response of [new Response('{}', { status: 200, headers: { 'content-type': 'text/html' } }),
    new Response('{}', { status: 302 }), new Response('broken', { status: 200, headers: { 'content-type': 'application/json' } })]) {
    globalThis.fetch = async (_url, init) => { assert.equal(init?.redirect, 'manual'); return response; };
    const poll = await getJson('http://simulated.invalid', 1000, new AbortController().signal);
    assert.equal(poll.body, null); assert.equal(poll.status, response.status);
  }
  globalThis.fetch = async () => { throw new Error('SECRET network details'); };
  assert.deepEqual(await getJson('http://simulated.invalid', 1000, new AbortController().signal), { status: null, body: null });
});
test('B: observer pool bounds concurrent polls independently of Publish concurrency', async () => {
  const time = fakeClock();
  const config = parseLoadConfig(['--confirm-publish', '--http-timeout-ms', '1000', '--mode', 'CONCURRENT', '--concurrency', '5'],
    { LIS_BASE_URL: options.lisBaseUrl, SPP82_EXPERIMENT_TARGET: 'simulation' });
  let active = 0; let max = 0;
  const envs = Array.from({ length: 5 }, () => environment());
  const result = await runMeasuredWorkload(config, envs.map((e) => ({ resultId: e.f.resultId, patientId: 'unused', testCode: 'unused' })),
    options, () => ({ record: () => {}, finish: () => null }), undefined, {
      clock: time.clock,
      sendPublish: async () => ({ status: 202, eventId: event, receivedAt: null, errorCode: null }),
      get: async () => {
        active++; max = Math.max(max, active);
        await new Promise<void>((resolve) => setImmediate(resolve)); active--;
        return { status: 503, body: null };
      },
    });
  assert.ok(max > 1); assert.ok(max <= options.observerConcurrency);
  assert.equal(result.rows.length, 5); assert.ok(result.rows.every((row) => row.outcome === 'timeout'));
});

test('B: journal does not grow with every poll; final complete snapshot is still written (SPP-73 DEF-02)', () => {
  const temp = mkdtempSync(join(tmpdir(), 'spp82-journal-'));
  try {
    const row = planned('R1'); const manifest = { run_id: 'journal-test' } as unknown as RunManifest;
    const writer = createReportWriter(join(temp, 'run'), manifest);
    writer.record(row);
    for (let poll = 0; poll < 50; poll++) {
      row.observations.push({ at: { utc: 'x', elapsed_ms: poll }, stage: 'lis', code: 'POLL' } as never);
      writer.record(row);
    }
    const before = readFileSync(join(temp, 'run', 'per-result.jsonl'), 'utf8').trim().split('\n');
    assert.ok(before.length <= 2, `expected at most 2 snapshots for 51 identical-state records, got ${before.length}`);
    try { writer.finish([row]); } catch { /* metrics need a full manifest; only the journal is under test */ }
    const lines = readFileSync(join(temp, 'run', 'per-result.jsonl'), 'utf8').trim().split('\n');
    assert.equal(JSON.parse(lines[lines.length - 1]!).observations.length, 50);
  } finally { rmSync(temp, { recursive: true }); }
});
