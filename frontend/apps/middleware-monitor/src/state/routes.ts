import { emptyQuery, statuses, type Query } from '../types/exchange.ts'
export const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
export function identifier(v: string) { return v.trim().length > 0 && !Array.from(v).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) }
// Normalize search input only; never rewrite exchange identities returned by the API.
export function normalizeSourceResultId(input: string) {
  const value = input.trim()
  return /^MIMIC-LAB-[0-9]+$/i.test(value) ? value.toUpperCase() : value
}
export type Route = { kind: 'list'; query: Query } | { kind: 'detail'; query: Query; id: string } | { kind: 'invalid'; message: string }
export function readRoute(hash: string): Route {
  try {
    const value = hash.replace(/^#/, '') || '/exchanges'
    const split = value.indexOf('?'), path = split < 0 ? value : value.slice(0, split), raw = split < 0 ? '' : value.slice(split + 1)
    decodeURIComponent(raw.replace(/\+/g, ' ')) // Reject broken escapes; URLSearchParams would silently repair them.
    const params = new URLSearchParams(raw), seen = new Set<string>()
    for (const [key] of params) { if (!['source_result_id', 'status', 'page'].includes(key) || seen.has(key)) throw new Error(); seen.add(key) }
    const source_result_id = params.get('source_result_id') ?? '', status = params.get('status') ?? ''
    const pageText = params.get('page') ?? '1', page = Number(pageText)
    if ((params.has('source_result_id') && !identifier(source_result_id)) || (params.has('status') && !statuses.some(s => s === status))
      || !/^[1-9]\d*$/.test(pageText) || !Number.isSafeInteger(page) || !Number.isSafeInteger((page - 1) * 20)) throw new Error()
    const query = { source_result_id: normalizeSourceResultId(source_result_id), status, page } as Query
    if (path === '/exchanges') return { kind: 'list', query }
    const match = /^\/exchanges\/([^/]+)$/.exec(path), id = match ? decodeURIComponent(match[1]) : ''
    if (!uuid.test(id)) throw new Error()
    return { kind: 'detail', query, id: id.toLowerCase() }
  } catch { return { kind: 'invalid', message: 'URL hoặc Exchange ID không hợp lệ. Chỉ dùng hai bộ lọc được hỗ trợ và số trang nguyên dương.' } }
}
export function routeHash(query: Query = emptyQuery, id?: string) {
  const params = new URLSearchParams()
  const source = normalizeSourceResultId(query.source_result_id)
  if (source) params.set('source_result_id', source)
  if (query.status) params.set('status', query.status)
  if (query.page !== 1) params.set('page', String(query.page))
  return '#/exchanges' + (id ? '/' + encodeURIComponent(id) : '') + (params.size ? '?' + params : '')
}
