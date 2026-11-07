import type { LisResult, LisResultStatus, LisResultsResponse } from '../types/lis.ts'
import { isLisIdentifier } from '../state/routes.ts'
import { lisResultRequest } from './resultRequest.ts'
import { emptyFilters, normalizeFilters } from '../state/results.ts'

interface GetLisResultsParams {
  limit?: number
  offset?: number
  patientId?: string
  testCode?: string
  resultStatus?: LisResultStatus
  signal?: AbortSignal
}

export class LisApiError extends Error {
  readonly status: number
  readonly code: string | undefined
  readonly resultNotFound: boolean

  constructor(status: number, code: string | undefined, message: string, resultNotFound = false) {
    super(message)
    this.name = 'LisApiError'
    this.status = status
    this.code = code
    this.resultNotFound = resultNotFound
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isLisResult(value: unknown): value is LisResult {
  if (!isRecord(value)) return false
  const strings = ['result_id', 'patient_id', 'test_code', 'test_name', 'value_num', 'unit']
  const nullable = ['fluid', 'category', 'reference_low', 'reference_high', 'effective_at']
  return strings.every((key) => typeof value[key] === 'string')
    && nullable.every((key) => isNullableString(value[key]))
    && (value.result_status === 'READY' || value.result_status === 'FINAL')
}

export async function getLisResults({
  limit = 11,
  offset = 0,
  patientId,
  testCode,
  resultStatus,
  signal,
}: GetLisResultsParams = {}): Promise<LisResultsResponse> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  })

  const filters = normalizeFilters({ ...emptyFilters, patientId: patientId ?? '', testCode: testCode ?? '' })
  if (filters.patientId) params.set('patient_id', filters.patientId)
  if (filters.testCode) params.set('test_code', filters.testCode)
  if (resultStatus) params.set('result_status', resultStatus)

  const payload = await requestLis('/api/lis/results?' + params.toString(), signal)
  if (!isRecord(payload) || !Array.isArray(payload.items)
    || !payload.items.every(isLisResult) || payload.items.length > limit
    || payload.limit !== limit || payload.offset !== offset) {
    throw new Error('Cấu trúc dữ liệu từ LIS không hợp lệ. Vui lòng thử tải lại.')
  }

  return { items: payload.items, limit: payload.limit, offset: payload.offset }
}

export async function getLisResult(resultId: string, signal?: AbortSignal): Promise<LisResult> {
  if (!isLisIdentifier(resultId)) {
    throw new LisApiError(400, 'VALIDATION_ERROR', 'Mã kết quả hoặc đường dẫn không hợp lệ. (HTTP 400)')
  }
  const { path, headers } = lisResultRequest(resultId)
  const payload = await requestLis(path, signal, true, headers)
  if (!isLisResult(payload) || payload.result_id !== resultId) {
    throw new Error('Cấu trúc dữ liệu chi tiết từ LIS không hợp lệ hoặc mã kết quả không khớp. Vui lòng thử tải lại.')
  }
  return payload
}

async function requestLis(path: string, signal?: AbortSignal, detailRequest = false, headers?: Record<string, string>): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(path, { signal, ...(headers ? { headers } : {}) })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('Không thể kết nối tới LIS. Vui lòng kiểm tra kết nối và thử tải lại.', { cause: error })
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    if (signal?.aborted) throw error
    if (response.ok) {
      throw new Error('Phản hồi từ LIS không phải JSON hợp lệ. Vui lòng thử tải lại.', { cause: error })
    }
  }

  if (!response.ok) {
    const detail = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined
    const code = typeof detail?.code === 'string' ? detail.code : undefined
    let message = typeof detail?.message === 'string' ? detail.message : 'Không thể tải kết quả xét nghiệm.'
    if (code === 'VALIDATION_ERROR') message = 'Bộ lọc hoặc thông tin phân trang không hợp lệ.'
    if (code === 'DEPENDENCY_UNAVAILABLE') message = 'Dịch vụ dữ liệu LIS tạm thời không sẵn sàng.'
    if (detailRequest) {
      if (response.status === 400) message = 'Mã kết quả hoặc đường dẫn không hợp lệ.'
      if (response.status === 404) message = 'Không tìm thấy kết quả xét nghiệm.'
      if (response.status === 503) message = 'Dịch vụ dữ liệu LIS tạm thời không sẵn sàng.'
      if (response.status === 502) message = 'Không thể tải chi tiết do lỗi cổng kết nối LIS.'
    }
    // Phân biệt bản ghi không tồn tại với 404 do route/proxy sai.
    const resultNotFound = detailRequest && response.status === 404 && code === 'NOT_FOUND'
      && detail?.message === 'Laboratory result not found'
    throw new LisApiError(response.status, code, message + ' (HTTP ' + response.status + ')', resultNotFound)
  }

  return payload
}
