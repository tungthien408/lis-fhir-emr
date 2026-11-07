import { statusLabels } from '../state/presentation.ts'
import { useState, type FormEvent } from 'react'
import { useExchangeList } from '../hooks/useExchanges.ts'
import { identifier, routeHash, uuid } from '../state/routes.ts'
import { emptyQuery, statuses, type Query } from '../types/exchange.ts'
import { Badge, Feedback, Timestamp } from './Common.tsx'
export function ExchangeList({
  query,
  revision,
  navigate,
  refresh,
}: {
  query: Query
  revision: number
  navigate: (hash: string) => void
  refresh: () => void
}) {
  const [source, setSource] = useState(query.source_result_id),
    [status, setStatus] = useState(query.status)
  const [exchangeId, setExchangeId] = useState(''),
    [idError, setIdError] = useState('')
  const data = useExchangeList(query, revision)
  function search(e: FormEvent) {
    e.preventDefault()
    if (source && !identifier(source)) return
    navigate(routeHash({ source_result_id: source, status, page: 1 }))
  }
  function openId(e: FormEvent) {
    e.preventDefault()
    const id = exchangeId.trim()
    if (!uuid.test(id)) {
      setIdError('Exchange ID phải là UUID dạng 8-4-4-4-12.')
      return
    }
    setIdError('')
    navigate(routeHash(query, id.toLowerCase()))
  }
  return (
    <>
      <section className="card search-card" aria-labelledby="search-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">THEO DÕI MIDDLEWARE</p>
            <h2 id="search-heading">Danh sách giao dịch</h2>
          </div>
          <button onClick={refresh} disabled={data.loading}>
            Làm mới
          </button>
        </div>
        <form className="filters" onSubmit={search}>
          <label>
            Mã kết quả nguồn
            <input
              id="source-result-id"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="Nhập chính xác mã kết quả"
              autoComplete="off"
            />
          </label>
          <label>
            Trạng thái Middleware
            <select id="exchange-status" value={status} onChange={(e) => setStatus(e.target.value as Query['status'])}>
              <option value="">Tất cả trạng thái</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {statusLabels[s]} · {s}
                </option>
              ))}
            </select>
          </label>
          <div className="actions">
            <button className="primary" type="submit">
              Tìm kiếm
            </button>
            <button
              type="button"
              onClick={() => {
                setSource('')
                setStatus('')
                navigate(routeHash(emptyQuery))
              }}
            >
              Xóa bộ lọc
            </button>
          </div>
        </form>
        {source && !identifier(source) && (
          <p className="error-text" role="alert">
            Mã kết quả không được chỉ có khoảng trắng hoặc chứa ký tự điều khiển.
          </p>
        )}
        <form className="direct-lookup" onSubmit={openId}>
          <label htmlFor="exchange-id">Mở trực tiếp theo Exchange ID</label>
          <div>
            <input
              id="exchange-id"
              value={exchangeId}
              onChange={(e) => {
                setExchangeId(e.target.value)
                setIdError('')
              }}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              autoComplete="off"
            />
            <button type="submit">Mở giao dịch</button>
          </div>
          {idError && (
            <p className="error-text" role="alert">
              {idError}
            </p>
          )}
        </form>
      </section>
      <section className="card results-card" aria-label="Kết quả giao dịch" aria-busy={data.loading}>
        <div className="table-title">
          <h2>Giao dịch trao đổi</h2>
          <span className="muted">20 dòng / trang · Thời gian UTC</span>
        </div>
        <Feedback loading={data.loading} error={data.error} retry={refresh} />
        {!data.loading &&
          !data.error &&
          (data.items.length ? (
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Bảng giao dịch, có thể cuộn ngang">
              <table>
                <thead>
                  <tr>
                    {[
                      'Mã kết quả nguồn',
                      'Trạng thái Middleware',
                      'Hệ thống nguồn',
                      'Exchange ID',
                      'Event ID',
                      'Pha thử lại',
                      'SEND / VERIFY',
                      'Tiếp nhận (UTC)',
                      'Thử tiếp theo (UTC)',
                      'Thao tác',
                    ].map((h) => (
                      <th key={h} scope="col">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.exchange_id}>
                      <td className="source-id">{item.source_result_id}</td>
                      <td>
                        <Badge status={item.status} />
                      </td>
                      <td>{item.source_system}</td>
                      <td className="mono">{item.exchange_id}</td>
                      <td className="mono">{item.event_id}</td>
                      <td>{item.retry_phase ?? '—'}</td>
                      <td>
                        {item.send_attempt_count} / {item.verify_attempt_count}
                      </td>
                      <td>
                        <Timestamp value={item.received_at} />
                      </td>
                      <td>
                        <Timestamp value={item.next_retry_at} />
                      </td>
                      <td>
                        <button onClick={() => navigate(routeHash(query, item.exchange_id))}>Xem chi tiết</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty" role="status">
              <strong>Không có giao dịch Middleware khớp bộ lọc</strong>
              <p>Điều này không khẳng định kết quả tại LIS chưa được Publish.</p>
            </div>
          ))}
        <nav className="pagination" aria-label="Phân trang">
          <p>Trang {query.page}</p>
          <div className="actions">
            <button disabled={data.loading || query.page === 1} onClick={() => navigate(routeHash({ ...query, page: query.page - 1 }))}>
              Trang trước
            </button>
            <button
              disabled={data.loading || !!data.error || !data.hasNext}
              onClick={() => navigate(routeHash({ ...query, page: query.page + 1 }))}
            >
              Trang sau
            </button>
          </div>
        </nav>
      </section>
    </>
  )
}
