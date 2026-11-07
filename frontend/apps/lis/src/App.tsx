import { useState } from 'react'
import { ResultFilters } from './components/ResultFilters.tsx'
import { ResultsTable } from './components/ResultsTable.tsx'
import { ResultsPagination } from './components/ResultsPagination.tsx'
import { ResultDetail } from './components/ResultDetail.tsx'
import { useLisResults } from './hooks/useLisResults.ts'
import { useResultsRoute } from './hooks/useResultsRoute.ts'
import { emptyFilters, initialQuery, normalizeFilters, resultsQueryReducer, type ResultsQuery } from './state/results.ts'
import { resultsHash } from './state/routes.ts'
import './App.css'

function ResultsList({ query, navigate }: { query: ResultsQuery; navigate: (hash: string) => void }) {
  const [draftFilters, setDraftFilters] = useState({ ...query.filters })
  const results = useLisResults(query)

  function changeQuery(action: Parameters<typeof resultsQueryReducer>[1]) {
    navigate(resultsHash(resultsQueryReducer(query, action)))
  }

  function resetFilters() {
    setDraftFilters({ ...emptyFilters })
    changeQuery({ type: 'reset' })
  }

  return (
    <section className="results-section" aria-labelledby="results-heading">
      <h2 id="results-heading">Danh sách kết quả xét nghiệm</h2>
      <ResultFilters values={draftFilters} onChange={setDraftFilters}
        onSearch={() => {
          const filters = normalizeFilters(draftFilters)
          setDraftFilters(filters)
          changeQuery({ type: 'search', filters })
        }}
        onReset={resetFilters} />
      <div className="results-content" aria-busy={results.status === 'loading'}>
        {results.status === 'loading' && <p className="results-feedback" role="status">Đang tải dữ liệu...</p>}
        {results.status === 'error' && (
          <div className="results-feedback error-message" role="alert">
            <p>{results.message}</p>
            <button type="button" onClick={() => changeQuery({ type: 'retry' })}>Thử tải lại</button>
          </div>
        )}
        {results.status === 'success' && (
          results.items.length === 0
            ? <p className="results-feedback" role="status">Không có kết quả xét nghiệm phù hợp.</p>
            : <>
              <p className="search-summary" role="status">Đã tải {results.items.length} kết quả{query.filters.resultId ? ' theo mã kết quả' : ' trên trang này'}.</p>
              <ResultsTable results={results.items} onDetail={(id) => navigate(resultsHash(query, id))} />
            </>
        )}
      </div>
      {!query.filters.resultId && <ResultsPagination pageIndex={query.pageIndex} loading={results.status === 'loading'}
        hasNext={results.status === 'success' && results.hasNext}
        onPrevious={() => changeQuery({ type: 'previous' })}
        onNext={() => changeQuery({ type: 'next' })} />}
    </section>
  )
}

function App() {
  const { route, navigate } = useResultsRoute()
  return (
    <main className="app-container">
      <header className="page-header">
        <h1>Hệ thống thông tin xét nghiệm – LIS</h1>
        <p>{route.kind === 'detail' ? 'Chi tiết kết quả xét nghiệm từ hệ thống LIS' : 'Danh sách kết quả xét nghiệm từ hệ thống LIS'}</p>
      </header>
      {route.kind === 'list' && <ResultsList key={JSON.stringify(route.query.filters)} query={route.query} navigate={navigate} />}
      {route.kind === 'detail' && <ResultDetail key={route.resultId} resultId={route.resultId}
        onBack={() => navigate(resultsHash(route.query))} />}
      {route.kind === 'invalid' && <section className="results-section">
        <div className="results-feedback error-message" role="alert"><p>{route.message}</p></div>
        <button type="button" onClick={() => navigate(resultsHash(initialQuery))}>Về danh sách mặc định</button>
      </section>}
    </main>
  )
}

export default App
