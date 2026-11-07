import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool, type QueryConfig } from "pg";
import { newLabResult } from "./fixtures.js";

delete process.env.EMR_DATABASE_URL;
const repository = await import("../../src/emr/repository.js");
const { emrDatabase } = await import("../../src/emr/db.js");

test("all operations reject an unconfigured database", async () => {
  for (const operation of [
    () => repository.findPatient({ identifier_system: "synthetic", identifier_value: "missing" }),
    () => repository.getPatientKeyByIdentifier("synthetic", "missing"),
    () => repository.getLabResultsBySource("synthetic", "missing"),
    () => repository.listLabResults({ patientKey: newLabResult().patientKey }),
    () => repository.createLabResult(newLabResult()),
    () => repository.withPatientLinkTransaction("synthetic", "missing", async () => undefined),
  ]) await assert.rejects(operation, /EMR_DATABASE_URL is not configured/);
});

// Only stub the wire boundary; real Drizzle controls transaction/error handling.
for (const phase of ["insert", "select", "commit"] as const) {
  test(`${phase} failure propagates and invokes rollback`, async (t) => {
    const pool = new Pool(); const client = Object.assign(new Client(), { release() {} });
    const queries: string[] = []; const failure = new Error(`synthetic ${phase} failure`);
    t.mock.method(pool, "connect", async () => client);
    t.mock.method(client, "query", async (query: string | QueryConfig) => {
      const text = typeof query === "string" ? query : query.text;
      queries.push(text);
      if (text.startsWith(phase)) throw failure;
      // For the commit case, insert must produce a row so it reaches COMMIT.
      return { rows: phase === "commit" && text.startsWith("insert") ? [wireRow()] : [] };
    });
    emrDatabase.db = drizzle({ client: pool });
    t.after(async () => { emrDatabase.db = null; await pool.end(); });
    await assert.rejects(repository.createLabResult(newLabResult()), (error: unknown) =>
      error === failure || (error instanceof Error && error.cause === failure));
    assert.match(queries[0], /read committed/);
    assert.equal(queries.at(-1), "rollback");
    assert.ok(queries.every((query) => !query.startsWith("update")));
  });
}

for (const count of [0, 2]) {
  test(`a source conflict with ${count} visible winners throws and rolls back`, async (t) => {
    const pool = new Pool(); const client = Object.assign(new Client(), { release() {} });
    const queries: string[] = [];
    t.mock.method(pool, "connect", async () => client);
    t.mock.method(client, "query", async (query: string | QueryConfig) => {
      const text = typeof query === "string" ? query : query.text; queries.push(text);
      return { rows: text.startsWith("select") ? Array.from({ length: count }, () => wireRow()) : [] };
    });
    emrDatabase.db = drizzle({ client: pool });
    t.after(async () => { emrDatabase.db = null; await pool.end(); });
    await assert.rejects(repository.createLabResult(newLabResult()), /Expected exactly one existing EMR/);
    assert.equal(queries.at(-1), "rollback");
  });
}

test("source read does not hide multiple matching rows if database uniqueness drifts", async (t) => {
  const pool = new Pool(); let queryText = ""; let parameters: unknown;
  t.mock.method(pool, "query", async (query: QueryConfig, values: unknown[]) => {
    queryText = query.text; parameters = values;
    return { rows: [wireRow(), wireRow()] };
  });
  emrDatabase.db = drizzle({ client: pool });
  t.after(async () => { emrDatabase.db = null; await pool.end(); });
  const rows = await repository.getLabResultsBySource("system'", "id'");
  assert.equal(rows.length, 2);
  assert.deepEqual(parameters, ["system'", "id'"]);
  assert.doesNotMatch(queryText, /\blimit\b|\boffset\b|\bdistinct\b|\bgroup by\b/i);
});

test("read failures remain rejected promises rather than missing links or empty lists", async (t) => {
  const pool = new Pool(); const failure = new Error("synthetic disconnected database");
  t.mock.method(pool, "query", async () => { throw failure; });
  emrDatabase.db = drizzle({ client: pool });
  t.after(async () => { emrDatabase.db = null; await pool.end(); });
  for (const operation of [
    () => repository.findPatient({ identifier_system: "synthetic", identifier_value: "missing" }),
    () => repository.getPatientKeyByIdentifier("synthetic", "missing"),
    () => repository.getLabResultsBySource("synthetic", "missing"),
    () => repository.listLabResults({ patientKey: newLabResult().patientKey }),
  ]) await assert.rejects(operation, (error: unknown) => error instanceof Error && error.cause === failure);
});

function wireRow(): unknown[] {
  const input = newLabResult();
  return [input.targetId, input.patientKey, input.externalSystem, input.externalId,
    input.analyteSystem, input.analyteCode, input.analyteDisplay, input.analyteContext,
    input.quantity, input.unitText, input.low, input.high, "2026-10-22T08:00:00.123456Z",
    input.clinicalStatus, input.fhirJson, "2026-10-22T08:00:00.123456Z", "2026-10-22T08:00:00.123456Z"];
}
