import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { FhirR4LabObservation } from "../../src/middleware/mapper.js";
import { loadWorkerConfig, validateWorkerConfig } from "../../src/middleware/worker-config.js";
import { sameDecimal, sameInstant, storageReceipt, verifyReadBack } from "../../src/middleware/worker-verification.js";
import { labItem } from "./worker-emr-mock.js";

const observation = JSON.parse(readFileSync(new URL("./fixtures/observation-r4-golden.json", import.meta.url), "utf8")) as FhirR4LabObservation;
function fixture() {
  const item = labItem(observation);
  const receipt = storageReceipt(201, { result: "STORED", ...item }, observation);
  assert.ok(receipt); return { item, receipt };
}

test("worker config requires explicit origin, bounds timers/retries and snapshots immutable settings", () => {
  const config = loadWorkerConfig({ EMR_BASE_URL: "http://127.0.0.1:3103/" });
  assert.deepEqual(config.retryDelaysMs, [2000, 4000, 8000]);
  assert.equal(config.httpTimeoutMs, 3000); assert.equal(config.leaseMs, 15000);
  assert.equal(config.emrBaseUrl, "http://127.0.0.1:3103");
  assert.ok(Object.isFrozen(config) && Object.isFrozen(config.retryDelaysMs));
  assert.deepEqual(loadWorkerConfig({ EMR_BASE_URL: config.emrBaseUrl, MIDDLEWARE_WORKER_RETRY_DELAYS_MS: "" }).retryDelaysMs, []);
  for (const url of ["", "ftp://host", "http://user:secret@host", "http://host/base", "http://host/?x=1", "http://host/#secret"]) {
    assert.throws(() => loadWorkerConfig({ EMR_BASE_URL: url }));
  }
  for (const patch of [{ httpTimeoutMs: 0 }, { leaseMs: 3000 }, { pollMs: 0 }, { retryDelaysMs: [-1] },
    { retryDelaysMs: Array<number>(11).fill(100) }, { retryDelaysMs: [Infinity] }]) {
    assert.throws(() => validateWorkerConfig({ ...config, ...patch }));
  }
  for (const value of ["1e3", "-1", "1, 2", "NaN"]) assert.throws(() => loadWorkerConfig({
    EMR_BASE_URL: config.emrBaseUrl, MIDDLEWARE_WORKER_RETRY_DELAYS_MS: value,
  }));
});
test("decimal comparison preserves precision, accepts scale/exponents, rejects rounded impostors", () => {
  for (const [text, value] of [["3.4000", 3.4], ["34e-1", 3.4], ["-0.00", 0], ["001.20", 1.2],
    [String(Number.MIN_VALUE), Number.MIN_VALUE], [String(Number.MAX_VALUE), Number.MAX_VALUE]] as const) assert.ok(sameDecimal(text, value));
  for (const actual of ["3.4000000000000000000001", " 3.4", "", null, 3.4, "NaN", "Infinity", "0x3.4", "1e" ]) {
    assert.equal(sameDecimal(actual, 3.4), false);
  }
  assert.equal(sameDecimal("9007199254740993", 9007199254740992), false);
  assert.equal(sameDecimal("1e999999999999999999999999999", 1), false);
});
test("timestamp comparison accepts equivalent offsets and preserves ALL fractional digits", () => {
  assert.ok(sameInstant("2180-06-03T19:00:00.123456000+07:00", observation.effectiveDateTime));
  assert.ok(sameInstant("1969-12-31T23:59:59.000001Z", "1970-01-01T06:59:59.000001+07:00"));
  assert.equal(sameInstant("2180-06-03T12:00:00.123457Z", observation.effectiveDateTime), false);
  assert.equal(sameInstant("2180-06-03T12:00:00.123456001Z", observation.effectiveDateTime), false);
  for (const value of ["2026-02-30T00:00:00Z", "2026-01-01T24:00:00Z", "2026-01-01T00:00:00", "0000-01-01T00:00:00Z", "2026-01-01T00:00:00+14:01"]) {
    assert.equal(sameInstant(value, value), false);
  }
});
test("storage receipts require matching identity, status/result pair, UUIDs, and allowlist fields", () => {
  const { receipt } = fixture();
  assert.deepEqual(storageReceipt(201, { ...receipt, secret: "discard" }, observation), receipt);
  assert.ok(storageReceipt(200, { ...receipt, result: "ALREADY_EXISTS" }, observation));
  for (const patch of [{ result: "ALREADY_EXISTS" }, { external_system: "lis-demo" }, { external_id: "other" },
    { patient_key: "patient-source-id" }, { target_id: "" }, { patient_key: undefined }]) {
    assert.equal(storageReceipt(201, { ...receipt, ...patch }, observation), undefined);
  }
  assert.equal(storageReceipt(202, receipt, observation), undefined);
});
test("read-back checks each MR field, target/patient receipt, and the stored FHIR", () => {
  const { item, receipt } = fixture();
  assert.deepEqual(verifyReadBack({ items: [item] }, observation, receipt), []);
  for (const [field, value] of Object.entries({ external_system: "lis-demo", external_id: "other", target_id: randomUUID(),
    patient_key: randomUUID(), analyte_system: "wrong", analyte_code: "wrong", analyte_display: "wrong",
    analyte_context: "wrong", quantity: "3.4000000000000001", unit_text: "wrong", low: "3.4", high: null,
    effective_at: "2180-06-03T12:00:00.123457Z", clinical_status: "preliminary", fhir_json: {} })) {
    assert.ok(verifyReadBack({ items: [{ ...item, [field]: value }] }, observation, receipt).includes(field), field);
  }
});
test("read-back requires exactly one item and explicit null missing bounds", () => {
  const { item, receipt } = fixture();
  for (const body of [null, {}, { items: [] }, { items: [item, item] }, { items: [null] }]) {
    assert.ok(verifyReadBack(body, observation, receipt).length > 0);
  }
  for (const referenceRange of [undefined, [{ low: { value: 0, unit: observation.valueQuantity.unit } }],
    [{ high: { value: 5.1, unit: observation.valueQuantity.unit } }]] as const) {
    const expected = structuredClone(observation);
    if (referenceRange) expected.referenceRange = structuredClone(referenceRange) as FhirR4LabObservation["referenceRange"];
    else delete expected.referenceRange;
    const actual = labItem(expected, receipt.patient_key, receipt.target_id);
    assert.deepEqual(verifyReadBack({ items: [actual] }, expected, receipt), []);
    if (actual.low === null) assert.ok(verifyReadBack({ items: [{ ...actual, low: undefined }] }, expected, receipt).includes("low"));
  }
});
test("stored FHIR patient identifier and laboratory group must match even if columns match", () => {
  const { item, receipt } = fixture();
  for (const change of [
    (fhir: FhirR4LabObservation) => { fhir.subject.identifier.value = "wrong-patient"; },
    (fhir: FhirR4LabObservation) => { fhir.category = [] as unknown as FhirR4LabObservation["category"]; },
  ]) {
    const actual = structuredClone(item); change(actual.fhir_json);
    assert.deepEqual(verifyReadBack({ items: [actual] }, observation, receipt), ["fhir_json"]);
  }
  // Valid JSON syntax can still overflow JS numbers after JSON.parse.
  const overflow = JSON.parse('{"value":1e999}') as unknown;
  assert.deepEqual(verifyReadBack({ items: [{ ...item, fhir_json: { ...item.fhir_json, overflow } }] }, observation, receipt), ["fhir_json"]);
});
