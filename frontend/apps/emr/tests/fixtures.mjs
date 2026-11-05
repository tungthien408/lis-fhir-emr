export const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
export const patientId = 'MIMIC-P-10007928', patientKey = uuid(1), otherKey = uuid(2)
export const patientSystem = 'https://example.org/lis/patient', resultSystem = 'https://example.org/lis/result'
export function patient(key = patientKey, value = patientId) { return { patient_key: key, display_label: 'Demo patient 10007928', identifiers: [{ identifier_system: patientSystem, identifier_value: value }] } }
export function result(n = 1, patch = {}) {
  const id = 'MIMIC-LAB-' + (100144 + n)
  return { target_id: uuid(100 + n), patient_key: patientKey, external_system: resultSystem, external_id: id,
    analyte_system: 'https://example.org/lis/test-code', analyte_code: '50971', analyte_display: 'Potassium', analyte_context: 'Potassium / Blood / Chemistry',
    quantity: '3.400000000000000000001', unit_text: 'mEq/L', low: '0', high: null, effective_at: '2129-04-05T21:30:00.123456Z',
    clinical_status: 'final', received_at: '2026-11-05T01:02:03.456789Z', stored_at: '2026-11-05T01:02:03.456790Z',
    fhir_json: { resourceType: 'Observation', status: 'final', identifier: [{ system: resultSystem, value: id }],
      subject: { type: 'Patient', identifier: { system: patientSystem, value: patientId } }, code: { text: 'Potassium / Blood / Chemistry' },
      valueQuantity: { value: 3.4, unit: 'mEq/L' }, effectiveDateTime: '2129-04-05T21:30:00.123456Z' }, ...patch }
}
