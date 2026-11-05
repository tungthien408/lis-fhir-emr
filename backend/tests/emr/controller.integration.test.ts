import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import express from "express";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { labResults, patientLinks, patients } from "../../src/emr/schema.js";
import { storageReceipt, verifyReadBack } from "../../src/middleware/worker-verification.js";
import { validObservation } from "./service-fixtures.js";
import { assertError, deferred, isRecord, requestJson, startHttpServer } from "./http-test-helpers.js";

const testUrl = process.env.EMR_REPOSITORY_TEST_DATABASE_URL?.trim();
delete process.env.EMR_DATABASE_URL;
if (testUrl) process.env.EMR_DATABASE_URL = testUrl;

test("EMR Controller C3 (real HTTP + disposable PostgreSQL)", {
  skip: testUrl ? false : "Run npm run test:emr:postgres for isolated PostgreSQL",
}, async (t) => {
  assert.equal(process.env.EMR_REPOSITORY_TEST_DISPOSABLE, "1");
  const { emrJsonParser, registerEmrRoutes } = await import("../../src/emr/controller.js");
  const service = await import("../../src/emr/service.js");
  const repository = await import("../../src/emr/repository.js");
  const { emrDatabase } = await import("../../src/emr/db.js");
  const pool = new Pool({ connectionString: testUrl, connectionTimeoutMillis: 3000 });
  const db = drizzle({ client: pool });
  const patientKey = randomUUID(); const patientId = `C3-SYNTHETIC-${randomUUID()}`;
  let closed = false;
  t.after(async () => {
    try {
      await db.transaction(async (tx) => {
        await tx.delete(labResults).where(eq(labResults.patientKey, patientKey));
        await tx.delete(patientLinks).where(eq(patientLinks.patientKey, patientKey));
        await tx.delete(patients).where(eq(patients.patientKey, patientKey));
      });
    } finally { await pool.end(); if (!closed) await emrDatabase.close(); }
  });
  assert.equal((await pool.query<{ role: string }>("select current_user as role")).rows[0].role, "emr_app");
  for (const table of [patients, patientLinks, labResults]) {
    assert.equal((await db.select({ total: count() }).from(table))[0].total, 0, "Use empty disposable EMR tables only");
  }
  await db.insert(patients).values({ patientKey, displayLabel: "C3 synthetic only" });
  await db.insert(patientLinks).values({ identifierSystem: "https://example.org/lis/patient", identifierValue: patientId, patientKey });
  const app = express(); app.use(emrJsonParser()); registerEmrRoutes(app);
  const server = await startHttpServer(app); t.after(server.close);
  const request = (path: string, options?: RequestInit) => requestJson(server.baseUrl, path, options);
  const input = () => { const observation = validObservation(); observation.subject.identifier.value = patientId; return observation; };
  const postOptions = (body: unknown) => ({ method: "POST", headers: { "Content-Type": "application/fhir+json" }, body: JSON.stringify(body) });
  const post = (body: unknown) => request("/api/observations", postOptions(body));
  const sourcePath = (observation: ReturnType<typeof input>) => `/api/lab-results?${new URLSearchParams({
    external_system: observation.identifier[0].system, external_id: observation.identifier[0].value,
  })}`;
  const patientPath = `/api/lab-results?patient_key=${patientKey}`;

  await t.test("health is unchanged; ready really checks emr_app and EMR tables", async () => {
    assert.deepEqual(await request("/health"), { status: 200, body: { service: "emr", status: "ok" } });
    assert.deepEqual(await request("/ready"), { status: 200, body: {
      service: "emr", status: "ready", schema: "emr", database: "dacn_db", role: "emr_app",
    } });
  });

  await t.test("patient lookup resolves exact namespace independently of label and distinguishes an empty existing record", async t => {
    const other = randomUUID();
    await db.insert(patients).values({ patientKey: other, displayLabel: "C3 synthetic only" });
    await db.insert(patientLinks).values({ identifierSystem: "urn:synthetic:other", identifierValue: patientId, patientKey: other });
    t.after(async () => { await db.delete(patientLinks).where(eq(patientLinks.patientKey, other)); await db.delete(patients).where(eq(patients.patientKey, other)); });
    for (const [system, key] of [["https://example.org/lis/patient", patientKey], ["urn:synthetic:other", other]]) {
      const response = await request("/api/patients?" + new URLSearchParams({ identifier_system: system, identifier_value: patientId }));
      assert.equal(response.status, 200); const body = response.body as { patient: { patient_key: string; display_label: string; identifiers: unknown[] } };
      assert.equal(body.patient.patient_key, key); assert.equal(body.patient.display_label, "C3 synthetic only");
      assert.deepEqual(body.patient.identifiers, [{ identifier_system: system, identifier_value: patientId }]);
      assert.deepEqual(await request(`/api/patients?patient_key=${key}`), response);
      assert.deepEqual(await request(`/api/lab-results?patient_key=${key}`), { status: 200, body: { items: [], limit: 20, offset: 0 } });
    }
    assert.equal((await request(`/api/patients?patient_key=${randomUUID()}`)).status, 404);
    assert.equal((await request("/api/patients?" + new URLSearchParams({ identifier_system: "urn:missing", identifier_value: patientId }))).status, 404);
    const before = await pool.query("select (select count(*) from emr.patients) as patients, (select count(*) from emr.patient_links) as links");
    await request(`/api/patients?patient_key=${patientKey}`);
    assert.deepEqual((await pool.query("select (select count(*) from emr.patients) as patients, (select count(*) from emr.patient_links) as links")).rows, before.rows);
  });

  await t.test("201 is visible on a separate connection; retry is 200; conflict is 409 without overwrite", async () => {
    const observation = input(); observation.effectiveDateTime = "2026-10-29T15:00:00.123456+07:00";
    const response = await post(observation); const receipt = storageReceipt(response.status, response.body, observation);
    assert.equal(response.status, 201); assert.ok(receipt); assert.equal(receipt.patient_key, patientKey);
    const saved = await pool.query("select target_id, quantity::text, effective_at::text, fhir_json from emr.lab_results where target_id=$1", [receipt.target_id]);
    assert.equal(saved.rowCount, 1); assert.deepEqual(saved.rows[0].fhir_json, observation);
    const read = await request(sourcePath(observation)); assert.equal(read.status, 200);
    assert.deepEqual(verifyReadBack(read.body, observation, receipt), []);
    assert.ok(isRecord(read.body)); assert.ok(Array.isArray(read.body.items)); const item: unknown = read.body.items[0];
    assert.ok(isRecord(item)); assert.equal(item.effective_at, "2026-10-29T08:00:00.123456Z");
    assert.equal(item.quantity, "3.4"); assert.equal(item.low, "3.3"); assert.equal(item.high, "5.1");
    assert.deepEqual(item.fhir_json, observation);
    assert.deepEqual(await post(observation), { status: 200, body: { ...receipt, result: "ALREADY_EXISTS" } });
    const conflict = structuredClone(observation); conflict.valueQuantity.value = 7;
    assertError(await post(conflict), 409, "DUPLICATE_CONFLICT");
    assert.deepEqual(await request(sourcePath(observation)), read);
  });

  await t.test("unlinked patients and invalid Observations return 422 and create no result", async () => {
    const unlinked = input(); unlinked.subject.identifier.value = "C3-MISSING";
    assertError(await post(unlinked), 422, "PATIENT_NOT_LINKED");
    assert.deepEqual(await request(sourcePath(unlinked)), { status: 200, body: { items: [] } });
    const invalid = input(); invalid.effectiveDateTime = "2026-02-29T00:00:00Z";
    assertError(await post(invalid), 422, "VALIDATION_ERROR");
    assert.deepEqual(await request(sourcePath(invalid)), { status: 200, body: { items: [] } });
  });

  await t.test("optional bounds stay decimal strings or explicit null; FHIR and microseconds survive HTTP", async () => {
    for (const bound of ["low", "high", "none"]) {
      const observation = input(); observation.effectiveDateTime = "2026-10-29T15:00:00.000001000+07:00";
      if (bound === "none") delete observation.referenceRange;
      else if (bound === "low") delete observation.referenceRange![0].high;
      else delete observation.referenceRange![0].low;
      const response = await post(observation); const receipt = storageReceipt(response.status, response.body, observation);
      assert.equal(response.status, 201); assert.ok(receipt);
      const read = await request(sourcePath(observation)); assert.deepEqual(verifyReadBack(read.body, observation, receipt), []);
      assert.ok(isRecord(read.body)); assert.ok(Array.isArray(read.body.items)); const item: unknown = read.body.items[0];
      assert.ok(isRecord(item)); assert.equal(item.low, bound === "low" ? "3.3" : null);
      assert.equal(item.high, bound === "high" ? "5.1" : null);
      assert.equal(item.effective_at, "2026-10-29T08:00:00.000001Z"); assert.deepEqual(item.fhir_json, observation);
    }
  });

  await t.test("GET reads actual NUMERIC digits rather than rebuilding values from FHIR", async () => {
    const observation = input(); const response = await post(observation);
    const receipt = storageReceipt(response.status, response.body, observation); assert.ok(receipt);
    await pool.query("update emr.lab_results set quantity=$1, low=$2, high=null where target_id=$3",
      ["3.400000000000000000001", "1.200000000000000000001", receipt.target_id]);
    const read = await request(sourcePath(observation)); assert.equal(read.status, 200);
    assert.ok(isRecord(read.body)); assert.ok(Array.isArray(read.body.items)); const item: unknown = read.body.items[0];
    assert.ok(isRecord(item)); assert.equal(item.quantity, "3.400000000000000000001");
    assert.equal(item.low, "1.200000000000000000001"); assert.equal(item.high, null);
    assert.deepEqual(item.fhir_json, observation);
    assert.ok(verifyReadBack(read.body, observation, receipt).includes("quantity"));
  });

  await t.test("patient pagination follows effective_at DESC and target_id ASC including equal timestamps", async () => {
    const all = await repository.listLabResults({ patientKey, limit: 100 });
    const expected = [...all].sort((a, b) => b.effective_at.localeCompare(a.effective_at) || a.target_id.localeCompare(b.target_id));
    assert.ok(expected.length >= 5);
    assert.deepEqual(await request(patientPath), { status: 200, body: { items: expected, limit: 20, offset: 0 } });
    for (const offset of [0, 2, 4, 100]) {
      assert.deepEqual(await request(`${patientPath}&limit=2&offset=${offset}`), {
        status: 200, body: { items: expected.slice(offset, offset + 2), limit: 2, offset },
      });
    }
    assert.deepEqual(await request(`/api/lab-results?patient_key=${randomUUID()}`), {
      status: 200, body: { items: [], limit: 20, offset: 0 },
    });
  });

  await t.test("HTTP response waits for COMMIT; a post-INSERT rollback returns 503 and no persisted row", async (t) => {
    const pendingApp = express(); pendingApp.use(emrJsonParser());
    const entered = deferred(); const commit = deferred(); t.after(commit.resolve);
    let fail = false;
    registerEmrRoutes(pendingApp, { ...service, checkDatabase: emrDatabase.check,
      storeObservation: (body: unknown) => service.storeObservation(body, {
        withPatientLinkTransaction(system, value, operation) {
          return repository.withPatientLinkTransaction(system, value, async (linked) => {
            const outcome = await operation(linked); entered.resolve(); await commit.promise;
            if (fail) throw new Error("SELECT patient-private; postgresql://admin:secret@db; private-stack");
            return outcome;
          });
        },
      }),
    });
    const pendingServer = await startHttpServer(pendingApp); t.after(pendingServer.close);
    const observation = input(); let responded = false;
    const response = requestJson(pendingServer.baseUrl, "/api/observations", postOptions(observation))
      .then((value) => { responded = true; return value; });
    await entered.promise;
    const before = await pool.query("select count(*)::int as total from emr.lab_results where external_id=$1", [observation.identifier[0].value]);
    assert.equal(before.rows[0].total, 0); assert.equal(responded, false);
    commit.resolve(); assert.equal((await response).status, 201);
    assert.equal((await repository.getLabResultsBySource(observation.identifier[0].system, observation.identifier[0].value)).length, 1);
    fail = true; const rolledBack = input();
    assertError(await requestJson(pendingServer.baseUrl, "/api/observations", postOptions(rolledBack)), 503, "DEPENDENCY_UNAVAILABLE");
    assert.deepEqual(await request(sourcePath(rolledBack)), { status: 200, body: { items: [] } });
  });

  await t.test("unavailable PostgreSQL connection returns 503 for POST, both GET modes and ready; health stays 200", async () => {
    await emrDatabase.close(); closed = true;
    assertError(await post(input()), 503, "DEPENDENCY_UNAVAILABLE");
    assertError(await request(sourcePath(input())), 503, "DEPENDENCY_UNAVAILABLE");
    assertError(await request(patientPath), 503, "DEPENDENCY_UNAVAILABLE");
    assertError(await request(`/api/patients?patient_key=${patientKey}`), 503, "DEPENDENCY_UNAVAILABLE");
    const ready = await request("/ready"); assert.equal(ready.status, 503);
    assert.ok(isRecord(ready.body)); assert.equal(ready.body.status, "unavailable");
    assert.deepEqual(await request("/health"), { status: 200, body: { service: "emr", status: "ok" } });
  });
});
