import { loadFlow, message } from './api.ts'
import { flowModel, type FlowData } from './model.ts'
import type { PublishReceipt } from '../types/publish.ts'

export const duplicateNotice = 'Yêu cầu trùng đã được tiếp nhận theo cơ chế idempotency. Không tạo lần gửi mới, không đặt lại lượt thử.'

// Only call with fresh, identity-checked API evidence, never infer delivery from ACK.
export function existingPublishNotice(data: FlowData): string {
  if (!data.publish.published) return 'Kết quả chưa được phát hành. Có thể gửi sang EMR.'
  if (flowModel(data).delivered) return 'Kết quả xét nghiệm này đã được gửi thành công trước đó.'
  if (['PENDING', 'IN_FLIGHT', 'RETRY_WAIT'].includes(data.publish.event?.dispatch_status ?? '')
    || ['RECEIVED', 'PROCESSING', 'VERIFYING', 'RETRY_WAIT'].includes(data.detail?.status ?? '')) {
    return 'Kết quả đang trong quá trình trao đổi. Không cần gửi lại.'
  }
  return 'Yêu cầu phát hành đã tồn tại. Chưa xác nhận trao đổi hoàn tất; xem trạng thái và nhật ký. Không tự gửi lại.'
}

export async function publishFeedback(response: { created: boolean; event: PublishReceipt }, signal: AbortSignal): Promise<string> {
  if (response.created) return 'LIS đã lưu yêu cầu phát hành. Chưa xác nhận kết quả đã được chuyển đến EMR.'
  try {
    const data = await loadFlow(response.event.result_id, signal)
    if (data.publish.event?.event_id !== response.event.event_id) throw new Error('Sự kiện đọc lại không khớp phản hồi Publish.')
    return duplicateNotice + ' ' + existingPublishNotice(data)
  } catch (error) {
    // A lookup timeout cannot undo the already validated HTTP 200 duplicate receipt.
    return duplicateNotice + ' Chưa đọc lại được trạng thái: ' + message(error)
  }
}
