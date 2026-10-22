import { sql } from "drizzle-orm";
import { pgSchema, text, jsonb, numeric, timestamp, uuid, integer, unique } from "drizzle-orm/pg-core";

// Mô tả BẢNG ĐÃ CÓ trong database/dacn_db_init_v2.sql để dùng với Drizzle.
// File TypeScript này KHÔNG tự tạo bảng; SQL của teammate là nguồn tạo schema.
const lis = pgSchema("lis");
const time = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const patients = lis.table("patients", {
  patientId: text("patient_id").primaryKey(),
  sourceSubjectId: text("source_subject_id").notNull().unique(),
  displayLabel: text("display_label"),
});

export const testCatalog = lis.table("test_catalog", {
  testCode: text("test_code").primaryKey(),
  testName: text("test_name").notNull(),
  fluid: text("fluid"),
  category: text("category"),
  acceptedUnits: jsonb("accepted_units").notNull(),
  catalogVersion: text("catalog_version").notNull(),
});

export const results = lis.table("results", {
  resultId: text("result_id").primaryKey(),
  patientId: text("patient_id").notNull().references(() => patients.patientId),
  testCode: text("test_code").notNull().references(() => testCatalog.testCode),
  valueNum: numeric("value_num").notNull(),
  unit: text("unit").notNull(),
  referenceLow: numeric("reference_low"),
  referenceHigh: numeric("reference_high"),
  effectiveAt: time("effective_at").notNull(),
  resultStatus: text("result_status").notNull(),
  provenance: jsonb("provenance").notNull().default({}),
});

export const publishEvents = lis.table("publish_events", {
  eventId: uuid("event_id").primaryKey(),
  resultId: text("result_id").notNull().unique().references(() => results.resultId),
  sourceSystem: text("source_system").notNull(),
  sourceSnapshot: jsonb("source_snapshot").notNull(),
  sourceHash: text("source_hash").notNull(),
  publishedAt: time("published_at").notNull().default(sql`clock_timestamp()`),
  exchangeId: uuid("exchange_id"),
  dispatchStatus: text("dispatch_status").notNull().default("PENDING"),
  dispatchAttemptCount: integer("dispatch_attempt_count").notNull().default(0),
  nextRetryAt: time("next_retry_at"),
  leaseUntil: time("lease_until"),
  ackedAt: time("acked_at"),
  leaseToken: uuid("lease_token"),
  lastErrorCode: text("last_error_code"),
  lastErrorMessage: text("last_error_message"),
  ackResponse: jsonb("ack_response"),
});

export const dispatchAttempts = lis.table("dispatch_attempts", {
  dispatchAttemptId: uuid("dispatch_attempt_id").primaryKey(),
  eventId: uuid("event_id").notNull().references(() => publishEvents.eventId),
  attemptNo: integer("attempt_no").notNull(),
  leaseToken: uuid("lease_token"),
  startedAt: time("started_at").notNull().default(sql`clock_timestamp()`),
  sentAt: time("sent_at"),
  responseAt: time("response_at"),
  endedAt: time("ended_at"),
  httpStatus: integer("http_status"),
  responseBody: jsonb("response_body"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
}, (t) => [unique("lis_attempt_event_number_uk").on(t.eventId, t.attemptNo)]);
