import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { SourceSnapshot } from "../../src/lis/service.js";
import type { FhirR4LabObservation } from "../../src/middleware/mapper.js";
import type { ExpectedColumns } from "../integration/c4-fixtures.js";

interface GoldenFile {
  provenance: string;
  catalog: { test_code: string; test_name: string; fluid: string; category: string; accepted_units: string[]; catalog_version: string };
  snapshot: SourceSnapshot;
  observation: FhirR4LabObservation;
  columns: ExpectedColumns;
  variants: { name: string;
    source: { value_num: string; reference_low: string | null; reference_high: string | null; effective_at: string };
    expected: Pick<ExpectedColumns, "quantity" | "low" | "high" | "effective_at"> }[];
}
export const fixtureFile = new URL("./fixtures/d3-synthetic.json", import.meta.url);
const text = readFileSync(fixtureFile, "utf8");
const golden = JSON.parse(text) as GoldenFile;
export const fixtureSha256 = createHash("sha256").update(text).digest("hex");
export const variants = golden.variants.map((variant) => variant.name);

/** Independent test oracle: never calls LIS canonicalization or Middleware Mapper. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
    return JSON.stringify(value);
  }
  throw new Error("Unsupported value in independent D3 JSON oracle");
}
export function digest(value: unknown): string { return createHash("sha256").update(stableJson(value)).digest("hex"); }

/** All clinical answers are fixed in the fixture file before any production code runs. */
export function createFixture(name = "both") {
  const variant = golden.variants.find((candidate) => candidate.name === name);
  if (!variant) throw new Error("Unknown D3 fixture variant");
  const id = randomUUID(); const resultId = `D3-SYNTHETIC-R-${id}`; const patientId = `D3-SYNTHETIC-P-${id}`;
  const catalog = { ...structuredClone(golden.catalog), test_code: `${golden.catalog.test_code}-${id}` };
  const columns = { ...structuredClone(golden.columns), ...variant.expected, external_id: resultId, analyte_code: catalog.test_code };
  // Number conversion is only for pre-authored expected JSON. Actual NUMERIC values stay strings.
  const snapshot: SourceSnapshot = { ...structuredClone(golden.snapshot), result_id: resultId, patient_id: patientId,
    test_code: catalog.test_code, value_num: Number(variant.expected.quantity),
    reference_low: variant.expected.low === null ? null : Number(variant.expected.low),
    reference_high: variant.expected.high === null ? null : Number(variant.expected.high), effective_at: variant.expected.effective_at };
  const observation = structuredClone(golden.observation);
  observation.identifier[0].value = resultId; observation.subject.identifier.value = patientId;
  observation.code.coding[0].code = catalog.test_code;
  observation.valueQuantity.value = Number(variant.expected.quantity); observation.effectiveDateTime = variant.expected.effective_at;
  if (variant.expected.low === null && variant.expected.high === null) delete observation.referenceRange;
  else observation.referenceRange = [{
    ...(variant.expected.low === null ? {} : { low: { value: Number(variant.expected.low), unit: "mg/dL" } }),
    ...(variant.expected.high === null ? {} : { high: { value: Number(variant.expected.high), unit: "mg/dL" } }),
  } as NonNullable<FhirR4LabObservation["referenceRange"]>[0]];
  const source = { result_id: resultId, patient_id: patientId, test_code: catalog.test_code,
    ...variant.source, unit: "mg/dL", result_status: "FINAL", provenance: { fixture: name, origin: "D3 synthetic only" } };
  return { name, resultId, patientId, catalog, source, snapshot, columns, observation,
    patientKey: randomUUID(), decoyKey: randomUUID(), expectedPatientLabel: `D3-SYNTHETIC-EXPECTED-${id}`,
    provenance: golden.provenance };
}
export type D3Fixture = ReturnType<typeof createFixture>;
