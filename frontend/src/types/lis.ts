
export interface LisResult {
  result_id: string
  patient_id: string
  test_code: string
  test_name: string
  fluid: string
  category: string
  value_num: string
  unit: string | null
  reference_low: string | null
  reference_high: string | null
  effective_at: string
  result_status: string
}

export interface LisResultsResponse {
  items: LisResult[]
  limit: number
  offset: number
}
