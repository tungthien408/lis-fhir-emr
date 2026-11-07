/** Read-only Monitor DTOs. Never expose arbitrary diagnostics or remote bodies. */
import type { ExchangeAttempt, ExchangeEvent, ExchangeTransaction } from "./repository.js";
const codes = new Set(["INVALID_SOURCE", "MAPPING_UNSUPPORTED", "PAYLOAD_INTEGRITY", "STORAGE_RECEIPT_MISSING",
  "DUPLICATE_CONFLICT", "REMOTE_VALIDATION_ERROR", "HTTP_TEMPORARY", "HTTP_PERMANENT", "HTTP_TIMEOUT",
  "NETWORK_ERROR", "INVALID_STORAGE_RESPONSE", "INVALID_VERIFY_RESPONSE", "VERIFY_MISMATCH", "LEASE_EXPIRED", "RETRY_EXHAUSTED"]);
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function record(v: unknown): v is Record<string, unknown> { return v !== null && typeof v === "object" && !Array.isArray(v); }
function safeCode(v: unknown): string | null { return v == null ? null : typeof v === "string" && codes.has(v) ? v : "DIAGNOSTIC_ERROR"; }
function receipt(row: ExchangeTransaction, attempt: ExchangeAttempt) {
  const value = attempt.responseBody;
  const fhir = row.fhirPayload;
  const identity = record(fhir) && Array.isArray(fhir.identifier) ? fhir.identifier[0] : undefined;
  if (![200, 201].includes(attempt.httpStatus ?? 0) || attempt.phase !== "SEND" || attempt.errorCode !== null || attempt.endedAt === null || !record(value)
    || value.result !== (attempt.httpStatus === 201 ? "STORED" : attempt.httpStatus === 200 ? "ALREADY_EXISTS" : undefined)
    || !record(identity) || identity.system !== "https://example.org/lis/result" || identity.value !== row.sourceResultId
    || value.external_system !== identity.system || value.external_id !== row.sourceResultId
    || typeof value.target_id !== "string" || !uuid.test(value.target_id)
    || typeof value.patient_key !== "string" || !uuid.test(value.patient_key)) return null;
  return { result: value.result as "STORED" | "ALREADY_EXISTS", external_system: identity.system,
    external_id: row.sourceResultId, target_id: value.target_id, patient_key: value.patient_key };
}
export function monitorAttempt(row: ExchangeTransaction, attempt: ExchangeAttempt) {
  const code = safeCode(attempt.errorCode);
  return { attempt_id: attempt.attemptId, exchange_id: attempt.exchangeId, phase: attempt.phase,
    attempt_no: attempt.attemptNo, started_at: attempt.startedAt, sent_at: attempt.sentAt,
    response_at: attempt.responseAt, ended_at: attempt.endedAt, http_status: attempt.httpStatus,
    error_code: code, error_message: code === null ? null : "The exchange attempt did not complete successfully.",
    receipt: receipt(row, attempt) };
}
export function monitorDiagnostics(events: ExchangeEvent[]) {
  return events.flatMap(event => {
    const code = record(event.detail) ? safeCode(event.detail.code) : null;
    return code === null ? [] : [{ log_event_id: event.logEventId, attempt_id: event.attemptId,
      event_type: event.eventType, occurred_at: event.occurredAt, error_code: code }];
  });
}
