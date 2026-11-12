import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { setTimeout as pause } from "node:timers/promises";
import { and, count, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { labResults, patientLinks, patients } from "../../src/emr/schema.js";
import { verifyReadBack } from "../../src/middleware/worker-verification.js";
import { reverseKeys, setField, validObservation } from "./service-fixtures.js";

const testUrl = process.env.EMR_REPOSITORY_TEST_DATABASE_URL?.trim();
delete process.env.EMR_DATABASE_URL;
if (testUrl) process.env.EMR_DATABASE_URL = testUrl;

test("EMR Service C2 (disposable PostgreSQL)", {
  skip: testUrl ? false : "Run npm run test:emr:postgres for isolated PostgreSQL",
}, async (t) => {
  assert.equal(process.env.EMR_REPOSITORY_TEST_DISPOSABLE, "1");
  const service = await import("../../src/emr/service.js");
  const repository = await import("../../src/emr/repository.js");
  const { emrDatabase } = await import("../../src/emr/db.js");
  const pool = new Pool({ connectionString: testUrl, max: 4, connectionTimeoutMillis: 3000 });
  const db = drizzle({ client: pool });
  const patientKeys = [randomUUID(), randomUUID()];
  const patientSystem = "urn:uuid:b954f2c4-cfe0-575f-86c0-c1cba88052a4";
  t.after(async () => {
    try {
      await db.transaction(async (tx) => {
        await tx.delete(labResults).where(inArray(labResults.patientKey, patientKeys));
        await tx.delete(patientLinks).where(inArray(patientLinks.patientKey, patientKeys));
        await tx.delete(patients).where(inArray(patients.patientKey, patientKeys));
      });
    } finally { await Promise.all([pool.end(), emrDatabase.close()]); }
  });
  assert.equal((await pool.query<{ role: string }>("select current_user as role")).rows[0].role, "emr_app");
  for (const table of [patients, patientLinks, labResults]) {
    assert.equal((await db.select({ total: count() }).from(table))[0].total, 0, "Use empty disposable EMR tables only");
  }
  await db.insert(patients).values(patientKeys.map((patientKey) => ({ patientKey, displayLabel: "C2 synthetic only" })));
  await db.insert(patientLinks).values([
    { identifierSystem: patientSystem, identifierValue: "B4A-SYNTHETIC-P1", patientKey: patientKeys[0] },
    { identifierSystem: "urn:c2:other", identifierValue: "B4A-SYNTHETIC-P1", patientKey: patientKeys[1] },
    { identifierSystem: patientSystem, identifierValue: "C2-SYNTHETIC-P2", patientKey: patientKeys[1] },
    { identifierSystem: "urn:c2:other", identifierValue: "C2-ONLY-OTHER", patientKey: patientKeys[1] },
  ]);
  const rows = (input: ReturnType<typeof validObservation>) => repository.getLabResultsBySource(input.identifier[0].system, input.identifier[0].value);
  const linkFilter = (id: string) => and(eq(patientLinks.identifierSystem, patientSystem), eq(patientLinks.identifierValue, id));

  await t.test("first valid Observation is committed to the exactly linked patient and satisfies Worker verification", async () => {
    const input = validObservation(); const before = structuredClone(input);
    const receipt = await service.storeObservation(input);
    assert.ok(receipt.kind === "stored"); assert.equal(receipt.result, "STORED");
    assert.equal(receipt.patient_key, patientKeys[0], "Identical identifier in another namespace must not select patient 2");
    const read = await service.getLabResultsBySource(input.identifier[0].system, input.identifier[0].value);
    assert.equal(read.kind, "found");
    assert.deepEqual(verifyReadBack(read, input, receipt), []);
    assert.deepEqual((await rows(input))[0].fhir_json, before); assert.deepEqual(input, before);
    assert.deepEqual(Object.keys(receipt).sort(), ["kind", "result", "external_system", "external_id", "target_id", "patient_key"].sort());
  });

  await t.test(
    "different result IDs with identical clinical values must both be stored",
    async () => {
      // Hai kết quả giống hệt nhau, ngoại trừ mã kết quả.
      const resultA = validObservation();
      const resultB = structuredClone(resultA);

      resultB.identifier[0].value =
        `C2-SYNTHETIC-${randomUUID()}`;

      assert.notEqual(
        resultA.identifier[0].value,
        resultB.identifier[0].value,
      );

      // Lưu cả hai qua EMR Service thật.
      const receiptA = await service.storeObservation(resultA);
      const receiptB = await service.storeObservation(resultB);

      assert.equal(receiptA.kind, "stored");
      assert.equal(receiptB.kind, "stored");

      if (
        receiptA.kind !== "stored" ||
        receiptB.kind !== "stored"
      ) {
        return;
      }

      // Phải có hai target_id khác nhau.
      assert.notEqual(
        receiptA.target_id,
        receiptB.target_id,
      );

      // Cả hai phải thuộc đúng bệnh nhân đã liên kết.
      assert.equal(receiptA.patient_key, patientKeys[0]);
      assert.equal(receiptB.patient_key, patientKeys[0]);

      // Đọc hai kết quả từ PostgreSQL thật.
      const storedA = await rows(resultA);
      const storedB = await rows(resultB);

      assert.equal(storedA.length, 1);
      assert.equal(storedB.length, 1);

      assert.notEqual(
        storedA[0].external_id,
        storedB[0].external_id,
      );

      // Giá trị xét nghiệm giống nhau phải được giữ nguyên.
      assert.equal(
        storedA[0].quantity,
        storedB[0].quantity,
      );

      assert.equal(
        storedA[0].analyte_code,
        storedB[0].analyte_code,
      );

      assert.deepEqual(storedA[0].fhir_json, resultA);
      assert.deepEqual(storedB[0].fhir_json, resultB);

      // Gửi lại A không được tạo thêm bản ghi.
      const retryA = await service.storeObservation(resultA);
      assert.equal(retryA.kind, "already_exists");

      assert.equal((await rows(resultA)).length, 1);
      assert.equal((await rows(resultB)).length, 1);
    },
  );


  await t.test("missing link, other-namespace-only link and unsupported namespace never create patients/results", async () => {
    for (const id of ["C2-MISSING", "C2-ONLY-OTHER"]) {
      const input = validObservation(); input.subject.identifier.value = id;
      const result = await service.storeObservation(input);
      assert.equal(result.kind, "patient_not_linked"); assert.deepEqual(await rows(input), []);
    }
    const input = validObservation(); setField(input, "subject.identifier.system", "urn:c2:other");
    assert.equal((await service.storeObservation(input)).kind, "unsupported");
    assert.deepEqual(await rows(input), []);
    assert.equal((await db.select({ total: count() }).from(patients))[0].total, 2);
  });

  await t.test("invalid and unsupported observations do not persist even if their source key already exists", async () => {
    const original = validObservation(); await service.storeObservation(original);
    const before = await rows(original);
    for (const [path, value] of [["status", "amended"], ["valueQuantity.value", "3.4"],
      ["effectiveDateTime", "2026-02-29T12:00:00Z"], ["component", []], ["referenceRange.0.low.value", 99]]) {
      const invalid = structuredClone(original); setField(invalid, path as string, value);
      const result = await service.storeObservation(invalid);
      assert.ok(result.kind === "invalid" || result.kind === "unsupported");
      assert.deepEqual(await rows(original), before);
    }
  });

  await t.test("identical retry and reordered nested keys return ALREADY_EXISTS with every original column unchanged", async () => {
    const input = validObservation(); const first = await service.storeObservation(input); assert.ok(first.kind === "stored");
    const before = await rows(input);
    for (const candidate of [input, reverseKeys(input), JSON.parse(JSON.stringify(input))]) {
      assert.deepEqual(await service.storeObservation(candidate), { ...first, kind: "already_exists", result: "ALREADY_EXISTS" });
      assert.deepEqual(await rows(input), before);
    }
  });

  await t.test("same source with any supported content difference conflicts, including equivalent timestamp spelling", async () => {
    const input = validObservation(); await service.storeObservation(input); const before = await rows(input);
    for (const [path, value] of [
      ["subject.identifier.value", "C2-SYNTHETIC-P2"], ["code.coding.0.code", "50802"],
      ["code.coding.0.display", "Different display"], ["code.text", "Different context"],
      ["valueQuantity.value", 3.5], ["referenceRange.0.low.value", 3.2], ["referenceRange.0.high.value", 5.2],
      ["effectiveDateTime", "2180-06-03T19:00:00.123456+07:00"],
      ["effectiveDateTime", "2180-06-03T12:00:00.1234560Z"],
      ["effectiveDateTime", "2180-06-03T12:00:00.123457Z"],
    ] as const) {
      const changed = structuredClone(input); setField(changed, path, value);
      const result = await service.storeObservation(changed);
      assert.equal(result.kind, "conflict");
      if (result.kind === "conflict") assert.equal(result.error.code, "DUPLICATE_CONFLICT");
      assert.deepEqual(await rows(input), before);
    }
    const changed = structuredClone(input); delete changed.referenceRange;
    assert.equal((await service.storeObservation(changed)).kind, "conflict");
    const unitChanged = structuredClone(input); unitChanged.code.coding[0].code = "50912"; unitChanged.valueQuantity.unit = "mg/dL";
    unitChanged.referenceRange![0].low!.unit = "mg/dL"; unitChanged.referenceRange![0].high!.unit = "mg/dL";
    assert.equal((await service.storeObservation(unitChanged)).kind, "conflict");
    assert.deepEqual(await rows(input), before);
  });

  await t.test("twelve concurrent identical requests create one row and share the original receipt", async () => {
    const input = validObservation();
    const outcomes = await Promise.all(Array.from({ length: 12 }, () => service.storeObservation(input)));
    const created = outcomes.filter((result) => result.kind === "stored");
    assert.equal(created.length, 1); assert.equal(outcomes.filter((result) => result.kind === "already_exists").length, 11);
    const winner = created[0]; assert.ok(winner.kind === "stored");
    for (const result of outcomes) {
      assert.ok(result.kind === "stored" || result.kind === "already_exists");
      assert.equal(result.target_id, winner.target_id); assert.equal(result.patient_key, winner.patient_key);
    }
    assert.equal((await rows(input)).length, 1);
  });

  await t.test("concurrent conflicting requests persist exactly one entire winner and reject the others", async () => {
    const input = validObservation();
    const candidates = Array.from({ length: 8 }, (_, i) => ({ ...structuredClone(input), valueQuantity: { value: i, unit: input.valueQuantity.unit } }));
    const outcomes = await Promise.all(candidates.map((candidate) => service.storeObservation(candidate)));
    assert.equal(outcomes.filter((result) => result.kind === "stored").length, 1);
    assert.equal(outcomes.filter((result) => result.kind === "conflict").length, 7);
    const winnerIndex = outcomes.findIndex((result) => result.kind === "stored");
    const saved = await rows(input); assert.equal(saved.length, 1);
    assert.deepEqual(saved[0].fhir_json, candidates[winnerIndex]);
    assert.equal(saved[0].quantity, String(winnerIndex));
  });

  await t.test("same original JSON after patient-link reassignment conflicts; removing the link returns PATIENT_NOT_LINKED", async () => {
    const input = validObservation(); await service.storeObservation(input); const before = await rows(input);
    const id = input.subject.identifier.value;
    try {
      await db.update(patientLinks).set({ patientKey: patientKeys[1] }).where(linkFilter(id));
      assert.equal((await service.storeObservation(input)).kind, "conflict");
      assert.deepEqual(await rows(input), before);
      await db.delete(patientLinks).where(linkFilter(id));
      assert.equal((await service.storeObservation(input)).kind, "patient_not_linked");
      assert.deepEqual(await rows(input), before);
    } finally {
      await db.insert(patientLinks).values({ identifierSystem: patientSystem, identifierValue: id, patientKey: patientKeys[0] })
        .onConflictDoUpdate({ target: [patientLinks.identifierSystem, patientLinks.identifierValue], set: { patientKey: patientKeys[0] } });
    }
  });

  await t.test("patient link remains locked from resolution through commit, preventing reassignment between lookup and INSERT", async () => {
    const input = validObservation(); const id = `C2-LOCK-${randomUUID()}`; input.subject.identifier.value = id;
    await db.insert(patientLinks).values({ identifierSystem: patientSystem, identifierValue: id, patientKey: patientKeys[0] });
    const entered = deferred(); const release = deferred();
    const storing = service.storeObservation(input, { withPatientLinkTransaction(system, value, operation) {
      return repository.withPatientLinkTransaction(system, value, async (linked) => {
        entered.resolve(); await release.promise; return operation(linked);
      });
    } });
    let writer: Promise<unknown> | undefined;
    try {
      await entered.promise;
      writer = pool.query("update emr.patient_links set patient_key = $1 where identifier_system = $2 and identifier_value = $3",
        [patientKeys[1], patientSystem, id]);
      await waitForLock("update emr.patient_links%");
      release.resolve();
      const outcome = await storing; assert.ok(outcome.kind === "stored"); assert.equal(outcome.patient_key, patientKeys[0]);
      await writer;
      assert.equal(await repository.getPatientKeyByIdentifier(patientSystem, id), patientKeys[1]);
      assert.equal((await service.storeObservation(input)).kind, "conflict");
      assert.equal((await rows(input))[0].patient_key, patientKeys[0]);
    } finally { release.resolve(); await storing; await writer; }
  });

  await t.test("lookup waiting behind a link writer uses its newly committed patient rather than stale identity", async () => {
    const input = validObservation(); const id = `C2-WRITER-${randomUUID()}`; input.subject.identifier.value = id;
    await db.insert(patientLinks).values({ identifierSystem: patientSystem, identifierValue: id, patientKey: patientKeys[0] });
    const writer = await pool.connect(); let storing: ReturnType<typeof service.storeObservation> | undefined;
    try {
      await writer.query("begin");
      await writer.query("update emr.patient_links set patient_key = $1 where identifier_system = $2 and identifier_value = $3",
        [patientKeys[1], patientSystem, id]);
      storing = service.storeObservation(input);
      await waitForLock('select%"emr"."patient_links"%for share%');
      await writer.query("commit");
      const outcome = await storing; assert.ok(outcome.kind === "stored"); assert.equal(outcome.patient_key, patientKeys[1]);
      assert.equal((await rows(input))[0].patient_key, patientKeys[1]);
    } finally { await writer.query("rollback"); writer.release(); await storing; }
  });

  await t.test("finite numeric extremes, optional bounds and timezone microseconds survive Service and database", async () => {
    for (const value of [Number.MIN_VALUE, Number.MAX_VALUE, -3.141592653589793, 0, 1e30]) {
      const input = validObservation(); input.valueQuantity.value = value;
      const outcome = await service.storeObservation(input); assert.ok(outcome.kind === "stored");
      const result = await service.getLabResultsBySource(input.identifier[0].system, input.identifier[0].value);
      assert.deepEqual(verifyReadBack(result, input, outcome), []);
    }
    for (const bound of ["both", "low", "high", "none"]) {
      const input = validObservation(); input.effectiveDateTime = "2026-10-29T15:00:00.000001000+07:00";
      if (bound === "none") delete input.referenceRange;
      else if (bound === "low") delete input.referenceRange![0].high;
      else if (bound === "high") delete input.referenceRange![0].low;
      const receipt = await service.storeObservation(input); assert.ok(receipt.kind === "stored");
      const result = await service.getLabResultsBySource(input.identifier[0].system, input.identifier[0].value);
      assert.deepEqual(verifyReadBack(result, input, receipt), []);
      assert.equal((await rows(input))[0].effective_at, "2026-10-29T08:00:00.000001Z");
      assert.deepEqual((await rows(input))[0].fhir_json, input);
    }
  });

  await t.test("patient listing returns stable paginated rows; source lookup has no pagination and matches both identifiers", async () => {
    const all = await repository.listLabResults({ patientKey: patientKeys[0], limit: 100 });
    assert.ok(all.length > 4);
    const page = await service.listLabResults({ patientKey: patientKeys[0], limit: 3, offset: 2 });
    assert.deepEqual(page, { kind: "found", items: all.slice(2, 5), limit: 3, offset: 2 });
    assert.deepEqual(await service.listLabResults({ patientKey: randomUUID() }), { kind: "found", items: [], limit: 20, offset: 0 });
    assert.deepEqual(await service.getLabResultsBySource("missing", all[0].external_id), { kind: "found", items: [] });
    assert.deepEqual(await service.getLabResultsBySource(all[0].external_system, "missing"), { kind: "found", items: [] });
  });

  await t.test("real UUID constraint failures and post-insert callback failures roll back without success or clinical diagnostics", async () => {
    const first = await service.storeObservation(validObservation()); assert.ok(first.kind === "stored");
    const input = validObservation();
    const conflict = await service.storeObservation(input, { withPatientLinkTransaction(system, value, operation) {
      return repository.withPatientLinkTransaction(system, value, (linked) => operation({ ...linked,
        createLabResult: (prepared) => linked.createLabResult({ ...prepared, targetId: first.target_id }),
      }));
    } });
    assert.equal(conflict.kind, "unavailable"); assert.deepEqual(await rows(input), []);
    const rolledBack = await service.storeObservation(input, { withPatientLinkTransaction(system, value, operation) {
      return repository.withPatientLinkTransaction(system, value, async (linked) => {
        await operation(linked); throw new Error("private diagnostic after INSERT");
      });
    } });
    assert.equal(rolledBack.kind, "unavailable"); assert.deepEqual(await rows(input), []);
    assert.doesNotMatch(JSON.stringify([conflict, rolledBack]), /private|INSERT|constraint|password/);
    assert.equal((await service.storeObservation(input)).kind, "stored", "Rollback releases locks and leaves pool usable");
  });

  await t.test("closed database yields unavailable for storage and both reads", async () => {
    const original = emrDatabase.db; const closed = new Pool({ connectionString: testUrl }); await closed.end();
    emrDatabase.db = drizzle({ client: closed });
    try {
      assert.equal((await service.storeObservation(validObservation())).kind, "unavailable");
      assert.equal((await service.getLabResultsBySource("synthetic", "missing")).kind, "unavailable");
      assert.equal((await service.listLabResults({ patientKey: patientKeys[0] })).kind, "unavailable");
    } finally { emrDatabase.db = original; }
  });

  async function waitForLock(pattern: string) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await pool.query<{ waiting: boolean }>(`select exists (select 1 from pg_stat_activity
        where usename = current_user and wait_event_type = 'Lock' and query like $1) as waiting`, [pattern]);
      if (result.rows[0].waiting) return;
      await pause(25);
    }
    assert.fail("Expected an actual PostgreSQL lock wait");
  }
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
