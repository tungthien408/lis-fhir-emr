/**
 * A3: HTTP → Controller → Service → Repository → PostgreSQL thật.
 * Tự tạo dữ liệu giả trong database test trống; không dùng database dự án.
 * Kiểm tra cả lưu thật, Publish lặp/đồng thời, lỗi lưu và kết nối đã đóng.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { mock, test } from "node:test";
import express from "express";
import { count, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { hashCanonicalJson } from "../../src/lis/canonical-json.js";
import { patients, publishEvents, results, testCatalog } from "../../src/lis/schema.js";
import { isRecord, requestJson, startHttpServer, type JsonResponse } from "./http-test-helpers.js";

const testUrl = process.env.LIS_REPOSITORY_TEST_DATABASE_URL?.trim();
delete process.env.LIS_DATABASE_URL;
if (testUrl) process.env.LIS_DATABASE_URL = testUrl;

function listedIds(response: JsonResponse): string[] {
  assert.equal(response.status, 200);
  assert.ok(isRecord(response.body) && Array.isArray(response.body.items));
  return response.body.items.map((item: unknown) => {
    assert.ok(isRecord(item) && typeof item.result_id === "string");
    return item.result_id;
  });
}

function publishedId(response: JsonResponse, status: number): string {
  assert.equal(response.status, status);
  assert.ok(isRecord(response.body) && typeof response.body.event_id === "string");
  assert.deepEqual(Object.keys(response.body).sort(), ["dispatch_status", "event_id", "exchange_id", "result_id"]);
  return response.body.event_id;
}

function assertError(response: JsonResponse, status: number, code: string): void {
  assert.equal(response.status, status);
  assert.ok(isRecord(response.body) && isRecord(response.body.error));
  assert.equal(response.body.error.code, code);
  assert.equal(typeof response.body.error.message, "string");
  assert.deepEqual(Object.keys(response.body.error).sort(), ["code", "message"]);
}

test("LIS Controller integration (HTTP + PostgreSQL)", {
  skip: testUrl ? false : "Set LIS_REPOSITORY_TEST_DATABASE_URL to an empty, disposable PostgreSQL database",
}, async (t) => {
  const { registerLisRoutes } = await import("../../src/lis/controller.js");
  const repository = await import("../../src/lis/repository.js");
  const { lisDatabase } = await import("../../src/lis/db.js");
  const pool = new Pool({ connectionString: testUrl, max: 4, connectionTimeoutMillis: 3000 });
  const fixtureDb = drizzle({ client: pool });
  const prefix = `A3TEST-${crypto.randomUUID()}`;
  const patientIds = [`${prefix}-P1`, `${prefix}-P2`];
  const testCodes = [`${prefix}-T1`, `${prefix}-T2`];
  const seedResults = Array.from({ length: 26 }, (_, index) => ({
    resultId: `${prefix}-R${String(index + 1).padStart(2, "0")}`,
    patientId: patientIds[index % 2], testCode: testCodes[Math.floor(index / 2) % 2],
    valueNum: index === 3 ? "12345678901234567890.123456789" : "3.4000",
    unit: index === 2 ? "invalid-unit" : Math.floor(index / 2) % 2 === 0 ? "mg/dL" : "mmol/L",
    referenceLow: "1.2000", referenceHigh: null,
    effectiveAt: sql`${"2026-10-22T15:00:00.123456+07:00"}::timestamptz`,
    resultStatus: index % 3 === 1 ? "READY" : "FINAL", provenance: { synthetic: true },
  }));
  const resultIds = seedResults.map((row) => row.resultId);
  let seeded = false;
  let lisClosed = false;
  let server: Awaited<ReturnType<typeof startHttpServer>> | undefined;

  t.after(async () => {
    try {
      await server?.close();
      if (seeded) {
        await fixtureDb.transaction(async (tx) => {
          await tx.delete(publishEvents).where(inArray(publishEvents.resultId, resultIds));
          await tx.delete(results).where(inArray(results.resultId, resultIds));
          await tx.delete(testCatalog).where(inArray(testCatalog.testCode, testCodes));
          await tx.delete(patients).where(inArray(patients.patientId, patientIds));
        });
      }
    } finally {
      await Promise.all([pool.end(), lisClosed ? Promise.resolve() : lisDatabase.close()]);
    }
  });

  const identity = await pool.query<{ role: string }>("SELECT current_user AS role");
  assert.equal(identity.rows[0]?.role, "lis_app");
  for (const table of [patients, testCatalog, results, publishEvents]) {
    const [row] = await fixtureDb.select({ total: count() }).from(table);
    assert.equal(row?.total, 0, "Use an empty, disposable LIS database for this suite");
  }
  await fixtureDb.transaction(async (tx) => {
    await tx.insert(patients).values(patientIds.map((patientId) => ({
      patientId, sourceSubjectId: patientId, displayLabel: "Synthetic patient",
    })));
    await tx.insert(testCatalog).values(testCodes.map((testCode, index) => ({
      testCode, testName: `Synthetic test ${index + 1}`, fluid: index === 0 ? "Blood" : null,
      category: index === 0 ? "Chemistry" : null,
      acceptedUnits: index === 0 ? ["mg/dL"] : ["mmol/L"], catalogVersion: "a3-test",
    })));
    await tx.insert(results).values(seedResults);
  });
  seeded = true;

  const app = express();
  app.use(express.json({ limit: "1mb" }));
  registerLisRoutes(app);
  server = await startHttpServer(app);
  const baseUrl = server.baseUrl;
  const request = (path: string, options?: RequestInit) => requestJson(baseUrl, path, options);
  const publish = (resultId: string) => request(`/api/results/${encodeURIComponent(resultId)}/publish`, { method: "POST" });
  let firstEventId = "";

  await t.test("health and ready remain healthy with the real LIS service role", async () => {
    assert.deepEqual(await request("/health"), { status: 200, body: { service: "lis", status: "ok" } });
    assert.deepEqual(await request("/ready"), {
      status: 200, body: { service: "lis", status: "ready", schema: "lis", database: "dacn_db", role: "lis_app" },
    });
  });

  await t.test("list defaults and pagination read real results in a stable order", async () => {
    const defaults = await request("/api/results");
    assert.deepEqual(listedIds(defaults), resultIds.slice(0, 20));
    assert.ok(isRecord(defaults.body));
    assert.equal(defaults.body.limit, 20);
    assert.equal(defaults.body.offset, 0);
    const first = listedIds(await request("/api/results?limit=10"));
    const second = listedIds(await request("/api/results?limit=10&offset=10"));
    const last = listedIds(await request("/api/results?limit=10&offset=20"));
    assert.deepEqual([...first, ...second, ...last], resultIds);
    assert.deepEqual(await request("/api/results?offset=26"), { status: 200, body: { items: [], limit: 20, offset: 26 } });
  });

  await t.test("each list filter and combined filters affect the PostgreSQL query", async () => {
    for (const [key, value, expected] of [
      ["patient_id", patientIds[0], seedResults.filter((row) => row.patientId === patientIds[0])],
      ["test_code", testCodes[1], seedResults.filter((row) => row.testCode === testCodes[1])],
      ["result_status", "READY", seedResults.filter((row) => row.resultStatus === "READY")],
    ] as const) {
      assert.deepEqual(listedIds(await request(`/api/results?${key}=${encodeURIComponent(value)}&limit=100`)),
        expected.map((row) => row.resultId));
    }
    const expected = seedResults.filter((row) => row.patientId === patientIds[0]
      && row.testCode === testCodes[0] && row.resultStatus === "FINAL");
    const params = new URLSearchParams({
      patient_id: patientIds[0], test_code: testCodes[0], result_status: "FINAL", limit: "1", offset: "1",
    });
    assert.deepEqual(listedIds(await request(`/api/results?${params}`)), expected.slice(1, 2).map((row) => row.resultId));
    assert.deepEqual(listedIds(await request(`/api/results?patient_id=${prefix}-missing`)), []);
  });

  await t.test("detail preserves NUMERIC precision and timestamp microseconds and handles missing results", async () => {
    const precise = await request(`/api/results/${resultIds[3]}`);
    assert.equal(precise.status, 200);
    assert.ok(isRecord(precise.body));
    assert.equal(precise.body.value_num, "12345678901234567890.123456789");
    assert.equal(precise.body.reference_low, "1.2000");
    assert.equal(precise.body.reference_high, null);
    assert.equal(precise.body.effective_at, "2026-10-22T08:00:00.123456Z");
    assert.equal(precise.body.test_name, "Synthetic test 2");
    assert.equal(precise.body.fluid, null);
    assertError(await request(`/api/results/${prefix}-missing`), 404, "NOT_FOUND");
  });

  await t.test("first Publish without a body returns 202 only after the complete event is persisted", async () => {
    const response = await publish(resultIds[0]);
    firstEventId = publishedId(response, 202);
    assert.deepEqual(response.body, {
      event_id: firstEventId, result_id: resultIds[0], dispatch_status: "PENDING", exchange_id: null,
    });
    const saved = await repository.getPublishEventByEventId(firstEventId);
    assert.ok(saved);
    const expectedSnapshot = {
      result_id: resultIds[0], patient_id: patientIds[0], test_code: testCodes[0],
      test_name: "Synthetic test 1", fluid: "Blood", category: "Chemistry", value_num: 3.4,
      unit: "mg/dL", reference_low: 1.2, reference_high: null,
      effective_at: "2026-10-22T08:00:00.123456Z", result_status: "FINAL",
    };
    assert.deepEqual(saved.sourceSnapshot, expectedSnapshot);
    assert.equal(saved.sourceHash, hashCanonicalJson(expectedSnapshot));
    assert.equal(saved.dispatchStatus, "PENDING");
    assert.equal(saved.dispatchAttemptCount, 0);
  });

  await t.test("changed source returns CONTENT_CONFLICT and keeps every original event field", async () => {
    await fixtureDb.update(results).set({ resultStatus: "READY", valueNum: "99", unit: "changed" })
      .where(eq(results.resultId, resultIds[0]));
    await fixtureDb.update(publishEvents).set({
      dispatchStatus: "RETRY_WAIT", dispatchAttemptCount: 1, lastErrorCode: "DEPENDENCY_UNAVAILABLE",
      lastErrorMessage: "upstream diagnostic password=do-not-expose",
    }).where(eq(publishEvents.eventId, firstEventId));
    const original = await repository.getPublishEventByEventId(firstEventId);
    const response = await publish(resultIds[0]);
    assertError(response, 409, "CONTENT_CONFLICT");
    assert.deepEqual(await repository.getPublishEventByEventId(firstEventId), original);
  });

  await t.test("read-only lookup finds the old event even after source changes; unpublished/missing stay distinct", async () => {
    const original = await repository.getPublishEventByEventId(firstEventId);
    for (let i = 0; i < 3; i++) {
      const state = await request(`/api/results/${resultIds[0]}/publish-event`);
      assert.equal(state.status, 200); assert.ok(isRecord(state.body));
      assert.equal(state.body.result_status, "READY"); assert.equal(state.body.published, true);
      assert.ok(isRecord(state.body.event)); assert.equal(state.body.event.event_id, firstEventId);
    }
    assert.deepEqual(await repository.getPublishEventByEventId(firstEventId), original);
    assert.deepEqual(await request(`/api/results/${resultIds[1]}/publish-event`), { status: 200,
      body: { result_id: resultIds[1], result_status: "READY", published: false, event: null } });
    assertError(await request(`/api/results/${prefix}-missing/publish-event`), 404, "NOT_FOUND");
    assert.equal(await repository.getPublishEventByResultId(resultIds[1]), undefined);
  });

  await t.test("event lookup reports persisted attempts/status, safe errors, unknown and malformed UUIDs", async () => {
    assert.deepEqual(await request(`/api/publish-events/${firstEventId.toUpperCase()}`), {
      status: 200, body: {
        event_id: firstEventId, result_id: resultIds[0], dispatch_status: "RETRY_WAIT", exchange_id: null,
        dispatch_attempt_count: 1, last_error_code: "DEPENDENCY_UNAVAILABLE",
        last_error_message: "The latest dispatch attempt failed.",
      },
    });
    assertError(await request(`/api/publish-events/${crypto.randomUUID()}`), 404, "NOT_FOUND");
    assertError(await request("/api/publish-events/malformed"), 400, "VALIDATION_ERROR");
  });

  await t.test("missing and ineligible Publishes return 404/422 and store no events", async () => {
    assertError(await publish(`${prefix}-missing`), 404, "NOT_FOUND");
    for (const [index, code] of [[1, "RESULT_NOT_READY"], [2, "INVALID_UNIT"], [3, "VALIDATION_ERROR"]] as const) {
      assertError(await publish(resultIds[index]), 422, code);
      assert.equal(await repository.getPublishEventByResultId(resultIds[index]), undefined);
    }
  });

  await t.test("invalid HTTP query parameters return 400 with the JSON envelope", async () => {
    for (const query of ["limit=0", "limit=101", "offset=-1", "result_status=INVALID", "limit=2&limit=3"]) {
      assertError(await request(`/api/results?${query}`), 400, "VALIDATION_ERROR");
    }
  });

  await t.test("eight concurrent HTTP Publishes return one 202, seven 200s and one stored event", async () => {
    const responses = await Promise.all(Array.from({ length: 8 }, () => publish(resultIds[5])));
    assert.equal(responses.filter((response) => response.status === 202).length, 1);
    assert.equal(responses.filter((response) => response.status === 200).length, 7);
    const id = publishedId(responses[0], responses[0].status);
    for (const response of responses) assert.deepEqual(response.body, responses[0].body);
    const saved = await fixtureDb.select().from(publishEvents).where(eq(publishEvents.resultId, resultIds[5]));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].eventId, id);
    assert.equal(saved[0].dispatchStatus, "PENDING");
  });

  await t.test("a real persistence error returns sanitized 503 and does not report success or overwrite another event", async () => {
    const original = await repository.getPublishEventByEventId(firstEventId);
    const uuid = mock.method(crypto, "randomUUID", () => firstEventId);
    syncBuiltinESMExports();
    try {
      const response = await publish(resultIds[6]);
      assertError(response, 503, "DEPENDENCY_UNAVAILABLE");
      assert.doesNotMatch(JSON.stringify(response.body), /insert|publish_events|postgresql|password|stack/i);
    } finally {
      uuid.mock.restore();
      syncBuiltinESMExports();
    }
    assert.equal(await repository.getPublishEventByResultId(resultIds[6]), undefined);
    assert.deepEqual(await repository.getPublishEventByEventId(firstEventId), original);
    await fixtureDb.update(results).set({ valueNum: "7.25" }).where(eq(results.resultId, resultIds[6]));
    publishedId(await publish(resultIds[6]), 202);
  });

  await t.test("closed database connections produce 503 on business routes and ready while health remains 200", async () => {
    await lisDatabase.close();
    lisClosed = true;
    for (const [path, method] of [
      ["/api/results", "GET"], [`/api/results/${resultIds[0]}`, "GET"],
      [`/api/publish-events/${firstEventId}`, "GET"], [`/api/results/${resultIds[0]}/publish-event`, "GET"], [`/api/results/${resultIds[7]}/publish`, "POST"],
    ]) {
      assertError(await request(path, { method }), 503, "DEPENDENCY_UNAVAILABLE");
    }
    const ready = await request("/ready");
    assert.equal(ready.status, 503);
    assert.ok(isRecord(ready.body));
    assert.equal(ready.body.status, "unavailable");
    assert.deepEqual(await request("/health"), { status: 200, body: { service: "lis", status: "ok" } });
  });
});
