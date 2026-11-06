import { emptyFilters, initialQuery, normalizeFilters, PAGE_SIZE, type ResultsQuery } from './results.ts'

export type ResultsRoute =
  | { kind: 'list'; query: ResultsQuery }
  | { kind: 'detail'; query: ResultsQuery; resultId: string }
  | { kind: 'invalid'; message: string }

export function isLisIdentifier(value: string): boolean {
  // Chỉ kiểm tra; không trim, đổi hoa/thường hoặc chuẩn hóa định danh.
  return value.trim().length > 0 && ![...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
}

function decodeQuery(value: string): string {
  return decodeURIComponent(value.replace(/\+/g, ' '))
}

export function parseResultsHash(hash: string): ResultsRoute {
  try {
    if (hash === '' || hash === '#') return { kind: 'list', query: { ...initialQuery, filters: { ...emptyFilters } } }
    const [path, search = '', ...extra] = hash.slice(1).split('?')
    const match = /^\/results(?:\/([^/]+))?$/.exec(path)
    if (!hash.startsWith('#') || !match || extra.length) throw new Error('Đường dẫn không được hỗ trợ.')
    const params = new Map<string, string>()
    for (const pair of search ? search.split('&') : []) {
      const separator = pair.indexOf('=')
      if (separator < 1) throw new Error('Tham số truy vấn không hợp lệ.')
      const key = decodeQuery(pair.slice(0, separator))
      const value = decodeQuery(pair.slice(separator + 1))
      if (!['patient_id', 'result_id', 'test_code', 'result_status', 'page'].includes(key) || params.has(key)) {
        throw new Error('Tham số không được hỗ trợ hoặc bị lặp.')
      }
      params.set(key, value)
    }
    for (const key of ['patient_id', 'result_id', 'test_code']) {
      if (params.has(key) && !isLisIdentifier(params.get(key)!)) throw new Error('Mã trong bộ lọc không hợp lệ.')
    }
    const status = params.get('result_status')
    if (status !== undefined && status !== 'READY' && status !== 'FINAL') throw new Error('Trạng thái kết quả không hợp lệ.')
    const page = params.get('page') ?? '1'
    const pageIndex = Number(page) - 1
    if (!/^[1-9][0-9]*$/.test(page) || !Number.isSafeInteger(pageIndex)
      || !Number.isSafeInteger((pageIndex + 1) * PAGE_SIZE)) throw new Error('Số trang không hợp lệ.')
    const query: ResultsQuery = {
      filters: normalizeFilters({ patientId: params.get('patient_id') ?? '', resultId: params.get('result_id') ?? '', testCode: params.get('test_code') ?? '', resultStatus: status ?? '' }),
      pageIndex: params.has('result_id') ? 0 : pageIndex,
    }
    if (match[1] === undefined) return { kind: 'list', query }
    const resultId = decodeURIComponent(match[1])
    if (!isLisIdentifier(resultId)) throw new Error('Mã kết quả hoặc đường dẫn không hợp lệ.')
    return { kind: 'detail', query, resultId }
  } catch (error) {
    return { kind: 'invalid', message: 'URL không hợp lệ. ' + (error instanceof URIError ? 'Mã hóa URL bị lỗi.' : (error as Error).message) }
  }
}

export function resultsHash(query: ResultsQuery, resultId?: string): string {
  const params = new URLSearchParams()
  if (query.filters.patientId.trim()) params.set('patient_id', query.filters.patientId)
  if (query.filters.resultId?.trim()) params.set('result_id', query.filters.resultId)
  if (query.filters.testCode.trim()) params.set('test_code', query.filters.testCode)
  if (query.filters.resultStatus) params.set('result_status', query.filters.resultStatus)
  if (!query.filters.resultId?.trim() && query.pageIndex > 0) params.set('page', String(query.pageIndex + 1))
  const search = params.toString()
  return '#/results' + (resultId === undefined ? '' : '/' + encodeURIComponent(resultId)) + (search ? '?' + search : '')
}
