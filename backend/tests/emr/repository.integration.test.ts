import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { setTimeout as pause } from "node:timers/promises";
import { count, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { labResults, patientLinks, patients } from "../../src/emr/schema.js";
import { hasSqlState, newLabResult } from "./fixtures.js";
// Compatibility check lives in tests only; production services never import peers.
import type { FhirR4LabObservation } from "../../src/middleware/mapper.js";
import { verifyReadBack } from "../../src/middleware/worker-verification.js";

const testUrl = process.env.EMR_REPOSITORY_TEST_DATABASE_URL?.trim();
delete process.env.EMR_DATABASE_URL;
if (testUrl) process.env.EMR_DATABASE_URL = testUrl;

test("EMR Repository integration (disposable PostgreSQL)", {
  skip: testUrl ? false : "Run npm run test:emr:postgres for isolated PostgreSQL",
}, async (t) => {
  assert.equal(process.env.EMR_REPOSITORY_TEST_DISPOSABLE, "1", "Requires explicit disposable database opt-in");
  const repository = await import("../../src/emr/repository.js");
  const { emrDatabase } = await import("../../src/emr/db.js");
  const pool = new Pool({ connectionString: testUrl, max: 4, connectionTimeoutMillis: 3000 });
  const db = drizzle({ client: pool });
  const patientKeys = [randomUUID(), randomUUID()];
  t.after(async () => {
    try {
      await db.transaction(async (tx) => {
        await tx.delete(labResults).where(inArray(labResults.patientKey, patientKeys));
        await tx.delete(patientLinks).where(inArray(patientLinks.patientKey, patientKeys));
        await tx.delete(patients).where(inArray(patients.patientKey, patientKeys));
      });
    } finally {
      await Promise.all([pool.end(), emrDatabase.close()]);
    }
  });
  assert.equal((await pool.query<{ role: string }>("select current_user as role")).rows[0].role, "emr_app");
  for (const table of [patients, patientLinks, labResults]) {
    assert.equal((await db.select({ total: count() }).from(table))[0].total, 0,
      "Refusing to run against populated EMR tables");
  }
  await db.insert(patients).values(patientKeys.map((patientKey) => ({ patientKey, displayLabel: "C1 synthetic only" })));
  await db.insert(patientLinks).values([
    { identifierSystem: "urn:uuid:b954f2c4-cfe0-575f-86c0-c1cba88052a4", identifierValue: "C1-SYNTHETIC-P", patientKey: patientKeys[0] },
    { identifierSystem: "urn:c1:other", identifierValue: "C1-SYNTHETIC-P", patientKey: patientKeys[1] },
    { identifierSystem: "urn:c1:quotes'", identifierValue: "value' OR '1'='1", patientKey: patientKeys[1] },
  ]);
  const input = () => newLabResult(patientKeys[0]);
  const read = (value: ReturnType<typeof input>) => repository.getLabResultsBySource(value.externalSystem, value.externalId);

  await t.test("exact link uses both namespace and value; never infers identity from display", async () => {
    assert.equal(await repository.getPatientKeyByIdentifier("urn:uuid:b954f2c4-cfe0-575f-86c0-c1cba88052a4", "C1-SYNTHETIC-P"), patientKeys[0]);
    assert.equal(await repository.getPatientKeyByIdentifier("urn:c1:other", "C1-SYNTHETIC-P"), patientKeys[1]);
    for (const [system, value] of [
      ["missing", "C1-SYNTHETIC-P"], ["urn:uuid:b954f2c4-cfe0-575f-86c0-c1cba88052a4", "missing"],
      ["urn:uuid:b954f2c4-cfe0-575f-86c0-c1cba88052a4", "C1 synthetic only"],
      ["urn:uuid:b954f2c4-cfe0-575f-86c0-c1cba88052a4", "c1-synthetic-p"],
    ]) assert.equal(await repository.getPatientKeyByIdentifier(system, value), undefined);
    assert.equal(await repository.getPatientKeyByIdentifier("urn:c1:quotes'", "value' OR '1'='1"), patientKeys[1]);
    assert.equal((await db.select({ total: count() }).from(patients))[0].total, 2);
  });

  await t.test("inserts all extracted fields, original JSON object, and database clock defaults", async () => {
    const value = input(); const before = structuredClone(value);
    const outcome = await repository.createLabResult(value);
    assert.equal(outcome.kind, "created");
    assert.deepEqual(outcome.record, {
      target_id: value.targetId, patient_key: value.patientKey,
      external_system: value.externalSystem, external_id: value.externalId,
      analyte_system: value.analyteSystem, analyte_code: value.analyteCode,
      analyte_display: value.analyteDisplay, analyte_context: value.analyteContext,
      quantity: value.quantity, unit_text: value.unitText, low: value.low, high: value.high,
      effective_at: "2026-10-22T08:00:00.123456Z", clinical_status: "final", fhir_json: value.fhirJson,
      received_at: outcome.record.received_at, stored_at: outcome.record.stored_at,
    });
    for (const field of ["received_at", "stored_at"] as const) {
      assert.match(outcome.record[field], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
    }
    assert.deepEqual(await read(value), [outcome.record]);
    assert.deepEqual(value, before, "Caller object is not mutated");
    assert.equal("id" in outcome.record.fhir_json, false);
    assert.equal("meta" in outcome.record.fhir_json, false);
    assert.deepEqual(verifyReadBack({ items: [outcome.record] }, value.fhirJson as unknown as FhirR4LabObservation, {
      result: "STORED", external_system: value.externalSystem, external_id: value.externalId,
      target_id: value.targetId, patient_key: value.patientKey,
    }), [], "Actual Repository output satisfies existing Middleware read-back checks");
  });

  await t.test("identical and conflicting retries return original row without comparison/overwrite", async () => {
    const value = input();
    const first = await repository.createLabResult(value);
    for (const candidate of [
      { ...value, targetId: randomUUID() },
      { ...value, targetId: randomUUID(), patientKey: patientKeys[1], quantity: "99.0001", unitText: "changed",
        effectiveAt: "2027-01-01T00:00:00Z", storedAt: "2027-01-01T00:00:00Z", fhirJson: { synthetic: "changed" } },
      { ...value, targetId: randomUUID(), fhirJson: Object.fromEntries(Object.entries(value.fhirJson).reverse()) },
    ]) {
      const retry = await repository.createLabResult(candidate);
      assert.equal(retry.kind, "existing");
      assert.deepEqual(retry.record, first.record);
      assert.deepEqual(await read(value), [first.record]);
    }
  });

  await t.test("simultaneous inserts store one complete winner and return its unchanged identity to all callers", async () => {
    const value = input();
    const candidates = Array.from({ length: 9 }, (_, i) => ({ ...value, targetId: randomUUID(), quantity: String(i) }));
    const outcomes = await Promise.all(candidates.map((candidate) => repository.createLabResult(candidate)));
    const winners = outcomes.filter((outcome) => outcome.kind === "created");
    assert.equal(winners.length, 1);
    const winner = winners[0].record;
    for (const outcome of outcomes) assert.deepEqual(outcome.record, winner);
    assert.equal(candidates.find((candidate) => candidate.targetId === winner.target_id)?.quantity, winner.quantity);
    assert.deepEqual(await read(value), [winner]);
  });

  for (const finish of ["commit", "rollback"] as const) {
    await t.test(`contender waits for uncommitted insert then handles ${finish} correctly`, async () => {
      const value = input(); const blocker = await pool.connect();
      let pending: ReturnType<typeof repository.createLabResult> | undefined;
      try {
        await blocker.query("begin");
        await blocker.query(`insert into emr.lab_results
          (target_id, patient_key, external_system, external_id, analyte_system, analyte_code,
           quantity, unit_text, effective_at, clinical_status, fhir_json)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10,$11::jsonb)`,
        [value.targetId, value.patientKey, value.externalSystem, value.externalId, value.analyteSystem,
          value.analyteCode, value.quantity, value.unitText, value.effectiveAt, value.clinicalStatus, JSON.stringify(value.fhirJson)]);
        pending = repository.createLabResult({ ...value, targetId: randomUUID() });
        // Observe an actual PostgreSQL lock wait rather than relying on timing.
        let waiting = false;
        for (let attempt = 0; attempt < 80; attempt++) {
          const result = await pool.query<{ waiting: boolean }>(`select exists (
            select 1 from pg_stat_activity where usename = current_user and wait_event_type = 'Lock'
              and query like 'insert into "emr"."lab_results"%') as waiting`);
          if (result.rows[0].waiting) { waiting = true; break; }
          await pause(25);
        }
        assert.equal(waiting, true, "Contender must reach UNIQUE arbitration before blocker finishes");
        await blocker.query(finish);
        const outcome = await pending;
        assert.equal(outcome.kind, finish === "commit" ? "existing" : "created");
        assert.equal(outcome.record.target_id === value.targetId, finish === "commit");
        assert.deepEqual(await read(value), [outcome.record]);
      } finally {
        await blocker.query("rollback"); blocker.release();
        await pending;
      }
    });
  }

  await t.test("source lookup requires exact pair, including quoted values and different namespaces", async () => {
    const value = { ...input(), externalSystem: "urn:c1:source'", externalId: "id' OR '1'='1" };
    const first = await repository.createLabResult(value);
    const other = { ...value, targetId: randomUUID(), externalSystem: "urn:c1:other" };
    const second = await repository.createLabResult(other);
    assert.deepEqual(await read(value), [first.record]);
    assert.deepEqual(await read(other), [second.record]);
    assert.deepEqual(await repository.getLabResultsBySource(value.externalSystem, "missing"), []);
    assert.deepEqual(await repository.getLabResultsBySource("missing", value.externalId), []);
  });

  await t.test("patient listing uses clinical time descending and UUID ascending for ties, with stable pages", async () => {
    const values = Array.from({ length: 23 }, (_, i) => ({ ...newLabResult(patientKeys[1]),
      effectiveAt: i < 3 ? "2030-01-02T00:00:00.000001Z" : "2030-01-01T00:00:00.123456Z" }));
    for (const value of values) await repository.createLabResult(value);
    const expected = [...values].sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt) || a.targetId.localeCompare(b.targetId));
    const all = await repository.listLabResults({ patientKey: patientKeys[1], limit: 100 });
    assert.deepEqual(all.map((row) => row.target_id), expected.map((row) => row.targetId));
    assert.equal((await repository.listLabResults({ patientKey: patientKeys[1] })).length, 20);
    const paged = [];
    for (let offset = 0; offset < all.length; offset += 4) {
      paged.push(...await repository.listLabResults({ patientKey: patientKeys[1], limit: 4, offset }));
    }
    assert.deepEqual(paged, all);
    assert.deepEqual(await repository.listLabResults({ patientKey: patientKeys[1], offset: 100 }), []);
    assert.deepEqual(await repository.listLabResults({ patientKey: randomUUID() }), []);
  });

  await t.test("NUMERIC remains exact decimal text across huge/small/scientific and signed values", async () => {
    for (const [quantity, low, high] of [
      ["9007199254740993.123456789012345678901", "-9007199254740994.123456789012345678901", "9007199254740994.123456789012345678901"],
      ["3.400000000000000000001", null, null],
      ["1.234567890123456789e-25", "-2.34e+30", "2.34e+30"],
      ["-0.000000000000000000000001", null, null],
    ] as const) {
      const value = { ...input(), quantity, low, high };
      const { record } = await repository.createLabResult(value);
      assert.equal(typeof record.quantity, "string");
      const expected = await pool.query<{ quantity: string; low: string | null; high: string | null }>(
        "select $1::numeric::text as quantity, $2::numeric::text as low, $3::numeric::text as high", [quantity, low, high]);
      for (const field of ["quantity", "low", "high"] as const) assert.equal(record[field], expected.rows[0][field]);
      assert.deepEqual(await read(value), [record]);
    }
  });

  await t.test("all three TIMESTAMPTZ columns retain microseconds across timezone offsets and read paths", async () => {
    const value = { ...input(), effectiveAt: "2026-10-22T15:00:00.000001+07:00",
      receivedAt: "2026-10-22T01:00:00.654321-07:00", storedAt: "2026-10-22T08:00:00.999999Z" };
    const { record } = await repository.createLabResult(value);
    assert.equal(record.effective_at, "2026-10-22T08:00:00.000001Z");
    assert.equal(record.received_at, "2026-10-22T08:00:00.654321Z");
    assert.equal(record.stored_at, "2026-10-22T08:00:00.999999Z");
    assert.deepEqual(await read(value), [record]);
    const listed = await repository.listLabResults({ patientKey: value.patientKey, limit: 100 });
    assert.deepEqual(listed.find((row) => row.target_id === value.targetId), record);
    const precise = await pool.query<{ same: boolean }>(`select effective_at = $2::timestamptz
      and received_at = $3::timestamptz and stored_at = $4::timestamptz as same
      from emr.lab_results where target_id = $1`, [value.targetId, value.effectiveAt, value.receivedAt, value.storedAt]);
    assert.equal(precise.rows[0].same, true);
  });

  await t.test("unrepresentable timestamps fail without rounding, and failures after INSERT roll back", async () => {
    for (const field of ["effectiveAt", "receivedAt", "storedAt"] as const) {
      const value = input();
      await assert.rejects(repository.createLabResult({ ...value, [field]: "2026-10-22T08:00:00.1234567Z" }),
        /exceeds PostgreSQL microsecond precision/);
      assert.deepEqual(await read(value), []);
    }
    const value = { ...input(), effectiveAt: "2026-10-22T08:00:00.123456000Z" };
    assert.equal((await repository.createLabResult(value)).record.effective_at, "2026-10-22T08:00:00.123456Z");
    for (const time of ["infinity", "-infinity", "10000-01-01T00:00:00Z"]) {
      const invalid = { ...input(), effectiveAt: time };
      await assert.rejects(repository.createLabResult(invalid), /cannot be represented as a finite ISO instant/);
      // INSERT succeeded in PostgreSQL, but RETURNING decoder failed: must roll back.
      assert.deepEqual(await read(invalid), []);
      assert.equal((await repository.createLabResult({ ...invalid, effectiveAt: value.effectiveAt })).kind, "created");
    }
  });

  await t.test("optional bounds/display/context return explicit null without inventing values", async () => {
    for (const bounds of [{}, { low: "1.200" }, { high: "5.600" }, { low: null, high: null }]) {
      const value = input(); delete value.low; delete value.high;
      delete value.analyteDisplay; delete value.analyteContext;
      Object.assign(value, bounds);
      const { record } = await repository.createLabResult(value);
      assert.equal(record.low, value.low ?? null); assert.equal(record.high, value.high ?? null);
      assert.equal(record.analyte_display, null); assert.equal(record.analyte_context, null);
    }
  });

  await t.test("FK/CHECK/UUID failures propagate, roll back, and never become existing/empty success", async () => {
    for (const [patch, state] of [
      [{ patientKey: randomUUID() }, "23503"],
      [{ low: "20", high: "10" }, "23514"],
      [{ clinicalStatus: "amended" as "final" }, "23514"],
      [{ fhirJson: [] as unknown as ReturnType<typeof input>["fhirJson"] }, "23514"],
      [{ quantity: "not-numeric" }, "22P02"],
    ] as const) {
      const value = input();
      await assert.rejects(repository.createLabResult({ ...value, ...patch }), (error) => hasSqlState(error, state));
      assert.deepEqual(await read(value), []);
      assert.equal((await repository.createLabResult(value)).kind, "created", "Transaction failure does not poison pool or reserve ID");
    }
    const value = input(); await repository.createLabResult(value);
    const collision = { ...input(), targetId: value.targetId };
    await assert.rejects(repository.createLabResult(collision), (error) => hasSqlState(error, "23505"));
    assert.deepEqual(await read(collision), []);
  });

  await t.test("emr_app cannot read or write LIS/integration tables", async () => {
    for (const schema of ["lis", "integration"]) {
      const table = schema === "lis" ? "patients" : "exchange_transactions";
      await assert.rejects(pool.query(`select * from ${schema}.${table}`), (error) => hasSqlState(error, "42501"));
      await assert.rejects(pool.query(`delete from ${schema}.${table} where false`), (error) => hasSqlState(error, "42501"));
    }
  });
});
