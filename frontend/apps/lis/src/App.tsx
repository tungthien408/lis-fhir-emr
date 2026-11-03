import { useReducer, useState } from 'react'
import { ResultFilters } from './components/ResultFilters.tsx'
import { ResultsTable } from './components/ResultsTable.tsx'
import { ResultsPagination } from './components/ResultsPagination.tsx'
import { useLisResults } from './hooks/useLisResults.ts'
import { emptyFilters, initialQuery, resultsQueryReducer } from './state/results.ts'
import './App.css'

function App() {
  const [draftFilters, setDraftFilters] = useState({ ...emptyFilters })
  const [query, dispatch] = useReducer(resultsQueryReducer, initialQuery)
  const results = useLisResults(query)

  function resetFilters() {
    setDraftFilters({ ...emptyFilters })
    dispatch({ type: 'reset' })
  }

  return (
    <main className="app-container">
      <header className="page-header">
        <h1>Hệ thống thông tin xét nghiệm – LIS</h1>
        <p>Danh sách kết quả xét nghiệm từ hệ thống LIS</p>
      </header>

      <section className="results-section" aria-labelledby="results-heading">
        <h2 id="results-heading">Danh sách kết quả xét nghiệm</h2>
        <ResultFilters values={draftFilters} onChange={setDraftFilters}
          onSearch={() => dispatch({ type: 'search', filters: draftFilters })}
          onReset={resetFilters} />

        <div className="results-content" aria-busy={results.status === 'loading'}>
          {results.status === 'loading' && (
            <p className="results-feedback" role="status">Đang tải dữ liệu...</p>
          )}
          {results.status === 'error' && (
            <div className="results-feedback error-message" role="alert">
              <p>{results.message}</p>
              <button type="button" onClick={() => dispatch({ type: 'retry' })}>Thử tải lại</button>
            </div>
          )}
          {results.status === 'success' && (
            results.items.length === 0
              ? <p className="results-feedback" role="status">Không có kết quả xét nghiệm phù hợp.</p>
              : <ResultsTable results={results.items} />
          )}
        </div>

        <ResultsPagination pageIndex={query.pageIndex} loading={results.status === 'loading'}
          hasNext={results.status === 'success' && results.hasNext}
          onPrevious={() => dispatch({ type: 'previous' })}
          onNext={() => dispatch({ type: 'next' })} />
      </section>
    </main>
  )
}

export default App
