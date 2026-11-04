import { mapObservation, type ObservationSourceSnapshot } from '../../src/middleware/mapper.js';
import { canonicalJson } from '../../src/middleware/canonical-json.js';
import { isRecord, storageReceipt, verifyReadBack } from '../../src/middleware/worker-verification.js';
import { mark, type Clock, type Measurement, type Observation } from './run-recorder.js';
export const isUuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export interface PollResponse { status: number | null; body: unknown }
export type GetJson = (url: string, timeoutMs: number, signal: AbortSignal) => Promise<PollResponse>;
export const getJson: GetJson = async (url, timeoutMs, signal) => {
  let status: number | null = null;
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      headers: { Accept: 'application/json' } });
    status = response.status;
    if (status !== 200 || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json' || !response.body) {
      await response.body?.cancel(); return { status, body: null };
    }
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 4 * 1024 * 1024) { await reader.cancel(); return { status, body: null }; }
      chunks.push(value);
    }
    return { status, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown };
  } catch { return { status, body: null }; }
};
export interface ObserverConfig { lisBaseUrl: string; middlewareBaseUrl: string; emrBaseUrl: string; httpTimeoutMs: number }
const lisStates = ['PENDING', 'IN_FLIGHT', 'RETRY_WAIT', 'ACK', 'BLOCKED', 'FAILED'];
const mwStates = ['RECEIVED', 'PROCESSING', 'VERIFYING', 'RETRY_WAIT', 'DELIVERED', 'REJECTED', 'FAILED'];
const counter = (value: unknown): number | undefined => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
const safeCode = (value: unknown): string | undefined => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : undefined;
function times(body: Record<string, unknown>, fields: string[]): Record<string, string | null> {
  return Object.fromEntries(fields.map((field) => [field, typeof body[field] === 'string'
    && /^\d{4}-\d\d-\d\dT[\d:.+-]+Z?$/.test(body[field] as string) ? body[field] : null])) as Record<string, string | null>;
}
export function finishFailure(row: Measurement, clock: Clock, outcome: Measurement['outcome'], reason: string): void {
  row.outcome = outcome; row.reason = reason;
  if (outcome === 'service_failure' || outcome === 'publish_rejected') mark(row, 'terminal_failure_observed', clock.stamp());
}
/** One bounded polling pass. Errors in observation never imply a failed service transaction. */
export async function observeProgress(row: Measurement, config: ObserverConfig, clock: Clock,
  signal: AbortSignal, record: (row: Measurement) => void, get: GetJson = getJson): Promise<void> {
  if (row.outcome !== 'pending' || !row.event_id || signal.aborted) return;
  const poll = async (stage: Observation['stage'], url: string) => {
    let response: PollResponse;
    try { response = await get(url, config.httpTimeoutMs, signal); }
    catch { response = { status: null, body: null }; }
    const evidence: Observation = { at: clock.stamp(), stage, http_status: response.status };
    row.observations.push(evidence);
    if (response.status !== 200 || !isRecord(response.body)) {
      evidence.code = 'POLL_UNAVAILABLE'; record(row); return undefined;
    }
    return { body: response.body, evidence };
  };
  const lis = await poll('lis', `${config.lisBaseUrl}/api/publish-events/${encodeURIComponent(row.event_id)}`);
  if (!lis || signal.aborted) return;
  const l = lis.body;
  if (typeof l.event_id !== 'string' || l.event_id.toLowerCase() !== row.event_id.toLowerCase()
    || l.result_id !== row.result_id || !lisStates.includes(String(l.dispatch_status))) {
    lis.evidence.code = 'LIS_CONTRACT_MISMATCH'; record(row); return;
  }
  lis.evidence.state = String(l.dispatch_status);
  lis.evidence.dispatch_attempt_count = counter(l.dispatch_attempt_count);
  lis.evidence.code = safeCode(l.last_error_code);
  lis.evidence.server_times = times(l, ['published_at', 'acked_at', 'next_retry_at']);
  if (l.dispatch_status === 'FAILED' || l.dispatch_status === 'BLOCKED') {
    finishFailure(row, clock, 'service_failure', `LIS_${l.dispatch_status}`); record(row); return;
  }
  if (l.dispatch_status !== 'ACK') { record(row); return; }
  mark(row, 'lis_ack_observed', lis.evidence.at);
  if (!isUuid(l.exchange_id)) { lis.evidence.code = 'MISSING_EXCHANGE_ID'; record(row); return; }
  if (row.exchange_id && row.exchange_id !== l.exchange_id.toLowerCase()) {
    finishFailure(row, clock, 'measurement_failure', 'EXCHANGE_ID_CHANGED'); record(row); return;
  }
  row.exchange_id = l.exchange_id.toLowerCase(); record(row);
  const mw = await poll('middleware', `${config.middlewareBaseUrl}/api/exchanges/${row.exchange_id}`);
  if (!mw || signal.aborted) return;
  const m = mw.body;
  if (typeof m.exchange_id !== 'string' || m.exchange_id.toLowerCase() !== row.exchange_id
    || typeof m.event_id !== 'string' || m.event_id.toLowerCase() !== row.event_id.toLowerCase()
    || m.source_result_id !== row.result_id || !mwStates.includes(String(m.status))) {
    mw.evidence.code = 'MIDDLEWARE_CONTRACT_MISMATCH'; record(row); return;
  }
  mw.evidence.state = String(m.status); mw.evidence.send_attempt_count = counter(m.send_attempt_count);
  mw.evidence.verify_attempt_count = counter(m.verify_attempt_count);
  mw.evidence.retry_phase = m.retry_phase === 'SEND' || m.retry_phase === 'VERIFY' ? m.retry_phase : null;
  mw.evidence.server_times = times(m, ['published_at', 'received_at', 'validated_at', 'mapping_started_at',
    'transformed_at', 'first_sent_at', 'target_stored_at', 'verified_at', 'completed_at', 'next_retry_at']);
  mw.evidence.history = Array.isArray(m.events) ? m.events.filter(isRecord).map((event) => ({
    event_type: safeCode(event.event_type) ?? 'UNKNOWN',
    old_status: mwStates.includes(String(event.old_status)) ? String(event.old_status) : null,
    new_status: mwStates.includes(String(event.new_status)) ? String(event.new_status) : null,
    occurred_at: times(event, ['occurred_at']).occurred_at,
  })) : [];
  if (m.status === 'FAILED' || m.status === 'REJECTED') {
    finishFailure(row, clock, 'service_failure', `MIDDLEWARE_${m.status}`); record(row); return;
  }
  if (m.status !== 'DELIVERED') { record(row); return; }
  mark(row, 'middleware_delivered_observed', mw.evidence.at); record(row);
  // The API does NOT expose SEND receipts. Verify all existing MR01–09 semantics
  // against the immutable source snapshot; destination UUIDs prove visibility only.
  const envelope = m.source_payload;
  if (!isRecord(envelope) || envelope.event_id !== m.event_id || envelope.source_result_id !== row.result_id
    || envelope.source_system !== m.source_system || !isRecord(envelope.source_snapshot)
    || envelope.source_snapshot.result_id !== row.result_id) {
    finishFailure(row, clock, 'measurement_failure', 'MISSING_SOURCE_EXPECTATION'); record(row); return;
  }
  const mapped = mapObservation(envelope.source_snapshot as unknown as ObservationSourceSnapshot);
  if (mapped.kind !== 'mapped' || canonicalJson(m.fhir_payload) !== canonicalJson(mapped.observation)) {
    finishFailure(row, clock, 'measurement_failure', 'INVALID_FHIR_EXPECTATION'); record(row); return;
  }
  const expected = mapped.observation;
  const query = new URLSearchParams({ external_system: expected.identifier[0].system, external_id: row.result_id });
  const emr = await poll('emr', `${config.emrBaseUrl}/api/lab-results?${query}`);
  if (!emr || signal.aborted) return;
  const items = emr.body.items;
  if (!Array.isArray(items)) { emr.evidence.code = 'INVALID_READBACK'; record(row); return; }
  emr.evidence.row_count = items.length;
  if (items.length > 1) {
    finishFailure(row, clock, 'measurement_failure', 'DUPLICATE_DESTINATION_ROWS'); record(row); return;
  }
  if (items.length === 0) { emr.evidence.code = 'MISSING_READBACK'; record(row); return; }
  const item: unknown = items[0];
  const receipt = isRecord(item) ? storageReceipt(201, { ...item, result: 'STORED' }, expected) : undefined;
  const mismatches = receipt ? verifyReadBack(emr.body, expected, receipt) : ['destination.identifiers'];
  emr.evidence.mismatches = mismatches;
  if (mismatches.length) { finishFailure(row, clock, 'measurement_failure', 'READBACK_MISMATCH'); }
  else {
    emr.evidence.server_times = times(item as Record<string, unknown>, ['received_at', 'stored_at']);
    mark(row, 'emr_readback_observed', emr.evidence.at); row.outcome = 'completed';
  }
  record(row);
}
