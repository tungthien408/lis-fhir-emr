import { useEffect, useRef, useState } from 'react'
import { publishResult } from '../api/publish.ts'
import { LisApiError } from '../api/lis.ts'
import { usePublishStatus } from '../hooks/usePublishStatus.ts'
import { formatLisTimestamp } from '../state/results.ts'
import type { LisResult } from '../types/lis.ts'
import type { PublishReceipt } from '../types/publish.ts'

const dispatchLabels = {
  PENDING: 'Đã lưu yêu cầu gửi, chờ Dispatcher.', IN_FLIGHT: 'Dispatcher đang chuyển giao tới middleware.',
  RETRY_WAIT: 'Đang chờ thử lại tự động tới middleware.', ACK: 'Middleware đã xác nhận tiếp nhận.',
  BLOCKED: 'Chuyển giao đã bị chặn. Cần kiểm tra nguyên nhân.', FAILED: 'Chuyển giao đã dừng. Cần kiểm tra nguyên nhân.',
}
const exchangeLabels = {
  RECEIVED: 'Middleware đã lưu yêu cầu, đang chờ xử lý.', PROCESSING: 'Middleware đang xử lý kết quả.',
  VERIFYING: 'Đang đọc lại và kiểm tra dữ liệu tại EMR.', RETRY_WAIT: 'Middleware đang chờ thử lại.',
  DELIVERED: 'Kết quả đã được lưu và kiểm tra tại EMR.', REJECTED: 'Middleware đã từ chối kết quả.', FAILED: 'Xử lý tại middleware đã dừng.',
}
export function PublishPanel({ result, onSourceRefresh }: { result: LisResult; onSourceRefresh: () => void }) {
  const [revision, setRevision] = useState(0)
  const state = usePublishStatus(result.result_id, revision)
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [receipt, setReceipt] = useState<PublishReceipt | null>(null)
  const inFlight = useRef<AbortController | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => () => { inFlight.current?.abort() }, [])
  useEffect(() => {
    if (confirming && !dialog.current?.open) dialog.current?.showModal()
    else if (!confirming && dialog.current?.open) dialog.current.close()
  }, [confirming])
  useEffect(() => {
    if (state.data && state.data.result_status !== result.result_status) onSourceRefresh()
  }, [state.data, result.result_status, onSourceRefresh])
  const event = state.data?.event ?? receipt
  const sourceStatus = state.data?.result_status ?? result.result_status
  const canPublish = sourceStatus === 'FINAL' && result.result_status === 'FINAL' && !sending && !state.loading && !state.error
  async function confirmPublish() {
    if (inFlight.current || !canPublish) return
    const controller = new AbortController()
    inFlight.current = controller
    setSending(true); setConfirming(false); setMessage(null)
    try {
      const response = await publishResult(result.result_id, controller.signal)
      if (controller.signal.aborted) return
      setReceipt(response.event)
      setMessage({ error: false, text: response.created
        ? 'Đã lưu yêu cầu gửi tại LIS.'
        : 'Đã có yêu cầu phát hành. Giữ nguyên sự kiện đã lưu, không tạo mới hoặc đặt lại tiến trình gửi.' })
    } catch (error) {
      if (controller.signal.aborted) return
      const definite = error instanceof LisApiError && [400, 404, 409, 413, 415, 422].includes(error.status)
      setMessage({ error: true, text: (definite ? '' : 'Chưa xác định yêu cầu đã được lưu hay chưa. Đang đối soát bằng GET; không tự gửi lại. ')
        + (error instanceof Error ? error.message : 'Không thể Publish kết quả.') })
    } finally {
      if (!controller.signal.aborted) { setSending(false); setRevision((n) => n + 1); inFlight.current = null }
    }
  }
  return <section className="publish-panel" aria-labelledby="publish-heading" data-publish-panel="true">
    <div className="publish-header">
      <div><h3 id="publish-heading">Trao đổi kết quả xét nghiệm</h3><p>Phát hành tại LIS và theo dõi từng chặng chuyển giao.</p></div>
      <div className="filter-actions">
        <button type="button" onClick={() => setRevision((n) => n + 1)} disabled={sending || state.loading}>Làm mới trạng thái</button>
        <button type="button" className="primary-button" onClick={() => setConfirming(true)} disabled={!canPublish}>
          {sending ? 'Đang lưu yêu cầu…' : event ? 'Publish lại' : 'Publish'}
        </button>
      </div>
    </div>
    {sourceStatus === 'READY' && <p className="publish-note">Chỉ kết quả FINAL mới có thể phát hành.</p>}
    {event && <p className="publish-note">Đã có sự kiện. Publish lại chỉ đối chiếu nội dung; không gửi lại hoặc đặt lại lượt thử của Dispatcher.</p>}
    {state.loading && <p role="status">Đang tra cứu trạng thái Publish…</p>}
    {sending && <p role="status">Đang lưu yêu cầu Publish…</p>}
    {message && <p className={message.error ? 'error-message' : 'publish-notice'} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
    {state.error && <p className="error-message" role="status">Chưa xác minh trạng thái Publish. {state.error} {state.data && 'Thông tin bên dưới là lần đọc trước, chưa cập nhật được.'}</p>}
    <dl className="publish-facts">
      <div><dt>Trạng thái nguồn LIS</dt><dd data-publish="source-status">{sourceStatus}</dd></div>
      <div><dt>Yêu cầu Publish</dt><dd data-publish="published">{event ? 'Đã được LIS ghi nhận' : state.data ? 'Chưa Publish' : 'Chưa xác minh'}</dd></div>
      <div><dt>Event ID</dt><dd data-publish="event-id">{event?.event_id ?? '—'}</dd></div>
      <div><dt>Trạng thái chuyển giao LIS</dt><dd data-publish="dispatch-status">{event?.dispatch_status ?? '—'}</dd></div>
      <div><dt>Exchange ID</dt><dd data-publish="exchange-id">{event?.exchange_id ?? '—'}</dd></div>
      <div><dt>Trạng thái middleware</dt><dd data-publish="exchange-status">{state.exchange?.status ?? 'Chưa xác minh'}</dd></div>
      {state.data?.event && <>
        <div><dt>Số lần thử chuyển giao LIS</dt><dd>{state.data.event.dispatch_attempt_count}</dd></div>
        <div><dt>Phát hành lúc (UTC)</dt><dd><time dateTime={state.data.event.published_at}>{formatLisTimestamp(state.data.event.published_at)}</time></dd></div>
      </>}
    </dl>
    {event && <p className="publish-note">{dispatchLabels[event.dispatch_status]}</p>}
    {state.data?.event?.last_error_code && <p className="error-message">{state.data.event.last_error_code}: {state.data.event.last_error_message ?? 'Chưa có thông tin lỗi chi tiết.'}</p>}
    {state.exchange && <p className="publish-notice" data-publish="delivery-message">{exchangeLabels[state.exchange.status]}{state.exchange.retry_phase && ' Pha: ' + state.exchange.retry_phase + '.'}</p>}
    {state.warning && <p className="error-message" role="status">Chưa xác minh trạng thái tại EMR. {state.warning}</p>}
    {!state.exchange && <p className="publish-note">Chưa xác minh EMR đã nhận và kiểm tra kết quả.</p>}
    <dialog ref={dialog} className="publish-dialog" aria-labelledby="confirm-publish-heading" onCancel={() => setConfirming(false)} onClose={() => setConfirming(false)}>
      <h3 id="confirm-publish-heading">Xác nhận Publish kết quả</h3>
      <p>Chốt dữ liệu tại LIS để gửi nền. Thao tác này chưa xác nhận EMR đã nhận.</p>
      <dl className="publish-facts">
        <div><dt>Mã kết quả</dt><dd>{result.result_id}</dd></div>
        <div><dt>Mã bệnh nhân</dt><dd>{result.patient_id}</dd></div>
        <div><dt>Xét nghiệm</dt><dd>{result.test_code} · {result.test_name}</dd></div>
        <div><dt>Giá trị</dt><dd>{result.value_num} {result.unit}</dd></div>
      </dl>
      {event && <p>Sự kiện đã có sẽ được giữ nguyên. Nếu nguồn khác snapshot đã phát hành, LIS sẽ báo CONTENT_CONFLICT.</p>}
      <div className="pagination-actions">
        <button type="button" onClick={() => setConfirming(false)} autoFocus>Hủy</button>
        <button type="button" className="primary-button" onClick={() => void confirmPublish()} disabled={!canPublish}>Xác nhận Publish</button>
      </div>
    </dialog>
  </section>
}
