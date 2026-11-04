import type { LisResult, LisResultStatus } from '../types/lis.ts'

export const PAGE_SIZE = 10

export interface ResultFilters {
  patientId: string
  resultId: string
  testCode: string
  resultStatus: LisResultStatus | ''
}

export interface ResultsQuery {
  filters: ResultFilters
  pageIndex: number
}

export const emptyFilters: ResultFilters = {
  patientId: '',
  resultId: '',
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

// Seed hiện tại dùng MIMIC-P-<subject_id> và MIMIC-LAB-<labevent_id>, hậu tố số.
// Chỉ chuẩn hóa bộ lọc nhập vào; không thay đổi ID nhận từ API hay ID đường dẫn chi tiết.
export function normalizeFilters(filters: ResultFilters): ResultFilters {
  const patientId = filters.patientId.trim()
  const resultId = (filters.resultId ?? '').trim()
  return {
    patientId: /^MIMIC-P-[0-9]+$/i.test(patientId) ? patientId.toUpperCase() : patientId,
    resultId: /^MIMIC-LAB-[0-9]+$/i.test(resultId) ? resultId.toUpperCase() : resultId,
    testCode: filters.testCode.trim(),
    resultStatus: filters.resultStatus,
  }
}

export function resultsQueryReducer(query: ResultsQuery, action: QueryAction): ResultsQuery {
  switch (action.type) {
    case 'search':
      return { filters: normalizeFilters(action.filters), pageIndex: 0 }
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
