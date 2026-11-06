/**
 * Publish use case (SPP-66 A2): tra sự kiện cũ, đọc nguồn dưới khóa trong
 * transaction Repository, kiểm tra dữ liệu FINAL, tạo snapshot/hash rồi lưu.
 * Trả outcome cho Controller tương lai; không xử lý HTTP hoặc tự gửi dữ liệu.
 */
import { randomUUID } from "node:crypto";
import { canonicalJson, hashCanonicalJson } from "./canonical-json.js";
import {
  withPublishTransaction,
  type JsonObject,
  type PublishEvent,
  type PublishResultState,
} from "./repository.js";

export interface SourceSnapshot extends JsonObject {
  result_id: string;
  patient_id: string;
  test_code: string;
  test_name: string;
  fluid: string | null;
  category: string | null;
  value_num: number;
  unit: string;
  reference_low: number | null;
  reference_high: number | null;
  effective_at: string;
  result_status: "FINAL";
}

export type PublishValidationCode =
  | "RESULT_NOT_READY" | "INVALID_TEST_CODE" | "INVALID_UNIT" | "VALIDATION_ERROR";

export type PublishOutcome =
  | { kind: "created"; event: PublishEvent }
  | { kind: "existing"; event: PublishEvent }
  | { kind: "not_found"; resultId: string }
  | { kind: "conflict"; resultId: string; error: { code: "CONTENT_CONFLICT"; message: string } }
  | {
    kind: "invalid";
    resultId: string;
    error: { code: PublishValidationCode; field: string; message: string };
  };

// Stable source identity from the contract's demo deployment, not a FHIR URI.
const SOURCE_SYSTEM = "lis-demo";

class InvalidPublishData extends Error {
  constructor(
    readonly code: PublishValidationCode,
    readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

function requireText(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new InvalidPublishData("VALIDATION_ERROR", field, "Required text must not be empty");
  }
}

function isAcceptedUnits(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0
    && value.every((unit: unknown) => typeof unit === "string" && unit.trim().length > 0);
}

/** Compare decimals using coefficient/exponent, without rounding through Number. */
function normalizeDecimal(value: string): string | undefined {
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!match) return undefined;
  const fraction = match[3] ?? "";
  const digits = `${match[2]}${fraction}`.replace(/^0+/, "");
  if (!digits) return "0";
  const coefficient = digits.replace(/0+$/, "");
  const exponent = BigInt(match[4] ?? "0") - BigInt(fraction.length)
    + BigInt(digits.length - coefficient.length);
  return `${match[1] === "-" ? "-" : ""}${coefficient}e${exponent}`;
}

/**
 * Snapshot uses JSON numbers as in the API contract. Accept conversion only if
 * JSON's decimal representation equals PostgreSQL's original decimal value.
 * 3.4000 -> 3.4 is exact at the decimal JSON boundary; 9007199254740993 is rejected.
 */
function jsonNumber(value: string, field: string): number {
  const original = normalizeDecimal(value);
  const number = Number(value);
  if (original === undefined || !Number.isFinite(number)
    || original !== normalizeDecimal(JSON.stringify(number))) {
    throw new InvalidPublishData(
      "VALIDATION_ERROR", field, "Numeric value cannot be represented as a JSON number without precision loss",
    );
  }
  return Object.is(number, -0) ? 0 : number;
}

function buildSnapshot(state: PublishResultState, checkCatalog = true): SourceSnapshot {
  const { result, patient, test } = state;
  if (result.resultStatus !== "FINAL") {
    throw new InvalidPublishData("RESULT_NOT_READY", "result_status", "Only FINAL results can be published");
  }
  requireText(result.resultId, "result_id");
  requireText(result.patientId, "patient_id");
  requireText(result.testCode, "test_code");
  requireText(test.testName, "test_name");
  if (patient.patientId !== result.patientId || test.testCode !== result.testCode) {
    throw new InvalidPublishData("VALIDATION_ERROR", "result_id", "Source data relationships do not match");
  }
  if (checkCatalog && !isAcceptedUnits(test.acceptedUnits)) {
    throw new InvalidPublishData("INVALID_TEST_CODE", "accepted_units", "Test catalog has no valid accepted units");
  }
  if (checkCatalog && (result.unit.trim().length === 0 || !(test.acceptedUnits as string[]).includes(result.unit))) {
    throw new InvalidPublishData("INVALID_UNIT", "unit", "Result unit is not accepted by its test catalog");
  }

  const value = jsonNumber(result.valueNum, "value_num");
  const low = result.referenceLow === null ? null : jsonNumber(result.referenceLow, "reference_low");
  const high = result.referenceHigh === null ? null : jsonNumber(result.referenceHigh, "reference_high");
  if (low !== null && high !== null && low > high) {
    throw new InvalidPublishData("VALIDATION_ERROR", "reference_low", "Reference low exceeds reference high");
  }
  // Repository supplies exact UTC text with six fractional digits, including
  // PostgreSQL microseconds. Never rebuild this string from the A1 Date value.
  if (state.effectiveAtIso === null
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(state.effectiveAtIso)) {
    throw new InvalidPublishData("VALIDATION_ERROR", "effective_at", "A finite ISO 8601 timestamp in years 0001–9999 is required");
  }

  return {
    result_id: result.resultId,
    patient_id: result.patientId,
    test_code: result.testCode,
    test_name: test.testName,
    fluid: test.fluid,
    category: test.category,
    value_num: value,
    unit: result.unit,
    reference_low: low,
    reference_high: high,
    effective_at: state.effectiveAtIso,
    result_status: "FINAL",
  };
}

/** Compare the original business snapshot; catalog policy is not part of its content.
 * Keep the existing JSON-number/UTC/canonical SHA-256 format. No migration or rewrite.
 */
function matchesSnapshot(state: PublishResultState, event: PublishEvent): boolean {
  try {
    const snapshot = buildSnapshot(state, false);
    return hashCanonicalJson(snapshot) === event.sourceHash
      && canonicalJson(snapshot) === canonicalJson(event.sourceSnapshot as JsonObject);
  } catch (error) {
    if (error instanceof InvalidPublishData) return false;
    throw error;
  }
}
function conflict(resultId: string): Extract<PublishOutcome, { kind: "conflict" }> {
  return { kind: "conflict", resultId, error: { code: "CONTENT_CONFLICT",
    message: "Current result content differs from the published snapshot. The original event was preserved." } };
}

export async function publishResult(resultId: string): Promise<PublishOutcome> {
  return withPublishTransaction(resultId, async (repository) => {
    const state = await repository.getResult(); // SHARE locks source through comparison/commit.
    if (!state) return { kind: "not_found", resultId };
    const existing = await repository.getPublishEvent(); // Fresh statement after any lock wait.
    if (existing) return matchesSnapshot(state, existing) ? { kind: "existing", event: existing } : conflict(resultId);

    let snapshot: SourceSnapshot;
    try { snapshot = buildSnapshot(state); }
    catch (error) {
      if (!(error instanceof InvalidPublishData)) throw error;
      return { kind: "invalid", resultId, error: { code: error.code, field: error.field, message: error.message } };
    }
    const saved = await repository.createPublishEvent({
      eventId: randomUUID(), sourceSystem: SOURCE_SYSTEM, sourceSnapshot: snapshot,
      sourceHash: hashCanonicalJson(snapshot), publishedAt: new Date(),
    });
    // Includes the loser of a concurrent INSERT; never silently accept other content.
    if (!saved.created && !matchesSnapshot(state, saved.event)) return conflict(resultId);
    return { kind: saved.created ? "created" : "existing", event: saved.event };
  });
}
