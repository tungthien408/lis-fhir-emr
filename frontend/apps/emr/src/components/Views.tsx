import { useCallback, useState, type FormEvent, type ReactNode } from 'react'
import { getPatient, getResult, getResults } from '../api/emr.ts'
import { useRead } from '../hooks/useRead.ts'
import { identifier, normalizeInput, routeHash, uuid } from '../state/routes.ts'
import { patientLabel, readableUtc } from '../state/presentation.ts'
import { emptySearch, PATIENT_SYSTEM, RESULT_SYSTEM, type Patient, type Route } from '../types/emr.ts'
type ValidRoute = Exclude<Route, { kind: 'invalid' }>
type Props<R extends ValidRoute> = { route: R; revision: number; navigate: (route: ValidRoute) => void; refresh: () => void }
export function Fact({ label, children }: { label: string; children: ReactNode }) { return <div><dt>{label}</dt><dd>{children ?? '—'}</dd></div> }
export function Timestamp({ value, original = false }: { value: string; original?: boolean }) {
  return <span className="timestamp"><time dateTime={value} title={value}>{readableUtc(value)}</time>{original && <small className="raw-time">UTC gốc: <code>{value}</code></small>}</span>
}
export function Feedback({ loading, error, refresh }: { loading: boolean; error: string | null; refresh: () => void }) {
  return loading ? <p className="feedback" role="status">Đang tải dữ liệu EMR…</p> : error ? <div className="feedback error" role="alert"><p>{error}</p><button onClick={refresh}>Thử tải lại</button></div> : null
}
function PatientCard({ patient, action, related = false }: { patient: Patient; action?: ReactNode; related?: boolean }) {
  const sourceIds = patient.identifiers.filter(x => x.identifier_system === PATIENT_SYSTEM)
  return <section className="card patient-card">
    <div className="section-heading"><div><p className="eyebrow">{related ? 'THÔNG TIN HỒ SƠ LIÊN QUAN' : 'ĐÃ TÌM THẤY HỒ SƠ'}</p><h2>{patientLabel(patient.display_label) || 'Hồ sơ chưa có nhãn hiển thị'}</h2></div>{action}</div>
    {sourceIds.map(x => <p className="patient-source" key={x.identifier_value}><span>Mã bệnh nhân LIS</span><strong>{x.identifier_value}</strong></p>)}
    <p className="note">Thông tin nhận diện từ hồ sơ mô phỏng.</p>
    <details className="technical-info"><summary>Thông tin kỹ thuật của hồ sơ</summary><p className="note">Khóa hồ sơ là mã nhận diện riêng trong EMR. Hệ thống định danh cho biết mã bệnh nhân thuộc nguồn nào.</p>
      <dl className="facts"><Fact label="Khóa hồ sơ bệnh nhân tại EMR"><span className="mono" data-emr="patient-key">{patient.patient_key}</span></Fact>
        <Fact label="Nhãn hồ sơ gốc (display_label)"><span data-emr="original-label">{patient.display_label ?? '—'}</span></Fact>
        {patient.identifiers.map(x => <Fact key={x.identifier_system + '\u0000' + x.identifier_value} label="Mã bệnh nhân / hệ thống định danh nguồn"><span>{x.identifier_value}</span><small className="mono">{x.identifier_system}</small></Fact>)}</dl>
      {!patient.identifiers.length && <p className="note">Hồ sơ chưa có định danh nguồn liên kết.</p>}
    </details>
  </section>
}
export function SearchView({ route, revision, navigate, refresh }: Props<Extract<ValidRoute, { kind: 'search' }>>) {
  const [mode, setMode] = useState(route.search.mode), [value, setValue] = useState(route.search.value), [error, setError] = useState('')
  const [resultId, setResultId] = useState(''), [resultError, setResultError] = useState('')
  const load = useCallback((signal: AbortSignal) => getPatient(route.search, signal), [route.search])
  const state = useRead(routeHash(route), load, revision, !!route.search.value)
  function submit(e: FormEvent) {
    e.preventDefault()
    if (!identifier(value) || (mode === 'key' && !uuid.test(value.trim()))) { setError(mode === 'key' ? 'Khóa hồ sơ EMR cần có dạng UUID, ví dụ xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.' : 'Nhập mã bệnh nhân hợp lệ, không chứa ký tự điều khiển.'); return }
    setError(''); navigate({ kind: 'search', search: { mode, value: mode === 'source' ? normalizeInput(value, 'patient') : value.trim() } })
  }
  function openResult(e: FormEvent) { e.preventDefault(); if (!identifier(resultId)) { setResultError('Nhập mã kết quả nguồn hợp lệ.'); return }; setResultError(''); navigate({ kind: 'result', system: RESULT_SYSTEM, id: normalizeInput(resultId, 'result'), search: route.search, page: 1 }) }
  return <section data-emr="search">
    <section className="card"><div className="section-heading"><div><p className="eyebrow">BỆNH ÁN ĐIỆN TỬ</p><h2>Tra cứu hồ sơ bệnh nhân</h2></div><button onClick={refresh} disabled={state.loading || !route.search.value}>Làm mới</button></div>
      <p className="section-intro">Tìm bệnh nhân để xem hồ sơ và các kết quả xét nghiệm đã lưu.</p><p className="note">Dùng mã bệnh nhân LIS nếu bạn có mã từ hệ thống xét nghiệm. Chọn khóa hồ sơ EMR khi bạn đã được cung cấp mã hồ sơ tại đây.</p>
      <form className="filters" onSubmit={submit}><label>Phương thức tìm kiếm<select id="patient-mode" value={mode} onChange={e => setMode(e.target.value as typeof mode)}><option value="source">Mã bệnh nhân LIS</option><option value="key">Khóa hồ sơ bệnh nhân tại EMR</option></select></label>
        <label>{mode === 'source' ? 'Mã bệnh nhân LIS' : 'Khóa hồ sơ EMR'}<input id="patient-input" value={value} onChange={e => setValue(e.target.value)} placeholder={mode === 'source' ? 'VD: MIMIC-P-10007928' : 'Nhập khóa hồ sơ đã được cung cấp'} autoComplete="off" /></label>
        <div className="actions"><button type="submit" className="primary">Tìm kiếm</button><button type="button" onClick={() => { setValue(''); setMode('source'); setError(''); navigate({ kind: 'search', search: emptySearch }) }}>Xóa tìm kiếm</button></div></form>
      {error && <p className="error-text" role="alert">{error}</p>}
    </section>
    <Feedback {...state} refresh={refresh} />
    {state.data && <PatientCard patient={state.data} action={<button className="primary" onClick={() => navigate({ kind: 'profile', key: state.data!.patient_key, search: route.search, page: 1 })}>Xem hồ sơ bệnh nhân</button>} />}
    {!route.search.value && <p className="empty">Bắt đầu bằng cách nhập mã bệnh nhân và chọn Tìm kiếm.</p>}
    <aside className="card quick-lookup"><h3>Tra cứu nhanh kết quả</h3><p className="note">Khi đã biết mã kết quả LIS, bạn có thể mở trực tiếp một xét nghiệm tại đây. Để xem các kết quả của bệnh nhân, hãy dùng tra cứu hồ sơ ở trên.</p><details><summary>Tra cứu bằng mã kết quả</summary><form className="direct-lookup" onSubmit={openResult}><label htmlFor="result-input">Mã kết quả nguồn</label><div><input id="result-input" value={resultId} onChange={e => setResultId(e.target.value)} placeholder="VD: MIMIC-LAB-100145" autoComplete="off" /><button>Mở kết quả</button></div></form>{resultError && <p className="error-text" role="alert">{resultError}</p>}</details></aside>
  </section>
}
export function ProfileView({ route, revision, navigate, refresh }: Props<Extract<ValidRoute, { kind: 'profile' }>>) {
  const load = useCallback(async (signal: AbortSignal) => { const patient = await getPatient({ mode: 'key', value: route.key }, signal); return { patient, ...await getResults(patient, route.page, signal) } }, [route.key, route.page])
  const state = useRead(routeHash(route), load, revision), data = state.data
  return <section data-emr="profile"><div className="section-heading"><div><p className="eyebrow">HỒ SƠ BỆNH NHÂN</p><h2>{data ? `Hồ sơ bệnh nhân – ${patientLabel(data.patient.display_label) || 'Chưa có nhãn hiển thị'}` : 'Hồ sơ bệnh nhân'}</h2></div><div className="actions"><button onClick={refresh} disabled={state.loading}>Làm mới</button><button onClick={() => navigate({ kind: 'search', search: route.search })}>Quay lại tra cứu</button></div></div>
    <Feedback {...state} refresh={refresh} />
    {data && <><PatientCard patient={data.patient} related /><section className="card results-card"><div className="table-title"><h3>Các kết quả xét nghiệm đã lưu</h3><span className="muted">Theo thời điểm xét nghiệm mới nhất</span></div>
      {data.items.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label="Bảng xét nghiệm, có thể cuộn ngang"><table><thead><tr>{['Xét nghiệm', 'Giá trị', 'Đơn vị', 'Khoảng tham chiếu', 'Trạng thái', 'Thời điểm xét nghiệm', 'Thao tác'].map(h => <th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{data.items.map(row => <tr key={row.target_id} data-target={row.target_id} data-source={row.external_id}>
        <td><strong className="test-name">{row.analyte_display ?? 'Chưa có tên xét nghiệm'}</strong><small>Mã xét nghiệm: {row.analyte_code}</small><small className="result-source" data-emr="list-source">{row.external_id}</small></td>
        <td className="quantity" data-emr="list-quantity">{row.quantity}</td><td>{row.unit_text}</td><td><span className="reference-range"><span>Thấp: {row.low ?? 'Không có'}</span><span>Cao: {row.high ?? 'Không có'}</span></span></td>
        <td><span className="badge">Đã hoàn tất <small>final</small></span></td><td><Timestamp value={row.effective_at} /></td><td><button onClick={() => navigate({ kind: 'result', system: row.external_system, id: row.external_id, key: data.patient.patient_key, search: route.search, page: route.page })}>Xem chi tiết</button></td></tr>)}</tbody></table></div>
        : <div className="empty" role="status"><strong>Không có kết quả trên trang này</strong><p>Hồ sơ bệnh nhân tồn tại. Chưa có xét nghiệm phù hợp hoặc trang hiện tại đã hết dữ liệu.</p></div>}
      <div className="list-footer"><p className="display-count">Đang hiển thị {data.items.length} kết quả{route.page > 1 ? ` trên trang ${route.page}` : ''}.</p>
        {(route.page > 1 || data.hasNext) && <nav className="pagination" aria-label="Phân trang"><p>Trang {route.page}</p><div className="actions"><button disabled={route.page === 1} onClick={() => navigate({ ...route, page: route.page - 1 })}>Trang trước</button><button disabled={!data.hasNext} onClick={() => navigate({ ...route, page: route.page + 1 })}>Trang sau</button></div></nav>}
      </div>
    </section></>}
  </section>
}
export function ResultView({ route, revision, navigate, refresh }: Props<Extract<ValidRoute, { kind: 'result' }>>) {
  const load = useCallback((signal: AbortSignal) => getResult(route.system, route.id, route.key, signal), [route.system, route.id, route.key])
  const state = useRead(routeHash(route), load, revision), data = state.data, row = data?.result
  return <section data-emr="result"><div className="section-heading detail-title"><div><p className="eyebrow">KẾT QUẢ ĐÃ TIẾP NHẬN</p><h2>Chi tiết xét nghiệm</h2><p className="mono detail-id">{route.id}</p></div><div className="actions"><button onClick={refresh} disabled={state.loading}>Làm mới</button><button onClick={() => navigate(route.key ? { kind: 'profile', key: route.key, search: route.search, page: route.page } : { kind: 'search', search: route.search })}>{route.key ? 'Quay lại hồ sơ' : 'Quay lại tra cứu'}</button></div></div>
    <Feedback {...state} refresh={refresh} />
    {row && data && <>
      <section className="card result-summary"><div className="section-heading"><div><p className="eyebrow">KẾT QUẢ XÉT NGHIỆM</p><h2>{row.analyte_display ?? 'Xét nghiệm chưa có tên'}</h2></div><span className="badge">Đã lưu tại EMR</span></div>
        <p className="result-value"><span data-emr="quantity">{row.quantity}</span> <span>{row.unit_text}</span></p>
        <dl className="facts summary-facts"><Fact label="Cận thấp">{row.low ?? 'Không có'}</Fact><Fact label="Cận cao">{row.high ?? 'Không có'}</Fact><Fact label="Trạng thái kết quả">Đã hoàn tất (final)</Fact>
          <Fact label="Mã kết quả nguồn LIS"><span data-emr="external-id">{row.external_id}</span></Fact><Fact label="Bệnh nhân liên quan">{patientLabel(data.patient.display_label) || 'Hồ sơ chưa có nhãn hiển thị'}</Fact></dl>
      </section>
      <section className="card"><h3>Thông tin xét nghiệm</h3><dl className="facts"><Fact label="Tên xét nghiệm từ nguồn">{row.analyte_display}</Fact><Fact label="Mã xét nghiệm">{row.analyte_code}</Fact><Fact label="Đơn vị đo">{row.unit_text}</Fact><Fact label="Thông tin mô tả từ nguồn">{row.analyte_context}</Fact></dl></section>
      <PatientCard patient={data.patient} related />
      <section className="card recorded-times"><h3>Các thời điểm ghi nhận</h3><p className="note">Ngày giờ được giữ nguyên theo dữ liệu mô phỏng. UTC là múi giờ chuẩn dùng để đối chiếu giữa các hệ thống.</p><dl className="facts"><Fact label="Thời điểm xét nghiệm"><Timestamp value={row.effective_at} original /></Fact><Fact label="EMR tiếp nhận"><Timestamp value={row.received_at} original /></Fact><Fact label="EMR lưu"><Timestamp value={row.stored_at} original /></Fact></dl></section>
      <section className="card technical"><h3>Thông tin kỹ thuật và dữ liệu FHIR</h3><p className="note">Dành cho việc tra cứu mã định danh và đối chiếu dữ liệu giữa các hệ thống.</p>
        <details><summary>Xem mã định danh và dữ liệu FHIR</summary><dl className="facts"><Fact label="Mã bản ghi kết quả tại EMR"><span className="mono" data-emr="target-id">{row.target_id}</span></Fact><Fact label="Khóa hồ sơ bệnh nhân tại EMR"><span className="mono">{row.patient_key}</span></Fact><Fact label="Hệ thống định danh nguồn">{row.external_system}</Fact><Fact label="Mã kết quả nguồn LIS">{row.external_id}</Fact><Fact label="Hệ thống mã xét nghiệm">{row.analyte_system}</Fact></dl>
          <p className="note">FHIR là cấu trúc dữ liệu trao đổi giữa các hệ thống. Bản ghi dưới đây giữ nguyên nội dung đã lưu tại EMR.</p><pre>{JSON.stringify(row.fhir_json, null, 2)}</pre>
          <p className="note">Việc lưu tại EMR và việc Middleware đọc lại để đối soát là các bước riêng. Trạng thái trao đổi được theo dõi tại Exchange Monitor.</p>
        </details>
      </section>
      <button onClick={() => navigate({ kind: 'profile', key: data.patient.patient_key, search: route.search, page: route.key ? route.page : 1 })}>Xem hồ sơ bệnh nhân</button>
    </>}
  </section>
}
