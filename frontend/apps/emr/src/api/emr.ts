import { identifier, normalizeInput, uuid } from '../state/routes.ts'
import { PATIENT_SYSTEM, type Patient, type LabResult, type Search } from '../types/emr.ts'
export function record(v: unknown): v is Record<string, unknown> { return v !== null && typeof v === 'object' && !Array.isArray(v) }
const text = (v: unknown): v is string => typeof v === 'string' && identifier(v)
const id = (v: unknown): v is string => typeof v === 'string' && uuid.test(v)
const nullable = (v: unknown, check: (v: unknown) => boolean) => v === null || check(v)
const decimal = (v: unknown) => typeof v === 'string' && /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(v)
const timestamp = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.[0-9]+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v))
function invalid(): never { throw new Error('Dữ liệu API không hợp lệ hoặc không nhất quán. Chưa thể hiển thị hồ sơ/kết quả; hãy làm mới hoặc kiểm tra dịch vụ.') }
export function validatePatient(v: unknown): Patient {
  if (!record(v) || !id(v.patient_key) || !nullable(v.display_label, x => typeof x === 'string') || !Array.isArray(v.identifiers)) invalid()
  for (const link of v.identifiers) if (!record(link) || !text(link.identifier_system) || !text(link.identifier_value)) invalid()
  return v as Patient
}
export function validateResult(v: unknown): LabResult {
  if (!record(v) || !id(v.target_id) || !id(v.patient_key) || !['external_system','external_id','analyte_system','analyte_code','unit_text'].every(k => text(v[k]))
    || !['analyte_display','analyte_context'].every(k => nullable(v[k], x => typeof x === 'string')) || !decimal(v.quantity)
    || !nullable(v.low, decimal) || !nullable(v.high, decimal) || !['effective_at','received_at','stored_at'].every(k => timestamp(v[k]))
    || v.clinical_status !== 'final' || !record(v.fhir_json)) invalid()
  const f = v.fhir_json, identity = Array.isArray(f.identifier) ? f.identifier[0] : null
  if (f.resourceType !== 'Observation' || f.status !== 'final' || !record(identity) || identity.system !== v.external_system || identity.value !== v.external_id
    || !record(f.subject) || !record(f.subject.identifier) || !text(f.subject.identifier.system) || !text(f.subject.identifier.value)) invalid()
  return v as LabResult
}
export function assertAssociation(result: LabResult, patient: Patient) {
  const subject = (result.fhir_json.subject as { identifier: { system: string; value: string } }).identifier
  if (result.patient_key.toLowerCase() !== patient.patient_key.toLowerCase() || !patient.identifiers.some(x => x.identifier_system === subject.system && x.identifier_value === subject.value))
    throw new Error('Kết quả không khớp hồ sơ hoặc liên kết bệnh nhân nguồn. Không gán kết quả vào hồ sơ này.')
}
export async function request(path: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response
  try { response = await fetch('/api/emr' + path, { signal, cache: 'no-store' }) }
  catch (error) { if (signal?.aborted) throw error; throw new Error('Không kết nối được EMR. Kiểm tra backend và mạng, sau đó thử tải lại.', { cause: error }) }
  let body: unknown
  try { body = await response.json() } catch { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError'); if (response.ok) throw new Error('API trả JSON không hợp lệ. Kiểm tra backend hoặc proxy.') }
  if (!response.ok) {
    const e = record(body) && record(body.error) ? body.error : null
    const message = response.status === 404 ? e?.message === 'Patient not found' ? 'Không tìm thấy hồ sơ bệnh nhân này.'
      : e?.message === 'API route not found' ? 'Backend đang chạy chưa có API này. Cần cập nhật service EMR và kiểm tra proxy.' : 'Không tìm thấy API hoặc hồ sơ. Kiểm tra đường dẫn dịch vụ.'
      : response.status === 400 ? 'Yêu cầu không hợp lệ. Kiểm tra mã định danh và các tham số.'
      : response.status === 503 ? 'EMR chưa truy cập được dữ liệu. Kiểm tra dịch vụ rồi thử tải lại.' : 'Không tải được dữ liệu EMR. Kiểm tra backend hoặc proxy.'
    throw new Error(message + ' (HTTP ' + response.status + ')')
  }
  return body
}
export async function getPatient(search: Search, signal?: AbortSignal) {
  if (!identifier(search.value) || !['source', 'key'].includes(search.mode)) invalid()
  const p = new URLSearchParams()
  if (search.mode === 'key') { if (!uuid.test(search.value.trim())) invalid(); p.set('patient_key', search.value.trim()) }
  else { p.set('identifier_system', PATIENT_SYSTEM); p.set('identifier_value', normalizeInput(search.value, 'patient')) }
  const body = await request('/patients?' + p, signal)
  if (!record(body)) invalid()
  const patient = validatePatient(body.patient)
  if (search.mode === 'key' ? patient.patient_key.toLowerCase() !== search.value.trim().toLowerCase()
    : !patient.identifiers.some(x => x.identifier_system === PATIENT_SYSTEM && x.identifier_value === normalizeInput(search.value, 'patient'))) invalid()
  return patient
}
export async function getResults(patient: Patient, page: number, signal?: AbortSignal) {
  const offset = (page - 1) * 20
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(offset)) invalid()
  const body = await request('/lab-results?' + new URLSearchParams({ patient_key: patient.patient_key, limit: '21', offset: String(offset) }), signal)
  if (!record(body) || !Array.isArray(body.items) || body.items.length > 21 || body.limit !== 21 || body.offset !== offset) invalid()
  const rows = body.items.map(validateResult)
  for (const row of rows) assertAssociation(row, patient)
  if (new Set(rows.map(x => x.target_id)).size !== rows.length) invalid()
  return { items: rows.slice(0,20), hasNext: rows.length > 20 }
}
export async function getResult(system: string, externalId: string, expectedKey?: string, signal?: AbortSignal) {
  if (!identifier(system) || !identifier(externalId) || (expectedKey && !uuid.test(expectedKey))) invalid()
  const body = await request('/lab-results?' + new URLSearchParams({ external_system: system, external_id: externalId }), signal)
  if (!record(body) || !Array.isArray(body.items)) invalid()
  if (!body.items.length) throw new Error('Không tìm thấy kết quả đã lưu tại EMR với đúng cặp định danh nguồn.')
  if (body.items.length !== 1) throw new Error('API trả nhiều kết quả cho cùng cặp định danh nguồn. Dữ liệu không nhất quán; không tự chọn bản ghi đầu.')
  const result = validateResult(body.items[0])
  if (result.external_system !== system || result.external_id !== externalId) invalid()
  if (expectedKey && result.patient_key.toLowerCase() !== expectedKey.toLowerCase()) throw new Error('Kết quả không thuộc hồ sơ đang mở. Kiểm tra lại patient key; không gán vào hồ sơ này.')
  const patient = await getPatient({ mode: 'key', value: result.patient_key }, signal)
  assertAssociation(result, patient)
  return { result, patient }
}
