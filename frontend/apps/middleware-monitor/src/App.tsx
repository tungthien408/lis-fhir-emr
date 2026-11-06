import { useMemo, useState, useSyncExternalStore } from 'react'
import { readRoute, routeHash } from './state/routes.ts'
import { ExchangeList } from './components/ExchangeList.tsx'
import { ExchangeDetail } from './components/ExchangeDetail.tsx'
function subscribe(callback: () => void) { window.addEventListener('hashchange', callback); return () => window.removeEventListener('hashchange', callback) }
const snapshot = () => window.location.hash
export default function App() {
  const hash = useSyncExternalStore(subscribe, snapshot), route = useMemo(() => readRoute(hash), [hash])
  const [revision, setRevision] = useState(0)
  const refresh = () => setRevision(n => n + 1)
  const navigate = (next: string) => { if (next === window.location.hash) refresh(); else window.location.hash = next }
  return <main>
    <header className="app-header"><div className="brand-mark" aria-hidden="true">↔</div><div><p className="eyebrow">LIS → MIDDLEWARE → EMR</p><h1>Giám sát trao đổi</h1><p>Theo dõi tiếp nhận, chuyển giao và xác minh kết quả xét nghiệm.</p></div><span className="read-only">Exchange Monitor</span></header>
    {route.kind === 'list' && <ExchangeList key={routeHash(route.query)} query={route.query} revision={revision} navigate={navigate} refresh={refresh} />}
    {route.kind === 'detail' && <ExchangeDetail key={route.id} id={route.id} revision={revision} back={() => navigate(routeHash(route.query))} refresh={refresh} />}
    {route.kind === 'invalid' && <section className="card feedback error" role="alert"><p>{route.message}</p><button onClick={() => navigate(routeHash())}>Về danh sách mặc định</button></section>}
    <footer>Trạng thái Middleware được theo dõi riêng với trạng thái nguồn LIS và Dispatcher. Không có thao tác gửi lại thủ công.</footer>
  </main>
}
