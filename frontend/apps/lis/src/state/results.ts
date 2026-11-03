import type { LisResult, LisResultStatus } from '../types/lis.ts'

export const PAGE_SIZE = 10

export interface ResultFilters {
  patientId: string
  testCode: string
  resultStatus: LisResultStatus | ''
}

export interface ResultsQuery {
  filters: ResultFilters
  pageIndex: number
}

export const emptyFilters: ResultFilters = {
  patientId: '',
  testCode: '',
  resultStatus: '',
}

export const initialQuery: ResultsQuery = {
  filters: { ...emptyFilters },
  pageIndex: 0,
}

type QueryAction =
  | { type: 'search'; filters: ResultFilters }
  | { type: 'reset' }
  | { type: 'previous' }
  | { type: 'next' }
  | { type: 'retry' }

export function resultsQueryReducer(query: ResultsQuery, action: QueryAction): ResultsQuery {
  switch (action.type) {
    case 'search':
      return { filters: { ...action.filters }, pageIndex: 0 }
    case 'reset':
      return { filters: { ...emptyFilters }, pageIndex: 0 }
    case 'previous':
      return { ...query, pageIndex: Math.max(0, query.pageIndex - 1) }
    case 'next':
      return { ...query, pageIndex: query.pageIndex + 1 }
    case 'retry':
      // Tạo truy vấn mới để tìm lại được ngay cả khi các điều kiện không đổi.
      return { ...query }
  }
}

export function resultsPage(items: LisResult[]) {
  return {
    items: items.slice(0, PAGE_SIZE),
    hasNext: items.length > PAGE_SIZE,
  }
}

export function formatLisTimestamp(value: string | null): string {
  return value === null ? '—' : value.slice(0, 19).replace('T', ' ')
}
