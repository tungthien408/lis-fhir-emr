export const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
export const patientId = 'MIMIC-P-10007928', patientKey = uuid(1), otherKey = uuid(2)
export const patientSystem = 'urn:uuid:b954f2c4-cfe0-575f-86c0-c1cba88052a4', resultSystem = 'urn:uuid:05934370-0df0-5666-8eff-bd5181906b62'
export function patient(key = patientKey, value = patientId) { return { patient_key: key, display_label: 'Demo patient 10007928', identifiers: [{ identifier_system: patientSystem, identifier_value: value }] } }
export function result(n = 1, patch = {}) {
  const id = 'MIMIC-LAB-' + (100144 + n)
  return { target_id: uuid(100 + n), patient_key: patientKey, external_system: resultSystem, external_id: id,
    analyte_system: 'urn:uuid:cb8ffc71-ef38-58d2-ba65-0bf0232d5d02', analyte_code: '50971', analyte_display: 'Potassium', analyte_context: 'Potassium / Blood / Chemistry',
    quantity: '3.400000000000000000001', unit_text: 'mEq/L', low: '0', high: null, effective_at: '2129-04-05T21:30:00.123456Z',
    clinical_status: 'final', received_at: '2026-11-05T01:02:03.456789Z', stored_at: '2026-11-05T01:02:03.456790Z',
    fhir_json: { resourceType: 'Observation', status: 'final', identifier: [{ system: resultSystem, value: id }],
      subject: { type: 'Patient', identifier: { system: patientSystem, value: patientId } }, code: { text: 'Potassium / Blood / Chemistry' },
      valueQuantity: { value: 3.4, unit: 'mEq/L' }, effectiveDateTime: '2129-04-05T21:30:00.123456Z' }, ...patch }
}
