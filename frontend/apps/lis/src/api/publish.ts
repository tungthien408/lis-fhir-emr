import { LisApiError } from './lis.ts'
import { lisResultRequest } from './resultRequest.ts'
import { isLisIdentifier } from '../state/routes.ts'
import { dispatchStatuses, exchangeStatuses, type PublishReceipt, type PublishState, type ExchangeStatus } from '../types/publish.ts'

const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function nullableText(value: unknown): boolean { return value === null || typeof value === 'string' }
function date(value: unknown): value is string { return typeof value === 'string' && /T.*Z$/.test(value) && Number.isFinite(Date.parse(value)) }
function receipt(value: unknown, resultId: string): value is PublishReceipt {
  return record(value) && typeof value.event_id === 'string' && uuid.test(value.event_id)
    && value.result_id === resultId && dispatchStatuses.some((s) => s === value.dispatch_status)
    && (value.exchange_id === null || (typeof value.exchange_id === 'string' && uuid.test(value.exchange_id)))
    && (value.dispatch_status !== 'ACK' || value.exchange_id !== null)
}
export function validatePublishState(value: unknown, resultId: string): PublishState {
  if (!record(value) || value.result_id !== resultId || !['READY', 'FINAL'].includes(String(value.result_status))
    || typeof value.published !== 'boolean') throw new Error('Dữ liệu trạng thái Publish không hợp lệ hoặc không khớp mã kết quả.')
  if (!value.published) {
    if (value.event !== null) throw new Error('Trạng thái Publish và sự kiện không nhất quán.')
  } else {
    const event = value.event
    if (!receipt(event, resultId) || !record(event) || !Number.isSafeInteger(event.dispatch_attempt_count)
      || (event.dispatch_attempt_count as number) < 0 || !nullableText(event.last_error_code) || !nullableText(event.last_error_message)
      || !date(event.published_at) || !(event.acked_at === null || date(event.acked_at))
      || !(event.next_retry_at === null || date(event.next_retry_at))
      || (event.dispatch_status === 'ACK' && event.acked_at === null)) throw new Error('Dữ liệu sự kiện Publish không hợp lệ hoặc không khớp mã kết quả.')
  }
  return value as unknown as PublishState
}
const messages: Record<string, string> = {
  CONTENT_CONFLICT: 'Nội dung nguồn đã thay đổi so với bản đã phát hành. Sự kiện và snapshot cũ được giữ nguyên.',
  RESULT_NOT_READY: 'Kết quả hiện chưa FINAL nên chưa thể Publish.',
  INVALID_TEST_CODE: 'Danh mục xét nghiệm chưa hợp lệ để Publish.',
  INVALID_UNIT: 'Đơn vị không phù hợp với danh mục xét nghiệm.',
  DEPENDENCY_UNAVAILABLE: 'Dịch vụ dữ liệu tạm thời không sẵn sàng.',
  VALIDATION_ERROR: 'Thông tin yêu cầu hoặc dữ liệu nguồn chưa hợp lệ.',
}
async function request(path: string, options: RequestInit) {
  let response: Response
  try { response = await fetch(path, { ...options, cache: 'no-store' }) }
  catch (error) {
    if (options.signal?.aborted) throw error
    throw new Error('Không thể kết nối tới dịch vụ.', { cause: error })
  }
  let body: unknown
  try { body = await response.json() }
  catch {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (response.ok) throw new Error('Phản hồi Publish không phải JSON hợp lệ.')
  }
  if (!response.ok) {
    const detail = record(body) && record(body.error) ? body.error : undefined
    const code = typeof detail?.code === 'string' ? detail.code : undefined
    // Only trusted contract messages distinguish a missing route from a missing record.
    // Every 404 remains an error; unpublished is exclusively a validated 200 lookup.
    const notFound = response.status === 404 && code === 'NOT_FOUND'
      ? detail?.message === 'API route not found'
        ? 'Backend đang chạy chưa hỗ trợ đường dẫn API này. Kiểm tra phiên bản dịch vụ và cấu hình proxy.'
        : detail?.message === 'Laboratory result not found'
          ? 'Không tìm thấy kết quả xét nghiệm.'
          : undefined
      : undefined
    const message = notFound || (code && messages[code]) || (response.status === 404 ? 'Không tìm thấy kết quả, sự kiện hoặc đường dẫn API.' : 'Không thể xử lý yêu cầu Publish.')
    throw new LisApiError(response.status, code, message + ' (HTTP ' + response.status + ')')
  }
  return { body, status: response.status }
}
export async function getResultPublishState(resultId: string, signal?: AbortSignal): Promise<PublishState> {
  if (!isLisIdentifier(resultId)) throw new LisApiError(400, 'VALIDATION_ERROR', 'Mã kết quả không hợp lệ.')
  const { path, headers } = lisResultRequest(resultId, 'publish-event')
  return validatePublishState((await request(path, { signal, headers })).body, resultId)
}
export async function publishResult(resultId: string, signal?: AbortSignal) {
  if (!isLisIdentifier(resultId)) throw new LisApiError(400, 'VALIDATION_ERROR', 'Mã kết quả không hợp lệ.')
  const { path, headers } = lisResultRequest(resultId, 'publish')
  const { body, status } = await request(path, { method: 'POST', headers, signal })
  if (![200, 202].includes(status) || !receipt(body, resultId)) throw new Error('Phản hồi Publish không hợp lệ hoặc không khớp mã kết quả; cần đối soát lại trạng thái.')
  return { event: body, created: status === 202 }
}
export async function getExchangeStatus(event: PublishReceipt, signal?: AbortSignal): Promise<ExchangeStatus> {
  if (!event.exchange_id || !uuid.test(event.exchange_id)) throw new Error('Chưa có mã giao dịch middleware hợp lệ.')
  const { body } = await request('/api/middleware/exchanges/' + encodeURIComponent(event.exchange_id), { signal })
  if (!record(body) || body.exchange_id !== event.exchange_id || body.event_id !== event.event_id
    || body.source_result_id !== event.result_id || body.source_system !== 'lis-demo'
    || !exchangeStatuses.some((s) => s === body.status) || ![null, 'SEND', 'VERIFY'].includes(body.retry_phase as string | null)
    || !(body.verified_at === null || date(body.verified_at)) || !(body.completed_at === null || date(body.completed_at))
    || (body.status === 'DELIVERED' && (!date(body.verified_at) || !date(body.completed_at)))) {
    throw new Error('Chưa xác minh: trạng thái middleware không hợp lệ hoặc không khớp sự kiện/kết quả.')
  }
  return body as unknown as ExchangeStatus
}
