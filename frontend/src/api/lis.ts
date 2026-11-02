
import type { LisResultsResponse } from '../types/lis'

interface GetLisResultsParams {
  limit?: number
  offset?: number
  patientId?: string
  testCode?: string
  signal?: AbortSignal
}

export async function getLisResults({
  limit = 10,
  offset = 0,
  patientId,
  testCode,
  signal,
}: GetLisResultsParams = {}): Promise<LisResultsResponse> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  })

  if (patientId?.trim()) {
    params.set('patient_id', patientId.trim())
  }

  if (testCode?.trim()) {
    params.set('test_code', testCode.trim())
  }

  const response = await fetch(
    `/api/lis/results?${params.toString()}`,
    { signal }
  )

  if (!response.ok) {
    throw new Error(
      `Không thể tải kết quả xét nghiệm (HTTP ${response.status}).`
    )
  }

  return (await response.json()) as LisResultsResponse
}
