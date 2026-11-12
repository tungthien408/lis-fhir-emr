/**
 * B4A: pure project-contract mapping to a numeric FHIR R4 Observation.
 * Input is the validated snapshot, NOT the source envelope. No storage, hash,
 * clock, UUID, HTTP or patient lookup. This type describes our output subset,
 * not every field/profile supported by the complete FHIR specification.
 */
import { FHIR_NAMESPACES } from "../common/fhir-namespaces.js";
import type { SourceSnapshot } from "./repository.js";

/** Project-local mapping revision; NOT an HL7/FHIR release or resource version. */
export const OBSERVATION_MAPPING_VERSION = "lis-observation-v2";

export type ObservationSourceSnapshot = Readonly<Pick<SourceSnapshot,
  "result_id" | "patient_id" | "test_code" | "test_name" | "value_num" | "unit" | "effective_at" | "result_status"
>> & Readonly<Partial<Pick<SourceSnapshot, "fluid" | "category" | "reference_low" | "reference_high">>>;

export interface ObservationQuantity { value: number; unit: string }
export type ObservationReferenceRange =
  | { low: ObservationQuantity; high?: ObservationQuantity }
  | { low?: ObservationQuantity; high: ObservationQuantity };

export interface FhirR4LabObservation {
  resourceType: "Observation";
  identifier: [{ system: typeof FHIR_NAMESPACES.result; value: string }];
  status: "final";
  category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category"; code: "laboratory" }] }];
  code: {
    coding: [{ system: typeof FHIR_NAMESPACES.test; code: string; display: string }];
    text: string;
  };
  subject: { type: "Patient"; identifier: { system: typeof FHIR_NAMESPACES.patient; value: string } };
  effectiveDateTime: string;
  valueQuantity: ObservationQuantity;
  referenceRange?: [ObservationReferenceRange];
}

type MappingField = keyof ObservationSourceSnapshot | "snapshot" | "code.text";
type MappingFailure =
  | { kind: "invalid"; error: { code: "INVALID_SOURCE_VALUE"; field: MappingField; message: string } }
  | { kind: "unsupported"; error: { code: "UNSUPPORTED_SOURCE_VALUE"; field: MappingField; message: string } };
export type MapObservationOutcome = MappingFailure | {
  kind: "mapped";
  mappingVersion: typeof OBSERVATION_MAPPING_VERSION;
  observation: FhirR4LabObservation;
};

function invalid(field: MappingField, message: string): MappingFailure {
  return { kind: "invalid", error: { code: "INVALID_SOURCE_VALUE", field, message } };
}

function unsupported(field: MappingField, message: string): MappingFailure {
  return { kind: "unsupported", error: { code: "UNSUPPORTED_SOURCE_VALUE", field, message } };
}

function stringIssue(value: string, field: MappingField): MappingFailure | undefined {
  // R4 string maximum: 1 Mi characters. Reject unrepresentable text; never trim,
  // replace or truncate an identifier, display or source unit to make it fit.
  if (value.length > 1024 * 1024 || /\u0000|[\uD800-\uDFFF]/u.test(value)) {
    return unsupported(field, "The source text cannot be represented by this FHIR mapping");
  }
  return undefined;
}

function timestampIssue(value: string): MappingFailure | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return invalid("effective_at", "A complete ISO 8601 timestamp with timezone is required");
  const [, y, m, d, h, min, s, , oh, om] = match;
  const year = Number(y); const month = Number(m); const day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const instant = new Date(value);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]
    || Number(h) > 23 || Number(min) > 59 || Number(s) > 59
    || (oh !== undefined && (Number(oh) > 23 || Number(om) > 59))
    || !Number.isFinite(instant.getTime()) || instant.getUTCFullYear() < 1 || instant.getUTCFullYear() > 9999) {
    return invalid("effective_at", "The source timestamp is outside the validated LIS calendar/time range");
  }
  // R4 dateTime offsets stop at +/-14:00. B2's PostgreSQL limit is wider;
  // surface the mismatch instead of silently rewriting the source instant.
  if (oh !== undefined && (Number(oh) > 14 || (Number(oh) === 14 && Number(om) !== 0))) {
    return unsupported("effective_at", "The source timezone offset is not supported by FHIR R4 dateTime");
  }
  return undefined;
}

/** Map MR01–MR09 without modifying input; failures never contain a partial resource. */
export function mapObservation(snapshot: ObservationSourceSnapshot): MapObservationOutcome {
  // Defensive checks also protect future callers reading stored JSON. They do
  // not replace B2 validation, hash checking or independent clinical evaluation.
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return invalid("snapshot", "A validated LIS snapshot object is required");
  }
  for (const field of ["result_id", "patient_id", "test_code", "test_name", "unit", "effective_at"] as const) {
    const value = snapshot[field];
    if (typeof value !== "string" || !value.trim()) return invalid(field, "A nonempty source string is required");
    const issue = stringIssue(value, field); if (issue) return issue;
  }
  if (typeof snapshot.result_status !== "string") return invalid("result_status", "A source status string is required");
  if (snapshot.result_status !== "FINAL") return unsupported("result_status", "Only FINAL source results are supported");
  // Coding.code is FHIR 'code', not arbitrary free text. Preserve a valid local
  // code exactly; reject whitespace that would require trimming/collapsing it.
  if (!/^\S+(?: \S+)*$/.test(snapshot.test_code)) {
    return unsupported("test_code", "The local code cannot be preserved as a FHIR code without changing whitespace");
  }
  if (typeof snapshot.value_num !== "number" || !Number.isFinite(snapshot.value_num)) {
    return invalid("value_num", "A finite source JSON number is required");
  }
  for (const field of ["reference_low", "reference_high"] as const) {
    const value = snapshot[field];
    if (value !== null && value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
      return invalid(field, "A reference boundary must be a finite number or absent");
    }
  }
  const low = snapshot.reference_low; const high = snapshot.reference_high;
  if (low != null && high != null && low > high) return invalid("reference_low", "Reference low exceeds reference high");
  for (const field of ["fluid", "category"] as const) {
    const value = snapshot[field];
    if (value !== null && value !== undefined) {
      if (typeof value !== "string") return invalid(field, "Optional source context must be a string or absent");
      const issue = stringIssue(value, field); if (issue) return issue;
    }
  }
  const timeIssue = timestampIssue(snapshot.effective_at); if (timeIssue) return timeIssue;
  const text = [snapshot.test_name, snapshot.fluid, snapshot.category]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0).join(" / ");
  const textIssue = stringIssue(text, "code.text"); if (textIssue) return textIssue;

  const observation: FhirR4LabObservation = {
    resourceType: "Observation",
    identifier: [{ system: FHIR_NAMESPACES.result, value: snapshot.result_id }],
    status: "final",
    category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory" }] }],
    code: { coding: [{ system: FHIR_NAMESPACES.test, code: snapshot.test_code, display: snapshot.test_name }], text },
    subject: { type: "Patient", identifier: { system: FHIR_NAMESPACES.patient, value: snapshot.patient_id } },
    effectiveDateTime: snapshot.effective_at,
    valueQuantity: { value: snapshot.value_num, unit: snapshot.unit },
  };
  // R4 obs-3: a referenceRange item must have low, high or text. Never emit [{}].
  if (low != null) {
    observation.referenceRange = [{ low: { value: low, unit: snapshot.unit },
      ...(high == null ? {} : { high: { value: high, unit: snapshot.unit } }) }];
  } else if (high != null) observation.referenceRange = [{ high: { value: high, unit: snapshot.unit } }];
  return { kind: "mapped", mappingVersion: OBSERVATION_MAPPING_VERSION, observation };
}
