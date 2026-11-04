import assert from "node:assert/strict";
import { test } from "node:test";
import { monitorAttempt, monitorDiagnostics } from "../../src/middleware/monitor-diagnostics.js";
import { syntheticTransaction, validEnvelope } from "./service-fixtures.js";
const row = syntheticTransaction(validEnvelope());
const at = new Date("2026-11-04T10:00:00Z");
const attempt = { attemptId: "00000000-0000-4000-8000-000000000001", exchangeId: row.exchangeId,
  attemptNo: 1, phase: "SEND", startedAt: at, sentAt: null, responseAt: null, endedAt: at,
  httpStatus: 201, errorCode: null, errorMessage: null,
  responseBody: { result: "STORED", external_system: "https://example.org/lis/result", external_id: row.sourceResultId,
    target_id: "00000000-0000-4000-8000-000000000002", patient_key: "00000000-0000-4000-8000-000000000003" } };
const mapped = { ...row, fhirPayload: { identifier: [{ system: "https://example.org/lis/result", value: row.sourceResultId }] } };
test("Monitor sanitization: mismatched receipts and non-SEND/non-200/201 never prove storage", () => {
  assert.ok(monitorAttempt(mapped, attempt).receipt);
  assert.equal(monitorAttempt({ ...mapped, fhirPayload: { identifier: [{ system: "https://secret.example", value: row.sourceResultId }] } }, { ...attempt, responseBody: { ...attempt.responseBody, external_system: "https://secret.example" } }).receipt, null);
  for (const patch of [{ httpStatus: null }, { httpStatus: 503 }, { phase: "VERIFY" }, { endedAt: null }, { errorCode: "NETWORK_ERROR" },
    { responseBody: { ...attempt.responseBody, external_id: "other" } }, { responseBody: { ...attempt.responseBody, result: "ALREADY_EXISTS" } },
    { responseBody: { ...attempt.responseBody, patient_key: "bad" } }]) assert.equal(monitorAttempt(mapped, { ...attempt, ...patch }).receipt, null);
});
test("Monitor sanitization: arbitrary error code/message and event detail do not leak", () => {
  const dto = monitorAttempt(mapped, { ...attempt, errorCode: "SELECT_SECRET", errorMessage: "password=secret" });
  assert.equal(dto.error_code, "DIAGNOSTIC_ERROR"); assert.doesNotMatch(JSON.stringify(dto), /SELECT|password|secret/);
  const event = { logEventId: attempt.attemptId, exchangeId: row.exchangeId, eventType: "FAILED", oldStatus: null, newStatus: "FAILED", occurredAt: at, attemptId: null, detail: { code: "sql-secret", secret: "token" } };
  assert.equal(monitorDiagnostics([event])[0].error_code, "DIAGNOSTIC_ERROR");
  assert.doesNotMatch(JSON.stringify(monitorDiagnostics([event])), /sql-secret|token/);
});
