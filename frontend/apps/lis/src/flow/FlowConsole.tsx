import { useEffect, useRef, useState } from 'react'
import { useLisResults } from '../hooks/useLisResults.ts'
import { emptyFilters, normalizeFilters, type ResultsQuery } from '../state/results.ts'
import { publishResult } from '../api/publish.ts'
import { LisApiError } from '../api/lis.ts'
import { diagnosticLabels } from '../../../middleware-monitor/src/state/presentation.ts'
import { useFlow } from './useFlow.ts'
import { loadFlow, message } from './api.ts'
import { existingPublishNotice, publishFeedback } from './publishFeedback.ts'
import { flowModel, sourceSnapshot, stationLabels, type FlowData } from './model.ts'

export function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    flow: 'M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4',
    lab: 'm10 3 4-1 3 8-4 2zM12 11l-2 1-3-6 3-1M8 9a6 6 0 1 0 9 7M5 21h14M12 18v3M10 15h10',
    search: 'M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    info: 'M12 8v1m0 3v5M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
    stethoscope: 'M5 3H3v5a5 5 0 0 0 10 0V3h-2M8 13v3a5 5 0 0 0 10 0v-3M20 11a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
    tree: 'M4 3h6v6H4zM14 15h6v6h-6zM14 3h6v6h-6zM7 9v9h7M10 6h4',
    hospital: 'M3 3h18v18H3zM12 7v10M7 12h10',
    shield: 'M12 3 3 7v6q0 5 9 9 9-4 9-9V7zM8 12l3 3 5-6',
    evidence: 'M5 3h14v18H5zM8 8h4m-4 4h4m-4 4h4m2-8 1 1 3-3',
    send: 'm3 3 19 9L3 21l4-9zM7 12h15',
    check: 'm5 12 4 4L19 6', close: 'm6 6 12 12M6 18 18 6',
    database: 'M4 6c0-4 16-4 16 0s-16 4-16 0v12c0 4 16 4 16 0V6M4 12c0 4 16 4 16 0',
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.flow} /></svg>
}
export function PanelTitle({ name, title, color, refresh }: { name: string; title: string; color?: string; refresh?: () => void }) {
  return <h2 className="panel-title">{refresh ? <button className={'icon-box ' + (color ?? '')} onClick={refresh} title="Làm mới trạng thái" aria-label="Làm mới trạng thái"><Icon name={name} /></button> : <span className={'icon-box ' + (color ?? '')}><Icon name={name} /></span>}{title}</h2>
}
const show = (v: unknown) => v === null ? 'Không có' : v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v)
const time = (v?: string | null) => v ? v.replace('T', ' ').replace(/Z$/, ' UTC') : '—'
const displayTime = (v?: string | null) => v ? v.slice(0, 16).replace('T', ' ') + (v.endsWith('Z') ? ' UTC' : v.slice(-6)) : '—'
const short = (v: string) => v.length > 22 ? v.slice(0, 8) + '…' + v.slice(-4) : v
const shortId = (v: string) => v.replace(/^MIMIC-/, '')
const eventLabels: Record<string, string> = { RECEIVED: 'Middleware tiếp nhận', CLAIMED: 'Worker nhận xử lý', VALIDATED: 'Nguồn hợp lệ', TRANSFORMED: 'Chuyển đổi FHIR hoàn tất', SENT: 'Gửi tới EMR', TARGET_STORED: 'EMR xác nhận lưu', VERIFY_STARTED: 'Đọc lại từ EMR', DELIVERED: 'Đối soát thành công', REJECTED: 'Giao dịch bị từ chối', FAILED: 'Xử lý thất bại', RETRY_SCHEDULED: 'Đã lên lịch thử lại', VERIFY_MISMATCH: 'Đối soát không khớp', LEASE_RECOVERED: 'Khôi phục sau gián đoạn', RETRY_EXHAUSTED: 'Hết lượt thử tự động' }

function Evidence({ data, sending }: { data: FlowData | null; sending: boolean }) {
  const model = flowModel(data, sending)
  const [chosen, setChosen] = useState<string | null>(null)
  const tab = chosen ?? (model.tone === 'active' || model.tone === 'error' ? 'log' : 'compare')
  const tabs = [['compare', 'So khớp LIS ↔ EMR'], ['json', 'Dữ liệu gốc → FHIR'], ['log', 'Nhật ký sự kiện']]
  const rows = model.rows.filter(r => r.label !== 'Trạng thái')
  const matched = rows.filter(r => r.match === true).length
  const event = data?.publish.event
  const logs = [
    ...(event ? [{ id: 'publish', at: event.published_at, label: 'LIS · Đã lưu yêu cầu phát hành', code: 'OUTBOX' }] : []),
    ...(event?.acked_at ? [{ id: 'ack', at: event.acked_at, label: 'LIS Dispatcher · Middleware đã ACK', code: 'ACK' }] : []),
    ...(data?.detail?.events ?? []).map(e => ({ id: e.log_event_id, at: e.occurred_at, label: eventLabels[e.event_type] ?? e.event_type, code: e.event_type })),
  ].sort((a, b) => a.at.localeCompare(b.at))
  return <section className="stitch-panel evidence-panel">
    <div className="evidence-heading"><PanelTitle name="evidence" title="Bằng chứng" />
      <div className="evidence-tabs" role="tablist" aria-label="Bằng chứng giao dịch">
        {data?.emr && <span className={'flow-badge ' + (model.mismatch ? 'error' : 'done')}>{matched}/{rows.length} TRƯỜNG KHỚP</span>}
        {model.terminal && <span className="flow-badge error">{model.failedStage === 3 ? 'TỪ CHỐI TẠI EMR' : model.label}</span>}
        {tabs.map(([id, label], index) => <button key={id} id={'tab-' + id} role="tab" aria-selected={tab === id} aria-controls={'panel-' + id}
          tabIndex={tab === id ? 0 : -1} onClick={() => setChosen(id)} onKeyDown={e => {
            const next = e.key === 'ArrowRight' ? (index + 1) % tabs.length : e.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null
            if (next !== null) { e.preventDefault(); setChosen(tabs[next][0]); document.getElementById('tab-' + tabs[next][0])?.focus() }
          }}>{label}</button>)}
      </div>
    </div>
    <div id={'panel-' + tab} role="tabpanel" aria-labelledby={'tab-' + tab} tabIndex={0}>
      {tab === 'compare' && <>
        <div className="table-scroll"><table className={'comparison-table ' + (model.delivered ? 'delivered-table' : '')}><thead><tr>{(model.delivered ? ['Trường', 'Giá trị tại LIS / FHIR', 'Giá trị tại EMR', 'Khớp'] : ['Trường dữ liệu', 'Giá trị LIS', 'Giá trị FHIR', 'Giá trị EMR', 'Kết quả khớp']).map(v => <th key={v}>{v}</th>)}</tr></thead>
          <tbody>{rows.map(row => <tr key={row.label}><th scope="row">{row.label}</th><td title={show(row.label.includes('SHA-256') && model.delivered ? row.fhir : row.lis)}>{row.label.includes('SHA-256') ? model.delivered ? short(show(row.fhir)) : '—' : show(row.lis)}</td>{!model.delivered && <td title={show(row.fhir)}>{!data?.detail?.fhir_payload ? '—' : row.label.includes('SHA-256') ? short(show(row.fhir)) : show(row.fhir)}</td>}<td title={show(row.emr)}>{row.label.includes('SHA-256') ? short(show(row.emr)) : show(row.emr)}</td><td><span className={'flow-badge ' + (row.match === null ? 'idle' : row.match ? 'done' : 'error')} aria-label={row.match === null ? 'Chờ dữ liệu' : row.match ? 'Khớp' : 'Không khớp'}>{row.match === null ? 'Chờ dữ liệu' : row.match ? '✓' : '≠ Không khớp'}</span></td></tr>)}</tbody></table></div>
        <div className={'flow-callout comparison-summary ' + (model.mismatch ? 'error' : matched === rows.length ? 'done' : 'idle')} title="Đối chiếu snapshot đã Publish. SHA-256 so sánh FHIR tại Middleware với JSON đọc lại ở EMR.">
          <Icon name="shield" /><span>{data?.emr ? 'SHA-256: ' + short(data.hashes?.fhir ?? '—') : 'ĐỐI SOÁT DỮ LIỆU'}</span><span>{data?.emr ? `${matched}/${rows.length} TRƯỜNG KHỚP` : 'Sẵn sàng nhận dữ liệu đối soát'}</span>
        </div>
      </>}
      {tab === 'json' && <div className="payload-grid">{[['Snapshot từ LIS (JSON)', sourceSnapshot(data)], ['FHIR R4 Observation', data?.detail?.fhir_payload]].map(([label, value]) => <div className="flow-inset" key={String(label)}><h3>{String(label)}</h3><pre>{value ? JSON.stringify(value, null, 2) : 'Chưa có dữ liệu từ API.'}</pre></div>)}</div>}
      {tab === 'log' && <><div className="flow-inset log-heading"><span>NHẬT KÝ SỰ KIỆN · UTC</span><span className={'flow-badge ' + model.tone}>{model.label}</span></div>
        {!logs.length && <p className="flow-empty">Chưa có sự kiện phát hành.</p>}
        <ol className="flow-log">{logs.map(log => <li key={log.id} className={/REJECTED|FAILED|MISMATCH|EXHAUSTED/.test(log.code) ? 'error' : ''}><time title={time(log.at)}>{log.at.slice(11, 23)}</time><span className={'flow-badge ' + (/REJECTED|FAILED|MISMATCH|EXHAUSTED/.test(log.code) ? 'error' : 'done')}>{log.code}</span><span>{log.label}</span></li>)}</ol>
        {data?.attempts && <details className="evidence-technical"><summary>Chi tiết lượt thử và chẩn đoán</summary><div className="table-scroll"><table><thead><tr>{['Pha / lượt', 'Bắt đầu (UTC)', 'HTTP', 'Kết quả / mã lỗi', 'Chi tiết'].map(x => <th key={x}>{x}</th>)}</tr></thead><tbody>{data.attempts.items.map(a => <tr key={a.attempt_id}><td>{a.phase} #{a.attempt_no}</td><td>{time(a.started_at)}</td><td>{a.http_status ?? '—'}</td><td>{a.error_code ?? a.receipt?.result ?? (a.ended_at ? 'Kết thúc lượt' : 'Đang thực hiện')}</td><td>{a.error_code ? diagnosticLabels[a.error_code] ?? a.error_message : a.receipt?.result === 'ALREADY_EXISTS' ? 'Đã có, không tạo trùng' : '—'}</td></tr>)}</tbody></table></div>
          {data.attempts.diagnostics.map(d => <p className="flow-note error-text" key={d.log_event_id}>{time(d.occurred_at)} · {d.error_code} · {diagnosticLabels[d.error_code] ?? d.event_type}</p>)}<p className="flow-note">Thử tiếp theo: {time(data.detail?.next_retry_at ?? event?.next_retry_at)}</p></details>}
      </>}
    </div>
  </section>
}

export function FlowConsole({ resultId = '' }: { resultId?: string }) {
  const [query, setQuery] = useState<ResultsQuery>({ filters: { ...emptyFilters, resultStatus: 'FINAL' }, pageIndex: 0 })
  const [search, setSearch] = useState('')
  const searchTimer = useRef<number | undefined>(undefined)
  const searchInput = useRef<HTMLInputElement>(null)
  const [defaultSelection, setDefaultSelection] = useState('')
  useEffect(() => () => window.clearTimeout(searchTimer.current), [])
  function applySearch(value: string) {
    window.clearTimeout(searchTimer.current)
    setQuery(previous => ({
      filters: normalizeFilters({ ...previous.filters, patientId: '', resultId: '', search: value }),
      pageIndex: 0,
    }))
  }
  function changeSearch(value: string) {
    setSearch(value)
    window.clearTimeout(searchTimer.current)
    if (!value.trim()) applySearch('')
    else searchTimer.current = window.setTimeout(() => applySearch(value), 250)
  }
  const list = useLisResults(query)
  const firstId = list.status === 'success' ? list.items[0]?.result_id ?? '' : ''
  if (!resultId && !defaultSelection && firstId) setDefaultSelection(firstId)
  const selected = resultId || defaultSelection || firstId
  return <div className="flow-console"><FlowSelection selected={selected} list={<>
    <form className="flow-search" role="search" autoComplete="off" onSubmit={e => { e.preventDefault(); applySearch(search) }}>
      <button type="submit" aria-label="Tìm kết quả"><Icon name="search" /></button><label className="sr-only" htmlFor="flow-search">Mã cần tìm</label><input id="flow-search" name="lis-result-filter" type="search" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} ref={searchInput} value={search} onChange={e => changeSearch(e.target.value)} placeholder="Tìm mã bệnh nhân/mã kết quả" />
      {search.length > 0 && <button type="button" className="clear-search" aria-label="Xóa tìm kiếm" title="Xóa tìm kiếm" onClick={() => { changeSearch(''); searchInput.current?.focus() }}><Icon name="close" /></button>}
    </form><div className="list-caption"><span>DANH SÁCH KẾT QUẢ FINAL</span><span className="list-page-controls"><button aria-label="Trang trước" disabled={query.pageIndex === 0} onClick={() => setQuery({ ...query, pageIndex: query.pageIndex - 1 })}>‹</button>{list.status === 'success' ? list.items.length + ' BẢN GHI' : list.status === 'loading' ? 'ĐANG TẢI' : 'LỖI TẢI'}<button aria-label="Trang sau" disabled={list.status !== 'success' || !list.hasNext} onClick={() => setQuery({ ...query, pageIndex: query.pageIndex + 1 })}>›</button></span></div>
    <div className="flow-result-list" aria-label="Chọn kết quả FINAL">
      {list.status === 'loading' && <p role="status">Đang tải kết quả LIS…</p>}
      {list.status === 'error' && <div role="alert"><p>{list.message}</p><button onClick={() => setQuery({ ...query })}>Thử tải lại</button></div>}
      {list.status === 'success' && !list.items.length && <p>Không có kết quả phù hợp.</p>}
      {list.status === 'success' && list.items.map(r => <button className={'flow-result ' + (selected === r.result_id ? 'selected' : '')} key={r.result_id} aria-pressed={selected === r.result_id} onClick={() => { window.location.hash = '#/flow?result_id=' + encodeURIComponent(r.result_id) }}>
        <span className="selection-dot">{selected === r.result_id ? '✓' : ''}</span><span className="result-name"><span className="result-identifiers"><span className="mono" title={r.result_id}>{shortId(r.result_id)}</span><small title={r.patient_id}> · {shortId(r.patient_id)}</small></span><strong>{r.test_name} ({r.test_code})</strong></span><span className="result-quantity">{r.value_num} {r.unit}<span className="flow-badge done">FINAL</span></span>
      </button>)}
    </div><div className="list-divider" />
  </>} /></div>
}

function FlowSelection({ selected, list }: { selected: string; list: React.ReactNode }) {
  const [revision, setRevision] = useState(0)
  const [action, setAction] = useState<{ resultId: string; busy: boolean; sending: boolean; notice: { text: string; error: boolean } | null }>({ resultId: selected, busy: false, sending: false, notice: null })
  const sending = action.resultId === selected && action.sending
  const busy = action.resultId === selected && action.busy
  const notice = action.resultId === selected ? action.notice : null
  const inFlight = useRef<AbortController | null>(null)
  useEffect(() => () => { inFlight.current?.abort(); inFlight.current = null }, [selected])
  const state = useFlow(selected, revision), data = state.data, result = data?.source, event = data?.publish.event
  // Reset per-result interaction state without remounting the scroll container.
  if (action.resultId !== selected) setAction({ resultId: selected, busy: false, sending: false, notice: null })
  const model = flowModel(data, sending)
  const processing = !!event && !model.delivered && !model.terminal && !['BLOCKED', 'FAILED'].includes(event.dispatch_status)
  const canPublish = !!result && result.result_status === 'FINAL' && data?.publish.result_status === 'FINAL' && !event && !busy && !state.loading && !state.error
  async function inspect() {
    if (inFlight.current || busy) return
    const controller = new AbortController(); inFlight.current = controller
    setAction({ resultId: selected, busy: true, sending: false, notice: null })
    try {
      const latest = await loadFlow(selected, AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]))
      if (!controller.signal.aborted) setAction({ resultId: selected, busy: false, sending: false, notice: { error: false, text: existingPublishNotice(latest) + (latest.warnings.length ? ' ' + latest.warnings.join(' ') : '') } })
    } catch (error) {
      if (!controller.signal.aborted) setAction({ resultId: selected, busy: false, sending: false, notice: { error: true, text: 'Không thể kiểm tra trạng thái: ' + message(error) } })
    } finally { if (!controller.signal.aborted) { inFlight.current = null; setRevision(n => n + 1) } }
  }
  async function send() {
    if (!canPublish || inFlight.current) return
    const controller = new AbortController(); inFlight.current = controller
    setAction({ resultId: selected, busy: true, sending: true, notice: null })
    try {
      const response = await publishResult(selected, AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]))
      if (controller.signal.aborted) return
      setAction(prev => ({ ...prev, sending: false }))
      const text = await publishFeedback(response, AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]))
      if (!controller.signal.aborted) setAction({ resultId: selected, busy: false, sending: false, notice: { error: false, text } })
    } catch (error) {
      if (!controller.signal.aborted) {
        const definite = error instanceof LisApiError && [400, 404, 409, 413, 415, 422].includes(error.status)
        setAction({ resultId: selected, busy: false, sending: false, notice: { error: true, text: (definite ? '' : 'Chưa rõ yêu cầu đã được lưu hay chưa. Đang đọc lại trạng thái; không tự gửi lại. ') + message(error) } })
      }
    } finally { if (!controller.signal.aborted) { inFlight.current = null; setRevision(n => n + 1) } }
  }
  return <>
    <div className="flow-columns">
      <section className="stitch-panel lis-panel"><PanelTitle name="lab" title="LIS · Hệ thống xét nghiệm" color="lis" />{list}
        <div className="flow-inset source-detail"><h3>CHI TIẾT XÉT NGHIỆM ĐƯỢC CHỌN</h3>
          {state.loading && <p role="status">Đang tải chi tiết và trạng thái…</p>}
          {!selected && <p>Chọn một kết quả FINAL để bắt đầu.</p>}
          {result && <><dl className="source-facts">{[['RESULT ID', result.result_id], ['PATIENT MRN', result.patient_id], ['MÃ XÉT NGHIỆM', `${result.test_name} (${result.test_code})`], ['TIME SPECIMEN', displayTime(result.effective_at)], ['REFERENCE RANGE', `${result.reference_low ?? '—'} – ${result.reference_high ?? '—'} ${result.unit}`]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={label === 'TIME SPECIMEN' ? result.effective_at ?? undefined : value}>{value}</dd></div>)}</dl>
            <div className="source-value"><div><span className="caps">GIÁ TRỊ XÁC NHẬN</span><strong>{result.value_num} <small>{result.unit}</small></strong></div><span className={'flow-badge ' + (result.result_status === 'FINAL' ? 'done' : 'idle')}>{result.result_status}</span></div></>}
        </div>
        <button className={'dispatch-button ' + (event && !processing ? 'published' : '')} disabled={event ? busy || state.loading : !canPublish} title={event ? 'Đọc lại trạng thái trao đổi từ backend.' : 'Phát hành kết quả FINAL tới EMR'} onClick={() => void (event ? inspect() : send())}><Icon name={sending || processing ? 'flow' : event ? 'check' : 'send'} />{model.delivered ? 'Đã gửi' : sending ? 'Đang gửi…' : processing ? 'Đang xử lý…' : event ? 'Đã phát hành' : 'Gửi sang EMR'}{event?.dispatch_status === 'ACK' && !processing && <span className="flow-badge done">ACK</span>}</button>
        {busy && !sending && <p className="flow-note" role="status">Đang kiểm tra trạng thái…</p>}
        {event && <p className="event-id">Event ID <span className="mono" title={event.event_id}>{short(event.event_id)}</span></p>}
        {notice && <p role={notice.error ? 'alert' : 'status'} className={notice.error ? 'flow-note error-text' : 'flow-note'}>{notice.text}</p>}
      </section>
      <section className="stitch-panel pipeline-panel">
        <div className="pipeline-header"><PanelTitle name="tree" title="Luồng trao đổi" color="middleware" refresh={() => setRevision(n => n + 1)} /><span className={'flow-badge ' + model.tone} data-flow-status={model.label} role="status">TRẠNG THÁI: {model.delivered ? 'THÀNH CÔNG' : model.label === 'REJECTED' ? 'TỪ CHỐI (REJECTED)' : model.tone === 'active' && model.label !== 'CHƯA ĐỦ BẰNG CHỨNG' ? 'ĐANG XỬ LÝ' : model.label}</span></div>
        {(model.delivered || model.terminal || model.failedStage !== null) && <div className={'flow-banner ' + model.tone}><span className="station-icon"><Icon name={model.delivered ? 'shield' : 'info'} /></span><div><strong>{model.delivered ? 'DELIVERED · Đã giao' : model.label + (model.last?.http_status ? ' · Lỗi ' + model.last.http_status : ' · Dừng xử lý')}</strong><small>{model.delivered ? model.total + ' · Exchange ' + short(data?.detail?.exchange_id ?? '') : model.failedStage !== null ? `Trạm ${model.failedStage + 1} · ${model.code ?? 'Xem nhật ký'}` : 'Chưa đủ thông tin xác định trạm lỗi'}</small></div></div>}
        <ol className="flow-stations">{stationLabels.map((label, i) => <li key={label} className={'station ' + model.stages[i]} data-stage={i + 1} data-tone={model.stages[i]}>
          <span className="station-icon"><Icon name={model.stages[i] === 'done' ? 'check' : model.stages[i] === 'error' ? 'close' : ['database', 'flow', 'tree', 'hospital', 'shield'][i]} /></span>
          <div className="station-body"><strong>({i + 1}) {label}</strong><span className="station-caption">{model.captions[i]}</span></div><span className="station-time" title={i === 0 ? 'API không cung cấp thời điểm bắt đầu thao tác Publish để tính thời lượng.' : 'Hiệu giữa hai mốc thời gian từ API'}>{model.timings[i]}</span>
        </li>)}</ol>
        <div className={'flow-callout ' + model.tone}><Icon name={model.delivered ? 'shield' : 'info'} /><span>{model.failedStage !== null ? `Dừng: Trạm (${model.failedStage + 1}) · ${model.code ?? 'Xem nhật ký'}` : model.delivered ? 'Hoàn tất đối soát 5/5 trạm (100%)' : event ? `Đang xử lý qua Middleware · Tiến độ ${model.stages.filter(s => s === 'done').length}/5 trạm hoàn tất` : 'Sẵn sàng kích hoạt luồng truyền · Bấm “Gửi sang EMR” để bắt đầu'}</span></div>
        {state.error && <p className="flow-callout error" role="alert">{state.error}{data && ' Dữ liệu bên dưới là lần đọc trước.'}</p>}
        {data?.warnings.map(w => <p className="flow-callout error" role="alert" key={w}>{w}</p>)}
        {model.mismatch && <p className="flow-callout error" role="alert">Dữ liệu đọc lại hiện tại có sai khác. Xem bảng so khớp; kết quả này tách biệt với lần đối soát backend đã ghi nhận.</p>}
        <div className="flow-inset schema-card"><h3>FHIR R4 OBSERVATION GỬI EMR <span>{data?.detail?.fhir_payload ? '1 Observation' : 'Chưa chuyển đổi'}</span></h3><div>{data?.detail?.fhir_payload ? <><span className="mono">Observation · {data.detail.source_result_id}</span><span className="flow-badge idle">FHIR JSON</span></> : <span>Chưa có dữ liệu chuyển đổi</span>}</div></div>
      </section>
      <section className="stitch-panel emr-panel"><PanelTitle name="hospital" title="EMR · Bệnh án" color={model.terminal ? 'error' : 'emr'} />
        {model.terminal && !data?.emr ? <div className="emr-rejection"><h3><Icon name="info" />{model.failedStage === 3 ? 'EMR từ chối tiếp nhận' : 'Giao dịch chưa hoàn tất'}</h3><dl><div><dt>Bệnh nhân:</dt><dd>{result?.patient_id ?? '—'}</dd></div><div><dt>Trạng thái:</dt><dd>{model.label}</dd></div><div><dt>Mã lỗi:</dt><dd>{model.code ?? 'Chưa xác định'}</dd></div></dl><p>{diagnosticLabels[model.code ?? ''] ?? 'Xem nhật ký và chi tiết trao đổi để xác định nguyên nhân.'}</p></div> : <>
        <div className="flow-inset patient-card"><div className="patient-heading"><h3>Hồ sơ bệnh nhân</h3><span className="mono">{result?.patient_id ?? 'Chưa chọn kết quả'}</span></div><p>Theo bệnh nhân của kết quả đang chọn</p><div className="patient-link"><span className="caps">LIÊN KẾT ĐỊNH DANH</span><p className="mono">{data?.emr ? <span className="patient-label" title={data.emr.patient.display_label ?? data.emr.patient.patient_key}>{result?.patient_id} → hồ sơ EMR</span> : 'Chưa xác minh liên kết EMR'}</p></div></div>
        {data?.emr ? <div className="emr-result"><div className="emr-result-heading"><h3>{data.emr.result.analyte_display ?? data.emr.result.analyte_code}</h3><span className="flow-badge done">{data.emr.result.clinical_status}</span></div><div className="source-value"><div><span className="caps">KẾT QUẢ ĐÃ GHI NHẬN</span><strong>{data.emr.result.quantity} <small>{data.emr.result.unit_text}</small></strong></div></div><dl className="source-facts"><div><dt>KHOẢNG THAM CHIẾU</dt><dd>{data.emr.result.low ?? '—'} – {data.emr.result.high ?? '—'}</dd></div><div><dt>THỜI GIAN NHẬN</dt><dd title={data.emr.result.stored_at}>{displayTime(data.emr.result.stored_at)}</dd></div></dl><div className="emr-result-footer"><span>Nguồn: LIS · {data.emr.result.external_id}</span><span className="stored-label">Đã lưu EMR</span></div></div>
          : <div className="emr-empty"><span className="station-icon"><Icon name="stethoscope" /></span><strong>Chờ kết quả từ LIS</strong><p>{data?.detail?.target_stored_at ? 'Chưa đọc lại được kết quả từ EMR.' : 'Chưa nhận kết quả xét nghiệm này'}</p><span className="flow-badge idle">CHỜ DỮ LIỆU</span></div>}
        </>}
      </section>
    </div>
    <Evidence key={selected} data={data} sending={sending} />
  </>
}
