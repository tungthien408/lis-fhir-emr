import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  mapObservation, OBSERVATION_MAPPING_VERSION,
  type FhirR4LabObservation, type ObservationSourceSnapshot,
} from "../../src/middleware/mapper.js";

const source: ObservationSourceSnapshot = JSON.parse(readFileSync(
  new URL("./fixtures/mapper-source-golden.json", import.meta.url), "utf8",
));
const golden: FhirR4LabObservation = JSON.parse(readFileSync(
  new URL("./fixtures/observation-r4-golden.json", import.meta.url), "utf8",
));

function mapped(snapshot: ObservationSourceSnapshot = source): FhirR4LabObservation {
  const result = mapObservation(snapshot);
  assert.ok(result.kind === "mapped", JSON.stringify(result));
  assert.equal(result.mappingVersion, OBSERVATION_MAPPING_VERSION);
  return result.observation;
}

/** Deliberately break the typed caller contract to check defensive outcomes. */
function unsafe(changes: Record<string, unknown>): ObservationSourceSnapshot {
  return { ...source, ...changes } as unknown as ObservationSourceSnapshot;
}

test("full mapping equals the reviewed golden FHIR JSON and returns a project-local version", () => {
  assert.deepEqual(mapped(), golden);
  assert.equal(OBSERVATION_MAPPING_VERSION, "lis-observation-v2");
  assert.equal("mappingVersion" in mapped(), false, "Version is metadata for the future Worker, not a FHIR field");
  assert.equal("meta" in mapped(), false);
});

test("MR01 preserves the complete result identifier and its namespace", () => {
  const result_id = " LIS-Result/Đ-001 ";
  assert.deepEqual(mapped({ ...source, result_id }).identifier,
    [{ system: "urn:uuid:05934370-0df0-5666-8eff-bd5181906b62", value: result_id }]);
  assert.equal("id" in mapped(), false);
});

test("MR02 uses the LIS patient identifier without inventing an EMR patient_key or resource reference", () => {
  const patient_id = "LIS-Patient/AbC-001";
  const observation = mapped({ ...source, patient_id });
  assert.deepEqual(observation.subject, {
    type: "Patient", identifier: { system: "urn:uuid:b954f2c4-cfe0-575f-86c0-c1cba88052a4", value: patient_id },
  });
  assert.equal("patient_key" in observation.subject, false);
  assert.equal("reference" in observation.subject, false);
});

test("MR03 preserves the local test code/display and does not assert LOINC", () => {
  const observation = mapped({ ...source, test_code: "Local CODE-01", test_name: "Xét nghiệm giả" });
  assert.deepEqual(observation.code.coding, [{
    system: "urn:uuid:cb8ffc71-ef38-58d2-ba65-0bf0232d5d02", code: "Local CODE-01", display: "Xét nghiệm giả",
  }]);
  assert.doesNotMatch(JSON.stringify(observation.code), /loinc/i);
});

test("MR04 preserves finite numbers, signed zero, negatives, exponents and extremes without rounding", () => {
  for (const value of [0, -0, -2.5, 3.4000000000000004, 1e-7, 1e21, Number.MIN_VALUE, Number.MAX_VALUE]) {
    assert.ok(Object.is(mapped({ ...source, value_num: value }).valueQuantity.value, value));
  }
});

test("MR05 preserves source units exactly, including Unicode, without inventing UCUM coding", () => {
  for (const unit of ["mEq/L", " mg/dL ", "µmol/L", "10^9/L"]) {
    const observation = mapped({ ...source, unit });
    assert.deepEqual(observation.valueQuantity, { value: source.value_num, unit });
    for (const quantity of [observation.valueQuantity, observation.referenceRange![0].low!, observation.referenceRange![0].high!]) {
      assert.equal(quantity.unit, unit);
      assert.deepEqual(Object.keys(quantity).sort(), ["unit", "value"]);
    }
  }
});

for (const [name, low, high] of [
  ["both bounds", 3.3, 5.1], ["low only", 3.3, null], ["high only", null, 5.1],
  ["both null", null, null], ["both omitted", undefined, undefined],
  ["zero low", 0, null], ["zero high", null, 0], ["equal bounds", 0, 0],
] as const) {
  test(`MR06 reference range: ${name}`, () => {
    const observation = mapped({ ...source, reference_low: low, reference_high: high });
    if (low == null && high == null) {
      assert.equal(Object.hasOwn(observation, "referenceRange"), false, "R4 obs-3 forbids an empty range item");
    } else {
      assert.deepEqual(observation.referenceRange, [{
        ...(low == null ? {} : { low: { value: low, unit: source.unit } }),
        ...(high == null ? {} : { high: { value: high, unit: source.unit } }),
      }]);
      assert.equal(JSON.stringify(observation.referenceRange).includes("null"), false);
    }
  });
}

test("MR07 preserves complete timestamps and fractional digits without changing their instant", () => {
  for (const effective_at of [
    "2180-06-03T12:00:00.123456Z", "2026-10-22T16:00:00.123456789+07:00",
    "2026-10-22T05:30:00.000001-03:30", "0004-02-29T00:00:00.000001Z",
    "9999-12-31T23:59:59.999999Z", "2026-10-22T00:00:00+14:00", "2026-10-22T00:00:00-14:00",
  ]) assert.equal(mapped({ ...source, effective_at }).effectiveDateTime, effective_at);
});

test("MR08 maps FINAL to final; unsupported source statuses never produce a partial Observation", () => {
  assert.equal(mapped().status, "final");
  for (const result_status of ["READY", "final", "AMENDED", ""]) {
    const result = mapObservation(unsafe({ result_status }));
    assert.ok(result.kind === "unsupported");
    assert.equal(result.error.code, "UNSUPPORTED_SOURCE_VALUE"); assert.equal(result.error.field, "result_status");
    assert.equal("observation" in result, false);
  }
});

test("MR09 constructs source context in fixed name / fluid / category order and uses laboratory coding", () => {
  const observation = mapped();
  assert.equal(observation.code.text, "Potassium / Blood / Chemistry");
  assert.deepEqual(observation.category, [{ coding: [{
    system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory",
  }] }]);
  for (const [fluid, category, expected] of [
    [null, "Chemistry", "Potassium / Chemistry"], ["Blood", null, "Potassium / Blood"],
    [null, null, "Potassium"], [undefined, undefined, "Potassium"],
    ["", "  ", "Potassium"], [" Blood ", "Chemistry", "Potassium /  Blood  / Chemistry"],
  ] as const) {
    const text = mapped({ ...source, fluid, category }).code.text;
    assert.equal(text, expected); assert.doesNotMatch(text, /null|undefined/);
  }
});

test("invalid dates, times, numeric values and inverted bounds return explicit invalid outcomes", () => {
  const invalid: [Record<string, unknown>, string][] = [
    ...[NaN, Infinity, -Infinity, "3.4", null, undefined].map((value_num): [Record<string, unknown>, string] => [{ value_num }, "value_num"]),
    [{ reference_low: Infinity }, "reference_low"], [{ reference_high: "5.1" }, "reference_high"],
    [{ reference_low: 5.1, reference_high: 3.3 }, "reference_low"],
    ...["2026-02-29T00:00:00Z", "2100-02-29T00:00:00Z", "2026-04-31T00:00:00Z",
      "2026-00-01T00:00:00Z", "2026-01-00T00:00:00Z", "2026-13-01T00:00:00Z",
      "2026-10-22", "2026-10-22T12:00:00", "2026-10-22T24:00:00Z", "2026-10-22T00:60:00Z",
      "2026-10-22T00:00:60Z", "0000-01-01T00:00:00Z", "infinity", "2026-10-22T00:00:00+25:00",
    ].map((effective_at): [Record<string, unknown>, string] => [{ effective_at }, "effective_at"]),
  ];
  for (const [input, field] of invalid) {
    const result = mapObservation(unsafe(input));
    assert.ok(result.kind === "invalid", JSON.stringify(result));
    assert.equal(result.error.code, "INVALID_SOURCE_VALUE"); assert.equal(result.error.field, field);
    assert.equal("observation" in result, false);
  }
});

test("FHIR-incompatible code whitespace and timezone offsets are reported without silently changing them", () => {
  for (const input of [
    { test_code: " 50971" }, { test_code: "50971 " }, { test_code: "A  B" }, { test_code: "A\tB" },
    { effective_at: "2026-10-22T00:00:00+14:01" }, { effective_at: "2026-10-22T00:00:00-15:59" },
  ]) {
    const result = mapObservation(unsafe(input)); assert.ok(result.kind === "unsupported");
    assert.equal("observation" in result, false);
  }
});

test("missing/invalid required text and optional context values fail without inventing data", () => {
  for (const field of ["result_id", "patient_id", "test_code", "test_name", "unit", "effective_at"]) {
    for (const value of [undefined, null, 42, "  "]) {
      const result = mapObservation(unsafe({ [field]: value }));
      assert.ok(result.kind === "invalid"); assert.equal(result.error.field, field);
    }
  }
  for (const field of ["fluid", "category", "result_status"]) {
    const result = mapObservation(unsafe({ [field]: 42 })); assert.ok(result.kind === "invalid");
    assert.equal(result.error.field, field);
  }
  for (const value of [null, undefined, []]) {
    assert.equal(mapObservation(value as unknown as ObservationSourceSnapshot).kind, "invalid");
  }
});

test("unrepresentable strings and combined context exceeding the FHIR string limit return unsupported", () => {
  for (const test_name of ["\u0000", "\ud800", "x".repeat(1024 * 1024 + 1)]) {
    assert.equal(mapObservation({ ...source, test_name }).kind, "unsupported");
  }
  const result = mapObservation({ ...source, test_name: "x".repeat(600000), fluid: "y".repeat(600000) });
  assert.ok(result.kind === "unsupported"); assert.equal(result.error.field, "code.text");
  assert.equal(mapped({ ...source, test_name: "Xét nghiệm 😀" }).code.coding[0].display, "Xét nghiệm 😀");
});

test("mapping is deterministic, accepts a frozen snapshot and never shares mutable output objects", () => {
  const original = structuredClone(source); const frozen = Object.freeze(structuredClone(source));
  const first = mapped(frozen); const second = mapped(frozen);
  assert.deepEqual(first, second); assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.notEqual(first, second); assert.notEqual(first.valueQuantity, second.valueQuantity);
  first.identifier[0].value = "changed"; first.valueQuantity.value = 9;
  first.referenceRange![0].low!.value = -9;
  assert.deepEqual(frozen, original); assert.deepEqual(second, golden); assert.deepEqual(mapped(frozen), golden);
});

test("equivalent snapshot key order yields the same output and source-only extras do not create clinical facts", () => {
  const reordered = Object.fromEntries(Object.entries(source).reverse()) as ObservationSourceSnapshot;
  assert.deepEqual(mapped(reordered), mapped(source));
  assert.deepEqual(mapped(unsafe({ extra: { synthetic: true }, patient_key: "not-an-emr-identity", interpretation: "high" })), golden);
});
