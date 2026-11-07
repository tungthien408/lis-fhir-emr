export const PATIENT_SYSTEM = 'https://example.org/lis/patient'
export const RESULT_SYSTEM = 'https://example.org/lis/result'
export type Patient = { patient_key: string; display_label: string | null; identifiers: { identifier_system: string; identifier_value: string }[] }
export type LabResult = { target_id: string; patient_key: string; external_system: string; external_id: string;
  analyte_system: string; analyte_code: string; analyte_display: string | null; analyte_context: string | null;
  quantity: string; unit_text: string; low: string | null; high: string | null; effective_at: string;
  clinical_status: 'final'; fhir_json: Record<string, unknown>; received_at: string; stored_at: string }
export type Search = { mode: 'source' | 'key'; value: string }
export const emptySearch: Search = { mode: 'source', value: '' }
export type Route = { kind: 'search'; search: Search } | { kind: 'profile'; key: string; search: Search; page: number }
  | { kind: 'result'; system: string; id: string; key?: string; search: Search; page: number } | { kind: 'invalid' }
