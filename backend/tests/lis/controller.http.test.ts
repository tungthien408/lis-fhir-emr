/**
 * A3: kiểm tra HTTP thật với Service/Repository giả lập để chủ động thử từng
 * phản hồi, tham số sai và lỗi database. Không cần PostgreSQL hoặc dữ liệu thật.
 * controller.integration.test.ts kiểm tra thêm toàn bộ đường đi đến PostgreSQL.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import type { LisRouteDependencies } from "../../src/lis/controller.js";
import type { ListResultsOptions, PublishEvent, ResultWithDetails } from "../../src/lis/repository.js";
import { isRecord, requestJson, startHttpServer, type JsonResponse } from "./http-test-helpers.js";

delete process.env.LIS_DATABASE_URL;
const { registerLisRoutes } = await import("../../src/lis/controller.js");

const eventId = "00000000-0000-4000-8000-000000000001";
const event: PublishEvent = {
  eventId, resultId: "SYNTHETIC-R1", sourceSystem: "lis-demo",
  sourceSnapshot: { result_id: "SYNTHETIC-R1" }, sourceHash: "a".repeat(64),
  publishedAt: new Date("2026-10-22T09:00:00Z"), exchangeId: null,
  dispatchStatus: "PENDING", dispatchAttemptCount: 0, nextRetryAt: null,
  leaseUntil: null, ackedAt: null, leaseToken: null, lastErrorCode: null,
  lastErrorMessage: null, ackResponse: null,
};
const row: ResultWithDetails = {
  result: {
    resultId: "SYNTHETIC-R1", patientId: "SYNTHETIC-P1", testCode: "SYNTHETIC-T1",
    valueNum: "12345678901234567890.123456789", unit: "mg/dL", referenceLow: "1.2000", referenceHigh: null,
    effectiveAt: new Date("2026-10-22T08:00:00.123Z"), resultStatus: "FINAL", provenance: {},
  },
  patient: { patientId: "SYNTHETIC-P1", sourceSubjectId: "synthetic", displayLabel: "Synthetic patient" },
  test: {
    testCode: "SYNTHETIC-T1", testName: "Synthetic test", fluid: null, category: "Chemistry",
    acceptedUnits: ["mg/dL"], catalogVersion: "a3-test",
  },
  effectiveAtIso: "2026-10-22T08:00:00.123456Z",
};
const resultBody = {
  result_id: "SYNTHETIC-R1", patient_id: "SYNTHETIC-P1", test_code: "SYNTHETIC-T1",
  test_name: "Synthetic test", fluid: null, category: "Chemistry",
  value_num: "12345678901234567890.123456789", unit: "mg/dL", reference_low: "1.2000", reference_high: null,
  effective_at: "2026-10-22T08:00:00.123456Z", result_status: "FINAL",
};
const publishBody = { event_id: eventId, result_id: event.resultId, dispatch_status: "PENDING", exchange_id: null };

function assertError(response: JsonResponse, status: number, code: string): void {
  assert.equal(response.status, status);
  assert.ok(isRecord(response.body) && isRecord(response.body.error));
  assert.equal(response.body.error.code, code);
  assert.equal(typeof response.body.error.message, "string");
  assert.deepEqual(Object.keys(response.body.error).sort(), ["code", "message"]);
}

test("LIS Controller HTTP (isolated dependencies)", async (t) => {
  const dependencies: LisRouteDependencies = {
    getResultPublishState: async (id) => id === row.result.resultId ? { resultId: id, resultStatus: row.result.resultStatus, event } : undefined,
    getResultById: async (id) => id === row.result.resultId ? row : undefined,
    listResults: async () => [row],
    getPublishEventByEventId: async (id) => id.toLowerCase() === eventId ? event : undefined,
    publishResult: async () => ({ kind: "created", event }),
    checkDatabase: async () => ({ status: "ready", database: "dacn_db", role: "lis_app", schema: "lis" }),
  };
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  registerLisRoutes(app, dependencies);
  const server = await startHttpServer(app);
  t.after(server.close);
  const request = (path: string, options?: RequestInit) => requestJson(server.baseUrl, path, options);

  await t.test("health stays independent of the database", async (t) => {
    t.mock.method(dependencies, "checkDatabase", async () => { throw new Error("database unavailable"); });
    assert.deepEqual(await request("/health"), { status: 200, body: { service: "lis", status: "ok" } });
  });

  await t.test("ready preserves its healthy and unconfigured response formats", async (t) => {
    assert.deepEqual(await request("/ready"), {
      status: 200, body: { service: "lis", status: "ready", database: "dacn_db", role: "lis_app", schema: "lis" },
    });
    t.mock.method(dependencies, "checkDatabase", async () => ({ status: "not_configured", schema: "lis" }));
    assert.deepEqual(await request("/ready"), { status: 503, body: { service: "lis", status: "not_configured", schema: "lis" } });
  });

  await t.test("list uses items/limit/offset, snake_case and lossless numeric and timestamp text", async (t) => {
    let received: ListResultsOptions | undefined;
    t.mock.method(dependencies, "listResults", async (options?: ListResultsOptions) => {
      received = options;
      return [row];
    });
    assert.deepEqual(await request("/api/results"), { status: 200, body: { items: [resultBody], limit: 20, offset: 0 } });
    assert.deepEqual(received, { limit: 20, offset: 0 });
  });

  await t.test("list validates and passes all filters and pagination to Repository", async (t) => {
    let received: ListResultsOptions | undefined;
    t.mock.method(dependencies, "listResults", async (options?: ListResultsOptions) => {
      received = options;
      return [];
    });
    assert.deepEqual(await request("/api/results?patient_id=P1&test_code=T1&result_status=FINAL&limit=100&offset=2"), {
      status: 200, body: { items: [], limit: 100, offset: 2 },
    });
    assert.deepEqual(received, { patientId: "P1", testCode: "T1", resultStatus: "FINAL", limit: 100, offset: 2 });
  });

  await t.test("invalid pagination, repeated/structured filters and unsupported parameters return 400 before querying", async (t) => {
    const query = t.mock.method(dependencies, "listResults", async () => [row]);
    for (const params of [
      "limit=0", "limit=101", "limit=-1", "limit=1.5", "limit=1e2", "limit=0x10", "limit=", "limit=%20",
      "limit=1&limit=2", "limit[x]=1", "offset=-1", "offset=1.5", "offset=", "offset=9007199254740992",
      "offset=0&offset=1", "patient_id=", "patient_id=P1&patient_id=P2", "patient_id[x]=P1", "test_code=",
      "result_status=final", "result_status=UNKNOWN", "result_status=FINAL&result_status=READY", "unknown=1",
    ]) {
      assertError(await request(`/api/results?${params}`), 400, "VALIDATION_ERROR");
    }
    assert.equal(query.mock.callCount(), 0);
  });

  await t.test("result detail returns the serialized result or JSON 404", async () => {
    assert.deepEqual(await request("/api/results/SYNTHETIC-R1"), { status: 200, body: resultBody });
    assertError(await request("/api/results/missing"), 404, "NOT_FOUND");
  });

  await t.test("blank, control-character and malformed URL identifiers return JSON 400", async () => {
    for (const path of ["/api/results/%20", "/api/results/%00", "/api/results/%ZZ", "/api/results/%00/publish"]) {
      assertError(await request(path, path.endsWith("publish") ? { method: "POST" } : undefined), 400, "VALIDATION_ERROR");
    }
  });

  await t.test("first Publish returns only the four contract fields with 202 and PENDING", async () => {
    assert.deepEqual(await request("/api/results/SYNTHETIC-R1/publish", { method: "POST" }), { status: 202, body: publishBody });
  });

  await t.test("repeated Publish returns 200 with the original ID and persisted ACK status", async (t) => {
    const exchangeId = "00000000-0000-4000-8000-000000000002";
    t.mock.method(dependencies, "publishResult", async () => ({
      kind: "existing", event: { ...event, dispatchStatus: "ACK", exchangeId },
    }));
    assert.deepEqual(await request("/api/results/SYNTHETIC-R1/publish", { method: "POST" }), {
      status: 200, body: { ...publishBody, dispatch_status: "ACK", exchange_id: exchangeId },
    });
  });

  await t.test("Publish maps missing, READY and invalid unit outcomes to the correct errors", async (t) => {
    const publish = t.mock.method(dependencies, "publishResult", async () => ({ kind: "not_found", resultId: "missing" }));
    assertError(await request("/api/results/missing/publish", { method: "POST" }), 404, "NOT_FOUND");
    publish.mock.restore();
    for (const code of ["RESULT_NOT_READY", "INVALID_UNIT"] as const) {
      const invalid = t.mock.method(dependencies, "publishResult", async () => ({
        kind: "invalid", resultId: event.resultId, error: { code, field: "test", message: "Synthetic validation failure" },
      }));
      assertError(await request("/api/results/SYNTHETIC-R1/publish", { method: "POST" }), 422, code);
      invalid.mock.restore();
    }
  });

  await t.test("changed source is a 409 CONTENT_CONFLICT, never a duplicate success", async (t) => {
    t.mock.method(dependencies, "publishResult", async () => ({ kind: "conflict", resultId: event.resultId,
      error: { code: "CONTENT_CONFLICT", message: "Original snapshot preserved" } }));
    assertError(await request("/api/results/SYNTHETIC-R1/publish", { method: "POST" }), 409, "CONTENT_CONFLICT");
  });

  await t.test("lookup distinguishes published/unpublished/missing and rejects query without mutation", async (t) => {
    const post = t.mock.method(dependencies, "publishResult", async () => ({ kind: "created", event }));
    const published = await request("/api/results/SYNTHETIC-R1/publish-event");
    assert.equal(published.status, 200);
    assert.ok(isRecord(published.body));
    assert.equal(published.body.published, true);
    assert.ok(isRecord(published.body.event)); assert.equal(published.body.event.event_id, eventId);
    assert.equal(published.body.event.published_at, event.publishedAt.toISOString());
    t.mock.method(dependencies, "getResultPublishState", async (id: string) => id === row.result.resultId
      ? { resultId: id, resultStatus: "FINAL", event: null } : undefined);
    assert.deepEqual(await request("/api/results/SYNTHETIC-R1/publish-event"), { status: 200,
      body: { result_id: event.resultId, result_status: "FINAL", published: false, event: null } });
    assertError(await request("/api/results/missing/publish-event"), 404, "NOT_FOUND");
    assertError(await request("/api/results/%00/publish-event"), 400, "VALIDATION_ERROR");
    assertError(await request("/api/results/SYNTHETIC-R1/publish-event?retry=1"), 400, "VALIDATION_ERROR");
    assert.equal(post.mock.callCount(), 0);
  });

  await t.test("optional body cannot replace the result ID in the path", async (t) => {
    let received = "";
    t.mock.method(dependencies, "publishResult", async (id: string) => {
      received = id;
      return { kind: "created", event };
    });
    const response = await request("/api/results/SYNTHETIC-R1/publish", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ result_id: "other" }),
    });
    assert.equal(response.status, 202);
    assert.equal(received, "SYNTHETIC-R1");
  });

  await t.test("publish event returns persisted status, attempts and safe latest-error information", async (t) => {
    const lookup = t.mock.method(dependencies, "getPublishEventByEventId", async () => ({
      ...event, dispatchStatus: "RETRY_WAIT", dispatchAttemptCount: 2,
      lastErrorCode: "DEPENDENCY_UNAVAILABLE", lastErrorMessage: "SELECT secret FROM table; password=do-not-expose",
    }));
    assert.deepEqual(await request(`/api/publish-events/${eventId}`), {
      status: 200, body: {
        ...publishBody, dispatch_status: "RETRY_WAIT", dispatch_attempt_count: 2,
        last_error_code: "DEPENDENCY_UNAVAILABLE", last_error_message: "The latest dispatch attempt failed.",
      },
    });
    lookup.mock.restore();
    t.mock.method(dependencies, "getPublishEventByEventId", async () => ({
      ...event, lastErrorCode: "SELECT password=secret", lastErrorMessage: "private diagnostic",
    }));
    const sanitized = await request(`/api/publish-events/${eventId}`);
    assert.ok(isRecord(sanitized.body));
    assert.equal(sanitized.body.last_error_code, "DISPATCH_ERROR");
    assert.doesNotMatch(JSON.stringify(sanitized.body), /SELECT|password|secret|private diagnostic/);
  });

  await t.test("unknown UUID returns 404 while malformed UUID returns 400", async () => {
    assertError(await request("/api/publish-events/00000000-0000-4000-8000-000000000099"), 404, "NOT_FOUND");
    for (const id of ["not-a-uuid", "123", "00000000000040008000000000000001"]) {
      assertError(await request(`/api/publish-events/${id}`), 400, "VALIDATION_ERROR");
    }
  });

  await t.test("database failures on every business route return sanitized 503, never false success", async (t) => {
    for (const [method, path, verb] of [
      ["listResults", "/api/results", "GET"],
      ["getResultById", "/api/results/SYNTHETIC-R1", "GET"],
      ["getPublishEventByEventId", `/api/publish-events/${eventId}`, "GET"],
      ["publishResult", "/api/results/SYNTHETIC-R1/publish", "POST"],
      ["getResultPublishState", "/api/results/SYNTHETIC-R1/publish-event", "GET"],
    ] as const) {
      const failure = t.mock.method(dependencies, method, async () => {
        throw new Error("SELECT patient_data; postgresql://admin:secret@db/dacn_db; private-stack-marker");
      });
      const response = await request(path, { method: verb });
      assertError(response, 503, "DEPENDENCY_UNAVAILABLE");
      assert.doesNotMatch(JSON.stringify(response.body), /SELECT|postgresql|secret|private-stack-marker/);
      failure.mock.restore();
    }
  });

  await t.test("malformed, oversized or unsupported JSON bodies return safe JSON errors", async () => {
    const malformed = await request("/api/results/SYNTHETIC-R1/publish", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: '{"secret":',
    });
    assertError(malformed, 400, "VALIDATION_ERROR");
    assert.doesNotMatch(JSON.stringify(malformed.body), /secret|SyntaxError|stack/);
    const oversized = await request("/api/results/SYNTHETIC-R1/publish", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: "x".repeat(1024 * 1024) }),
    });
    assertError(oversized, 413, "VALIDATION_ERROR");
    const unsupportedHeaders: Record<string, string>[] = [
      { "Content-Type": "application/json; charset=iso-8859-1" },
      { "Content-Type": "application/json", "Content-Encoding": "unsupported" },
    ];
    for (const headers of unsupportedHeaders) {
      const unsupported = await request("/api/results/SYNTHETIC-R1/publish", { method: "POST", headers, body: "{}" });
      assertError(unsupported, 415, "VALIDATION_ERROR");
    }
  });

  await t.test("unknown API paths use the same JSON error envelope", async () => {
    assertError(await request("/api/unknown"), 404, "NOT_FOUND");
  });
});
