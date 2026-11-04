import { useEffect, useState } from 'react'
import { parseResultsHash } from '../state/routes.ts'

export function useResultsRoute() {
  const [route, setRoute] = useState(() => parseResultsHash(window.location.hash))
  useEffect(() => {
    const onHashChange = () => setRoute(parseResultsHash(window.location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  function navigate(hash: string) {
    if (window.location.hash !== hash) window.history.pushState(null, '', hash)
    // Cùng URL vẫn tạo truy vấn mới cho Tìm kiếm / Xóa bộ lọc / Thử tải lại.
    setRoute(parseResultsHash(hash))
  }
  return { route, navigate }
}
