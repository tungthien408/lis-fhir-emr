import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { NewLabResult, withPatientLinkTransaction } from "../../src/emr/repository.js";
import { canonicalJson } from "../../src/emr/canonical-json.js";
import { getLabResultsBySource, listLabResults, storeObservation, validateObservation } from "../../src/emr/service.js";
import { reverseKeys, setField, storedRow, validObservation } from "./service-fixtures.js";

type StoreRepository = { withPatientLinkTransaction: typeof withPatientLinkTransaction };
const patientKey = randomUUID();
function fakeRepository(inspect?: (input: NewLabResult) => void): StoreRepository {
  return { async withPatientLinkTransaction(system, value, operation) {
    assert.equal(system, "urn:uuid:b954f2c4-cfe0-575f-86c0-c1cba88052a4");
    assert.equal(value, "B4A-SYNTHETIC-P1");
    return operation({ patientKey, async createLabResult(input) {
      const prepared = { ...input, patientKey }; inspect?.(prepared);
      return { kind: "created", record: storedRow(prepared) };
    } });
  } };
}
async function rejectsBeforeDatabase(input: unknown) {
  let calls = 0;
  const outcome = await storeObservation(input, { async withPatientLinkTransaction() {
    calls++; throw new Error("Validation must precede the database");
  } });
  assert.equal(calls, 0);
  assert.ok(outcome.kind === "invalid" || outcome.kind === "unsupported");
  assert.equal(outcome.error.code, "VALIDATION_ERROR");
  return outcome;
}

test("valid frozen Mapper Observation maps every required field and returns only the persisted receipt", async () => {
  const input = validObservation(); const before = structuredClone(input);
  let prepared: NewLabResult | undefined;
  const result = await storeObservation(input, fakeRepository((value) => { prepared = value; }));
  assert.ok(prepared);
  assert.deepEqual(prepared, {
    targetId: prepared.targetId, patientKey, externalSystem: input.identifier[0].system, externalId: input.identifier[0].value,
    analyteSystem: input.code.coding[0].system, analyteCode: input.code.coding[0].code,
    analyteDisplay: input.code.coding[0].display, analyteContext: input.code.text,
    quantity: "3.4", unitText: "mEq/L", low: "3.3", high: "5.1",
    effectiveAt: input.effectiveDateTime, clinicalStatus: "final", fhirJson: input,
  });
  assert.notEqual(prepared.fhirJson, input);
  assert.deepEqual(input, before);
  assert.deepEqual(result, { kind: "stored", result: "STORED", external_system: input.identifier[0].system,
    external_id: input.identifier[0].value, patient_key: patientKey, target_id: prepared.targetId });
});

test("all required FHIR fields reject absence and wrong types before identity lookup", async (t) => {
  for (const path of [
    "resourceType", "status", "identifier", "identifier.0.system", "identifier.0.value", "category",
    "category.0.coding", "category.0.coding.0.system", "category.0.coding.0.code", "code", "code.coding",
    "code.coding.0.system", "code.coding.0.code", "code.coding.0.display", "code.text",
    "subject", "subject.type", "subject.identifier", "subject.identifier.system", "subject.identifier.value",
    "effectiveDateTime", "valueQuantity", "valueQuantity.value", "valueQuantity.unit",
  ]) await t.test(path, async () => {
    const missing = validObservation(); setField(missing, path, undefined, true); await rejectsBeforeDatabase(missing);
    for (const value of [null, false, {}, []]) {
      const malformed = validObservation(); setField(malformed, path, value); await rejectsBeforeDatabase(malformed);
    }
  });
});

test("wrong resource/status/category/namespaces and blank identifiers are rejected", async () => {
  for (const [path, value] of [
    ["resourceType", "DiagnosticReport"], ["status", "preliminary"], ["status", "amended"],
    ["identifier.0.system", "lis-demo"], ["identifier.0.value", "  "],
    ["subject.type", "Group"], ["subject.identifier.system", "urn:another-hospital"], ["subject.identifier.value", ""],
    ["category.0.coding.0.system", "urn:other"], ["category.0.coding.0.code", "vital-signs"],
    ["code.coding.0.system", "http://loinc.org"], ["code.coding.0.code", " A  B "],
    ["code.coding.0.display", " "], ["code.text", ""], ["valueQuantity.unit", " "],
  ]) { const input = validObservation(); setField(input, path, value); await rejectsBeforeDatabase(input); }
});

test("unsupported FHIR fields are rejected at every level, never stripped or reinterpreted", async () => {
  for (const [path, value] of [
    ["component", []], ["modifierExtension", []], ["extension", []], ["id", "new-id"], ["meta", {}],
    ["valueString", "3.4"], ["dataAbsentReason", {}], ["effectivePeriod", {}], ["note", []],
    ["identifier.0.use", "official"], ["subject.reference", "Patient/another"], ["subject.identifier.assigner", {}],
    ["code.coding.0.version", "other"], ["category.0.text", "different"],
    ["valueQuantity.comparator", "<"], ["valueQuantity.system", "http://unitsofmeasure.org"], ["valueQuantity.code", "mg"],
    ["referenceRange.0.appliesTo", []], ["referenceRange.0.low.comparator", ">"],
  ] as const) {
    const input = validObservation(); setField(input, path, value);
    assert.equal((await rejectsBeforeDatabase(input)).kind, "unsupported");
  }
  for (const path of ["identifier", "category", "code.coding", "category.0.coding", "referenceRange"]) {
    const input = validObservation();
    let value: unknown = input;
    for (const key of path.split(".")) value = (value as Record<string, unknown>)[key];
    const array = value as unknown[]; array.push(structuredClone(array[0]));
    await rejectsBeforeDatabase(input);
  }
});

test("non-JSON values, sparse arrays, getters, cycles, NUL and unpaired surrogates cannot enter storage", async () => {
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  for (const input of [undefined, null, true, 42, "{}", [], new Date(), cycle]) await rejectsBeforeDatabase(input);
  for (const value of [NaN, Infinity, -Infinity, undefined, 1n, () => 1, new Date(), "\u0000", "\ud800", "\udc00"]) {
    await rejectsBeforeDatabase({ ...validObservation(), extra: value });
  }
  const getter = validObservation();
  Object.defineProperty(getter, "resourceType", { enumerable: true, get() { throw new Error("must not execute"); } });
  await rejectsBeforeDatabase(getter);
  const sparse = validObservation(); delete (sparse.identifier as unknown[])[0]; await rejectsBeforeDatabase(sparse);
  const symbol = validObservation(); Object.assign(symbol, { [Symbol("hidden")]: "value" }); await rejectsBeforeDatabase(symbol);
});

test("quantity and both reference bounds require finite JSON numbers without coercion", async () => {
  for (const path of ["valueQuantity.value", "referenceRange.0.low.value", "referenceRange.0.high.value"]) {
    for (const value of ["3.4", null, true, NaN, Infinity, -Infinity, {}, [], undefined]) {
      const input = validObservation(); setField(input, path, value); await rejectsBeforeDatabase(input);
    }
  }
  for (const value of [0, -0, -3.141592653589793, Number.MIN_VALUE, Number.MAX_VALUE, 1e30, 0.30000000000000004]) {
    const input = validObservation(); input.valueQuantity.value = value;
    const result = await storeObservation(input, fakeRepository((row) => assert.equal(row.quantity, String(value))));
    assert.equal(result.kind, "stored");
  }
});

test("reference bounds support both, low-only, high-only or omitted range; reject empty, null and mixed units", async () => {
  for (const bounds of ["both", "low", "high", "none"]) {
    const input = validObservation();
    if (bounds === "none") delete input.referenceRange;
    else if (bounds === "low") delete input.referenceRange![0].high;
    else if (bounds === "high") delete input.referenceRange![0].low;
    assert.equal((await storeObservation(input, fakeRepository((row) => {
      assert.equal(row.low, bounds === "both" || bounds === "low" ? "3.3" : null);
      assert.equal(row.high, bounds === "both" || bounds === "high" ? "5.1" : null);
    }))).kind, "stored");
  }
  for (const [path, value] of [["referenceRange", null], ["referenceRange", []], ["referenceRange", [{}]],
    ["referenceRange.0.low", null], ["referenceRange.0.low.unit", "mg/dL"], ["referenceRange.0.low.value", 6]]) {
    const input = validObservation(); setField(input, path as string, value); await rejectsBeforeDatabase(input);
  }
});

test("timestamps require real dates, supported offsets and lossless PostgreSQL precision", async () => {
  for (const value of ["2026-02-29T12:00:00Z", "2100-02-29T12:00:00Z", "2026-04-31T12:00:00Z",
    "2026-00-01T00:00:00Z", "2026-13-01T00:00:00Z", "2026-01-00T00:00:00Z", "0000-01-01T00:00:00Z",
    "2026-01-01", "2026-01-01T00:00:00", "2026-01-01T24:00:00Z", "2026-01-01T23:60:00Z",
    "2026-01-01T23:59:60Z", "2026-01-01T00:00:00+14:01", "2026-01-01T00:00:00-15:00",
    "2026-01-01T00:00:00+07:60", "2026-01-01T00:00:00.1234567Z", "2026-01-01T00:00:00.0000001Z",
    "9999-12-31T23:59:59-01:00", "0001-01-01T00:00:00+01:00", "infinity"] ) {
    const input = validObservation(); input.effectiveDateTime = value; await rejectsBeforeDatabase(input);
  }
  for (const value of ["2000-02-29T12:00:00Z", "2026-01-01T00:00:00.000001+07:00",
    "2026-01-01T00:00:00.123456000Z", "2026-01-01T00:00:00+14:00", "0001-01-01T00:00:00Z", "9999-12-31T23:59:59.999999Z"]) {
    const input = validObservation(); input.effectiveDateTime = value;
    assert.equal((await storeObservation(input, fakeRepository((row) => assert.equal(row.effectiveAt, value)))).kind, "stored");
  }
});

test("missing and invalid linked patient keys never write or invent a patient", async () => {
  assert.equal((await storeObservation(validObservation(), { async withPatientLinkTransaction() { return undefined; } })).kind, "patient_not_linked");
  for (const invalidKey of ["", "not-uuid"]) {
    const result = await storeObservation(validObservation(), { async withPatientLinkTransaction(_system, _value, operation) {
      return operation({ patientKey: invalidKey, async createLabResult() { throw new Error("must not write"); } });
    } });
    assert.equal(result.kind, "patient_not_linked");
  }
});

test("pending storage retains a private copy even if the caller changes the original", async () => {
  const input = validObservation(); const before = structuredClone(input);
  const result = await storeObservation(input, { async withPatientLinkTransaction(_s, _v, operation) {
    input.subject.identifier.value = "changed"; input.valueQuantity.value = 99;
    input.effectiveDateTime = "2026-01-01T00:00:00Z";
    await Promise.resolve();
    return operation({ patientKey, async createLabResult(row) {
      assert.deepEqual(row.fhirJson, before); assert.equal(row.quantity, "3.4");
      return { kind: "created", record: storedRow({ ...row, patientKey }) };
    } });
  } });
  assert.equal(result.kind, "stored");
});

test("canonical comparison ignores object-key ordering but preserves arrays, strings and numeric meaning", () => {
  const input = validObservation();
  assert.equal(canonicalJson(input), canonicalJson(reverseKeys(input)));
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
  assert.notEqual(canonicalJson(3.4), canonicalJson("3.4"));
  assert.equal(canonicalJson(-0), canonicalJson(0));
  assert.equal(validateObservation(reverseKeys(input)).kind, "valid");
});

test("lookup/write/commit failures never produce success or reveal driver diagnostics", async () => {
  const secret = new Error("private synthetic clinical payload / connection string");
  for (const phase of ["lookup", "write", "commit"]) {
    const result = await storeObservation(validObservation(), { async withPatientLinkTransaction(_s, _v, operation) {
      if (phase === "lookup") throw secret;
      const result = await operation({ patientKey, async createLabResult(input) {
        if (phase === "write") throw secret;
        return { kind: "created", record: storedRow({ ...input, patientKey }) };
      } });
      if (phase === "commit") throw secret;
      return result;
    } });
    assert.equal(result.kind, "unavailable"); assert.doesNotMatch(JSON.stringify(result), /private|clinical payload|connection string/);
  }
});

test("source reads keep the exact pair and all rows; malformed filters never query", async () => {
  const outcome = await getLabResultsBySource("urn:system", " ID with spaces ", { async getLabResultsBySource(system, id) {
    assert.equal(system, "urn:system"); assert.equal(id, " ID with spaces "); return [];
  } });
  assert.deepEqual(outcome, { kind: "found", items: [] });
  for (const [system, id] of [["", "id"], ["system", " "], [null, "id"], ["system", []]]) {
    const result = await getLabResultsBySource(system, id, { async getLabResultsBySource() { assert.fail("Must not query"); } });
    assert.equal(result.kind, "invalid");
  }
});

test("patient listing validates UUID and numeric pagination, passes defaults and returns empty pages", async () => {
  const listed = await listLabResults({ patientKey }, { async listLabResults(options) {
    assert.deepEqual(options, { patientKey, limit: 20, offset: 0 }); return [];
  } });
  assert.deepEqual(listed, { kind: "found", items: [], limit: 20, offset: 0 });
  for (const input of [{}, { patientKey: "bad" }, { patientKey, limit: 0 }, { patientKey, limit: 101 },
    { patientKey, limit: 1.2 }, { patientKey, limit: "20" }, { patientKey, limit: null },
    { patientKey, offset: -1 }, { patientKey, offset: NaN }, { patientKey, offset: Infinity },
    { patientKey, offset: Number.MAX_SAFE_INTEGER + 1 }, { patientKey, offset: "0" },
    { patientKey, externalId: "mixed" }, null, []]) {
    const result = await listLabResults(input, { async listLabResults() { assert.fail("Must not query"); } });
    assert.ok(result.kind === "invalid" || result.kind === "unsupported");
  }
});

test("both read modes return typed unavailable outcomes on database failure", async () => {
  const result = await getLabResultsBySource("source", "id", { async getLabResultsBySource() { throw new Error("private"); } });
  const page = await listLabResults({ patientKey }, { async listLabResults() { throw new Error("private"); } });
  assert.equal(result.kind, "unavailable"); assert.equal(page.kind, "unavailable");
});
