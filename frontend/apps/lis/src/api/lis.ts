import type { LisResult, LisResultStatus, LisResultsResponse } from '../types/lis.ts'

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

  constructor(status: number, code: string | undefined, message: string) {
    super(message)
    this.name = 'LisApiError'
    this.status = status
    this.code = code
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

  // Chỉ dùng trim để nhận biết ô trống; giữ nguyên định danh khi gửi.
  if (patientId?.trim()) params.set('patient_id', patientId)
  if (testCode?.trim()) params.set('test_code', testCode)
  if (resultStatus) params.set('result_status', resultStatus)

  let response: Response
  try {
    response = await fetch('/api/lis/results?' + params.toString(), { signal })
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
    throw new LisApiError(response.status, code, message + ' (HTTP ' + response.status + ')')
  }

  if (!isRecord(payload) || !Array.isArray(payload.items)
    || !payload.items.every(isLisResult) || payload.items.length > limit
    || payload.limit !== limit || payload.offset !== offset) {
    throw new Error('Cấu trúc dữ liệu từ LIS không hợp lệ. Vui lòng thử tải lại.')
  }

  return { items: payload.items, limit: payload.limit, offset: payload.offset }
}
