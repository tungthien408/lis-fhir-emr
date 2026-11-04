export type Row = Record<string, unknown>;
export type Outcome = 'PASS' | 'FAIL' | 'NOT_VERIFIED';
export interface ExpectedResult {
  result_id: string; source_labevent_id: string; patient_id: string; patient_key: string;
  test_code: string; test_name: string; fluid: string | null; category: string | null;
  value_num: string; unit: string; low: string | null; high: string | null;
  effective_at: string; result_status: 'FINAL'; context: string;
}
export interface PatientLink { identifier_system: string; identifier_value: string; patient_key: string }
export interface ReferenceRules {
  version: string; source_system: string; seed_tag: string; result_system: string; patient_system: string;
  test_system: string; category_system: string; category_code: string; subject_type: string;
  clinical_status: string; source_status: string; resource_type: string; context_separator: string;
}
export interface FrozenReference {
  manifest_sha256: string; population: 1000; results: ExpectedResult[]; patient_links: PatientLink[];
  rules: ReferenceRules; provenance: Row; limitations: string[];
}
export type TableEvidence = { status: 'available'; rows: Row[] } | { status: 'unavailable'; reason: string };
export const tables = ['lis_results', 'publish_events', 'exchanges', 'send_receipts', 'emr_results', 'patient_links', 'emr_patients'] as const;
export type TableName = typeof tables[number];
export interface EvidenceSnapshot {
  schema_version: 1; phase: 'before' | 'after'; run_id: string | null; environment_id: string;
  oracle_manifest_sha256: string; captured_at: string;
  scope: { source_system: string; result_system: string; seed_tag: string; coverage: 'namespace-and-expected-identities' };
  snapshots: Record<string, { role: string; server_time: string; consistency: 'repeatable-read-read-only' } | null>;
  tables: Record<TableName, TableEvidence>;
}
export interface RunRecord {
  result_id: string; event_id: string | null; exchange_id: string | null;
  publication: 'NEW' | 'EXISTING' | 'ERROR' | null; outcome: string;
}
export interface VerificationRun {
  run_id: string; result_ids: string[]; selection_complete: boolean; records: RunRecord[];
  incomplete: boolean; input_checksums: Record<string, string>;
}
export interface FieldComparison {
  run_id: string; result_id: string | null; exchange_id: string | null;
  rule_id: string; field_path: string; expected: unknown; actual_source: unknown;
  actual_fhir: unknown; actual_target: unknown; outcome: Outcome; reason: string;
}
export interface ResultVerification {
  result_id: string; outcome: Outcome; measurement_outcome: string | null;
  fields: FieldComparison[];
}
