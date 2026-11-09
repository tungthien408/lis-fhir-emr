import { isLisIdentifier } from '../state/routes.ts'

// Only Flow Console is routable. Retired and unknown URLs return to its start.
export function readFlowRoute(hash: string) {
  if (!hash || hash === '#') return { resultId: '', invalid: false, redirect: false }
  const [path, search = '', ...extra] = hash.split('?')
  if (path !== '#/flow') return { resultId: '', invalid: false, redirect: true }
  try {
    decodeURIComponent(search.replace(/\+/g, ' '))
    const params = new URLSearchParams(search)
    if (extra.length || [...params.keys()].some(k => k !== 'result_id') || params.getAll('result_id').length > 1) throw new Error()
    const resultId = params.get('result_id') ?? ''
    if (params.has('result_id') && !isLisIdentifier(resultId)) throw new Error()
    return { resultId, invalid: false, redirect: false }
  } catch { return { resultId: '', invalid: true, redirect: false } }
}
