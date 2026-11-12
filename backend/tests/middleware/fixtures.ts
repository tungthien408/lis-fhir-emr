import { randomUUID } from "node:crypto";
import type { NewExchange } from "../../src/middleware/repository.js";

/** Synthetic data only. The future Service supplies validation/hash calculation. */
export function newExchange(): NewExchange {
  const resultId = `B1TEST-${randomUUID()}`;
  return {
    sourceEnvelope: {
      event_id: randomUUID(), source_system: "b1-synthetic-lis", source_result_id: resultId,
      source_snapshot: {
        result_id: resultId, patient_id: "B1-SYNTHETIC-PATIENT", test_code: "50912",
        test_name: "Synthetic analyte", fluid: "Blood", category: "Chemistry",
        value_num: 3.4, unit: "mg/dL", reference_low: null, reference_high: 5.1,
        effective_at: "2026-10-22T08:00:00.123456Z", result_status: "FINAL",
      },
      source_hash: "a".repeat(64), published_at: "2026-10-22T09:00:00.123456Z",
    },
  };
}

export function hasSqlState(error: unknown, code: string): boolean {
  if (!(error instanceof Error)) return false;
  if ("code" in error && error.code === code) return true;
  return hasSqlState(error.cause, code);
}
