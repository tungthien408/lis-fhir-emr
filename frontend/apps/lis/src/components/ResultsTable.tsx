import type { LisResult } from '../types/lis.ts'
import { formatLisTimestamp } from '../state/results.ts'

export function ResultsTable({ results, onDetail }: { results: LisResult[]; onDetail: (resultId: string) => void }) {
  return (
    <div className="table-wrapper" role="region" aria-label="Bảng kết quả xét nghiệm" tabIndex={0}>
      <table className="results-table">
        <thead>
          <tr>
            <th scope="col">Mã kết quả</th>
            <th scope="col">Mã bệnh nhân</th>
            <th scope="col">Mã loại xét nghiệm</th>
            <th scope="col">Tên xét nghiệm</th>
            <th scope="col">Giá trị</th>
            <th scope="col">Đơn vị</th>
            <th scope="col">Thời điểm xét nghiệm (UTC)</th>
            <th scope="col">Trạng thái kết quả</th>
            <th scope="col">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result) => (
            <tr key={result.result_id}>
              <td className="identifier">{result.result_id}</td>
              <td className="identifier">{result.patient_id}</td>
              <td className="identifier">{result.test_code}</td>
              <td>{result.test_name}</td>
              <td className="numeric-value">{result.value_num}</td>
              <td>{result.unit}</td>
              <td className="timestamp">
                {result.effective_at === null ? '—' : (
                  <time dateTime={result.effective_at} title={result.effective_at}>
                    {formatLisTimestamp(result.effective_at)}
                  </time>
                )}
              </td>
              <td>
                <span className={'status-badge status-' + result.result_status.toLowerCase()}>
                  {result.result_status}
                </span>
              </td>
              <td>
                <button type="button" onClick={() => onDetail(result.result_id)}>
                  Xem chi tiết
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
