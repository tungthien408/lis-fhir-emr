import { useEffect, useState, useSyncExternalStore } from 'react'
import { FlowConsole, Icon } from './flow/FlowConsole.tsx'
import { readFlowRoute } from './flow/routes.ts'
import './flow/fonts.css'
import './index.css'
import './flow/stitch.css'

function subscribe(callback: () => void) { window.addEventListener('hashchange', callback); return () => window.removeEventListener('hashchange', callback) }
const snapshot = () => window.location.hash
function Health() {
  const [services, setServices] = useState<Record<string, boolean | null>>({ lis: null, middleware: null, emr: null })
  useEffect(() => {
    const controller = new AbortController()
    let busy = false
    async function check() {
      if (busy || document.visibilityState === 'hidden') return
      busy = true
      const values = await Promise.all(['lis', 'middleware', 'emr'].map(async service => {
        try {
          const res = await fetch('/status/' + service + '/ready', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) })
          const body = await res.json()
          return [service, res.ok && body.service === service && body.status === 'ready'] as const
        } catch { return [service, false] as const }
      }))
      if (!controller.signal.aborted) setServices(Object.fromEntries(values))
      busy = false
    }
    void check()
    const timer = setInterval(() => void check(), 15_000)
    document.addEventListener('visibilitychange', check)
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', check) }
  }, [])
  const ready = Object.values(services).every(Boolean)
  return <span className={'health-summary flow-badge ' + (ready ? 'done' : 'idle')}>{ready ? '● Tất cả dịch vụ sẵn sàng' : Object.values(services).some(v => v === false) ? 'Có dịch vụ chưa sẵn sàng' : 'Đang kiểm tra kết nối'}</span>
}
export default function App() {
  const hash = useSyncExternalStore(subscribe, snapshot)
  const { resultId, invalid, redirect } = readFlowRoute(hash)
  useEffect(() => {
    if (redirect || window.location.pathname !== '/' || window.location.search) {
      window.history.replaceState(null, '', '/' + (redirect ? '#/flow' : hash || '#/flow'))
      window.dispatchEvent(new Event('hashchange'))
    }
  }, [hash, redirect])
  return <>
    <a className="skip-link" href="#main-content" onClick={e => { e.preventDefault(); document.getElementById('main-content')?.focus() }}>Bỏ qua điều hướng</a>
    <header className="stitch-header"><div className="header-inner"><div className="stitch-brand"><span className="icon-box lis" aria-hidden="true"><Icon name="flow" /></span><a href="#/flow"><h1>Trao đổi kết quả xét nghiệm LIS → FHIR → EMR</h1><small>Đồ án chuyên ngành · Demo luồng dữ liệu thật</small></a></div><Health /></div></header>
    <main id="main-content" className="stitch-main" tabIndex={-1}>
      {invalid ? <section className="stitch-panel"><p role="alert">URL hoặc mã kết quả không hợp lệ.</p><a href="#/flow">Về luồng trao đổi</a></section> : <FlowConsole resultId={resultId} />}
    </main><footer className="stitch-footer">JSON → FHIR R4 Observation → EMR</footer>
  </>
}
