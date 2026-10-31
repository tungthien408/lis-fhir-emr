import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { SourceEnvelope, SourceSnapshot } from "../../src/middleware/repository.js";
import type { FhirR4LabObservation } from "../../src/middleware/mapper.js";
import { hashCanonicalJson } from "../../src/lis/canonical-json.js";

export interface ExpectedColumns {
  external_system: string; external_id: string; analyte_system: string; analyte_code: string;
  analyte_display: string; analyte_context: string; quantity: string; unit_text: string;
  low: string | null; high: string | null; effective_at: string; clinical_status: string;
}
type ClinicalSource = Pick<SourceSnapshot, "value_num" | "reference_low" | "reference_high" | "effective_at">;
type ClinicalExpected = Pick<ExpectedColumns, "quantity" | "low" | "high" | "effective_at">;
interface FixtureFile {
  snapshot: SourceSnapshot; observation: FhirR4LabObservation; columns: ExpectedColumns;
  variants: { name: string; source: ClinicalSource; expected: ClinicalExpected }[];
}
export const fixtureFile = new URL("./fixtures/c4-synthetic.json", import.meta.url);
const golden = JSON.parse(readFileSync(fixtureFile, "utf8")) as FixtureFile;
export const variants = golden.variants.map((variant) => variant.name);

/** Independent clinical answers are authored in JSON BEFORE Worker/Mapper runs. */
export function createFixture(variantName = "both") {
  const variant = golden.variants.find((item) => item.name === variantName);
  if (!variant) throw new Error("Unknown C4 fixture variant");
  const suffix = randomUUID();
  const resultId = `C4-SYNTHETIC-R-${suffix}`; const patientId = `C4-SYNTHETIC-P-${suffix}`;
  const snapshot = { ...structuredClone(golden.snapshot), ...variant.source, result_id: resultId, patient_id: patientId };
  const envelope: SourceEnvelope = { event_id: randomUUID(), source_system: "c4-synthetic-lis",
    source_result_id: resultId, source_snapshot: snapshot, source_hash: hashCanonicalJson(snapshot),
    published_at: "2026-10-29T09:00:00.123456Z" };
  const columns = { ...structuredClone(golden.columns), ...variant.expected, external_id: resultId };
  const observation = structuredClone(golden.observation);
  observation.identifier[0].value = resultId; observation.subject.identifier.value = patientId;
  // Only expected JSON numbers are converted here; actual NUMERIC responses are NEVER coerced.
  observation.valueQuantity.value = Number(variant.expected.quantity);
  observation.effectiveDateTime = variant.source.effective_at;
  const range = { ...(variant.expected.low === null ? {} : { low: { value: Number(variant.expected.low), unit: "mg/dL" } }),
    ...(variant.expected.high === null ? {} : { high: { value: Number(variant.expected.high), unit: "mg/dL" } }) };
  if (variant.expected.low === null && variant.expected.high === null) delete observation.referenceRange;
  else observation.referenceRange = [range as NonNullable<FhirR4LabObservation["referenceRange"]>[0]];
  return { variant: variantName, envelope, observation, columns, patientKey: randomUUID(), decoyPatientKey: randomUUID() };
}
export type C4Fixture = ReturnType<typeof createFixture>;
