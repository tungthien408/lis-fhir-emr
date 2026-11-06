import { useEffect, useMemo, useState } from 'react'
export function useRead<T>(key: string, load: (signal: AbortSignal) => Promise<T>, revision: number, enabled = true) {
  const request = useMemo(() => ({ key, load, revision, enabled }), [key, load, revision, enabled])
  const [loaded, setLoaded] = useState<{ request: object; data: T | null; error: string | null } | null>(null)
  useEffect(() => {
    if (!request.enabled) return
    const controller = new AbortController()
    void request.load(controller.signal).then(data => { if (!controller.signal.aborted) setLoaded({ request, data, error: null }) })
      .catch(error => { if (!controller.signal.aborted) setLoaded({ request, data: null, error: error instanceof Error ? error.message : 'Không tải được dữ liệu.' }) })
    return () => controller.abort()
  }, [request])
  return loaded?.request === request ? { ...loaded, loading: false } : { data: null, error: null, loading: enabled }
}
