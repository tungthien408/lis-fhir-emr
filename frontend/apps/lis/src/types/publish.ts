import type { LisResultStatus } from './lis.ts'

export const dispatchStatuses = ['PENDING', 'IN_FLIGHT', 'RETRY_WAIT', 'ACK', 'BLOCKED', 'FAILED'] as const
export type DispatchStatus = typeof dispatchStatuses[number]
export interface PublishReceipt {
  event_id: string
  result_id: string
  dispatch_status: DispatchStatus
  exchange_id: string | null
}
export interface PublishEvent extends PublishReceipt {
  dispatch_attempt_count: number
  last_error_code: string | null
  last_error_message: string | null
  published_at: string
  acked_at: string | null
  next_retry_at: string | null
}
export interface PublishState {
  result_id: string
  result_status: LisResultStatus
  published: boolean
  event: PublishEvent | null
}
export const exchangeStatuses = ['RECEIVED', 'PROCESSING', 'VERIFYING', 'RETRY_WAIT', 'DELIVERED', 'REJECTED', 'FAILED'] as const
export interface ExchangeStatus {
  exchange_id: string
  event_id: string
  source_system: string
  source_result_id: string
  status: typeof exchangeStatuses[number]
  retry_phase: 'SEND' | 'VERIFY' | null
  verified_at: string | null
  completed_at: string | null
}
