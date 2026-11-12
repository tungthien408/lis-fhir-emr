import { randomUUID } from "node:crypto";
import type { NewLabResult } from "../../src/emr/repository.js";

export function newLabResult(patientKey = randomUUID()): NewLabResult {
  const externalId = `C1-SYNTHETIC-${randomUUID()}`;
  return {
    targetId: randomUUID(), patientKey,
    externalSystem: "urn:uuid:05934370-0df0-5666-8eff-bd5181906b62", externalId,
    analyteSystem: "urn:uuid:cb8ffc71-ef38-58d2-ba65-0bf0232d5d02", analyteCode: "C1-TEST",
    analyteDisplay: "Synthetic test", analyteContext: "Synthetic test / Blood / Chemistry",
    quantity: "3.4000", unitText: "mg/dL", low: "1.2000", high: "5.1000",
    effectiveAt: "2026-10-22T15:00:00.123456+07:00", clinicalStatus: "final",
    fhirJson: {
      resourceType: "Observation",
      identifier: [{ system: "urn:uuid:05934370-0df0-5666-8eff-bd5181906b62", value: externalId }],
      status: "final",
      category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory" }] }],
      code: { coding: [{ system: "urn:uuid:cb8ffc71-ef38-58d2-ba65-0bf0232d5d02", code: "C1-TEST", display: "Synthetic test" }],
        text: "Synthetic test / Blood / Chemistry" },
      subject: { type: "Patient", identifier: { system: "urn:uuid:b954f2c4-cfe0-575f-86c0-c1cba88052a4", value: "C1-SYNTHETIC-P" } },
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
