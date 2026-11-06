import { getLisResult, getLisResults, LisApiError } from './lis.ts'
import { normalizeFilters, PAGE_SIZE, resultsPage, type ResultsQuery } from '../state/results.ts'
import type { LisResult } from '../types/lis.ts'

export async function searchLisResults(query: ResultsQuery, signal?: AbortSignal) {
  const filters = normalizeFilters(query.filters)
  if (!filters.resultId) {
    const data = await getLisResults({
      limit: PAGE_SIZE + 1, offset: query.pageIndex * PAGE_SIZE,
      patientId: filters.patientId, testCode: filters.testCode,
      resultStatus: filters.resultStatus || undefined, signal,
    })
    return resultsPage(data.items)
  }

  let result: LisResult
  try {
    result = await getLisResult(filters.resultId, signal)
  } catch (error) {
    if (error instanceof LisApiError && error.resultNotFound) return { items: [], hasNext: false }
    throw error
  }
  const matches = (!filters.patientId || result.patient_id === filters.patientId)
    && (!filters.testCode || result.test_code === filters.testCode)
    && (!filters.resultStatus || result.result_status === filters.resultStatus)
  return { items: matches ? [result] : [], hasNext: false }
}
