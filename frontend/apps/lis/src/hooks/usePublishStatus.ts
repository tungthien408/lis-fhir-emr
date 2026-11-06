import { useEffect, useMemo, useState } from 'react'
import { getExchangeStatus, getResultPublishState } from '../api/publish.ts'
import type { ExchangeStatus, PublishState } from '../types/publish.ts'

type Loaded = { request: object; data: PublishState | null; exchange: ExchangeStatus | null; error: string | null; warning: string | null }
export function usePublishStatus(resultId: string, revision: number) {
  const request = useMemo(() => ({ resultId, revision }), [resultId, revision])
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined, inFlight = false
    async function load() {
      if (controller.signal.aborted || inFlight) return
      if (document.visibilityState === 'hidden') { timer = setTimeout(() => void load(), 5000); return }
      inFlight = true
      let next = true
      try {
        const data = await getResultPublishState(request.resultId, controller.signal)
        let exchange: ExchangeStatus | null = null, warning: string | null = null
        if (data.event?.exchange_id) {
          try { exchange = await getExchangeStatus(data.event, controller.signal) }
          catch (error) { warning = error instanceof Error ? error.message : 'Chưa xác minh trạng thái middleware.' }
        }
        if (controller.signal.aborted) return
        setLoaded({ request, data, exchange, error: null, warning })
        const terminal = data.event && ['ACK', 'BLOCKED', 'FAILED'].includes(data.event.dispatch_status)
        const exchangeDone = !data.event?.exchange_id || (exchange && ['DELIVERED', 'REJECTED', 'FAILED'].includes(exchange.status))
        next = !terminal || !exchangeDone
      } catch (error) {
        if (!controller.signal.aborted) setLoaded((previous) => ({ request,
          data: previous?.data?.result_id === request.resultId ? previous.data : null,
          exchange: null, warning: null,
          error: error instanceof Error ? error.message : 'Không thể tải trạng thái Publish.',
        }))
      } finally {
        inFlight = false
        if (!controller.signal.aborted && next) timer = setTimeout(() => void load(), 5000)
      }
    }
    const visible = () => { if (document.visibilityState === 'visible') { clearTimeout(timer); void load() } }
    document.addEventListener('visibilitychange', visible)
    void load()
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', visible) }
  }, [request])
  if (loaded?.request !== request) return { loading: true, data: null, exchange: null, error: null, warning: null }
  return { ...loaded, loading: false }
}
