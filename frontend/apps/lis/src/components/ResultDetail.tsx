import { useCallback, useState } from 'react'
import { PublishPanel } from './PublishPanel.tsx'
import { useLisResult } from '../hooks/useLisResult.ts'
import { formatLisTimestamp } from '../state/results.ts'
import type { LisResult } from '../types/lis.ts'

export function ResultDetailFields({ result }: { result: LisResult }) {
  return (
    <div className="result-detail-grid">
      <section aria-labelledby="identity-heading">
        <h3 id="identity-heading">Thông tin xét nghiệm</h3>
        <dl>
          <div className="detail-field"><dt>Mã kết quả</dt><dd data-field="result_id">{result.result_id}</dd></div>
          <div className="detail-field"><dt>Mã bệnh nhân</dt><dd data-field="patient_id">{result.patient_id}</dd></div>
          <div className="detail-field"><dt>Mã loại xét nghiệm</dt><dd data-field="test_code">{result.test_code}</dd></div>
          <div className="detail-field"><dt>Tên xét nghiệm</dt><dd data-field="test_name">{result.test_name}</dd></div>
          <div className="detail-field"><dt>Loại mẫu</dt><dd data-field="fluid">{result.fluid ?? '—'}</dd></div>
          <div className="detail-field"><dt>Nhóm xét nghiệm</dt><dd data-field="category">{result.category ?? '—'}</dd></div>
        </dl>
      </section>
      <section aria-labelledby="value-heading">
        <h3 id="value-heading">Thông tin kết quả</h3>
        <dl>
          <div className="detail-field"><dt>Giá trị xét nghiệm</dt><dd className="numeric-value result-value" data-field="value_num">{result.value_num}</dd></div>
          <div className="detail-field"><dt>Đơn vị</dt><dd data-field="unit">{result.unit}</dd></div>
          <div className="detail-field"><dt>Cận tham chiếu thấp</dt><dd className="numeric-value" data-field="reference_low">{result.reference_low ?? '—'}</dd></div>
          <div className="detail-field"><dt>Cận tham chiếu cao</dt><dd className="numeric-value" data-field="reference_high">{result.reference_high ?? '—'}</dd></div>
          <div className="detail-field"><dt>Thời điểm xét nghiệm (UTC)</dt>
          <dd data-field="effective_at">{result.effective_at === null ? '—' : (
            <time dateTime={result.effective_at} title={result.effective_at}>{formatLisTimestamp(result.effective_at)}</time>
          )}</dd></div>
          <div className="detail-field"><dt>Trạng thái kết quả</dt><dd data-field="result_status">
            <span className={'status-badge status-' + result.result_status.toLowerCase()}>{result.result_status}</span>
          </dd></div>
        </dl>
      </section>
    </div>
  )
}

export function ResultDetail({ resultId, onBack }: { resultId: string; onBack: () => void }) {
  const [request, setRequest] = useState(() => ({ resultId }))
  const detail = useLisResult(request)
  const refreshSource = useCallback(() => setRequest({ resultId }), [resultId])
  return (
    <section className="results-section result-detail" aria-labelledby="detail-heading">
      <div className="detail-header">
        <div className="detail-heading-group">
          <h2 id="detail-heading">Chi tiết kết quả xét nghiệm</h2>
          <p className="detail-location">Kết quả <span>{resultId}</span></p>
        </div>
        <div className="detail-header-actions">
          {detail.status === 'success' && <span className={'status-badge status-' + detail.result.result_status.toLowerCase()}>{detail.result.result_status}</span>}
          <button type="button" className="back-button" onClick={onBack}>Quay lại danh sách</button>
        </div>
      </div>
      <div className="detail-content" aria-busy={detail.status === 'loading'}>
        {detail.status === 'loading' && <p className="results-feedback" role="status">Đang tải chi tiết kết quả...</p>}
        {detail.status === 'error' && <div className="results-feedback error-message" role="alert">
          <p>{detail.message}</p>
          {detail.retryable && <button type="button" onClick={() => setRequest({ resultId })}>Thử tải lại</button>}
        </div>}
        {detail.status === 'success' && <>
          <ResultDetailFields result={detail.result} />
          <PublishPanel result={detail.result} onSourceRefresh={refreshSource} />
        </>}
      </div>
    </section>
  )
}
