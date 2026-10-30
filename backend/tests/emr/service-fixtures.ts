import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { LabResult, NewLabResult } from "../../src/emr/repository.js";
import type { SupportedObservation } from "../../src/emr/service.js";

/** Frozen synthetic B4A output: compatibility fixture, no live Middleware import. */
export function validObservation(): SupportedObservation {
  const value = JSON.parse(readFileSync(new URL("../middleware/fixtures/observation-r4-golden.json", import.meta.url), "utf8")) as SupportedObservation;
  value.identifier[0].value = `C2-SYNTHETIC-${randomUUID()}`;
  return value;
}

export function storedRow(input: NewLabResult): LabResult {
  return {
    target_id: input.targetId, patient_key: input.patientKey,
    external_system: input.externalSystem, external_id: input.externalId,
    analyte_system: input.analyteSystem, analyte_code: input.analyteCode,
    analyte_display: input.analyteDisplay ?? null, analyte_context: input.analyteContext ?? null,
    quantity: input.quantity, unit_text: input.unitText, low: input.low ?? null, high: input.high ?? null,
    effective_at: input.effectiveAt, clinical_status: input.clinicalStatus, fhir_json: structuredClone(input.fhirJson),
    received_at: "2026-10-29T00:00:00.123456Z", stored_at: "2026-10-29T00:00:00.123457Z",
  };
}

export function setField(input: unknown, path: string, value: unknown, remove = false): void {
  const keys = path.split("."); const last = keys.pop()!;
  let record = input as Record<string, unknown>;
  for (const key of keys) record = record[key] as Record<string, unknown>;
  if (remove) delete record[last]; else record[last] = value;
}

export function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)]));
  }
  return value;
}
