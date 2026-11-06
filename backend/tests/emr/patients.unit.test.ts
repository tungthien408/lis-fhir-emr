import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { findPatient } from "../../src/emr/service.js";
import { registerEmrRoutes } from "../../src/emr/controller.js";
import * as service from "../../src/emr/service.js";
import { requestJson, startHttpServer } from "./http-test-helpers.js";
const key = "00000000-0000-4000-8000-000000000001";
const patient = { patient_key: key, display_label: null, identifiers: [{ identifier_system: "urn:synthetic", identifier_value: " P/AbC " }] };
test("Patient service forwards exact identity and UUID; never normalizes external keys", async () => {
  for (const query of [{ patient_key: key.toUpperCase() }, { identifier_system: "urn:synthetic", identifier_value: " P/AbC " }]) {
    assert.deepEqual(await findPatient(query, { async findPatient(input) { assert.deepEqual(input, query); return patient; } }), { kind: "found", patient });
  }
});
test("Patient service rejects incomplete/mixed/extra inputs before repository", async () => {
  for (const input of [null, [], {}, { patient_key: "bad" }, { identifier_system: "urn:x" }, { identifier_value: "x" },
    { patient_key: key, identifier_value: "x" }, { patient_key: key, limit: 20 },
    { identifier_system: "urn:x", identifier_value: " " }, { identifier_system: "urn:x", identifier_value: "x\n" }]) {
    const result = await findPatient(input, { async findPatient() { assert.fail("Must validate before reading"); } });
    assert.ok(result.kind === "invalid" || result.kind === "unsupported");
  }
});
test("Patient service distinguishes absent patient and sanitized dependency failure", async () => {
  const query = { patient_key: key };
  assert.equal((await findPatient(query, { async findPatient() { return undefined; } })).kind, "not_found");
  const result = await findPatient(query, { async findPatient() { throw new Error("SQL private token"); } });
  assert.equal(result.kind, "unavailable"); assert.ok(!JSON.stringify(result).includes("private"));
});
test("Patient HTTP exact modes, not-found, query validation, DB failure and no-store", async t => {
  const dependencies = { ...service, checkDatabase: async () => ({ status: "ready" as const, schema: "emr" }),
    findPatient: (query: unknown) => findPatient(query, { async findPatient() { return patient; } }) };
  const app = express(); registerEmrRoutes(app, dependencies); const server = await startHttpServer(app); t.after(server.close);
  for (const query of ["patient_key=" + key, "identifier_system=urn%3Asynthetic&identifier_value=%20P%2FAbC%20"]) {
    const response = await fetch(server.baseUrl + "/api/patients?" + query);
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { patient });
  }
  for (const query of ["", "patient_key=bad", "identifier_system=urn:x", "identifier_value=x", "patient_key=" + key + "&identifier_value=x",
    "patient_key=" + key + "&patient_key=" + key, "identifier_system=x&identifier_value=x&identifier_value=y",
    "patient_key=" + key + "&offset=0", "patient_key[]=" + key, "identifier_system=x&identifier_value=%00", "identifier_system=x&identifier_value=%ZZ"]) {
    assert.equal((await requestJson(server.baseUrl, "/api/patients?" + query)).status, 400, query);
  }
  let mock = t.mock.method(dependencies, "findPatient", async () => ({ kind: "not_found" as const, error: { code: "NOT_FOUND" as const, message: "Patient not found" } }));
  assert.deepEqual(await requestJson(server.baseUrl, "/api/patients?patient_key=" + key), { status: 404, body: { error: { code: "NOT_FOUND", message: "Patient not found" } } }); mock.mock.restore();
  mock = t.mock.method(dependencies, "findPatient", async () => { throw new Error("private SQL token"); });
  const failed = await requestJson(server.baseUrl, "/api/patients?patient_key=" + key);
  assert.equal(failed.status, 503); assert.ok(!JSON.stringify(failed).includes("private"));
});
