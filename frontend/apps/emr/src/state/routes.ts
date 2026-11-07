import { emptySearch, type Route, type Search } from '../types/emr.ts'
export const uuid = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
export const identifier = (v: string) => !!v.trim() && !Array.from(v).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
export function normalizeInput(value: string, kind: 'patient' | 'result') {
  const trimmed = value.trim(), pattern = kind === 'patient' ? /^MIMIC-P-[0-9]+$/i : /^MIMIC-LAB-[0-9]+$/i
  return pattern.test(trimmed) ? trimmed.toUpperCase() : trimmed
}
export function readRoute(hash: string): Route {
  try {
    const raw = hash.replace(/^#/, '') || '/search', split = raw.indexOf('?')
    const path = split < 0 ? raw : raw.slice(0, split), query = split < 0 ? '' : raw.slice(split + 1)
    decodeURIComponent(query.replace(/\+/g, ' '))
    const p = new URLSearchParams(query), seen = new Set<string>()
    const allowed = path === '/result' ? ['external_system', 'external_id', 'patient_key', 'mode', 'value', 'page']
      : path === '/search' ? ['mode', 'value'] : ['mode', 'value', 'page']
    for (const [k] of p) { if (!allowed.includes(k) || seen.has(k)) throw new Error(); seen.add(k) }
    const mode = p.get('mode') ?? 'source', input = p.get('value') ?? ''
    if (!['source', 'key'].includes(mode) || (p.has('value') && !identifier(input))) throw new Error()
    const search = { mode, value: mode === 'source' ? normalizeInput(input, 'patient') : input.trim() } as Search
    if (mode === 'key' && search.value && !uuid.test(search.value)) throw new Error()
    if (path === '/search') return { kind: 'search', search }
    const pageText = p.get('page') ?? '1', page = Number(pageText)
    if (!/^[1-9]\d*$/.test(pageText) || !Number.isSafeInteger(page) || !Number.isSafeInteger((page - 1) * 20)) throw new Error()
    if (path === '/result') {
      const system = p.get('external_system') ?? '', id = p.get('external_id') ?? '', key = p.get('patient_key') ?? undefined
      if (!identifier(system) || !identifier(id) || (key !== undefined && !uuid.test(key))) throw new Error()
      return { kind: 'result', system, id, key, search, page }
    }
    const match = /^\/patients\/([^/]+)$/.exec(path), key = match ? decodeURIComponent(match[1]) : ''
    if (!uuid.test(key)) throw new Error()
    return { kind: 'profile', key: key.toLowerCase(), search, page }
  } catch { return { kind: 'invalid' } }
}
export function routeHash(route: Exclude<Route, { kind: 'invalid' }> = { kind: 'search', search: emptySearch }) {
  const p = new URLSearchParams(), path = route.kind === 'profile' ? '/patients/' + encodeURIComponent(route.key) : route.kind === 'result' ? '/result' : '/search'
  if (route.kind === 'result') { p.set('external_system', route.system); p.set('external_id', route.id); if (route.key) p.set('patient_key', route.key) }
  if (route.search.mode !== 'source') p.set('mode', route.search.mode)
  if (route.search.value) p.set('value', route.search.value)
  if (route.kind !== 'search' && route.page !== 1) p.set('page', String(route.page))
  return '#' + path + (p.size ? '?' + p : '')
}
