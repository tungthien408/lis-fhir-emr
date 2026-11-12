/** SPP-66 B2: validate a LIS envelope, verify its snapshot hash, then persist via B1. */
import { canonicalJson, hashCanonicalJson } from "./canonical-json.js";
import * as exchangeRepository from "./repository.js";
import type { SourceEnvelope } from "./repository.js";
import { testUnitIssue } from "../common/test-catalog.js";

export interface ExchangeAcknowledgement {
  accepted: true;
  event_id: string;
  exchange_id: string;
  source_system: string;
  source_result_id: string;
  source_hash: string;
}

type ValidationCode = "VALIDATION_ERROR" | "RESULT_NOT_READY" | "INVALID_TEST_CODE" | "INVALID_UNIT";
interface ValidationError {
  code: ValidationCode;
  field: string;
  message: string;
}

/** B3 can map these kinds to 202 / 400 / 422 / 409 / 503 respectively. */
export type AcceptExchangeOutcome =
  | (ExchangeAcknowledgement & { kind: "accepted"; created: boolean })
  | { kind: "malformed"; error: ValidationError }
  | { kind: "invalid"; error: ValidationError }
  | { kind: "conflict"; error: { code: "DUPLICATE_CONFLICT"; message: string } }
  | { kind: "unavailable"; error: { code: "DEPENDENCY_UNAVAILABLE"; message: string } };

class InvalidExchange extends Error {
  constructor(
    readonly kind: "malformed" | "invalid",
    readonly field: string,
    message: string,
    readonly code: ValidationCode = "VALIDATION_ERROR",
  ) { super(message); }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(record: Record<string, unknown>, key: string, prefix = ""): string {
  const value = record[key];
  if (typeof value !== "string") throw new InvalidExchange("malformed", `${prefix}${key}`, "A string is required");
  return value;
}

function nonempty(value: string, field: string, kind: "malformed" | "invalid", code?: ValidationCode): void {
  if (!value.trim()) throw new InvalidExchange(kind, field, "Text must not be empty", code);
}

/** Extended ISO calendar date/time with timezone; never normalize the source string. */
function isTimestamp(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHour, offsetMinute] = match;
  const year = Number(yearText); const month = Number(monthText); const day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]
    || Number(hourText) > 23 || Number(minuteText) > 59 || Number(secondText) > 59
    // PostgreSQL timestamptz accepts numeric timezone displacements through 15:59.
    || (offsetHour !== undefined && (Number(offsetHour) > 15 || Number(offsetMinute) > 59))) return false;
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) && instant.getUTCFullYear() >= 1 && instant.getUTCFullYear() <= 9999;
}

function timestamp(value: string, field: string): void {
  if (!isTimestamp(value)) {
    throw new InvalidExchange("malformed", field, "A valid ISO 8601 timestamp with timezone in years 0001–9999 is required");
  }
}

/** PostgreSQL UTF-8 JSONB cannot store NUL or unpaired UTF-16 surrogates. */
function isDatabaseText(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 0 || (code >= 0xdc00 && code <= 0xdfff)) return false;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    }
  }
  return true;
}

function parseEnvelope(input: unknown): SourceEnvelope {
  let body: unknown;
  try {
    // An independent JSON copy also prevents caller mutation while awaiting B1.
    // Keep additional JSON fields: snapshot extras are hashed; all extras are stored.
    body = JSON.parse(canonicalJson(input), (key: string, value: unknown) => {
      if (!isDatabaseText(key) || (typeof value === "string" && !isDatabaseText(value))) {
        throw new TypeError("Unsupported PostgreSQL JSONB text");
      }
      return value;
    });
  } catch (error) {
    if (!(error instanceof TypeError) && !(error instanceof RangeError)) throw error;
    throw new InvalidExchange("malformed", "body", "The request must contain supported JSON values");
  }
  if (!isRecord(body)) throw new InvalidExchange("malformed", "body", "A JSON object is required");
  const eventId = text(body, "event_id");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) {
    throw new InvalidExchange("malformed", "event_id", "A UUID in 8-4-4-4-12 format is required");
  }
  for (const key of ["source_system", "source_result_id"]) nonempty(text(body, key), key, "malformed");
  const hash = text(body, "source_hash");
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new InvalidExchange("malformed", "source_hash", "A lowercase hexadecimal SHA-256 hash is required");
  }
  timestamp(text(body, "published_at"), "published_at");

  const snapshot = body.source_snapshot;
  if (!isRecord(snapshot)) throw new InvalidExchange("malformed", "source_snapshot", "A JSON object is required");
  const prefix = "source_snapshot.";
  for (const key of ["result_id", "patient_id", "test_code", "test_name", "unit", "effective_at", "result_status"]) {
    text(snapshot, key, prefix);
  }
  for (const key of ["fluid", "category"]) {
    if (snapshot[key] !== null && typeof snapshot[key] !== "string") {
      throw new InvalidExchange("malformed", `${prefix}${key}`, "A string or null is required");
    }
  }
  for (const key of ["value_num", "reference_low", "reference_high"]) {
    if (key !== "value_num" && snapshot[key] === null) continue;
    if (typeof snapshot[key] !== "number" || !Number.isFinite(snapshot[key])) {
      throw new InvalidExchange("malformed", `${prefix}${key}`, "A finite JSON number is required");
    }
  }
  if (snapshot.result_status !== "FINAL") {
    throw new InvalidExchange("invalid", `${prefix}result_status`, "Only FINAL results can be accepted", "RESULT_NOT_READY");
  }
  for (const key of ["result_id", "patient_id", "test_code", "test_name", "unit"]) {
    const code = key === "unit" ? "INVALID_UNIT" : key === "test_code" ? "INVALID_TEST_CODE" : "VALIDATION_ERROR";
    nonempty(text(snapshot, key, prefix), `${prefix}${key}`, "invalid", code);
  }
  timestamp(text(snapshot, "effective_at", prefix), `${prefix}effective_at`);
  if (body.source_result_id !== snapshot.result_id) {
    throw new InvalidExchange("invalid", "source_result_id", "Source result identifiers must match");
  }
  if (typeof snapshot.reference_low === "number" && typeof snapshot.reference_high === "number"
    && snapshot.reference_low > snapshot.reference_high) {
    throw new InvalidExchange("invalid", `${prefix}reference_low`, "Reference low exceeds reference high");
  }
  if (hashCanonicalJson(snapshot) !== hash) {
    throw new InvalidExchange("invalid", "source_hash", "The snapshot does not match its source hash");
  }
  const catalogIssue = testUnitIssue(snapshot.test_code as string, snapshot.unit as string);
  if (catalogIssue) {
    const field = catalogIssue === "INVALID_TEST_CODE" ? "test_code" : "unit";
    throw new InvalidExchange("invalid", `${prefix}${field}`, "The test code and unit must belong to the supported catalog", catalogIssue);
  }
  // Every required field was checked above. Retain the complete original JSON.
  return body as SourceEnvelope;
}

/** B2 validation shared with B4B's stored-envelope check; no persistence here. */
export function validateExchangeEnvelope(input: unknown):
  | { kind: "valid"; envelope: SourceEnvelope }
  | Extract<AcceptExchangeOutcome, { kind: "malformed" | "invalid" }> {
  try {
    return { kind: "valid", envelope: parseEnvelope(input) };
  } catch (error) {
    if (!(error instanceof InvalidExchange)) throw error;
    return { kind: error.kind, error: { code: error.code, field: error.field, message: error.message } };
  }
}

/**
 * Validate before B1, then acknowledge only committed receipt (never delivery).
 * The optional Repository dependency is a test seam; production uses B1.
 */
export async function acceptExchange(
  input: unknown,
  repository: Pick<typeof exchangeRepository, "createExchange"> = exchangeRepository,
): Promise<AcceptExchangeOutcome> {
  const checked = validateExchangeEnvelope(input);
  if (checked.kind !== "valid") return checked;
  const envelope = checked.envelope;
  try {
    const saved = await repository.createExchange({ sourceEnvelope: envelope });
    if (saved.kind === "conflict") {
      return { kind: "conflict", error: { code: "DUPLICATE_CONFLICT", message: "The source identifiers or content conflict with an existing exchange" } };
    }
    return {
      kind: "accepted", created: saved.kind === "created", accepted: true,
      // Echo source IDs as received (including UUID letter case) for the LIS ACK.
      event_id: envelope.event_id, exchange_id: saved.transaction.exchangeId,
      source_system: envelope.source_system, source_result_id: envelope.source_result_id,
      source_hash: envelope.source_hash,
    };
  } catch {
    // No SQL, source payload, connection URL or driver text reaches B3.
    return { kind: "unavailable", error: { code: "DEPENDENCY_UNAVAILABLE", message: "Exchange persistence is temporarily unavailable" } };
  }
}
