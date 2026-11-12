export const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
export const date = '2026-11-04T10:00:00.123Z'
export function detail(n = 1, status = 'DELIVERED', sourceId = 'MONITOR-' + n) {
  const snapshot = { result_id: sourceId, patient_id: 'SYNTHETIC-P', test_code: 'TEST', test_name: 'Synthetic analyte', fluid: 'Blood', category: 'Chemistry', value_num: 3.4, unit: 'mg/dL', reference_low: null, reference_high: 5.1, effective_at: '2026-11-04T09:00:00.123456Z', result_status: 'FINAL' }
  return { exchange_id: uuid(n), event_id: uuid(n + 100), source_system: 'lis-demo', source_result_id: sourceId, source_hash: 'a'.repeat(64), status, retry_phase: status === 'RETRY_WAIT' ? 'VERIFY' : null,
    send_attempt_count: status === 'RECEIVED' ? 0 : 2, verify_attempt_count: status === 'DELIVERED' ? 2 : 0,
    published_at: date, received_at: date, next_retry_at: status === 'RETRY_WAIT' ? date : null, completed_at: status === 'DELIVERED' ? date : null,
    source_payload: { event_id: uuid(n + 100), source_system: 'lis-demo', source_result_id: sourceId, source_hash: 'a'.repeat(64), source_snapshot: snapshot, published_at: date },
    fhir_payload: { resourceType: 'Observation', identifier: [{ system: 'urn:uuid:05934370-0df0-5666-8eff-bd5181906b62', value: sourceId }] }, payload_hash: 'b'.repeat(64), mapping_version: 'lis-observation-v1',
    validated_at: date, mapping_started_at: date, transformed_at: date, first_sent_at: date, target_stored_at: status === 'DELIVERED' || status === 'VERIFYING' ? date : null, verified_at: status === 'DELIVERED' ? date : null,
    events: [{ log_event_id: uuid(n + 200), exchange_id: uuid(n), event_type: status, old_status: null, new_status: status, occurred_at: date, attempt_id: null }] }
}
export function attempts(d = detail()) {
  const receipt = { result: 'STORED', external_system: 'urn:uuid:05934370-0df0-5666-8eff-bd5181906b62', external_id: d.source_result_id, target_id: uuid(900), patient_key: uuid(901) }
  const base = { exchange_id: d.exchange_id, started_at: date, sent_at: date, response_at: date, ended_at: date, http_status: 200, error_code: null, error_message: null, receipt: null }
  return { exchange_id: d.exchange_id, event_id: d.event_id, source_system: d.source_system, source_result_id: d.source_result_id,
    items: d.status === 'RECEIVED' ? [] : [
      { ...base, attempt_id: uuid(500), phase: 'SEND', attempt_no: 1, http_status: 503, error_code: 'HTTP_TEMPORARY', error_message: 'Safe diagnostic' },
      { ...base, attempt_id: uuid(501), phase: 'SEND', attempt_no: 2, http_status: 201, receipt },
      { ...base, attempt_id: uuid(502), phase: 'VERIFY', attempt_no: 1, http_status: 503, error_code: 'HTTP_TEMPORARY', error_message: 'Safe diagnostic' },
      { ...base, attempt_id: uuid(503), phase: 'VERIFY', attempt_no: 2 },
    ], diagnostics: [{ log_event_id: uuid(800), attempt_id: null, event_type: 'RETRY_SCHEDULED', occurred_at: date, error_code: 'HTTP_TEMPORARY' }] }
}
