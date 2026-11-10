import { getLisResults } from './lis.ts'
import { normalizeFilters, PAGE_SIZE, resultsPage, type ResultsQuery } from '../state/results.ts'

export async function searchLisResults(query: ResultsQuery, signal?: AbortSignal) {
  const filters = normalizeFilters(query.filters)
  const data = await getLisResults({
    limit: PAGE_SIZE + 1, offset: query.pageIndex * PAGE_SIZE,
    search: filters.search,
    resultId: filters.resultId, patientId: filters.patientId, testCode: filters.testCode,
    resultStatus: filters.resultStatus || undefined, signal,
  })
  return resultsPage(data.items)
}
