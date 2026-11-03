export type LisResultStatus = 'READY' | 'FINAL'

export interface LisResult {
  result_id: string
  patient_id: string
  test_code: string
  test_name: string
  fluid: string | null
  category: string | null
  value_num: string
  unit: string
  reference_low: string | null
  reference_high: string | null
  effective_at: string | null
  result_status: LisResultStatus
}

export interface LisResultsResponse {
  items: LisResult[]
  limit: number
  offset: number
}
