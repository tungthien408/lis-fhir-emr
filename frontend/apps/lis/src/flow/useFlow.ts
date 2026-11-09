import { useEffect, useMemo, useState } from 'react'
import { loadFlow, message } from './api.ts'
import { flowModel, type FlowData } from './model.ts'

export function useFlow(resultId: string, revision: number) {
  const request = useMemo(() => ({ resultId, revision }), [resultId, revision])
  const [loaded, setLoaded] = useState<{ request: object; data: FlowData | null; error: string | null; paused: boolean } | null>(null)
  useEffect(() => {
    if (!request.resultId) return
    const controller = new AbortController()
    let inFlight = false, stopped = false
    const started = Date.now()
    async function poll() {
      if (controller.signal.aborted || inFlight || stopped || document.visibilityState === 'hidden') return
      if (Date.now() - started > 120_000) {
        stopped = true
        setLoaded(prev => ({ request, data: prev?.request === request ? prev.data : null,
          error: 'Đã dừng tự cập nhật sau 2 phút. Làm mới để tiếp tục theo dõi; giao dịch vẫn do backend xử lý.', paused: true }))
        return
      }
      inFlight = true
      try {
        const data = await loadFlow(request.resultId, AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]))
        if (controller.signal.aborted) return
        setLoaded({ request, data, error: null, paused: false })
        const model = flowModel(data)
        stopped = !data.warnings.length && (!data.publish.published || model.delivered || model.terminal || ['BLOCKED', 'FAILED'].includes(data.publish.event?.dispatch_status ?? ''))
      } catch (error) {
        if (!controller.signal.aborted) setLoaded(prev => ({ request, data: prev?.request === request ? prev.data : null,
          error: message(error), paused: false }))
      } finally { inFlight = false }
    }
    const timer = window.setInterval(() => void poll(), 1200)
    const visible = () => { if (document.visibilityState === 'visible') void poll() }
    document.addEventListener('visibilitychange', visible)
    void poll()
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [request])
  return loaded?.request === request ? { ...loaded, loading: false } : { data: null, error: null, paused: false, loading: !!resultId }
}
