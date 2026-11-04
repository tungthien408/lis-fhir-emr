/** Client observations use offsets from ONE monotonic run origin; UTC is audit only. */
export interface Stamp { utc: string; elapsed_ms: number }
export interface Clock { stamp(): Stamp; sleep(ms: number, signal: AbortSignal): Promise<void> }
export function monotonicClock(): Clock {
  const origin = performance.now();
  return {
    stamp: () => ({ utc: new Date().toISOString(), elapsed_ms: performance.now() - origin }),
    sleep: (ms, signal) => new Promise((resolve) => {
      if (signal.aborted) { resolve(); return; }
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, ms); signal.addEventListener('abort', done, { once: true });
    }),
  };
}
export type Milestone = 'publish_request_start' | 'publish_response' | 'lis_ack_observed'
  | 'middleware_delivered_observed' | 'emr_readback_observed' | 'terminal_failure_observed';
export type Outcome = 'pending' | 'completed' | 'service_failure' | 'publish_rejected' | 'measurement_failure'
  | 'existing' | 'timeout' | 'interrupted' | 'unknown';
export interface Observation {
  at: Stamp; stage: 'publish' | 'lis' | 'middleware' | 'emr' | 'client';
  http_status?: number | null; state?: string; code?: string;
  dispatch_attempt_count?: number; send_attempt_count?: number; verify_attempt_count?: number;
  retry_phase?: string | null; row_count?: number; mismatches?: string[];
  /** Allowlisted timestamps from one server; never used to subtract client time. */
  server_times?: Record<string, string | null>;
  history?: { event_type: string; old_status: string | null; new_status: string | null; occurred_at: string | null }[];
}
export interface Measurement {
  result_id: string; event_id: string | null; exchange_id: string | null;
  publication: 'NEW' | 'EXISTING' | 'ERROR' | null;
  outcome: Outcome; reason: string | null;
  milestones: Partial<Record<Milestone, Stamp>>; observations: Observation[];
}
export function planned(result_id: string): Measurement {
  return { result_id, event_id: null, exchange_id: null, publication: null,
    outcome: 'pending', reason: null, milestones: {}, observations: [] };
}
export function mark(row: Measurement, name: Milestone, at: Stamp): void {
  row.milestones[name] ??= at;
}
export interface RunManifest {
  schema_version: 1; run_id: string; scenario: string; simulated: boolean;
  result_ids: string[]; manifest_hash: string | null; selection_hash: string;
  concurrency: number; concurrency_semantics: 'publish_http_in_flight'; observer_concurrency: number;
  worker_counts: { dispatcher: number | null; middleware: number | null };
  service_configuration: Record<string, number | number[] | null>;
  http_timeout_ms: number; polling_interval_ms: number; run_timeout_ms: number;
  git_commit: string | null; started: Stamp; ended: Stamp | null;
  stop_reason: 'completed' | 'timeout' | 'interrupted' | 'measurement_failure' | null;
}
