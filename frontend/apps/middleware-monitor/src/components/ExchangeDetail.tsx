import { diagnosticLabels } from '../state/presentation.ts'
import { identityVerified, record, verifiedDelivery } from '../api/exchanges.ts'
import { useExchangeDetail } from '../hooks/useExchanges.ts'
import { Badge, Fact, Feedback, Timestamp } from './Common.tsx'
const fieldLabels: Record<string, string> = {
  result_id: 'Mã kết quả',
  patient_id: 'Mã bệnh nhân nguồn',
  test_code: 'Mã xét nghiệm',
  test_name: 'Tên xét nghiệm',
  fluid: 'Loại mẫu',
  category: 'Nhóm',
  value_num: 'Giá trị',
  unit: 'Đơn vị',
  reference_low: 'Cận thấp',
  reference_high: 'Cận cao',
  effective_at: 'Thời điểm xét nghiệm (gốc)',
  result_status: 'Trạng thái nguồn lúc Publish',
}
const eventLabels: Record<string, string> = {
  RECEIVED: 'Tiếp nhận',
  CLAIMED: 'Nhận việc',
  VALIDATED: 'Kiểm tra nguồn',
  TRANSFORMED: 'Chuyển đổi FHIR',
  SENT: 'Gửi đến EMR',
  TARGET_STORED: 'Nhận xác nhận lưu',
  VERIFY_STARTED: 'Bắt đầu đọc lại',
  DELIVERED: 'Hoàn tất đối soát',
  RETRY_SCHEDULED: 'Lên lịch thử lại',
  RETRY_EXHAUSTED: 'Hết lượt thử',
  LEASE_RECOVERED: 'Tiếp tục sau gián đoạn',
  FAILED: 'Xử lý thất bại',
  REJECTED: 'Từ chối',
  VERIFY_MISMATCH: 'Dữ liệu đối soát không khớp',
}
export function ExchangeDetail({ id, revision, back, refresh }: { id: string; revision: number; back: () => void; refresh: () => void }) {
  const state = useExchangeDetail(id, revision),
    d = state.data,
    a = state.attempts
  const snapshot = d && record(d.source_payload) && record(d.source_payload.source_snapshot) ? d.source_payload.source_snapshot : null
  const delivered = d && verifiedDelivery(d, a)
  return (
    <section aria-labelledby="detail-heading">
      <div className="section-heading detail-title">
        <div>
          <p className="eyebrow">GIAO DỊCH MIDDLEWARE</p>
          <h2 id="detail-heading">Chi tiết trao đổi</h2>
          <p className="mono muted detail-id">{id}</p>
        </div>
        <div className="actions">
          <button onClick={refresh} disabled={state.loading}>
            Làm mới trạng thái
          </button>
          <button onClick={back}>Quay lại danh sách</button>
        </div>
      </div>
      <Feedback loading={state.loading} error={state.error} retry={refresh} />
      {d && (
        <>
          <div className="detail-grid">
            <section className="card">
              <h3>Định danh giao dịch</h3>
              <dl className="facts">
                <Fact label="Exchange ID">{d.exchange_id}</Fact>
                <Fact label="Event ID">{d.event_id}</Fact>
                <Fact label="Hệ thống nguồn">{d.source_system}</Fact>
                <Fact label="Mã kết quả nguồn">{d.source_result_id}</Fact>
                <Fact label="Source hash">{d.source_hash}</Fact>
                <Fact label="Mapping version">{d.mapping_version}</Fact>
              </dl>
            </section>
            <section className="card">
              <h3>Trạng thái Middleware</h3>
              <div data-monitor="status">
                <Badge status={d.status} />
              </div>
              <p className="note">Đây là trạng thái Middleware, khác READY/FINAL của nguồn và ACK của Dispatcher LIS.</p>
              <dl className="facts">
                <Fact label="Pha thử lại">{d.retry_phase}</Fact>
                <Fact label="Số lần SEND">{d.send_attempt_count}</Fact>
                <Fact label="Số lần VERIFY">{d.verify_attempt_count}</Fact>
                <Fact label="Thử tiếp theo">
                  <Timestamp value={d.next_retry_at} />
                </Fact>
                <Fact label="Hoàn tất">
                  <Timestamp value={d.completed_at} />
                </Fact>
              </dl>
            </section>
          </div>
          <section className={'card verification ' + (delivered ? 'verified' : '')} aria-labelledby="verification-heading">
            <h3 id="verification-heading">Xác minh tại EMR</h3>
            <p data-monitor="verification" className={delivered ? 'success-text' : 'note'}>
              {delivered
                ? 'Middleware đã xác nhận kết quả được lưu và đọc lại đối soát tại EMR.'
                : d.status === 'DELIVERED'
                  ? 'Middleware báo DELIVERED nhưng chưa đủ bằng chứng nhất quán để xác nhận đối soát. Kiểm tra receipt, định danh và các mốc xác minh.'
                  : 'Chưa có xác nhận hoàn tất đối soát EMR. ACK hoặc phản hồi lưu 200/201 không có nghĩa DELIVERED.'}
            </p>
            {!identityVerified(d) && (
              <p className="error-text" role="status">
                Định danh trong dữ liệu nguồn không nhất quán với giao dịch; chưa thể xác minh.
              </p>
            )}
            <dl className="facts">
              <Fact label="EMR đã xác nhận lưu">
                <Timestamp value={d.target_stored_at} />
              </Fact>
              <Fact label="Đọc lại được xác minh">
                <Timestamp value={d.verified_at} />
              </Fact>
              <Fact label="Hoàn tất">
                <Timestamp value={d.completed_at} />
              </Fact>
            </dl>
            {a?.items
              .filter((x) => x.receipt)
              .map((x) => (
                <div className="receipt" key={x.attempt_id}>
                  <h4>Receipt lưu · SEND #{x.attempt_no}</h4>
                  <dl className="facts">
                    <Fact label="Phản hồi">{x.receipt!.result}</Fact>
                    <Fact label="External system">{x.receipt!.external_system}</Fact>
                    <Fact label="External ID">{x.receipt!.external_id}</Fact>
                    <Fact label="Target ID">{x.receipt!.target_id}</Fact>
                    <Fact label="Patient key (EMR)">{x.receipt!.patient_key}</Fact>
                  </dl>
                  <p className="note">Receipt xác nhận lưu, không thay thế bước đọc lại đối soát.</p>
                </div>
              ))}
          </section>
          <section className="card">
            <h3>Snapshot tại thời điểm LIS Publish</h3>
            <p className="note">Đây là dữ liệu đã phát hành; không nhất thiết phản ánh trạng thái LIS hiện tại.</p>
            {snapshot ? (
              <dl className="facts snapshot">
                {Object.entries(fieldLabels).map(([key, label]) => (
                  <Fact key={key} label={label}>
                    {snapshot[key] === null || snapshot[key] === undefined
                      ? '—'
                      : typeof snapshot[key] === 'object'
                        ? 'Dữ liệu không hợp lệ'
                        : String(snapshot[key])}
                  </Fact>
                ))}
              </dl>
            ) : (
              <p className="error-text">Không có snapshot có cấu trúc hợp lệ. Xem dữ liệu kỹ thuật để kiểm tra.</p>
            )}
          </section>
          <section className="card">
            <h3>Lịch sử các lần thử</h3>
            <p className="note">SEND là gửi kết quả; VERIFY là đọc lại EMR. Số lượt lấy từ attempts, không dựng từ timeline.</p>
            {state.warning && (
              <p className="feedback error" role="alert">
                Không tải được lịch sử các lần thử. {state.warning} Có thể thử Làm mới trạng thái.
              </p>
            )}
            {a &&
              (a.items.length ? (
                <div className="table-scroll" tabIndex={0} role="region" aria-label="Bảng các lần thử">
                  <table className="attempts-table">
                    <thead>
                      <tr>
                        {['Pha / lượt', 'Attempt ID', 'Bắt đầu', 'Gửi lúc', 'Có phản hồi', 'Kết thúc', 'HTTP', 'Mã lỗi', 'Kết quả lưu'].map(
                          (h) => (
                            <th key={h}>{h}</th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {a.items.map((x) => (
                        <tr key={x.attempt_id}>
                          <td>
                            <strong>
                              {x.phase} #{x.attempt_no}
                            </strong>
                          </td>
                          <td className="mono">{x.attempt_id}</td>
                          <td>
                            <Timestamp value={x.started_at} />
                          </td>
                          <td>
                            <Timestamp value={x.sent_at} />
                          </td>
                          <td>
                            <Timestamp value={x.response_at} />
                          </td>
                          <td>
                            <Timestamp value={x.ended_at} />
                          </td>
                          <td>{x.http_status ?? '—'}</td>
                          <td>
                            {x.error_code ?? '—'}
                            {x.error_code && (
                              <small className="error-text">{diagnosticLabels[x.error_code] ?? 'Kiểm tra mã lỗi và pha xử lý.'}</small>
                            )}
                          </td>
                          <td>
                            {x.receipt?.result ?? (x.ended_at ? 'Đã kết thúc lượt' : 'Đang thực hiện')}
                            <small>{x.phase === 'VERIFY' ? 'Xem trạng thái đối soát ở trên' : ''}</small>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="empty">Chưa có lần thử được ghi nhận.</p>
              ))}
            {a && a.diagnostics.length > 0 && (
              <div className="diagnostics">
                <h4>Mã chẩn đoán đã ghi nhận</h4>
                <ul>
                  {a.diagnostics.map((x) => (
                    <li key={x.log_event_id}>
                      <strong>{x.error_code}</strong> · {diagnosticLabels[x.error_code] ?? 'Cần kiểm tra chẩn đoán.'} ·{' '}
                      {eventLabels[x.event_type] ?? x.event_type} · <Timestamp value={x.occurred_at} />
                      {x.attempt_id && <span className="mono"> · {x.attempt_id}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
          <section className="card">
            <h3>Dòng thời gian xử lý</h3>
            {d.events.length ? (
              <ol className="timeline">
                {d.events.map((e) => (
                  <li key={e.log_event_id}>
                    <div>
                      <strong>{eventLabels[e.event_type] ?? e.event_type}</strong>
                      <code>{e.event_type}</code>
                    </div>
                    <p>
                      {e.old_status ?? '—'} → {e.new_status ?? '—'}
                    </p>
                    <Timestamp value={e.occurred_at} />
                    {e.attempt_id && <p className="mono">Attempt: {e.attempt_id}</p>}
                  </li>
                ))}
              </ol>
            ) : (
              <p>Chưa có sự kiện lịch sử.</p>
            )}
            <details>
              <summary>Các mốc xử lý đã lưu</summary>
              <dl className="facts">
                {(
                  [
                    ['Publish', d.published_at],
                    ['Tiếp nhận', d.received_at],
                    ['Kiểm tra', d.validated_at],
                    ['Bắt đầu mapping', d.mapping_started_at],
                    ['Chuyển đổi', d.transformed_at],
                    ['Gửi lần đầu', d.first_sent_at],
                  ] as const
                ).map(([label, value]) => (
                  <Fact label={label} key={label}>
                    <Timestamp value={value} />
                  </Fact>
                ))}
              </dl>
            </details>
          </section>
          <section className="card technical">
            <h3>Dữ liệu kỹ thuật</h3>
            <p className="note">Payload đã lưu; chỉ xem, không chỉnh sửa hoặc gửi lại.</p>
            <details>
              <summary>Source payload</summary>
              <pre>{JSON.stringify(d.source_payload, null, 2)}</pre>
            </details>
            <details>
              <summary>FHIR payload</summary>
              <pre>{d.fhir_payload === null ? 'Chưa có FHIR payload.' : JSON.stringify(d.fhir_payload, null, 2)}</pre>
            </details>
            <details>
              <summary>Payload hash</summary>
              <p className="mono">{d.payload_hash ?? '—'}</p>
            </details>
          </section>
        </>
      )}
    </section>
  )
}
