/** HTTP contract checks only. No EMR imports, database access or patient lookup. */
import { canonicalJson } from "./canonical-json.js";
import type { FhirR4LabObservation } from "./mapper.js";

export interface StorageReceipt {
  result: "STORED" | "ALREADY_EXISTS";
  external_system: string;
  external_id: string;
  target_id: string;
  patient_key: string;
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function storageReceipt(status: number, body: unknown, observation: FhirR4LabObservation): StorageReceipt | undefined {
  if (!isRecord(body) || (status !== 201 && status !== 200)
    || body.result !== (status === 201 ? "STORED" : "ALREADY_EXISTS")
    || body.external_system !== observation.identifier[0].system
    || body.external_id !== observation.identifier[0].value
    || typeof body.target_id !== "string" || !uuid.test(body.target_id)
    || typeof body.patient_key !== "string" || !uuid.test(body.patient_key)) return undefined;
  // Explicit allowlist; never persist arbitrary response/error bodies.
  return { result: body.result as StorageReceipt["result"], external_system: body.external_system,
    external_id: body.external_id, target_id: body.target_id.toLowerCase(), patient_key: body.patient_key.toLowerCase() };
}

/** Normalize decimal text symbolically, never via Number(actual) or rounding. */
function decimal(value: string): string | undefined {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!match) return undefined;
  let digits = (match[2] + (match[3] ?? "")).replace(/^0+/, "");
  if (!digits) return "0";
  let exponent = BigInt(match[4] ?? "0") - BigInt(match[3]?.length ?? 0);
  const trailing = /0+$/.exec(digits)?.[0].length ?? 0;
  digits = digits.slice(0, digits.length - trailing); exponent += BigInt(trailing);
  return `${match[1]}${digits}e${exponent}`;
}
export function sameDecimal(actual: unknown, expected: number): boolean {
  // GET uses decimal strings, matching PostgreSQL NUMERIC, to avoid JSON.parse
  // rounding a mismatched decimal onto the expected JS number.
  return typeof actual === "string" && actual.length <= 4096 && decimal(actual) === decimal(String(expected));
}

/** Seconds + exact fractional digits; JS Date alone would lose microseconds. */
function instant(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return undefined;
  const [, y, m, d, h, min, s, fraction, zone, oh, om] = match;
  const year = Number(y); const month = Number(m); const day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]
    || Number(h) > 23 || Number(min) > 59 || Number(s) > 59
    || Number(om ?? 0) > 59 || Number(oh ?? 0) > 14 || (Number(oh) === 14 && Number(om) !== 0)) return undefined;
  const milliseconds = Date.parse(`${y}-${m}-${d}T${h}:${min}:${s}${zone}`);
  if (!Number.isFinite(milliseconds)) return undefined;
  return `${milliseconds / 1000}:${(fraction ?? "").replace(/0+$/, "")}`;
}
export function sameInstant(actual: unknown, expected: string): boolean {
  const normalized = instant(actual);
  return normalized !== undefined && normalized === instant(expected);
}

/** Returns only field labels, never actual/expected health data. */
export function verifyReadBack(body: unknown, expected: FhirR4LabObservation, receipt: StorageReceipt): string[] {
  if (!isRecord(body) || !Array.isArray(body.items)) return ["items"];
  if (body.items.length !== 1) return ["items.count"];
  const item: unknown = body.items[0];
  if (!isRecord(item)) return ["items[0]"];
  const mismatches: string[] = [];
  const fields = {
    external_system: expected.identifier[0].system, external_id: expected.identifier[0].value,
    analyte_system: expected.code.coding[0].system, analyte_code: expected.code.coding[0].code,
    analyte_display: expected.code.coding[0].display, analyte_context: expected.code.text,
    unit_text: expected.valueQuantity.unit, clinical_status: expected.status,
  };
  for (const [field, value] of Object.entries(fields)) if (item[field] !== value) mismatches.push(field);
  for (const field of ["target_id", "patient_key"] as const) {
    if (typeof item[field] !== "string" || item[field].toLowerCase() !== receipt[field]) mismatches.push(field);
  }
  if (!sameDecimal(item.quantity, expected.valueQuantity.value)) mismatches.push("quantity");
  for (const bound of ["low", "high"] as const) {
    const value = expected.referenceRange?.[0][bound]?.value;
    if (value === undefined ? item[bound] !== null : !sameDecimal(item[bound], value)) mismatches.push(bound);
  }
  if (!sameInstant(item.effective_at, expected.effectiveDateTime)) mismatches.push("effective_at");
  // Columns alone cannot prove the patient source identifier / laboratory group.
  // Require the stored original FHIR as well as the extracted EMR columns.
  const fhir = item.fhir_json;
  let fhirMatches = false;
  try {
    fhirMatches = isRecord(fhir) && sameInstant(fhir.effectiveDateTime, expected.effectiveDateTime)
      && canonicalJson({ ...fhir, effectiveDateTime: expected.effectiveDateTime }) === canonicalJson(expected);
  } catch { /* Untrusted JSON can overflow a number or exceed serialization depth. */ }
  if (!fhirMatches) mismatches.push("fhir_json");
  return mismatches;
}
