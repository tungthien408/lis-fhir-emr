import { useEffect, useState } from 'react'
import { getLisResult, LisApiError } from '../api/lis.ts'
import type { LisResult } from '../types/lis.ts'

type LoadedResult =
  | { request: object; status: 'success'; result: LisResult }
  | { request: object; status: 'error'; message: string; retryable: boolean }

export function useLisResult(request: { resultId: string }) {
  const [loaded, setLoaded] = useState<LoadedResult | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const result = await getLisResult(request.resultId, controller.signal)
        if (!controller.signal.aborted) setLoaded({ request, status: 'success', result })
      } catch (error) {
        if (!controller.signal.aborted) setLoaded({
          request, status: 'error',
          message: error instanceof Error ? error.message : 'Không thể tải chi tiết kết quả từ LIS.',
          retryable: !(error instanceof LisApiError) || ![400, 404].includes(error.status),
        })
      }
    }
    void load()
    return () => controller.abort()
  }, [request])
  if (loaded?.request !== request) return { status: 'loading' as const }
  return loaded
}
