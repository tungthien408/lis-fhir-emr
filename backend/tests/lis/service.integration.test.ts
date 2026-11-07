/**
 * SPP-66 A2: kiểm thử Publish Service trên PostgreSQL thật với dữ liệu giả.
 * Bao gồm validation, snapshot/hash, độ chính xác số/thời gian, idempotency,
 * Publish đồng thời, chờ khóa nguồn và rollback khi INSERT thất bại.
 * Dùng cùng database test trống của A1; npm test chạy các file lần lượt.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { mock, test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { count, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { hashCanonicalJson } from "../../src/lis/canonical-json.js";
import type { PublishEvent } from "../../src/lis/repository.js";
import { patients, publishEvents, results, testCatalog } from "../../src/lis/schema.js";
import type { PublishOutcome } from "../../src/lis/service.js";

const testUrl = process.env.LIS_REPOSITORY_TEST_DATABASE_URL?.trim();
delete process.env.LIS_DATABASE_URL;
if (testUrl) process.env.LIS_DATABASE_URL = testUrl;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function snapshotField(event: PublishEvent, key: string): unknown {
  const snapshot = event.sourceSnapshot;
  assert.ok(isRecord(snapshot) && Object.hasOwn(snapshot, key));
  return snapshot[key];
}

function createdEvent(outcome: PublishOutcome): PublishEvent {
  assert.ok(outcome.kind === "created", `Expected created, received ${outcome.kind}`);
  return outcome.event;
}

function hasSqlState(error: unknown, code: string): boolean {
  if (!(error instanceof Error)) return false;
  return ("code" in error && error.code === code) || hasSqlState(error.cause, code);
}

async function waitForSourceLock(pool: Pool): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ blocked: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE usename = current_user AND wait_event_type = 'Lock'
          AND query LIKE 'select %from "lis"."results"%for share%'
      ) AS blocked
    `);
    if (result.rows[0]?.blocked) return;
    await setTimeout(10);
  }
  assert.fail("Publish did not wait for the competing source writer");
}

interface SourceOptions {
  resultStatus?: "READY" | "FINAL";
  valueNum?: string;
  unit?: string;
  referenceLow?: string | null;
  referenceHigh?: string | null;
  testName?: string;
  acceptedUnits?: unknown;
}

test("LIS Publish Service integration (PostgreSQL)", {
  skip: testUrl ? false : "Set LIS_REPOSITORY_TEST_DATABASE_URL to an empty, disposable PostgreSQL database",
}, async (t) => {
  const service = await import("../../src/lis/service.js");
  const repository = await import("../../src/lis/repository.js");
  const { lisDatabase } = await import("../../src/lis/db.js");
  const pool = new Pool({ connectionString: testUrl, max: 4, connectionTimeoutMillis: 3000 });
  const fixtureDb = drizzle({ client: pool });
  const prefix = `A2TEST-${crypto.randomUUID()}`;
  const resultIds: string[] = [];
  const patientIds: string[] = [];
  const testCodes: string[] = [];
  let canClean = false;

  t.after(async () => {
    try {
      if (canClean) {
        await fixtureDb.transaction(async (tx) => {
          await tx.delete(publishEvents).where(inArray(publishEvents.resultId, resultIds));
          await tx.delete(results).where(inArray(results.resultId, resultIds));
          await tx.delete(testCatalog).where(inArray(testCatalog.testCode, testCodes));
          await tx.delete(patients).where(inArray(patients.patientId, patientIds));
        });
      }
    } finally {
      await Promise.all([pool.end(), lisDatabase.close()]);
    }
  });
  const identity = await pool.query<{ role: string }>("SELECT current_user AS role");
  assert.equal(identity.rows[0]?.role, "lis_app");
  for (const table of [patients, testCatalog, results, publishEvents]) {
    const [row] = await fixtureDb.select({ total: count() }).from(table);
    assert.equal(row?.total, 0, "Use an empty, disposable LIS database for this suite");
  }
  canClean = true;

  async function source(options: SourceOptions = {}) {
    const suffix = resultIds.length + 1;
    const resultId = `${prefix}-R${suffix}`;
    const patientId = `${prefix}-P${suffix}`;
    const testCode = `${prefix}-T${suffix}`;
    resultIds.push(resultId);
    patientIds.push(patientId);
    testCodes.push(testCode);
    await fixtureDb.transaction(async (tx) => {
      await tx.insert(patients).values({ patientId, sourceSubjectId: patientId, displayLabel: "Synthetic" });
      await tx.insert(testCatalog).values({
        testCode, testName: options.testName ?? "Synthetic test", fluid: null, category: "Chemistry",
        acceptedUnits: options.acceptedUnits ?? ["mg/dL", "mmol/L"], catalogVersion: "a2-test",
      });
      await tx.insert(results).values({
        resultId, patientId, testCode, valueNum: options.valueNum ?? "3.4000",
        unit: options.unit ?? "mg/dL", referenceLow: options.referenceLow ?? null,
        referenceHigh: options.referenceHigh ?? null, effectiveAt: new Date("2026-10-22T08:00:00Z"),
        resultStatus: options.resultStatus ?? "FINAL", provenance: { synthetic: true },
      });
    });
    return { resultId, patientId, testCode };
  }

  async function assertInvalid(resultId: string, code: string, field: string): Promise<void> {
    const outcome = await service.publishResult(resultId);
    assert.ok(outcome.kind === "invalid");
    assert.equal(outcome.error.code, code);
    assert.equal(outcome.error.field, field);
    assert.equal(await repository.getPublishEventByResultId(resultId), undefined);
  }

  await t.test("first valid FINAL Publish persists a complete snapshot, UUID, SHA-256 and PENDING", async () => {
    const ids = await source({ referenceLow: "1.2000", referenceHigh: "5.1000" });
    const before = Date.now();
    const event = createdEvent(await service.publishResult(ids.resultId));
    const expected = {
      result_id: ids.resultId, patient_id: ids.patientId, test_code: ids.testCode,
      test_name: "Synthetic test", fluid: null, category: "Chemistry", value_num: 3.4,
      unit: "mg/dL", reference_low: 1.2, reference_high: 5.1,
      effective_at: "2026-10-22T08:00:00.000000Z", result_status: "FINAL",
    };
    assert.deepEqual(event.sourceSnapshot, expected);
    assert.equal(event.sourceHash, hashCanonicalJson(expected));
    assert.match(event.eventId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(event.sourceSystem, "lis-demo");
    assert.equal(event.dispatchStatus, "PENDING");
    assert.equal(event.dispatchAttemptCount, 0);
    assert.equal(event.exchangeId, null);
    assert.ok(event.publishedAt.getTime() >= before && event.publishedAt.getTime() <= Date.now());
    assert.deepEqual(await repository.getPublishEventByEventId(event.eventId), event);
  });

  await t.test("changed source returns CONTENT_CONFLICT without changing the original event", async () => {
    const ids = await source();
    const first = createdEvent(await service.publishResult(ids.resultId));
    await fixtureDb.update(results).set({ resultStatus: "READY", valueNum: "99", unit: "changed" })
      .where(eq(results.resultId, ids.resultId));
    await fixtureDb.update(testCatalog).set({ testName: "Changed", acceptedUnits: [42] })
      .where(eq(testCatalog.testCode, ids.testCode));
    await fixtureDb.update(publishEvents).set({ dispatchStatus: "RETRY_WAIT", dispatchAttemptCount: 2 })
      .where(eq(publishEvents.eventId, first.eventId));
    const original = await repository.getPublishEventByEventId(first.eventId);
    const repeated = await service.publishResult(ids.resultId);
    assert.equal(repeated.kind, "conflict");
    assert.deepEqual(await repository.getPublishEventByEventId(first.eventId), original);
  });

  await t.test("persisted snapshot remains compatible: decimal scale and catalog-only policy changes are not content changes", async () => {
    const ids = await source({ valueNum: "3.4000" });
    const first = createdEvent(await service.publishResult(ids.resultId));
    await fixtureDb.update(results).set({ valueNum: "3.4" }).where(eq(results.resultId, ids.resultId));
    await fixtureDb.update(testCatalog).set({ acceptedUnits: ["different-policy"] }).where(eq(testCatalog.testCode, ids.testCode));
    const same = await service.publishResult(ids.resultId);
    assert.ok(same.kind === "existing"); assert.deepEqual(same.event, first);
    await fixtureDb.update(testCatalog).set({ testName: "Changed display" }).where(eq(testCatalog.testCode, ids.testCode));
    const changed = await service.publishResult(ids.resultId);
    assert.equal(changed.kind, "conflict");
    assert.deepEqual(await repository.getPublishEventByEventId(first.eventId), first);
  });

  await t.test("missing result returns a typed not_found outcome", async () => {
    const resultId = `${prefix}-missing`;
    assert.deepEqual(await service.publishResult(resultId), { kind: "not_found", resultId });
    assert.equal(await repository.getPublishEventByResultId(resultId), undefined);
  });

  await t.test("READY result is rejected without creating an event", async () => {
    const ids = await source({ resultStatus: "READY" });
    await assertInvalid(ids.resultId, "RESULT_NOT_READY", "result_status");
  });

  await t.test("unit must match an accepted catalog entry exactly; no trimming or case conversion", async () => {
    for (const unit of ["g/dL", "mg/dl", " mg/dL ", ""]) {
      const ids = await source({ unit });
      await assertInvalid(ids.resultId, "INVALID_UNIT", "unit");
    }
    const ids = await source({ unit: "mmol/L" });
    const event = createdEvent(await service.publishResult(ids.resultId));
    assert.equal(snapshotField(event, "unit"), "mmol/L");
  });

  await t.test("malformed catalog entries and empty required text are rejected", async () => {
    const malformed = await source({ acceptedUnits: [42] });
    await assertInvalid(malformed.resultId, "INVALID_TEST_CODE", "accepted_units");
    const emptyName = await source({ testName: " " });
    await assertInvalid(emptyName.resultId, "VALIDATION_ERROR", "test_name");
  });

  await t.test("reference bounds allow neither, only low, or only high", async () => {
    for (const bounds of [
      { referenceLow: null, referenceHigh: null },
      { referenceLow: "1.20", referenceHigh: null },
      { referenceLow: null, referenceHigh: "5.10" },
    ]) {
      const ids = await source(bounds);
      const event = createdEvent(await service.publishResult(ids.resultId));
      assert.equal(snapshotField(event, "reference_low"), bounds.referenceLow === null ? null : 1.2);
      assert.equal(snapshotField(event, "reference_high"), bounds.referenceHigh === null ? null : 5.1);
    }
  });

  await t.test("decimal JSON round-trip preserves values, normalizes scale and accepts negative or tiny values", async () => {
    for (const [valueNum, expected] of [
      ["3.4000", 3.4], ["-2.500", -2.5], ["-0.000", 0], ["1e-7", 1e-7], ["1e20", 1e20],
    ] as const) {
      const ids = await source({ valueNum });
      const event = createdEvent(await service.publishResult(ids.resultId));
      assert.equal(snapshotField(event, "value_num"), expected);
    }
  });

  await t.test("precision loss, overflow, underflow and non-finite NUMERIC values are rejected", async () => {
    for (const valueNum of ["9007199254740993", "0.10000000000000001", "1e400", "1e-400", "NaN", "Infinity", "-Infinity"]) {
      const ids = await source({ valueNum });
      await assertInvalid(ids.resultId, "VALIDATION_ERROR", "value_num");
    }
  });

  await t.test("reference bounds receive the same precision checks as the result value", async () => {
    for (const field of ["referenceLow", "referenceHigh"] as const) {
      const ids = await source({ [field]: "0.10000000000000001" });
      await assertInvalid(ids.resultId, "VALIDATION_ERROR", field === "referenceLow" ? "reference_low" : "reference_high");
    }
  });

  await t.test("timestamp normalization preserves the UTC instant and all PostgreSQL microseconds", async () => {
    const ids = await source();
    await fixtureDb.update(results).set({ effectiveAt: sql`${"2026-10-22T15:00:00.123456+07:00"}::timestamptz` })
      .where(eq(results.resultId, ids.resultId));
    const event = createdEvent(await service.publishResult(ids.resultId));
    assert.equal(snapshotField(event, "effective_at"), "2026-10-22T08:00:00.123456Z");
    const stored = await repository.getPublishEventByEventId(event.eventId);
    assert.deepEqual(stored?.sourceSnapshot, event.sourceSnapshot);
  });

  await t.test("timestamps without a finite ISO instant are rejected", async () => {
    const ids = await source();
    await fixtureDb.update(results).set({ effectiveAt: sql`'infinity'::timestamptz` })
      .where(eq(results.resultId, ids.resultId));
    await assertInvalid(ids.resultId, "VALIDATION_ERROR", "effective_at");
  });

  await t.test("eight concurrent Service Publishes produce exactly one event and seven reuses", async () => {
    const ids = await source();
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => service.publishResult(ids.resultId)));
    const creators = outcomes.filter((outcome) => outcome.kind === "created");
    assert.equal(creators.length, 1);
    assert.equal(outcomes.filter((outcome) => outcome.kind === "existing").length, 7);
    const winner = createdEvent(creators[0]);
    for (const outcome of outcomes) {
      assert.ok(outcome.kind === "created" || outcome.kind === "existing");
      assert.deepEqual(outcome.event, winner);
    }
    const stored = await fixtureDb.select().from(publishEvents).where(eq(publishEvents.resultId, ids.resultId));
    assert.deepEqual(stored, [winner]);
  });

  for (const change of ["result", "catalog"] as const) {
    await t.test(`Publish waits for a ${change} writer and validates its newly committed state`, async () => {
      const ids = await source();
      const writer = await pool.connect();
      try {
        await writer.query("BEGIN");
        const writerDb = drizzle({ client: writer });
        if (change === "result") {
          await writerDb.update(results).set({ resultStatus: "READY", valueNum: "99" })
            .where(eq(results.resultId, ids.resultId));
        } else {
          await writerDb.update(testCatalog).set({ acceptedUnits: ["mmol/L"] })
            .where(eq(testCatalog.testCode, ids.testCode));
        }
        const pending = service.publishResult(ids.resultId);
        void pending.catch(() => undefined);
        try {
          await waitForSourceLock(pool);
        } finally {
          await writer.query("COMMIT");
        }
        const outcome = await pending;
        assert.ok(outcome.kind === "invalid");
        assert.equal(outcome.error.code, change === "result" ? "RESULT_NOT_READY" : "INVALID_UNIT");
        assert.equal(await repository.getPublishEventByResultId(ids.resultId), undefined);
      } finally {
        await writer.query("ROLLBACK");
        writer.release();
      }
    });
  }

  await t.test("Publish snapshots the new committed value after waiting for a source update", async () => {
    const ids = await source();
    const writer = await pool.connect();
    try {
      await writer.query("BEGIN");
      await drizzle({ client: writer }).update(results).set({ valueNum: "7.25" })
        .where(eq(results.resultId, ids.resultId));
      const pending = service.publishResult(ids.resultId);
      void pending.catch(() => undefined);
      try {
        await waitForSourceLock(pool);
      } finally {
        await writer.query("COMMIT");
      }
      const event = createdEvent(await pending);
      assert.equal(snapshotField(event, "value_num"), 7.25);
    } finally {
      await writer.query("ROLLBACK");
      writer.release();
    }
  });

  await t.test("a real INSERT failure rolls back and releases source locks without storing an event", async () => {
    const first = await source();
    const original = createdEvent(await service.publishResult(first.resultId));
    const second = await source();
    // Force only UUID generation to collide; persistence and rollback are real PG.
    const uuid = mock.method(crypto, "randomUUID", () => original.eventId);
    syncBuiltinESMExports();
    try {
      await assert.rejects(service.publishResult(second.resultId), (error: unknown) => hasSqlState(error, "23505"));
    } finally {
      uuid.mock.restore();
      syncBuiltinESMExports();
    }
    assert.equal(await repository.getPublishEventByResultId(second.resultId), undefined);
    assert.deepEqual(await repository.getPublishEventByEventId(original.eventId), original);
    await fixtureDb.update(results).set({ valueNum: "7.25" }).where(eq(results.resultId, second.resultId));
    const retried = createdEvent(await service.publishResult(second.resultId));
    assert.equal(snapshotField(retried, "value_num"), 7.25);
  });
});
