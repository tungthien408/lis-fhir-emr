/**
 * Kiểm thử tích hợp LIS Repository (SPP-66 A1) trên PostgreSQL thật qua Drizzle.
 *
 * Các nhóm hành vi được kiểm tra:
 * - Đọc kết quả kèm bệnh nhân và catalog xét nghiệm; xử lý bản ghi không tồn tại,
 *   trường nullable và giữ độ chính xác NUMERIC, không tự làm tròn.
 * - Lọc theo patientId, testCode, resultStatus; kết hợp các bộ lọc và phân trang
 *   bằng limit/offset với thứ tự ổn định, không thiếu hoặc lặp bản ghi giữa các trang.
 * - Lưu sự kiện Publish mới với đầy đủ dữ liệu và trạng thái PENDING; tra lại
 *   được theo resultId hoặc eventId.
 * - Publish lặp hoặc đồng thời chỉ giữ một sự kiện cho mỗi resultId, trả lại
 *   sự kiện đã lưu và giữ nguyên snapshot, hash, UUID, thời điểm cùng trạng thái cũ.
 * - Xử lý INSERT phải chờ transaction cạnh tranh commit hoặc rollback.
 * - Rollback khi gặp lỗi FK, UUID hoặc trùng khóa eventId của kết quả khác;
 *   không để lại sự kiện dở dang và vẫn sử dụng được kết nối sau lỗi.
 *
 * Điều kiện chạy: LIS_REPOSITORY_TEST_DATABASE_URL trỏ tới database test riêng,
 * có schema LIS từ SQL gốc, role lis_app và các bảng nguồn/sự kiện trống.
 * Suite tự tạo dữ liệu giả có namespace UUID và dọn fixture sau test; không dùng
 * dữ liệu bệnh nhân thật. Thiếu URL test thì skip; có URL nhưng database lỗi thì fail.
 *
 * Phạm vi chỉ là Repository: chưa kiểm thử validation FINAL, tạo snapshot/hash,
 * HTTP endpoint hoặc luồng gửi sang Middleware/EMR. Test thiếu cấu hình kết nối
 * nằm riêng trong repository.unconfigured.test.ts.
 * Cách tạo PostgreSQL test bằng Docker và chạy lại: docs/spp-66-a1-review.md.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { count, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { NewPublishEvent } from "../../src/lis/repository.js";
import { patients, publishEvents, results, testCatalog } from "../../src/lis/schema.js";

const testUrl = process.env.LIS_REPOSITORY_TEST_DATABASE_URL?.trim();
delete process.env.LIS_DATABASE_URL;
if (testUrl) process.env.LIS_DATABASE_URL = testUrl;

async function waitForBlockedPublish(pool: Pool): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const locks = await pool.query<{ blocked: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE usename = current_user AND wait_event_type = 'Lock'
          AND query LIKE 'insert into "lis"."publish_events"%'
      ) AS blocked
    `);
    if (locks.rows[0]?.blocked) return;
    await setTimeout(10);
  }
  assert.fail("The competing Publish did not reach the PostgreSQL unique-key lock");
}

// Drizzle wraps driver errors with a cause. Check the PostgreSQL SQLSTATE
// without casting unknown errors or matching potentially sensitive SQL text.
function hasSqlState(error: unknown, code: string): boolean {
  if (!(error instanceof Error)) return false;
  if ("code" in error && error.code === code) return true;
  return hasSqlState(error.cause, code);
}

test("LIS Repository integration (PostgreSQL)", {
  skip: testUrl ? false : "Set LIS_REPOSITORY_TEST_DATABASE_URL to an empty, disposable PostgreSQL database",
}, async (t) => {
  const repository = await import("../../src/lis/repository.js");
  const { lisDatabase } = await import("../../src/lis/db.js");
  const pool = new Pool({ connectionString: testUrl, max: 4, connectionTimeoutMillis: 3000 });
  const fixtureDb = drizzle({ client: pool });
  const prefix = `A1TEST-${randomUUID()}`;
  const patientIds = [`${prefix}-P1`, `${prefix}-P2`];
  const testCodes = [`${prefix}-T1`, `${prefix}-T2`];
  const effectiveAt = new Date("2026-10-22T08:00:00Z");
  const seedResults = Array.from({ length: 26 }, (_, index) => ({
    resultId: `${prefix}-R${String(index + 1).padStart(2, "0")}`,
    patientId: patientIds[index % 2],
    testCode: testCodes[Math.floor(index / 2) % 2],
    valueNum: index === 0 ? "12345678901234567890.1234567890123456789" : "3.4",
    unit: "mg/dL",
    referenceLow: index === 0 ? null : "1.2",
    referenceHigh: null,
    effectiveAt,
    resultStatus: index % 3 === 0 ? "READY" : "FINAL",
    provenance: { synthetic: true },
  }));
  const resultIds = seedResults.map((row) => row.resultId);
  let seeded = false;

  t.after(async () => {
    try {
      if (seeded) {
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
  assert.equal(identity.rows[0]?.role, "lis_app", "Integration tests must use the LIS service role");
  // Refuse to read clinical rows from a populated database. Setup is external;
  // the test itself performs no DDL and touches only synthetic LIS fixtures.
  for (const table of [patients, testCatalog, results, publishEvents]) {
    const [row] = await fixtureDb.select({ total: count() }).from(table);
    assert.equal(row?.total, 0, "Use an empty, disposable LIS database for this suite");
  }
  await fixtureDb.transaction(async (tx) => {
    await tx.insert(patients).values(patientIds.map((patientId) => ({
      patientId, sourceSubjectId: patientId, displayLabel: "Synthetic patient",
    })));
    await tx.insert(testCatalog).values(testCodes.map((testCode, index) => ({
      testCode,
      testName: `Synthetic test ${index + 1}`,
      fluid: index === 0 ? "Blood" : null,
      category: index === 0 ? "Chemistry" : null,
      acceptedUnits: ["mg/dL"],
      catalogVersion: "a1-test",
    })));
    await tx.insert(results).values(seedResults);
  });
  seeded = true;

  function newEvent(index: number): NewPublishEvent {
    return {
      eventId: randomUUID(),
      resultId: resultIds[index],
      sourceSystem: "lis-repository-test",
      sourceSnapshot: { result_id: resultIds[index], value_num: 3.4, synthetic: true },
      sourceHash: "a".repeat(64), // Already prepared by the caller; no hashing in A1.
      publishedAt: new Date("2026-10-22T09:00:00Z"),
    };
  }

  await t.test("retrieves result, patient and complete catalog without numeric rounding", async () => {
    const row = await repository.getResultById(resultIds[0]);
    assert.ok(row);
    assert.deepEqual(row.result, seedResults[0]);
    assert.deepEqual(row.patient, {
      patientId: patientIds[0], sourceSubjectId: patientIds[0], displayLabel: "Synthetic patient",
    });
    assert.deepEqual(row.test, {
      testCode: testCodes[0], testName: "Synthetic test 1", fluid: "Blood", category: "Chemistry",
      acceptedUnits: ["mg/dL"], catalogVersion: "a1-test",
    });
    const nullable = await repository.getResultById(resultIds[2]);
    assert.equal(nullable?.test.fluid, null);
    assert.equal(nullable?.test.category, null);
  });

  await t.test("missing result and events return undefined", async () => {
    assert.equal(await repository.getResultById(`${prefix}-missing`), undefined);
    assert.equal(await repository.getPublishEventByResultId(resultIds[0]), undefined);
    assert.equal(await repository.getPublishEventByEventId(randomUUID()), undefined);
  });

  await t.test("lists default 20 rows in stable result-ID order", async () => {
    const rows = await repository.listResults();
    assert.deepEqual(rows.map((row) => row.result.resultId), resultIds.slice(0, 20));
    assert.equal(rows[0].test.testName, "Synthetic test 1");
    assert.equal(rows[0].patient.patientId, patientIds[0]);
  });

  await t.test("filters independently by patient, test and result status", async () => {
    for (const filter of [
      { patientId: patientIds[0] }, { testCode: testCodes[1] }, { resultStatus: "FINAL" as const },
    ]) {
      const rows = await repository.listResults({ ...filter, limit: 100 });
      const expected = seedResults.filter((row) => (
        (!filter.patientId || row.patientId === filter.patientId)
        && (!filter.testCode || row.testCode === filter.testCode)
        && (!filter.resultStatus || row.resultStatus === filter.resultStatus)
      ));
      assert.deepEqual(rows.map((row) => row.result), expected);
    }
  });

  await t.test("combines all filters with AND, then applies limit and offset", async () => {
    const options = { patientId: patientIds[0], testCode: testCodes[1], resultStatus: "FINAL" as const };
    const expected = seedResults.filter((row) => row.patientId === options.patientId
      && row.testCode === options.testCode && row.resultStatus === options.resultStatus);
    assert.ok(expected.length > 2);
    const rows = await repository.listResults({ ...options, limit: 2, offset: 1 });
    assert.deepEqual(rows.map((row) => row.result), expected.slice(1, 3));
    assert.deepEqual(await repository.listResults({ patientId: `${prefix}-missing` }), []);
    assert.deepEqual(await repository.listResults({ offset: 26 }), []);
  });

  await t.test("paginates unfiltered results without gaps or overlaps", async () => {
    const first = await repository.listResults({ limit: 10 });
    const second = await repository.listResults({ limit: 10, offset: 10 });
    const last = await repository.listResults({ limit: 10, offset: 20 });
    assert.deepEqual([...first, ...second, ...last].map((row) => row.result.resultId), resultIds);
  });

  await t.test("atomically creates a complete PENDING event and retrieves it by either ID", async () => {
    const input = newEvent(1);
    const saved = await repository.createPublishEvent(input);
    assert.equal(saved.created, true);
    assert.deepEqual(saved.event, {
      ...input,
      dispatchStatus: "PENDING", dispatchAttemptCount: 0, exchangeId: null,
      nextRetryAt: null, leaseUntil: null, ackedAt: null, leaseToken: null,
      lastErrorCode: null, lastErrorMessage: null, ackResponse: null,
    });
    assert.deepEqual(await repository.getPublishEventByResultId(input.resultId), saved.event);
    assert.deepEqual(await repository.getPublishEventByEventId(input.eventId), saved.event);
  });

  await t.test("reuses an existing event and preserves every original field on duplicate Publish", async () => {
    const input = newEvent(2);
    const first = await repository.createPublishEvent(input);
    // Duplicate Publish must also preserve dispatcher fields if they change later.
    await fixtureDb.update(publishEvents).set({
      dispatchStatus: "RETRY_WAIT", dispatchAttemptCount: 2,
      nextRetryAt: new Date("2026-10-22T09:01:00Z"), lastErrorCode: "TEST_NETWORK_ERROR",
    }).where(eq(publishEvents.eventId, first.event.eventId));
    const original = await repository.getPublishEventByEventId(first.event.eventId);
    const duplicate = await repository.createPublishEvent({
      ...newEvent(2), sourceSystem: "changed-system",
      sourceSnapshot: { changed: true }, sourceHash: "b".repeat(64),
      publishedAt: new Date("2026-10-23T00:00:00Z"),
    });
    assert.equal(duplicate.created, false);
    assert.deepEqual(duplicate.event, original);
    assert.deepEqual(await repository.getPublishEventByResultId(input.resultId), original);
  });

  await t.test("eight concurrent Publishes create exactly one immutable event", async () => {
    const inputs = Array.from({ length: 8 }, (_, index) => ({
      ...newEvent(4), sourceSnapshot: { contender: index },
      sourceHash: String(index).repeat(64), publishedAt: new Date(1792659600000 + index),
    }));
    const saved = await Promise.all(inputs.map((input) => repository.createPublishEvent(input)));
    const creators = saved.filter((outcome) => outcome.created);
    assert.equal(creators.length, 1);
    for (const outcome of saved) assert.deepEqual(outcome.event, creators[0].event);
    const winningInput = inputs.find((input) => input.eventId === creators[0].event.eventId);
    assert.ok(winningInput);
    assert.deepEqual(creators[0].event.sourceSnapshot, winningInput.sourceSnapshot);
    assert.equal(creators[0].event.sourceHash, winningInput.sourceHash);
    assert.deepEqual(creators[0].event.publishedAt, winningInput.publishedAt);
    const stored = await fixtureDb.select().from(publishEvents)
      .where(eq(publishEvents.resultId, resultIds[4]));
    assert.equal(stored.length, 1);
  });

  for (const commit of [true, false]) {
    await t.test(`waits for an uncommitted competing INSERT, then ${commit ? "reuses its committed event" : "creates after its rollback"}`, async () => {
      const index = commit ? 5 : 6;
      const blocker = await pool.connect();
      try {
        await blocker.query("BEGIN");
        const [first] = await drizzle({ client: blocker }).insert(publishEvents)
          .values(newEvent(index)).returning();
        const input = { ...newEvent(index), sourceSnapshot: { contender: true }, sourceHash: "b".repeat(64) };
        const pending = repository.createPublishEvent(input);
        // Attach immediately so a failure cannot become an unhandled rejection
        // while the test waits for evidence of the database lock.
        void pending.catch(() => undefined);
        try {
          await waitForBlockedPublish(pool);
        } finally {
          await blocker.query(commit ? "COMMIT" : "ROLLBACK");
        }
        const saved = await pending;
        assert.equal(saved.created, !commit);
        if (commit) assert.deepEqual(saved.event, first);
        else {
          assert.equal(saved.event.eventId, input.eventId);
          assert.deepEqual(saved.event.sourceSnapshot, input.sourceSnapshot);
          assert.equal(await repository.getPublishEventByEventId(first.eventId), undefined);
        }
        const stored = await fixtureDb.select().from(publishEvents)
          .where(eq(publishEvents.resultId, input.resultId));
        assert.deepEqual(stored, [saved.event]);
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
      }
    });
  }

  await t.test("foreign-key failure rolls back and leaves the connection usable", async () => {
    const input = { ...newEvent(7), resultId: `${prefix}-missing` };
    await assert.rejects(repository.createPublishEvent(input), (error: unknown) => hasSqlState(error, "23503"));
    assert.equal(await repository.getPublishEventByEventId(input.eventId), undefined);
    assert.equal(await repository.getPublishEventByResultId(input.resultId), undefined);
    assert.equal((await repository.createPublishEvent(newEvent(7))).created, true);
  });

  await t.test("an unrelated event-ID collision propagates instead of reusing the wrong event", async () => {
    const original = await repository.createPublishEvent(newEvent(8));
    const input = { ...newEvent(10), eventId: original.event.eventId };
    await assert.rejects(repository.createPublishEvent(input), (error: unknown) => hasSqlState(error, "23505"));
    assert.equal(await repository.getPublishEventByResultId(input.resultId), undefined);
    assert.deepEqual(await repository.getPublishEventByEventId(input.eventId), original.event);
    assert.equal((await repository.createPublishEvent(newEvent(10))).created, true);
  });

  await t.test("invalid UUID database failure rolls back without a partial event", async () => {
    const input = { ...newEvent(11), eventId: "invalid-uuid" };
    await assert.rejects(repository.createPublishEvent(input), (error: unknown) => hasSqlState(error, "22P02"));
    assert.equal(await repository.getPublishEventByResultId(input.resultId), undefined);
    assert.equal((await repository.createPublishEvent(newEvent(11))).created, true);
  });
});
