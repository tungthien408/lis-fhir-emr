import { sql } from "drizzle-orm";
import { pgSchema, text, jsonb, numeric, timestamp, uuid, primaryKey, unique } from "drizzle-orm/pg-core";

const emr = pgSchema("emr");
const time = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const patients = emr.table("patients", {
  patientKey: uuid("patient_key").primaryKey(),
  displayLabel: text("display_label"),
});

export const patientLinks = emr.table("patient_links", {
  identifierSystem: text("identifier_system").notNull(),
  identifierValue: text("identifier_value").notNull(),
  patientKey: uuid("patient_key").notNull().references(() => patients.patientKey),
}, (t) => [primaryKey({ name: "emr_patient_links_pk", columns: [t.identifierSystem, t.identifierValue] })]);

export const labResults = emr.table("lab_results", {
  targetId: uuid("target_id").primaryKey(),
  patientKey: uuid("patient_key").notNull().references(() => patients.patientKey),
  externalSystem: text("external_system").notNull(),
  externalId: text("external_id").notNull(),
  analyteSystem: text("analyte_system").notNull(),
  analyteCode: text("analyte_code").notNull(),
  analyteDisplay: text("analyte_display"),
  analyteContext: text("analyte_context"),
  quantity: numeric("quantity").notNull(),
  unitText: text("unit_text").notNull(),
  low: numeric("low"),
  high: numeric("high"),
  effectiveAt: time("effective_at").notNull(),
  clinicalStatus: text("clinical_status").notNull(),
  fhirJson: jsonb("fhir_json").notNull(),
  receivedAt: time("received_at").notNull().default(sql`clock_timestamp()`),
  storedAt: time("stored_at").notNull().default(sql`clock_timestamp()`),
}, (t) => [unique("emr_lab_external_uk").on(t.externalSystem, t.externalId)]);
