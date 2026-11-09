import { identityVerified, record, verifiedDelivery } from '../../../middleware-monitor/src/api/exchanges.ts'
import type { Attempts, Detail } from '../../../middleware-monitor/src/types/exchange.ts'
import type { LabResult, Patient } from '../../../emr/src/types/emr.ts'
import type { PublishState } from '../types/publish.ts'
import type { LisResult } from '../types/lis.ts'

export interface FlowData {
  source: LisResult
  publish: PublishState
  detail: Detail | null
  attempts: Attempts | null
  emr: { result: LabResult; patient: Patient } | null
  hashes: { fhir: string; emr: string | null } | null
  warnings: string[]
}
export type Tone = 'idle' | 'active' | 'done' | 'error'
export const stationLabels = ['LIS phát hành', 'Chuyển tới Middleware', 'Chuyển đổi FHIR R4', 'Lưu vào EMR', 'Đối soát đọc lại']

// Symbolic comparison preserves PostgreSQL NUMERIC precision (no Number coercion).
export function decimal(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value)
  if (text.length > 4096) return undefined
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text)
  if (!m || !(m[2] || m[3])) return undefined
  let digits = (m[2] + (m[3] ?? '')).replace(/^0+/, '')
  if (!digits) return '0'
  const zeros = /0+$/.exec(digits)?.[0].length ?? 0
  digits = digits.slice(0, digits.length - zeros)
  return `${m[1] === '-' ? '-' : ''}${digits}e${BigInt(m[4] ?? '0') - BigInt(m[3]?.length ?? 0) + BigInt(zeros)}`
}
export function instant(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!m || !Number.isFinite(Date.parse(value))) return undefined
  return `${Date.parse(m[1] + m[3])}:${(m[2] ?? '').replace(/0+$/, '')}`
}
export function duration(start?: string | null, end?: string | null) {
  if (!start || !end) return '—'
  const ms = Date.parse(end) - Date.parse(start)
  return Number.isFinite(ms) && ms >= 0 ? `${ms.toLocaleString('vi-VN')} ms` : '—'
}
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  if (record(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}'
  throw new Error('JSON không hợp lệ để tính SHA-256.')
}
export async function hashJson(value: unknown) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(value)))
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('')
}
export function sourceSnapshot(data: FlowData | null) {
  const payload = data?.detail?.source_payload
  return record(payload) && record(payload.source_snapshot) ? payload.source_snapshot : null
}
function object(value: unknown) { return record(value) ? value : {} }
function first(value: unknown) { return Array.isArray(value) ? object(value[0]) : {} }
export interface Comparison { label: string; lis: unknown; fhir: unknown; emr: unknown; match: boolean | null }
export function comparisons(data: FlowData | null): Comparison[] {
  const s = sourceSnapshot(data), f = object(data?.detail?.fhir_payload), e = data?.emr?.result
  const code = first(object(f.code).coding), range = first(f.referenceRange), q = object(f.valueQuantity)
  const subject = object(object(f.subject).identifier), ef = object(e?.fhir_json)
  const ready = !!(s && e && data?.detail && identityVerified(data.detail))
  function row(label: string, lis: unknown, fhir: unknown, emr: unknown, normalize: (v: unknown) => unknown = v => v): Comparison {
    const values = [lis, fhir, emr].map(normalize)
    return { label, lis, fhir, emr, match: ready ? values.every(v => v !== undefined) && values[0] === values[1] && values[1] === values[2] : null }
  }
  const number = (v: unknown) => v === null ? null : decimal(v)
  return [
    row('Mã kết quả', s?.result_id, first(f.identifier).value, e?.external_id),
    row('Mã bệnh nhân', s?.patient_id, subject.value, object(object(ef.subject).identifier).value),
    row('Mã xét nghiệm', s?.test_code, code.code, e?.analyte_code),
    row('Giá trị', s?.value_num, q.value, e?.quantity, number),
    row('Đơn vị', s?.unit, q.unit, e?.unit_text),
    row('Cận thấp', s?.reference_low, object(range.low).value ?? null, e?.low, number),
    row('Cận cao', s?.reference_high, object(range.high).value ?? null, e?.high, number),
    row('Thời điểm', s?.effective_at, f.effectiveDateTime, e?.effective_at, instant),
    row('Trạng thái', s?.result_status, f.status, e?.clinical_status, v => typeof v === 'string' ? v.toLowerCase() : undefined),
    { label: 'FHIR JSON (SHA-256)', lis: 'Không áp dụng', fhir: data?.hashes?.fhir, emr: data?.hashes?.emr,
      match: ready && data?.hashes?.emr ? data.hashes.fhir === data.hashes.emr && data.hashes.fhir === data.detail?.payload_hash : null },
  ]
}
export function flowModel(data: FlowData | null, sending = false) {
  const event = data?.publish.event, d = data?.detail, a = data?.attempts
  const attempts = [...(a?.items ?? [])].sort((x, y) => x.started_at.localeCompare(y.started_at) || x.attempt_no - y.attempt_no)
  const last = attempts.at(-1)
  const diagnostic = [...(a?.diagnostics ?? [])].sort((x, y) => x.occurred_at.localeCompare(y.occurred_at)).at(-1)
  const code = last?.error_code ?? diagnostic?.error_code ?? event?.last_error_code
  const terminal = !!d && ['REJECTED', 'FAILED'].includes(d.status)
  const dispatchFailed = !!event && ['BLOCKED', 'FAILED'].includes(event.dispatch_status)
  const delivered = !!(d && verifiedDelivery(d, a ?? null) && data?.hashes?.fhir === d.payload_hash)
  const stored = attempts.find(x => x.receipt && x.ended_at && !x.error_code && x.phase === 'SEND')
  const stages: Tone[] = [event ? 'done' : sending ? 'active' : 'idle', event?.dispatch_status === 'ACK' ? 'done' : event ? 'active' : 'idle',
    d?.transformed_at && d.fhir_payload ? 'done' : d ? 'active' : 'idle',
    d?.target_stored_at && stored ? 'done' : d?.first_sent_at || d?.transformed_at ? 'active' : 'idle',
    delivered ? 'done' : d?.status === 'VERIFYING' || d?.retry_phase === 'VERIFY' ? 'active' : 'idle']
  let failedStage: number | null = null
  if (dispatchFailed) failedStage = 1
  else if (terminal) {
    failedStage = last?.phase === 'VERIFY' || code === 'VERIFY_MISMATCH' ? 4
      : ['INVALID_SOURCE', 'MAPPING_UNSUPPORTED', 'PAYLOAD_INTEGRITY'].includes(code ?? '') ? 2
      : last?.phase === 'SEND' ? 3 : null
  }
  if (terminal || dispatchFailed) stages.forEach((tone, i) => { if (tone === 'active') stages[i] = 'idle' })
  if (failedStage !== null) stages[failedStage] = 'error'
  const rows = comparisons(data)
  const mismatch = rows.some(r => r.match === false)
  const label = sending ? 'ĐANG GỬI' : dispatchFailed ? event!.dispatch_status : terminal ? d!.status
    : delivered ? 'DELIVERED' : d?.status === 'DELIVERED' ? 'CHƯA ĐỦ BẰNG CHỨNG'
    : event ? (d?.status ?? event.dispatch_status) : data ? (data.publish.result_status === 'FINAL' ? 'SẴN SÀNG' : 'CHƯA FINAL') : 'CHƯA XÁC MINH'
  const tone: Tone = terminal || dispatchFailed || mismatch ? 'error' : delivered ? 'done' : event || sending ? 'active' : 'idle'
  const captions = [event ? 'OUTBOX' : 'Chưa phát hành', event?.dispatch_status ?? 'Chờ ACK',
    d?.transformed_at ? 'FHIR R4 · Observation' : d ? 'Kiểm tra / chuyển đổi' : 'Chờ dữ liệu',
    stored ? `${stored.http_status} ${stored.receipt!.result}` : d?.first_sent_at ? 'Đang gửi / chờ kết quả' : 'Chờ dữ liệu',
    delivered ? 'Backend đã đối soát' : terminal && failedStage !== 4 ? 'Không thực hiện' : 'Chờ đối soát']
  if (failedStage !== null) captions[failedStage] = [last?.http_status, code ?? 'Xem nhật ký'].filter(Boolean).join(' · ')
  if (d?.status === 'RETRY_WAIT') captions[d.retry_phase === 'VERIFY' ? 4 : 3] = 'Chờ thử lại tự động'
  return { label, tone, stages, captions, delivered, terminal, failedStage, code, last, mismatch,
    timings: ['—', duration(event?.published_at, event?.acked_at), duration(d?.mapping_started_at, d?.transformed_at),
      duration(d?.first_sent_at, d?.target_stored_at ?? (last?.phase === 'SEND' ? last.response_at : null)),
      duration(d?.target_stored_at, d?.verified_at ?? (last?.phase === 'VERIFY' ? last.ended_at : null))],
    total: duration(event?.published_at, d?.verified_at), rows }
}
