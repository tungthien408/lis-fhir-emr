/** SIMULATED DATA ONLY. Deterministic virtual clock and HTTP; zero network/database access. */
import { readFileSync } from 'node:fs';
import { parseLoadConfig } from './load-config.js';
import { runMeasuredWorkload } from './measurement-runner.js';
import { createReportWriter } from './report-writer.js';
const golden = JSON.parse(readFileSync(new URL('../../tests/e2e/fixtures/d3-synthetic.json', import.meta.url), 'utf8'));
const event = '00000000-0000-4000-8000-000000000001';
const exchange = '00000000-0000-4000-8000-000000000002';
const resultIds = [golden.snapshot.result_id as string, 'SIMULATED-EXISTING', 'SIMULATED-FAILED'];
let now = 0;
const config = parseLoadConfig(['--confirm-publish', '--http-timeout-ms', '1000'], { LIS_BASE_URL: 'http://simulated.invalid', SPP82_EXPERIMENT_TARGET: 'simulation-no-network' }, 'SPP82-B-SIMULATED');
const directory = process.argv[2];
if (!directory) throw new Error('Provide a NEW output directory for simulated artifacts');
await runMeasuredWorkload(config, resultIds.map((id) => ({ resultId: id, patientId: 'unused', testCode: 'unused' })), {
  lisBaseUrl: config.lisBaseUrl, middlewareBaseUrl: 'http://simulated.invalid', emrBaseUrl: 'http://simulated.invalid',
  httpTimeoutMs: 1000, scenario: 'SPP-73-simulated', pollingIntervalMs: 1000, runTimeoutMs: 10000,
  observerConcurrency: 1, gitCommit: null, manifestHash: null, simulated: true,
}, (manifest) => createReportWriter(directory, manifest), undefined, {
  clock: { stamp: () => ({ utc: new Date(Date.UTC(2026, 10, 2) + now).toISOString(), elapsed_ms: now }),
    sleep: async (ms) => { now += ms; await new Promise<void>((resolve) => setImmediate(resolve)); } },
  sendPublish: async (_url, id) => {
    now += 20;
    return { status: id === resultIds[1] ? 200 : id === resultIds[2] ? 422 : 202,
      eventId: id === resultIds[2] ? null : event, receivedAt: new Date(Date.UTC(2026, 10, 2) + now).toISOString(), errorCode: null };
  },
  get: async (url) => {
    now += 10;
    if (url.includes('publish-events')) return { status: 200, body: { event_id: event, result_id: resultIds[0],
      dispatch_status: 'ACK', exchange_id: exchange, dispatch_attempt_count: 2 } };
    if (url.includes('/api/exchanges/')) return { status: 200, body: { exchange_id: exchange, event_id: event,
      source_result_id: resultIds[0], source_system: 'lis-demo', status: 'DELIVERED', send_attempt_count: 1, verify_attempt_count: 1,
      source_payload: { event_id: event, source_result_id: resultIds[0], source_system: 'lis-demo', source_snapshot: golden.snapshot },
      fhir_payload: golden.observation } };
    if (url.includes('/api/lab-results?')) return { status: 200, body: { items: [{ ...golden.columns,
      target_id: '00000000-0000-4000-8000-000000000003', patient_key: '00000000-0000-4000-8000-000000000004', fhir_json: golden.observation }] } };
    throw new Error('Unexpected simulated request');
  },
});
