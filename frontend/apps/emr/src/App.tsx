import { useMemo, useState, useSyncExternalStore } from 'react'
import { readRoute, routeHash } from './state/routes.ts'
import { ProfileView, ResultView, SearchView } from './components/Views.tsx'
import type { Route } from './types/emr.ts'
function subscribe(callback: () => void) {
  window.addEventListener('hashchange', callback)
  return () => window.removeEventListener('hashchange', callback)
}
const snapshot = () => window.location.hash
export default function App() {
  const hash = useSyncExternalStore(subscribe, snapshot),
    route = useMemo(() => readRoute(hash), [hash])
  const [revision, setRevision] = useState(0),
    refresh = () => setRevision((x) => x + 1)
  const navigate = (target: Exclude<Route, { kind: 'invalid' }>) => {
    const next = routeHash(target)
    if (next === window.location.hash) refresh()
    else window.location.hash = next
  }
  return (
    <main>
      <header className="app-header">
        <div className="brand-mark" aria-hidden="true">
          +
        </div>
        <div>
          <p className="eyebrow">HỆ THỐNG EMR</p>
          <h1>Bệnh án điện tử</h1>
          <p>Tìm bệnh nhân, xem hồ sơ và đọc kết quả xét nghiệm.</p>
        </div>
      </header>
      <nav className="workflow" aria-label="Các bước sử dụng">
        <ol>
          {['Tra cứu bệnh nhân', 'Xem hồ sơ', 'Xem kết quả xét nghiệm'].map((label, index) => (
            <li key={label} aria-current={index === (route.kind === 'profile' ? 1 : route.kind === 'result' ? 2 : 0) ? 'step' : undefined}>
              <span>{index + 1}</span>
              {label}
            </li>
          ))}
        </ol>
      </nav>
      {route.kind === 'search' && (
        <SearchView key={routeHash(route)} route={route} revision={revision} navigate={navigate} refresh={refresh} />
      )}
      {route.kind === 'profile' && <ProfileView route={route} revision={revision} navigate={navigate} refresh={refresh} />}
      {route.kind === 'result' && <ResultView route={route} revision={revision} navigate={navigate} refresh={refresh} />}
      {route.kind === 'invalid' && (
        <section className="feedback error" role="alert">
          <p>URL hoặc định danh không hợp lệ. Kiểm tra mã kết quả, khóa hồ sơ bệnh nhân và số trang.</p>
          <button onClick={() => navigate({ kind: 'search', search: { mode: 'source', value: '' } })}>Về tra cứu</button>
        </section>
      )}
      <footer>Hồ sơ mô phỏng phục vụ học tập và thực nghiệm.</footer>
    </main>
  )
}
