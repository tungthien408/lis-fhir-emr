export const statuses = ['RECEIVED', 'PROCESSING', 'VERIFYING', 'RETRY_WAIT', 'DELIVERED', 'REJECTED', 'FAILED'] as const
export type Status = typeof statuses[number]
export type Phase = 'SEND' | 'VERIFY'
export interface Summary {
  exchange_id: string; event_id: string; source_system: string; source_result_id: string; source_hash: string
  status: Status; retry_phase: Phase | null; send_attempt_count: number; verify_attempt_count: number
  published_at: string | null; received_at: string; next_retry_at: string | null; completed_at: string | null
}
export interface TimelineEvent {
  log_event_id: string; exchange_id: string; event_type: string; old_status: Status | null; new_status: Status | null
  occurred_at: string; attempt_id: string | null
}
export interface Detail extends Summary {
  source_payload: unknown; fhir_payload: unknown; payload_hash: string | null; mapping_version: string | null
  validated_at: string | null; mapping_started_at: string | null; transformed_at: string | null
  first_sent_at: string | null; target_stored_at: string | null; verified_at: string | null; events: TimelineEvent[]
}
export interface Receipt { result: 'STORED' | 'ALREADY_EXISTS'; external_system: string; external_id: string; target_id: string; patient_key: string }
export interface Attempt {
  attempt_id: string; exchange_id: string; phase: Phase; attempt_no: number; started_at: string
  sent_at: string | null; response_at: string | null; ended_at: string | null; http_status: number | null
  error_code: string | null; error_message: string | null; receipt: Receipt | null
}
export interface Diagnostic { log_event_id: string; attempt_id: string | null; event_type: string; occurred_at: string; error_code: string }
export interface Attempts {
  exchange_id: string; event_id: string; source_system: string; source_result_id: string
  items: Attempt[]; diagnostics: Diagnostic[]
}
export interface Query { source_result_id: string; status: Status | ''; page: number }
export const emptyQuery: Query = { source_result_id: '', status: '', page: 1 }
