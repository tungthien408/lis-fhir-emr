export const PATIENT_SYSTEM = 'urn:uuid:b954f2c4-cfe0-575f-86c0-c1cba88052a4'
export const RESULT_SYSTEM = 'urn:uuid:05934370-0df0-5666-8eff-bd5181906b62'
export type Patient = { patient_key: string; display_label: string | null; identifiers: { identifier_system: string; identifier_value: string }[] }
export type LabResult = { target_id: string; patient_key: string; external_system: string; external_id: string;
  analyte_system: string; analyte_code: string; analyte_display: string | null; analyte_context: string | null;
  quantity: string; unit_text: string; low: string | null; high: string | null; effective_at: string;
  clinical_status: 'final'; fhir_json: Record<string, unknown>; received_at: string; stored_at: string }
export type Search = { mode: 'source' | 'key'; value: string }
export const emptySearch: Search = { mode: 'source', value: '' }
export type Route = { kind: 'search'; search: Search } | { kind: 'profile'; key: string; search: Search; page: number }
  | { kind: 'result'; system: string; id: string; key?: string; search: Search; page: number } | { kind: 'invalid' }
