import { statuses, type Summary, type Detail, type Attempts, type Receipt, type Query } from '../types/exchange.ts'
import { identifier, normalizeSourceResultId, uuid } from '../state/routes.ts'
export function record(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}
function id(v: unknown): v is string {
  return typeof v === 'string' && uuid.test(v)
}
function text(v: unknown): v is string {
  return typeof v === 'string' && identifier(v)
}
function date(v: unknown): v is string {
  return typeof v === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v))
}
function nullable(v: unknown, test: (v: unknown) => boolean) {
  return v === null || test(v)
}
function status(v: unknown) {
  return statuses.some((s) => s === v)
}
function phase(v: unknown) {
  return v === 'SEND' || v === 'VERIFY'
}
function count(v: unknown) {
  return Number.isSafeInteger(v) && (v as number) >= 0
}
function fail(): never {
  throw new Error('Dữ liệu API không hợp lệ hoặc không khớp định danh. Chưa thể xác minh trạng thái; hãy làm mới hoặc kiểm tra dịch vụ.')
}
export function validateSummary(v: unknown): Summary {
  if (
    !record(v) ||
    !id(v.exchange_id) ||
    !id(v.event_id) ||
    !text(v.source_system) ||
    !text(v.source_result_id) ||
    typeof v.source_hash !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(v.source_hash) ||
    !status(v.status) ||
    !nullable(v.retry_phase, phase) ||
    !count(v.send_attempt_count) ||
    !count(v.verify_attempt_count) ||
    !date(v.received_at) ||
    !['published_at', 'next_retry_at', 'completed_at'].every((k) => nullable(v[k], date))
  )
    fail()
  return v as unknown as Summary
}
export function validateDetail(v: unknown, expected: string): Detail {
  const s = validateSummary(v)
  if (
    !record(v) ||
    s.exchange_id.toLowerCase() !== expected.toLowerCase() ||
    !('source_payload' in v) ||
    !('fhir_payload' in v) ||
    !nullable(v.payload_hash, (x) => typeof x === 'string' && /^[a-f0-9]{64}$/i.test(x)) ||
    !nullable(v.mapping_version, text) ||
    !['validated_at', 'mapping_started_at', 'transformed_at', 'first_sent_at', 'target_stored_at', 'verified_at'].every((k) =>
      nullable(v[k], date),
    ) ||
    !Array.isArray(v.events)
  )
    fail()
  for (const e of v.events)
    if (
      !record(e) ||
      !id(e.log_event_id) ||
      e.exchange_id !== s.exchange_id ||
      !text(e.event_type) ||
      !nullable(e.old_status, status) ||
      !nullable(e.new_status, status) ||
      !date(e.occurred_at) ||
      !nullable(e.attempt_id, id)
    )
      fail()
  return v as unknown as Detail
}
function receipt(v: unknown): v is Receipt {
  return (
    record(v) &&
    ['STORED', 'ALREADY_EXISTS'].includes(String(v.result)) &&
    text(v.external_system) &&
    text(v.external_id) &&
    id(v.target_id) &&
    id(v.patient_key)
  )
}
export function validateAttempts(v: unknown, expected: string): Attempts {
  if (
    !record(v) ||
    !id(v.exchange_id) ||
    v.exchange_id.toLowerCase() !== expected.toLowerCase() ||
    !id(v.event_id) ||
    !text(v.source_system) ||
    !text(v.source_result_id) ||
    !Array.isArray(v.items) ||
    !Array.isArray(v.diagnostics)
  )
    fail()
  for (const a of v.items)
    if (
      !record(a) ||
      !id(a.attempt_id) ||
      a.exchange_id !== v.exchange_id ||
      !phase(a.phase) ||
      !count(a.attempt_no) ||
      a.attempt_no === 0 ||
      !date(a.started_at) ||
      !['sent_at', 'response_at', 'ended_at'].every((k) => nullable(a[k], date)) ||
      !nullable(a.http_status, (x) => Number.isInteger(x) && (x as number) >= 100 && (x as number) <= 599) ||
      !nullable(a.error_code, text) ||
      !nullable(a.error_message, text) ||
      !nullable(a.receipt, receipt)
    )
      fail()
  for (const e of v.diagnostics)
    if (
      !record(e) ||
      !id(e.log_event_id) ||
      !nullable(e.attempt_id, id) ||
      !text(e.event_type) ||
      !date(e.occurred_at) ||
      !text(e.error_code)
    )
      fail()
  return v as unknown as Attempts
}
export async function request(path: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response
  try {
    response = await fetch('/api/middleware' + path, { signal, cache: 'no-store' })
  } catch (e) {
    if (signal?.aborted) throw e
    throw new Error('Không kết nối được Middleware. Kiểm tra dịch vụ và mạng, sau đó thử tải lại.', { cause: e })
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (response.ok) throw new Error('API trả JSON không hợp lệ. Kiểm tra backend hoặc proxy.')
  }
  if (!response.ok) {
    const error = record(body) && record(body.error) ? body.error : null
    const message =
      response.status === 404
        ? error?.message === 'API route not found'
          ? 'Backend đang chạy chưa có API này. Cần cập nhật service Middleware và kiểm tra proxy.'
          : error?.message === 'Exchange not found'
            ? 'Không tìm thấy giao dịch này. Kiểm tra lại Exchange ID.'
            : 'Không tìm thấy API hoặc giao dịch. Kiểm tra dịch vụ và đường dẫn.'
        : response.status === 400
          ? 'Yêu cầu không hợp lệ. Kiểm tra Exchange ID và bộ lọc.'
          : response.status === 503
            ? 'Middleware chưa truy cập được dữ liệu. Kiểm tra dịch vụ rồi thử tải lại.'
            : 'Không tải được dữ liệu. Kiểm tra backend và proxy.'
    throw new Error(message + ' (HTTP ' + response.status + ')')
  }
  return body
}
export async function listExchanges(query: Query, signal?: AbortSignal) {
  const offset = (query.page - 1) * 20
  if (!count(offset) || (query.source_result_id && !identifier(query.source_result_id)) || (query.status && !status(query.status))) fail()
  const params = new URLSearchParams({ limit: '21', offset: String(offset) })
  const source = normalizeSourceResultId(query.source_result_id)
  if (source) params.set('source_result_id', source)
  if (query.status) params.set('status', query.status)
  const v = await request('/exchanges?' + params, signal)
  if (!record(v) || v.limit !== 21 || v.offset !== offset || !Array.isArray(v.items) || v.items.length > 21) fail()
  return { items: v.items.map(validateSummary).slice(0, 20), hasNext: v.items.length > 20 }
}
export const getDetail = async (id: string, signal?: AbortSignal) => {
  if (!uuid.test(id)) fail()
  return validateDetail(await request('/exchanges/' + encodeURIComponent(id), signal), id)
}
export const getAttempts = async (id: string, signal?: AbortSignal) => {
  if (!uuid.test(id)) fail()
  return validateAttempts(await request('/exchanges/' + encodeURIComponent(id) + '/attempts', signal), id)
}
export function sameExchange(d: Detail, a: Attempts) {
  return (
    d.exchange_id === a.exchange_id &&
    d.event_id === a.event_id &&
    d.source_system === a.source_system &&
    d.source_result_id === a.source_result_id
  )
}
export function identityVerified(d: Detail) {
  const s = d.source_payload
  return (
    record(s) &&
    typeof s.event_id === 'string' &&
    s.event_id.toLowerCase() === d.event_id.toLowerCase() &&
    s.source_system === d.source_system &&
    s.source_result_id === d.source_result_id &&
    s.source_hash === d.source_hash &&
    record(s.source_snapshot) &&
    s.source_snapshot.result_id === d.source_result_id &&
    s.source_snapshot.result_status === 'FINAL'
  )
}
export function verifiedDelivery(d: Detail, a: Attempts | null) {
  if (
    d.status !== 'DELIVERED' ||
    !d.target_stored_at ||
    !d.verified_at ||
    !d.completed_at ||
    !identityVerified(d) ||
    !a ||
    !sameExchange(d, a)
  )
    return false
  const fhir = d.fhir_payload,
    identity = record(fhir) && Array.isArray(fhir.identifier) ? fhir.identifier[0] : null
  return (
    record(identity) &&
    identity.value === d.source_result_id &&
    a.items.some(
      (x) =>
        x.phase === 'SEND' &&
        x.error_code === null &&
        x.ended_at &&
        x.receipt &&
        x.receipt.external_id === d.source_result_id &&
        x.receipt.external_system === identity.system &&
        x.receipt.result === (x.http_status === 201 ? 'STORED' : x.http_status === 200 ? 'ALREADY_EXISTS' : null),
    ) &&
    a.items.some((x) => x.phase === 'VERIFY' && x.http_status === 200 && x.error_code === null && x.ended_at)
  )
}
