import { useEffect, useMemo, useState } from 'react'
import { getAttempts, getDetail, listExchanges, sameExchange } from '../api/exchanges.ts'
import type { Attempts, Detail, Query, Summary } from '../types/exchange.ts'
const terminal = (d: Detail) => ['DELIVERED', 'REJECTED', 'FAILED'].includes(d.status)
export function useExchangeList(query: Query, revision: number) {
  const request = useMemo(() => ({ query, revision }), [query, revision])
  const [loaded, setLoaded] = useState<{ request: object; items: Summary[]; hasNext: boolean; error: string | null } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void listExchanges(request.query, controller.signal).then(data => {
      if (!controller.signal.aborted) setLoaded({ request, ...data, error: null })
    }).catch(error => { if (!controller.signal.aborted) setLoaded({ request, items: [], hasNext: false, error: error instanceof Error ? error.message : 'Không tải được danh sách.' }) })
    return () => controller.abort()
  }, [request])
  return loaded?.request === request ? { ...loaded, loading: false } : { loading: true, items: [], hasNext: false, error: null }
}
export function useExchangeDetail(id: string, revision: number) {
  const request = useMemo(() => ({ id, revision }), [id, revision])
  const [loaded, setLoaded] = useState<{ request: object; data: Detail | null; attempts: Attempts | null; error: string | null; warning: string | null } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined, inFlight = false, latest: Detail | null = null
    async function load() {
      if (controller.signal.aborted || inFlight) return
      if (document.visibilityState === 'hidden') { timer = setTimeout(() => void load(), 5000); return }
      inFlight = true
      let next = false
      try {
        const [detail, history] = await Promise.allSettled([getDetail(request.id, controller.signal), getAttempts(request.id, controller.signal)])
        if (controller.signal.aborted) return
        if (detail.status === 'rejected') throw detail.reason
        latest = detail.value
        let attempts: Attempts | null = null, warning: string | null = null
        if (history.status === 'fulfilled' && sameExchange(latest, history.value)) attempts = history.value
        else warning = history.status === 'rejected' ? String(history.reason instanceof Error ? history.reason.message : history.reason) : 'Lịch sử không khớp định danh giao dịch. Chưa xác minh.'
        setLoaded({ request, data: latest, attempts, error: null, warning })
        next = !terminal(latest) || warning !== null
      } catch (error) {
        if (!controller.signal.aborted) setLoaded({ request, data: null, attempts: null, warning: null, error: error instanceof Error ? error.message : 'Không tải được chi tiết.' })
        next = latest !== null && !terminal(latest)
      } finally { inFlight = false; if (!controller.signal.aborted && next) timer = setTimeout(() => void load(), 5000) }
    }
    const visible = () => { if (document.visibilityState === 'visible') { clearTimeout(timer); void load() } }
    document.addEventListener('visibilitychange', visible); void load()
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', visible) }
  }, [request])
  return loaded?.request === request ? { ...loaded, loading: false } : { loading: true, data: null, attempts: null, error: null, warning: null }
}
