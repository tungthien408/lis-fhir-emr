/** SPP-66 C2: project Observation validation, patient linking and idempotency. */
import { randomUUID } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import * as labRepository from "./repository.js";
import type { LabResult } from "./repository.js";

const namespaces = {
  result: "https://example.org/lis/result",
  patient: "https://example.org/lis/patient",
  test: "https://example.org/lis/test-code",
  category: "http://terminology.hl7.org/CodeSystem/observation-category",
} as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Quantity = { value: number; unit: string };

/** Only the B4A project's subset; not a general FHIR R4 resource definition. */
export type SupportedObservation = {
  resourceType: "Observation";
  identifier: [{ system: typeof namespaces.result; value: string }];
  status: "final";
  category: [{ coding: [{ system: typeof namespaces.category; code: "laboratory" }] }];
  code: { coding: [{ system: typeof namespaces.test; code: string; display: string }]; text: string };
  subject: { type: "Patient"; identifier: { system: typeof namespaces.patient; value: string } };
  effectiveDateTime: string;
  valueQuantity: Quantity;
  referenceRange?: [{ low: Quantity; high?: Quantity } | { low?: Quantity; high: Quantity }];
};

export type ObservationValidationFailure = {
  kind: "invalid" | "unsupported";
  error: { code: "VALIDATION_ERROR"; field: string; message: string };
};
type Unavailable = { kind: "unavailable"; error: { code: "DEPENDENCY_UNAVAILABLE"; message: string } };
type Receipt = { external_system: string; external_id: string; target_id: string; patient_key: string };
export type StoreObservationOutcome =
  | (Receipt & { kind: "stored"; result: "STORED" })
  | (Receipt & { kind: "already_exists"; result: "ALREADY_EXISTS" })
  | { kind: "patient_not_linked"; error: { code: "PATIENT_NOT_LINKED"; message: string } }
  | { kind: "conflict"; error: { code: "DUPLICATE_CONFLICT"; message: string } }
  | ObservationValidationFailure | Unavailable;
export type ReadLabResultsOutcome = { kind: "found"; items: LabResult[] } | ObservationValidationFailure | Unavailable;
export type ListLabResultsOutcome =
  | { kind: "found"; items: LabResult[]; limit: number; offset: number }
  | ObservationValidationFailure | Unavailable;

class InvalidObservation extends Error {
  constructor(readonly kind: "invalid" | "unsupported", readonly field: string, message: string) { super(message); }
}
function invalid(field: string, message: string): never { throw new InvalidObservation("invalid", field, message); }
function unsupported(field: string, message: string): never { throw new InvalidObservation("unsupported", field, message); }
function failure(error: InvalidObservation): ObservationValidationFailure {
  return { kind: error.kind, error: { code: "VALIDATION_ERROR", field: error.field, message: error.message } };
}
function unavailable(): Unavailable {
  // Never expose SQL, driver text, connection URLs, or clinical payloads.
  return { kind: "unavailable", error: { code: "DEPENDENCY_UNAVAILABLE", message: "EMR persistence is temporarily unavailable" } };
}
function notLinked(): Extract<StoreObservationOutcome, { kind: "patient_not_linked" }> {
  return { kind: "patient_not_linked", error: { code: "PATIENT_NOT_LINKED", message: "No valid EMR patient link was found" } };
}
function record(value: unknown, field: string, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(field, "An object is required");
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    unsupported(field, "Additional fields are not supported by the project Observation contract");
  }
  return value as Record<string, unknown>;
}
function single(value: unknown, field: string): unknown {
  if (!Array.isArray(value) || value.length === 0) invalid(field, "An array containing one item is required");
  if (value.length !== 1) unsupported(field, "Only one item is supported");
  return value[0];
}
function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(field, "A nonempty string is required");
  if (value.length > 1024 * 1024 || /\u0000|[\uD800-\uDFFF]/u.test(value)) {
    unsupported(field, "The text cannot be stored faithfully");
  }
  return value; // Preserve spaces/case; never repair identity or clinical text.
}
function exact(value: unknown, expected: string, field: string): void {
  if (text(value, field) !== expected) unsupported(field, "The value is outside the supported project contract");
}
function quantity(value: unknown, field: string): Quantity {
  const item = record(value, field, ["value", "unit"]);
  if (typeof item.value !== "number" || !Number.isFinite(item.value)) {
    invalid(`${field}.value`, "A finite JSON number is required; numeric strings are not accepted");
  }
  // Every finite JS number's JSON decimal fits unconstrained PostgreSQL NUMERIC.
  // Conversion uses its shortest round-trip spelling, never toFixed/rounding.
  return { value: item.value, unit: text(item.unit, `${field}.unit`) };
}
function timestamp(value: unknown): void {
  const field = "effectiveDateTime";
  const source = text(value, field);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-](\d{2}):(\d{2}))$/.exec(source);
  if (!match) invalid(field, "A complete ISO timestamp with seconds and timezone is required");
  const [, y, m, d, h, minute, second, fraction = "", zone, oh, om] = match;
  const year = Number(y); const month = Number(m); const day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]
    || Number(h) > 23 || Number(minute) > 59 || Number(second) > 59
    || Number(oh ?? 0) > 14 || Number(om ?? 0) > 59 || (Number(oh) === 14 && Number(om) !== 0)) {
    invalid(field, "An actual calendar date/time with timezone between -14:00 and +14:00 is required; leap seconds are unsupported");
  }
  if (/[1-9]/.test(fraction.slice(6))) unsupported(field, "The timestamp exceeds PostgreSQL microsecond precision");
  // Date checks ONLY whole-second UTC year bounds; fractions never pass through Date.
  const wholeSecond = new Date(`${y}-${m}-${d}T${h}:${minute}:${second}${zone}`);
  if (!Number.isFinite(wholeSecond.getTime()) || wholeSecond.getUTCFullYear() < 1 || wholeSecond.getUTCFullYear() > 9999) {
    unsupported(field, "The UTC instant must be within years 0001–9999");
  }
}

/** Validate and copy before any await so callers cannot mutate a pending store. */
export function validateObservation(input: unknown):
  | { kind: "valid"; observation: SupportedObservation }
  | ObservationValidationFailure {
  try {
    let body: unknown;
    try { body = JSON.parse(canonicalJson(input)); }
    catch { invalid("body", "A JSON object with finite numbers and storable text is required"); }
    const observation = record(body, "body", ["resourceType", "identifier", "status", "category", "code", "subject",
      "effectiveDateTime", "valueQuantity", "referenceRange"]);
    exact(observation.resourceType, "Observation", "resourceType");
    exact(observation.status, "final", "status");
    const identifier = record(single(observation.identifier, "identifier"), "identifier[0]", ["system", "value"]);
    exact(identifier.system, namespaces.result, "identifier[0].system"); text(identifier.value, "identifier[0].value");
    const category = record(single(observation.category, "category"), "category[0]", ["coding"]);
    const categoryCode = record(single(category.coding, "category[0].coding"), "category[0].coding[0]", ["system", "code"]);
    exact(categoryCode.system, namespaces.category, "category[0].coding[0].system");
    exact(categoryCode.code, "laboratory", "category[0].coding[0].code");
    const code = record(observation.code, "code", ["coding", "text"]);
    const coding = record(single(code.coding, "code.coding"), "code.coding[0]", ["system", "code", "display"]);
    exact(coding.system, namespaces.test, "code.coding[0].system");
    if (!/^\S+(?: \S+)*$/.test(text(coding.code, "code.coding[0].code"))) {
      invalid("code.coding[0].code", "A local test code cannot contain leading, trailing or repeated whitespace");
    }
    text(coding.display, "code.coding[0].display"); text(code.text, "code.text");
    const subject = record(observation.subject, "subject", ["type", "identifier"]);
    exact(subject.type, "Patient", "subject.type");
    const patient = record(subject.identifier, "subject.identifier", ["system", "value"]);
    exact(patient.system, namespaces.patient, "subject.identifier.system"); text(patient.value, "subject.identifier.value");
    timestamp(observation.effectiveDateTime);
    const result = quantity(observation.valueQuantity, "valueQuantity");
    if (observation.referenceRange !== undefined) {
      const range = record(single(observation.referenceRange, "referenceRange"), "referenceRange[0]", ["low", "high"]);
      if (range.low === undefined && range.high === undefined) {
        invalid("referenceRange", "Omit referenceRange when both bounds are absent");
      }
      const low = range.low === undefined ? undefined : quantity(range.low, "referenceRange[0].low");
      const high = range.high === undefined ? undefined : quantity(range.high, "referenceRange[0].high");
      for (const bound of [low, high]) {
        if (bound && bound.unit !== result.unit) invalid("referenceRange", "Reference units must exactly match valueQuantity.unit");
      }
      if (low && high && low.value > high.value) invalid("referenceRange", "Reference low exceeds reference high");
    }
    return { kind: "valid", observation: observation as SupportedObservation };
  } catch (error) {
    if (!(error instanceof InvalidObservation)) throw error;
    return failure(error);
  }
}

/** Only the Repository owns SQL/transactions. Success is returned after commit. */
export async function storeObservation(
  input: unknown,
  repository: Pick<typeof labRepository, "withPatientLinkTransaction"> = labRepository,
): Promise<StoreObservationOutcome> {
  const checked = validateObservation(input);
  if (checked.kind !== "valid") return checked;
  const observation = checked.observation;
  const source = observation.identifier[0]; const subject = observation.subject.identifier;
  const original = canonicalJson(observation);
  try {
    const outcome = await repository.withPatientLinkTransaction(subject.system, subject.value, async (linked): Promise<StoreObservationOutcome> => {
      if (typeof linked.patientKey !== "string" || !uuid.test(linked.patientKey)) return notLinked();
      const saved = await linked.createLabResult({
        targetId: randomUUID(), externalSystem: source.system, externalId: source.value,
        analyteSystem: observation.code.coding[0].system, analyteCode: observation.code.coding[0].code,
        analyteDisplay: observation.code.coding[0].display, analyteContext: observation.code.text,
        quantity: String(observation.valueQuantity.value), unitText: observation.valueQuantity.unit,
        low: observation.referenceRange?.[0].low === undefined ? null : String(observation.referenceRange[0].low.value),
        high: observation.referenceRange?.[0].high === undefined ? null : String(observation.referenceRange[0].high.value),
        effectiveAt: observation.effectiveDateTime, clinicalStatus: observation.status, fhirJson: observation,
      });
      const row = saved.record;
      if (!uuid.test(row.target_id) || !uuid.test(row.patient_key)
        || row.external_system !== source.system || row.external_id !== source.value) {
        throw new Error("Invalid persisted EMR identity");
      }
      // Strict whole-JSON comparison, INCLUDING the original timestamp string.
      // Equivalent timezone spellings are allowed at read-back, not POST retry.
      const identical = row.patient_key.toLowerCase() === linked.patientKey.toLowerCase()
        && canonicalJson(row.fhir_json) === original;
      if (!identical) {
        if (saved.kind === "created") throw new Error("Unexpected persisted EMR content");
        return { kind: "conflict", error: { code: "DUPLICATE_CONFLICT", message: "The source key already has different content or patient linkage" } };
      }
      const receipt = { external_system: row.external_system, external_id: row.external_id,
        target_id: row.target_id, patient_key: row.patient_key };
      return saved.kind === "created" ? { kind: "stored", result: "STORED", ...receipt }
        : { kind: "already_exists", result: "ALREADY_EXISTS", ...receipt };
    });
    return outcome ?? notLinked();
  } catch { return unavailable(); }
}

/** Exact source mode always returns all rows; there is no pagination here. */
export async function getLabResultsBySource(
  externalSystem: unknown, externalId: unknown,
  repository: Pick<typeof labRepository, "getLabResultsBySource"> = labRepository,
): Promise<ReadLabResultsOutcome> {
  let system: string; let id: string;
  try { system = text(externalSystem, "external_system"); id = text(externalId, "external_id"); }
  catch (error) { if (error instanceof InvalidObservation) return failure(error); throw error; }
  try { return { kind: "found", items: await repository.getLabResultsBySource(system, id) }; }
  catch { return unavailable(); }
}

/** C3 parses HTTP query text; this operation accepts validated numeric pagination. */
export async function listLabResults(
  input: unknown,
  repository: Pick<typeof labRepository, "listLabResults"> = labRepository,
): Promise<ListLabResultsOutcome> {
  let patientKey: string; let limit: number; let offset: number;
  try {
    const options = record(input, "filters", ["patientKey", "limit", "offset"]);
    patientKey = text(options.patientKey, "patient_key");
    if (!uuid.test(patientKey)) invalid("patient_key", "A UUID in 8-4-4-4-12 format is required");
    const requestedLimit = options.limit === undefined ? 20 : options.limit;
    const requestedOffset = options.offset === undefined ? 0 : options.offset;
    if (typeof requestedLimit !== "number" || !Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
      invalid("limit", "Limit must be an integer between 1 and 100");
    }
    if (typeof requestedOffset !== "number" || !Number.isSafeInteger(requestedOffset) || requestedOffset < 0) {
      invalid("offset", "Offset must be a nonnegative safe integer");
    }
    limit = requestedLimit; offset = requestedOffset;
  } catch (error) { if (error instanceof InvalidObservation) return failure(error); throw error; }
  try { return { kind: "found", items: await repository.listLabResults({ patientKey, limit, offset }), limit, offset }; }
  catch { return unavailable(); }
}
