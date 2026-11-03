import { useEffect, useState } from 'react'
import { getLisResults } from '../api/lis.ts'
import { PAGE_SIZE, resultsPage, type ResultsQuery } from '../state/results.ts'
import type { LisResult } from '../types/lis.ts'

type LoadedResults =
  | { query: ResultsQuery; status: 'success'; items: LisResult[]; hasNext: boolean }
  | { query: ResultsQuery; status: 'error'; message: string }

export function useLisResults(query: ResultsQuery) {
  const [loaded, setLoaded] = useState<LoadedResults | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function loadResults() {
      try {
        const data = await getLisResults({
          limit: PAGE_SIZE + 1,
          offset: query.pageIndex * PAGE_SIZE,
          patientId: query.filters.patientId,
          testCode: query.filters.testCode,
          resultStatus: query.filters.resultStatus || undefined,
          signal: controller.signal,
        })
        if (!controller.signal.aborted) {
          setLoaded({ query, status: 'success', ...resultsPage(data.items) })
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setLoaded({
            query,
            status: 'error',
            message: error instanceof Error ? error.message : 'Không thể tải dữ liệu từ LIS.',
          })
        }
      }
    }

    void loadResults()
    return () => controller.abort()
  }, [query])

  // Kết quả luôn gắn với truy vấn đã tạo ra nó, kể cả trước khi cleanup chạy.
  if (loaded?.query !== query) return { status: 'loading' as const }
  return loaded
}
