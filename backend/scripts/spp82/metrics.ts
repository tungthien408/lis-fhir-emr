import type { Measurement, RunManifest } from './run-recorder.js';
/** Nearest rank: sorted[ceil(p*n)-1], no interpolation. Invalid observations never become zero latency. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  return [...values].sort((a, b) => a - b)[Math.ceil(p * values.length) - 1];
}
export function completionLatency(row: Measurement): number | null {
  if (row.outcome !== 'completed' || row.publication !== 'NEW' || !row.event_id || !row.exchange_id) return null;
  const names = ['publish_request_start', 'publish_response', 'lis_ack_observed',
    'middleware_delivered_observed', 'emr_readback_observed'] as const;
  const times = names.map((name) => row.milestones[name]?.elapsed_ms);
  if (times.some((time, i) => time === undefined || !Number.isFinite(time) || time < 0
    || (i > 0 && time < times[i - 1]!))) return null;
  return times[4]! - times[0]!;
}
export function calculateMetrics(manifest: RunManifest, records: Measurement[]) {
  const byId = new Map(records.map((row) => [row.result_id, row]));
  const rows = manifest.result_ids.map((id) => byId.get(id));
  const latencies = rows.flatMap((row) => { const value = row ? completionLatency(row) : null; return value === null ? [] : [value]; });
  const count = (outcome: Measurement['outcome']) => rows.filter((row) => row?.outcome === outcome).length;
  const elapsed = manifest.ended ? (manifest.ended.elapsed_ms - manifest.started.elapsed_ms) / 1000 : null;
  const failure = count('service_failure') + count('publish_rejected') + count('measurement_failure');
  return {
    planned_count: rows.length, completion_count: latencies.length, failure_count: failure,
    service_failure_count: count('service_failure'), publish_rejected_count: count('publish_rejected'),
    measurement_failure_count: count('measurement_failure'), timeout_count: count('timeout'),
    existing_count: count('existing'), interrupted_count: count('interrupted'),
    unknown_count: count('unknown'), pending_count: count('pending'), missing_record_count: rows.filter((row) => !row).length,
    censored_count: rows.length - latencies.length - failure - count('existing'),
    invalid_completion_count: count('completed') - latencies.length,
    completion_rate: rows.length ? latencies.length / rows.length : null,
    total_elapsed_seconds: elapsed,
    throughput_results_per_second: elapsed !== null && elapsed > 0 ? latencies.length / elapsed : null,
    latency_p50_ms: percentile(latencies, 0.5), latency_p95_ms: percentile(latencies, 0.95),
    percentile_algorithm: 'nearest-rank', partial_run: latencies.length !== rows.length,
    incomplete_artifact: manifest.ended === null,
  };
}
/** JSONL is an append-only journal of per-result snapshots; last complete line wins. */
export function replayJsonl(jsonl: string): Measurement[] {
  const rows = new Map<string, Measurement>();
  const lines = jsonl.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    try { const row = JSON.parse(lines[i]) as Measurement; rows.set(row.result_id, row); }
    catch (error) { if (i !== lines.length - 1) throw error; /* Torn final line after hard kill. */ }
  }
  return [...rows.values()];
}
