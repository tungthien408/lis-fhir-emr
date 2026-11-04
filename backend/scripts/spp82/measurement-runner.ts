import { createHash } from 'node:crypto';
import type { LoadConfig } from './load-config.js';
import type { EligibleResult } from './load-fixtures.js';
import { runPublishWorkload, sendPublishRequest, type PublishRunnerDependencies } from './publish-runner.js';
import { observeProgress, getJson, isUuid, finishFailure, type GetJson, type ObserverConfig } from './progress-observer.js';
import { mark, monotonicClock, planned, type Clock, type Measurement, type RunManifest } from './run-recorder.js';
export interface MeasurementConfig extends ObserverConfig {
  scenario: string; pollingIntervalMs: number; runTimeoutMs: number; observerConcurrency: number;
  gitCommit: string | null; manifestHash: string | null; simulated?: boolean;
  workerCounts?: RunManifest['worker_counts']; serviceConfiguration?: RunManifest['service_configuration'];
}
export interface MeasurementSink { record(row: Measurement): void; finish(rows: Measurement[]): unknown }
export interface MeasurementDependencies { clock: Clock; sendPublish: PublishRunnerDependencies['sendPublish']; get: GetJson }
/** The publisher retains its publish-only slots. Observation uses a separate bounded pool. */
export async function runMeasuredWorkload(config: LoadConfig, results: readonly EligibleResult[], options: MeasurementConfig,
  openSink: (manifest: RunManifest) => MeasurementSink, signal?: AbortSignal,
  deps: MeasurementDependencies = { clock: monotonicClock(), sendPublish: sendPublishRequest, get: getJson }) {
  if (config.dryRun || !config.isPublishAllowed) throw new Error('Measurement requires the existing 82-A publish guards');
  for (const value of [options.pollingIntervalMs, options.runTimeoutMs, options.observerConcurrency]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid measurement configuration');
  }
  if (options.observerConcurrency > 10 || options.runTimeoutMs > 2_147_483_647 || options.pollingIntervalMs > 2_147_483_647) {
    throw new Error('Measurement limits exceeded');
  }
  if (options.lisBaseUrl !== config.lisBaseUrl || options.httpTimeoutMs !== config.httpTimeoutMs) {
    throw new Error('Observer LIS origin and HTTP timeout must match publisher metadata');
  }
  if (new Set(results.map((row) => row.resultId)).size !== results.length) throw new Error('Duplicate planned result IDs');
  const clock = deps.clock;
  const rows = results.map((row) => planned(row.resultId));
  const byId = new Map(rows.map((row) => [row.result_id, row]));
  const manifest: RunManifest = {
    schema_version: 1, run_id: config.runId, scenario: options.scenario, simulated: options.simulated ?? false,
    result_ids: rows.map((row) => row.result_id), manifest_hash: options.manifestHash,
    selection_hash: createHash('sha256').update(JSON.stringify(rows.map((row) => row.result_id))).digest('hex'),
    concurrency: config.concurrency, concurrency_semantics: 'publish_http_in_flight', observer_concurrency: options.observerConcurrency,
    worker_counts: options.workerCounts ?? { dispatcher: null, middleware: null },
    service_configuration: options.serviceConfiguration ?? {
      dispatcher_http_timeout_ms: null, dispatcher_max_attempts: null, dispatcher_retry_delays_ms: null,
      worker_http_timeout_ms: null, worker_max_send_attempts: null, worker_max_verify_attempts: null, worker_retry_delays_ms: null,
    },
    http_timeout_ms: config.httpTimeoutMs, polling_interval_ms: options.pollingIntervalMs, run_timeout_ms: options.runTimeoutMs,
    git_commit: options.gitCommit, started: clock.stamp(), ended: null, stop_reason: null,
  };
  // Open evidence before any POST. A directory/permission failure cannot leave an unrecorded workload.
  const sink = openSink(manifest);
  for (const row of rows) sink.record(row);
  const controller = new AbortController();
  const interrupt = () => { manifest.stop_reason = 'interrupted'; controller.abort(); };
  if (signal?.aborted) interrupt(); else signal?.addEventListener('abort', interrupt, { once: true });
  const expire = () => { manifest.stop_reason ??= 'timeout'; controller.abort(); };
  const timer = setTimeout(expire, options.runTimeoutMs);
  let publishDone = false;
  const publishing = runPublishWorkload(config, results, (record) => {
    const row = byId.get(record.resultId)!;
    row.publication = record.publishOutcome;
    row.event_id = isUuid(record.eventId) ? record.eventId.toLowerCase() : null;
    if (record.publishOutcome === 'EXISTING') finishFailure(row, clock, 'existing', 'PREVIOUSLY_PUBLISHED');
    else if (record.publishOutcome === 'ERROR') {
      const status = record.httpStatus;
      if (status !== null && status >= 400 && status < 500 && ![408, 429].includes(status)) {
        finishFailure(row, clock, 'publish_rejected', `HTTP_${status}`);
      } else finishFailure(row, clock, 'unknown', 'PUBLISH_OUTCOME_UNKNOWN');
    } else if (!row.event_id) finishFailure(row, clock, 'measurement_failure', 'MISSING_EVENT_ID');
    sink.record(row);
  }, controller.signal, {
    sendPublish: async (url, id, timeout, publishSignal) => {
      const row = byId.get(id)!;
      mark(row, 'publish_request_start', clock.stamp()); sink.record(row);
      const response = await deps.sendPublish(url, id, timeout, publishSignal);
      if (response.status !== null) mark(row, 'publish_response', clock.stamp());
      row.observations.push({ at: clock.stamp(), stage: 'publish', http_status: response.status,
        code: response.errorCode && /^[A-Z][A-Z0-9_]{0,63}$/.test(response.errorCode) ? response.errorCode : undefined });
      return response;
    },
  }).catch(() => { manifest.stop_reason = 'measurement_failure'; controller.abort(); }).finally(() => { publishDone = true; });
  try {
    while (!controller.signal.aborted) {
      if (clock.stamp().elapsed_ms - manifest.started.elapsed_ms >= options.runTimeoutMs) { expire(); break; }
      const pending = rows.filter((row) => row.outcome === 'pending' && row.event_id !== null);
      let index = 0;
      await Promise.all(Array.from({ length: Math.min(options.observerConcurrency, pending.length) }, async () => {
        while (index < pending.length && !controller.signal.aborted) {
          const row = pending[index++];
          try { await observeProgress(row, options, clock, controller.signal, (value) => sink.record(value), deps.get); }
          catch { finishFailure(row, clock, 'measurement_failure', 'OBSERVER_EXCEPTION'); sink.record(row); }
        }
      }));
      if (publishDone && rows.every((row) => row.outcome !== 'pending')) break;
      await clock.sleep(options.pollingIntervalMs, controller.signal);
    }
    await publishing;
    for (const row of rows) {
      if (row.outcome === 'pending' || (controller.signal.aborted && row.outcome === 'unknown')) {
        row.outcome = manifest.stop_reason === 'interrupted' ? 'interrupted'
          : manifest.stop_reason === 'timeout' ? 'timeout' : 'measurement_failure';
        row.reason = row.exchange_id === null && row.milestones.lis_ack_observed ? 'MISSING_EXCHANGE_ID'
          : row.milestones.publish_request_start ? 'FINAL_OUTCOME_UNKNOWN' : 'NOT_STARTED';
      }
      sink.record(row);
    }
    manifest.stop_reason ??= 'completed'; manifest.ended = clock.stamp();
    const metrics = sink.finish(rows);
    return { manifest, rows, metrics };
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', interrupt);
  }
}
