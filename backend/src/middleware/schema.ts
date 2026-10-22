import { sql } from "drizzle-orm";
import { pgSchema, text, jsonb, timestamp, uuid, integer, unique, foreignKey } from "drizzle-orm/pg-core";

// Mô tả 5 bảng Integration trong file SQL; chỉ có 3 bảng đầu do middleware ghi.
// Hai bảng experiment_* và field_comparisons được evaluator quản lý riêng.
const integration = pgSchema("integration");
const time = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const exchangeTransactions = integration.table("exchange_transactions", {
  exchangeId: uuid("exchange_id").primaryKey(),
  eventId: uuid("event_id").notNull().unique(),
  sourceSystem: text("source_system").notNull(),
  sourceResultId: text("source_result_id").notNull(),
  patientIdentifier: jsonb("patient_identifier"),
  sourcePayload: jsonb("source_payload").notNull(),
  fhirPayload: jsonb("fhir_payload"),
  sourceHash: text("source_hash").notNull(),
  payloadHash: text("payload_hash"),
  mappingVersion: text("mapping_version"),
  status: text("status").notNull().default("RECEIVED"),
  retryPhase: text("retry_phase"),
  nextRetryAt: time("next_retry_at"),
  leaseUntil: time("lease_until"),
  leaseToken: uuid("lease_token"),
  sendAttemptCount: integer("send_attempt_count").notNull().default(0),
  verifyAttemptCount: integer("verify_attempt_count").notNull().default(0),
  publishedAt: time("published_at"),
  receivedAt: time("received_at").notNull().default(sql`clock_timestamp()`),
  validatedAt: time("validated_at"),
  mappingStartedAt: time("mapping_started_at"),
  transformedAt: time("transformed_at"),
  firstSentAt: time("first_sent_at"),
  targetStoredAt: time("target_stored_at"),
  verifiedAt: time("verified_at"),
  completedAt: time("completed_at"),
}, (t) => [unique("exchange_source_result_uk").on(t.sourceSystem, t.sourceResultId)]);

export const exchangeAttempts = integration.table("exchange_attempts", {
  attemptId: uuid("attempt_id").primaryKey(),
  exchangeId: uuid("exchange_id").notNull().references(() => exchangeTransactions.exchangeId),
  attemptNo: integer("attempt_no").notNull(),
  phase: text("phase").notNull(),
  startedAt: time("started_at").notNull().default(sql`clock_timestamp()`),
  sentAt: time("sent_at"),
  responseAt: time("response_at"),
  endedAt: time("ended_at"),
  httpStatus: integer("http_status"),
  responseBody: jsonb("response_body"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
}, (t) => [
  unique("exchange_attempt_phase_number_uk").on(t.exchangeId, t.phase, t.attemptNo),
  unique("exchange_attempt_id_exchange_uk").on(t.attemptId, t.exchangeId),
]);

export const exchangeEvents = integration.table("exchange_events", {
  logEventId: uuid("log_event_id").primaryKey(),
  exchangeId: uuid("exchange_id").notNull().references(() => exchangeTransactions.exchangeId),
  eventType: text("event_type").notNull(),
  oldStatus: text("old_status"),
  newStatus: text("new_status"),
  occurredAt: time("occurred_at").notNull().default(sql`clock_timestamp()`),
  attemptId: uuid("attempt_id"),
  detail: jsonb("detail"),
}, (t) => [foreignKey({
  name: "exchange_event_attempt_same_exchange_fk",
  columns: [t.attemptId, t.exchangeId],
  foreignColumns: [exchangeAttempts.attemptId, exchangeAttempts.exchangeId],
})]);

export const experimentRuns = integration.table("experiment_runs", {
  runId: uuid("run_id").primaryKey(),
  scenarioId: text("scenario_id").notNull(),
  protocolVersion: text("protocol_version").notNull(),
  manifestHash: text("manifest_hash").notNull(),
  gitCommit: text("git_commit"),
  environment: jsonb("environment").notNull().default({}),
  startedAt: time("started_at").notNull().default(sql`clock_timestamp()`),
  endedAt: time("ended_at"),
  outcome: text("outcome"),
  artifactPath: text("artifact_path"),
});

export const fieldComparisons = integration.table("field_comparisons", {
  comparisonId: uuid("comparison_id").primaryKey(),
  runId: uuid("run_id").notNull().references(() => experimentRuns.runId),
  caseId: text("case_id").notNull(),
  exchangeId: uuid("exchange_id").references(() => exchangeTransactions.exchangeId),
  ruleId: text("rule_id").notNull(),
  fieldPath: text("field_path").notNull(),
  expected: jsonb("expected"),
  actualFhir: jsonb("actual_fhir"),
  actualTarget: jsonb("actual_target"),
  outcome: text("outcome").notNull(),
  reason: text("reason"),
});
