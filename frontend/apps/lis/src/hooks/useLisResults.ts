import { useEffect, useState } from 'react'
import { searchLisResults } from '../api/searchResults.ts'
import type { ResultsQuery } from '../state/results.ts'
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
        const data = await searchLisResults(query, controller.signal)
        if (!controller.signal.aborted) {
          setLoaded({ query, status: 'success', ...data })
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
