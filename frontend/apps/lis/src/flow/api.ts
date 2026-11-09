import { getLisResult } from '../api/lis.ts'
import { getResultPublishState } from '../api/publish.ts'
import { getAttempts, getDetail, identityVerified, sameExchange, record } from '../../../middleware-monitor/src/api/exchanges.ts'
import { getResult } from '../../../emr/src/api/emr.ts'
import { hashJson, type FlowData } from './model.ts'

export async function loadFlow(resultId: string, signal: AbortSignal): Promise<FlowData> {
  const [source, publish] = await Promise.all([getLisResult(resultId, signal), getResultPublishState(resultId, signal)])
  const data: FlowData = { source, publish, detail: null, attempts: null, emr: null, hashes: null, warnings: [] }
  const event = publish.event
  if (!event?.exchange_id) return data
  try {
    const d = await getDetail(event.exchange_id, signal)
    if (d.event_id !== event.event_id || d.source_result_id !== resultId || d.source_system !== 'lis-demo' || !identityVerified(d)) {
      throw new Error('Định danh snapshot / giao dịch không khớp với sự kiện LIS. Không sử dụng bằng chứng này.')
    }
    data.detail = d
    try {
      const attempts = await getAttempts(d.exchange_id, signal)
      if (!sameExchange(d, attempts)) throw new Error('Lịch sử lượt thử không khớp giao dịch.')
      data.attempts = attempts
    } catch (error) { data.warnings.push(message(error)) }
    if (d.fhir_payload) {
      try { data.hashes = { fhir: await hashJson(d.fhir_payload), emr: null } }
      catch (error) { data.warnings.push(message(error)) }
      if (data.hashes && data.hashes.fhir !== d.payload_hash) data.warnings.push('SHA-256 của FHIR không khớp payload_hash từ Middleware.')
    }
    if (d.target_stored_at) {
      try {
        const f = record(d.fhir_payload) ? d.fhir_payload : null
        const id = f && Array.isArray(f.identifier) && record(f.identifier[0]) ? f.identifier[0] : null
        if (typeof id?.system !== 'string' || id.value !== resultId) throw new Error('Định danh FHIR không khớp kết quả nguồn.')
        const receipt = data.attempts?.items.find(a => a.receipt)?.receipt
        const emr = await getResult(id.system, resultId, receipt?.patient_key, signal)
        if (receipt && emr.result.target_id !== receipt.target_id) throw new Error('Target ID đọc lại không khớp receipt lưu EMR.')
        const subject = record(emr.result.fhir_json.subject) ? emr.result.fhir_json.subject : null
        const patient = subject && record(subject.identifier) ? subject.identifier : null
        const snapshot = record(d.source_payload) && record(d.source_payload.source_snapshot) ? d.source_payload.source_snapshot : null
        if (patient?.value !== snapshot?.patient_id) throw new Error('Bệnh nhân EMR không khớp snapshot đã Publish.')
        data.emr = emr
        if (data.hashes) data.hashes.emr = await hashJson(emr.result.fhir_json)
      } catch (error) { data.warnings.push(message(error)) }
    }
  } catch (error) { data.warnings.push(message(error)) }
  signal.throwIfAborted()
  return data
}
export function message(error: unknown) { return error instanceof Error ? error.message : 'Không thể tải bằng chứng giao dịch.' }
