import { randomUUID } from "node:crypto";
import type { NewLabResult } from "../../src/emr/repository.js";

export function newLabResult(patientKey = randomUUID()): NewLabResult {
  const externalId = `C1-SYNTHETIC-${randomUUID()}`;
  return {
    targetId: randomUUID(), patientKey,
    externalSystem: "https://example.org/lis/result", externalId,
    analyteSystem: "https://example.org/lis/test-code", analyteCode: "C1-TEST",
    analyteDisplay: "Synthetic test", analyteContext: "Synthetic test / Blood / Chemistry",
    quantity: "3.4000", unitText: "mg/dL", low: "1.2000", high: "5.1000",
    effectiveAt: "2026-10-22T15:00:00.123456+07:00", clinicalStatus: "final",
    fhirJson: {
      resourceType: "Observation",
      identifier: [{ system: "https://example.org/lis/result", value: externalId }],
      status: "final",
      category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory" }] }],
      code: { coding: [{ system: "https://example.org/lis/test-code", code: "C1-TEST", display: "Synthetic test" }],
        text: "Synthetic test / Blood / Chemistry" },
      subject: { type: "Patient", identifier: { system: "https://example.org/lis/patient", value: "C1-SYNTHETIC-P" } },
      effectiveDateTime: "2026-10-22T15:00:00.123456+07:00",
      valueQuantity: { value: 3.4, unit: "mg/dL" },
      referenceRange: [{ low: { value: 1.2, unit: "mg/dL" }, high: { value: 5.1, unit: "mg/dL" } }],
    },
  };
}

export function hasSqlState(error: unknown, state: string): boolean {
  if (error === null || typeof error !== "object") return false;
  if ("code" in error && error.code === state) return true;
  return "cause" in error && hasSqlState(error.cause, state);
}
