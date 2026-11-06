import type { ResultFilters as FilterValues } from '../state/results.ts'

interface Props {
  values: FilterValues
  onChange: (values: FilterValues) => void
  onSearch: () => void
  onReset: () => void
}

export function ResultFilters({ values, onChange, onSearch, onReset }: Props) {
  return (
    <form
      className="result-filters"
      aria-label="Bộ lọc kết quả xét nghiệm"
      onSubmit={(event) => { event.preventDefault(); onSearch() }}
    >
      <div className="filter-field">
        <label htmlFor="patient-id">Mã bệnh nhân</label>
        <input id="patient-id" type="text" placeholder="VD: MIMIC-P-10007928" value={values.patientId}
          onChange={(event) => onChange({ ...values, patientId: event.target.value })} />
      </div>
      <div className="filter-field">
        <label htmlFor="result-id">Mã kết quả xét nghiệm</label>
        <input id="result-id" type="text" placeholder="VD: MIMIC-LAB-100145" value={values.resultId}
          onChange={(event) => onChange({ ...values, resultId: event.target.value })} />
      </div>
      <div className="filter-field">
        <label htmlFor="test-code">Mã loại xét nghiệm</label>
        <input id="test-code" type="text" placeholder="VD: 50971" aria-describedby={/^MIMIC-LAB-/i.test(values.testCode.trim()) ? 'test-code-hint' : undefined} value={values.testCode}
          onChange={(event) => onChange({ ...values, testCode: event.target.value })} />
        {/^MIMIC-LAB-/i.test(values.testCode.trim()) && <p id="test-code-hint" className="filter-hint">
          Đây có thể là mã kết quả. Hãy dùng ô Mã kết quả xét nghiệm để tra cứu.
        </p>}
      </div>
      <div className="filter-field">
        <label htmlFor="result-status">Trạng thái kết quả</label>
        <select id="result-status" value={values.resultStatus}
          onChange={(event) => onChange({ ...values, resultStatus: event.target.value as FilterValues['resultStatus'] })}>
          <option value="">Tất cả</option>
          <option value="READY">READY</option>
          <option value="FINAL">FINAL</option>
        </select>
      </div>
      <div className="filter-actions">
        <button className="primary-button" type="submit">Tìm kiếm</button>
        <button type="button" onClick={onReset}>Xóa bộ lọc</button>
      </div>
    </form>
  )
}
