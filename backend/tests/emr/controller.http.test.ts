import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import express from "express";
import type { EmrRouteDependencies } from "../../src/emr/controller.js";
import { newLabResult } from "./fixtures.js";
import { setField, storedRow, validObservation } from "./service-fixtures.js";
import { assertError, deferred, requestJson, startHttpServer } from "./http-test-helpers.js";

delete process.env.EMR_DATABASE_URL;
const { emrJsonParser, registerEmrRoutes } = await import("../../src/emr/controller.js");
const service = await import("../../src/emr/service.js");

test("EMR Controller C3 (real HTTP, isolated dependencies)", async (t) => {
  const observation = validObservation(); const patientKey = randomUUID();
  const row = storedRow(newLabResult(patientKey));
  const receipt = { result: "STORED" as const, external_system: observation.identifier[0].system,
    external_id: observation.identifier[0].value, target_id: row.target_id, patient_key: patientKey };
  const dependencies: EmrRouteDependencies = {
    findPatient: service.findPatient,
    storeObservation: async () => ({ kind: "stored", ...receipt }),
    getLabResultsBySource: async () => ({ kind: "found", items: [row] }),
    listLabResults: async () => ({ kind: "found", items: [row], limit: 20, offset: 0 }),
    checkDatabase: async () => ({ status: "ready", schema: "emr", database: "dacn_db", role: "emr_app" }),
  };
  const app = express(); app.use(emrJsonParser()); registerEmrRoutes(app, dependencies);
  // Prove normal application/json still parses for other JSON endpoints.
  app.post("/json-probe", (req, res) => { res.json(req.body); });
  const server = await startHttpServer(app); t.after(server.close);
  const request = (path: string, options?: RequestInit) => requestJson(server.baseUrl, path, options);
  const post = (body: unknown = observation, headers = { "Content-Type": "application/fhir+json" }) =>
    request("/api/observations", { method: "POST", headers, body: JSON.stringify(body) });
  const source = "/api/lab-results?external_system=urn%3Auuid%3A05934370-0df0-5666-8eff-bd5181906b62&external_id=R1";
  const patient = `/api/lab-results?patient_key=${patientKey}`;

  await t.test("health and readiness preserve their response formats and readiness statuses", async (t) => {
    assert.deepEqual(await request("/health"), { status: 200, body: { service: "emr", status: "ok" } });
    assert.deepEqual(await request("/ready"), { status: 200, body: {
      service: "emr", status: "ready", schema: "emr", database: "dacn_db", role: "emr_app",
    } });
    for (const status of ["not_configured", "unavailable", "schema_incomplete", "wrong_role", "unsafe_permissions"] as const) {
      const mock = t.mock.method(dependencies, "checkDatabase", async () => ({ status, schema: "emr" }));
      assert.deepEqual(await request("/ready"), { status: 503, body: { service: "emr", status, schema: "emr" } });
      mock.mock.restore();
    }
  });

  await t.test("FHIR JSON is parsed as an object, forwarded unchanged to C2, and returns five receipt fields", async (t) => {
    t.mock.method(dependencies, "storeObservation", async (input: unknown) => {
      assert.deepEqual(input, observation); return { kind: "stored", ...receipt };
    });
    assert.deepEqual(await post(), { status: 201, body: receipt });
    assert.equal((await post(observation, { "Content-Type": "Application/Fhir+Json; charset=utf-8" })).status, 201);
    assert.deepEqual(await request("/json-probe", { method: "POST", headers: { "Content-Type": "application/json" },
      body: '{"ok":true}' }), { status: 200, body: { ok: true } });
  });

  await t.test("identical retry maps to 200 with ALREADY_EXISTS and original identities", async (t) => {
    t.mock.method(dependencies, "storeObservation", async () => ({ kind: "already_exists", ...receipt, result: "ALREADY_EXISTS" }));
    assert.deepEqual(await post(), { status: 200, body: { ...receipt, result: "ALREADY_EXISTS" } });
  });

  await t.test("every typed C2 failure maps to the documented error envelope", async (t) => {
    for (const [kind, status, code] of [
      ["conflict", 409, "DUPLICATE_CONFLICT"], ["patient_not_linked", 422, "PATIENT_NOT_LINKED"],
      ["invalid", 422, "VALIDATION_ERROR"], ["unsupported", 422, "VALIDATION_ERROR"],
      ["unavailable", 503, "DEPENDENCY_UNAVAILABLE"],
    ] as const) {
      const mock = t.mock.method(dependencies, "storeObservation", async () => ({ kind,
        error: { code, field: "body", message: "Synthetic safe failure" } }));
      assertError(await post(), status, code); mock.mock.restore();
    }
  });

  await t.test("real C2 rejects invalid/unsupported Observations, empty bodies and JSON primitives with 422", async (t) => {
    t.mock.method(dependencies, "storeObservation", service.storeObservation);
    const invalid = structuredClone(observation); setField(invalid, "valueQuantity.value", "3.4");
    for (const input of [invalid, {}, [], null, 1, true, "patient-private", { ...observation, status: "preliminary" }]) {
      assertError(await post(input), 422, "VALIDATION_ERROR");
    }
    assertError(await request("/api/observations", { method: "POST", headers: { "Content-Type": "application/fhir+json" } }),
      422, "VALIDATION_ERROR");
    t.mock.method(dependencies, "storeObservation", (input: unknown) => service.storeObservation(input, {
      async withPatientLinkTransaction() { return undefined; },
    }));
    assertError(await post(), 422, "PATIENT_NOT_LINKED");
  });

  await t.test("real C2 rejects unknown codes and consistently unsupported quantities over HTTP", async (t) => {
    t.mock.method(dependencies, "storeObservation", service.storeObservation);
    for (const mode of ["unknown", "all-kg", "no-range"]) {
      const input = structuredClone(observation); input.code.coding[0].code = mode === "unknown" ? "99999" : "50912";
      input.valueQuantity.unit = mode === "unknown" ? "mg/dL" : "kg";
      for (const range of input.referenceRange ?? []) for (const key of ["low", "high"] as const) {
        if (range[key]) range[key].unit = input.valueQuantity.unit;
      }
      if (mode === "no-range") delete input.referenceRange;
      assertError(await post(input), 422, "VALIDATION_ERROR");
    }
  });

  await t.test("no success response is sent while the C2 transaction is pending", async (t) => {
    const entered = deferred(); const commit = deferred(); t.after(commit.resolve);
    t.mock.method(dependencies, "storeObservation", (input: unknown) => service.storeObservation(input, {
      async withPatientLinkTransaction(_system, _id, operation) {
        const outcome = await operation({ patientKey, async createLabResult(prepared) {
          return { kind: "created", record: storedRow({ ...prepared, patientKey }) };
        } });
        entered.resolve(); await commit.promise; return outcome;
      },
    }));
    let responded = false;
    const response = post().then((value) => { responded = true; return value; });
    await entered.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(responded, false); commit.resolve(); assert.equal((await response).status, 201);
  });

  await t.test("exact source lookup forwards both identities without pagination, truncation or deduplication", async (t) => {
    t.mock.method(dependencies, "getLabResultsBySource", async (system: unknown, id: unknown) => {
      assert.equal(system, "urn:uuid:05934370-0df0-5666-8eff-bd5181906b62"); assert.equal(id, " R1 ");
      return { kind: "found", items: [row, { ...row, target_id: randomUUID() }] };
    });
    const response = await request(`${source.replace("=R1", "=%20R1%20")}`);
    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(response.body as object), ["items"]);
    assert.equal((response.body as { items: unknown[] }).items.length, 2);
  });

  await t.test("readback preserves decimal strings, null bounds, microseconds and stored FHIR", async () => {
    assert.deepEqual(await request(source), { status: 200, body: { items: [row] } });
    assert.equal(row.quantity, "3.4000"); assert.equal(row.effective_at, "2026-10-22T15:00:00.123456+07:00");
  });

  await t.test("missing exact result returns items:[]", async (t) => {
    t.mock.method(dependencies, "getLabResultsBySource", async () => ({ kind: "found", items: [] }));
    assert.deepEqual(await request(source), { status: 200, body: { items: [] } });
  });

  await t.test("patient mode passes numeric defaults and valid pagination to C2", async (t) => {
    let options: unknown;
    t.mock.method(dependencies, "listLabResults", async (input: unknown) => { options = input;
      return { kind: "found", items: [row], limit: 20, offset: 0 }; });
    assert.deepEqual(await request(patient), { status: 200, body: { items: [row], limit: 20, offset: 0 } });
    assert.deepEqual(options, { patientKey, limit: 20, offset: 0 });
    assert.deepEqual(await request(`${patient}&limit=100&offset=2`), {
      status: 200, body: { items: [row], limit: 100, offset: 2 },
    });
    assert.deepEqual(options, { patientKey, limit: 100, offset: 2 });
    assert.equal((await request(`${patient}&offset=9007199254740991`)).status, 200);
  });

  await t.test("missing, malformed, repeated, mixed, structured and unsupported query filters never call C2", async (t) => {
    let calls = 0;
    t.mock.method(dependencies, "getLabResultsBySource", async () => { calls++; return { kind: "found", items: [] }; });
    t.mock.method(dependencies, "listLabResults", async () => { calls++; return { kind: "found", items: [], limit: 20, offset: 0 }; });
    const valid = `patient_key=${patientKey}`;
    for (const query of ["", "external_system=uri", "external_id=id", "limit=1", "offset=0", "other=1",
      "external_system=&external_id=id", "external_system=uri&external_id=%20", "patient_key=bad", "patient_key=",
      "external_system=uri&external_id=id&limit=20", "external_system=uri&external_id=id&offset=0",
      `external_system=uri&external_id=id&${valid}`, `external_system=uri&${valid}`, `external_id=id&${valid}`,
      "external_system=uri&external_system=uri&external_id=id", "external_system=uri&external_id=id&external_id=id",
      "external_system[]=uri&external_id=id", "external_system[x]=uri&external_id=id", "external_system=%00&external_id=id",
      "external_system=uri&external_id=%7f", "external_system=uri&external_id=%E0%A4%A", "external_system=uri&external_id=%ZZ",
      `${valid}&${valid}`, `patient_key[]=${patientKey}`, `patient_key[x]=${patientKey}`, `${valid}&other=1`,
      ...["0", "101", "-1", "1.5", "1e2", "%201", "%2B1", "", "NaN"].map((v) => `${valid}&limit=${v}`),
      ...["-1", "1.5", "1e2", "%200", "%2B0", "", "9007199254740992"].map((v) => `${valid}&offset=${v}`),
      `${valid}&limit=1&limit=2`, `${valid}&offset=0&offset=0`, `${valid}&limit[]=1`, `${valid}&offset[x]=0`,
      `${valid}&${Array.from({ length: 1001 }, () => "limit=1").join("&")}`,
    ]) assertError(await request(`/api/lab-results?${query}`), 400, "VALIDATION_ERROR");
    assert.equal(calls, 0);
    t.mock.method(dependencies, "storeObservation", async () => { assert.fail("Must reject POST query before C2"); });
    assertError(await request("/api/observations?external_id=id", { method: "POST",
      headers: { "Content-Type": "application/fhir+json" }, body: JSON.stringify(observation) }), 400, "VALIDATION_ERROR");
  });

  await t.test("malformed JSON, oversized bodies, wrong media type, charset and encoding are safe errors", async (t) => {
    let calls = 0;
    t.mock.method(dependencies, "storeObservation", async () => { calls++; return { kind: "stored", ...receipt }; });
    assertError(await request("/api/observations", { method: "POST", headers: { "Content-Type": "application/fhir+json" },
      body: '{"patient-private":' }), 400, "VALIDATION_ERROR");
    assertError(await post({ data: "x".repeat(1024 * 1024) }), 413, "VALIDATION_ERROR");
    const unsupportedHeaders: Record<string, string>[] = [
      { "Content-Type": "text/plain" }, { "Content-Type": "application/json" }, { "Content-Type": "application/xml" },
      { "Content-Type": "application/fhir+json; charset=iso-8859-1" },
      { "Content-Type": "application/fhir+json", "Content-Encoding": "gzip" },
      { "Content-Type": "application/fhir+json", "Content-Encoding": "unsupported" },
    ];
    for (const headers of unsupportedHeaders) {
      assertError(await request("/api/observations", { method: "POST", headers, body: "{}" }), 415, "VALIDATION_ERROR");
    }
    assertError(await request("/api/observations", { method: "POST", headers: { "Content-Type": "application/json" },
      body: '{"patient-private":' }), 415, "VALIDATION_ERROR");
    assertError(await request("/api/observations", { method: "POST", headers: {
      "Content-Type": "application/fhir+json", "Content-Encoding": "unsupported",
    } }), 415, "VALIDATION_ERROR");
    assertError(await request("/api/observations", { method: "POST" }), 415, "VALIDATION_ERROR");
    assert.equal(calls, 0);
  });

  await t.test("thrown dependencies and typed read failures return sanitized errors on both modes", async (t) => {
    for (const [method, path] of [["storeObservation", "/api/observations"],
      ["getLabResultsBySource", source], ["listLabResults", patient], ["checkDatabase", "/ready"]] as const) {
      const mock = t.mock.method(dependencies, method, async () => {
        throw new Error("SELECT patient-private; postgresql://admin:secret@db; private-stack");
      });
      assertError(await request(path, method === "storeObservation" ? { method: "POST",
        headers: { "Content-Type": "application/fhir+json" }, body: JSON.stringify(observation) } : undefined),
      503, "DEPENDENCY_UNAVAILABLE"); mock.mock.restore();
    }
    for (const [method, path] of [["getLabResultsBySource", source], ["listLabResults", patient]] as const) {
      const mock = t.mock.method(dependencies, method, async () => ({ kind: "unavailable",
        error: { code: "DEPENDENCY_UNAVAILABLE", message: "EMR persistence is temporarily unavailable" } }));
      assertError(await request(path), 503, "DEPENDENCY_UNAVAILABLE"); mock.mock.restore();
    }
    assertError(await request("/api/unknown"), 404, "NOT_FOUND");
  });
});
