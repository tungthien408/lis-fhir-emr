import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import type { MiddlewareRouteDependencies } from "../../src/middleware/controller.js";
import type { ExchangeEvent, ListExchangesOptions } from "../../src/middleware/repository.js";
import { acceptedId, assertError, isRecord, requestJson, startHttpServer } from "./http-test-helpers.js";
import { syntheticTransaction, validEnvelope } from "./service-fixtures.js";

delete process.env.MIDDLEWARE_DATABASE_URL;
const { registerMiddlewareRoutes } = await import("../../src/middleware/controller.js");
const { acceptExchange } = await import("../../src/middleware/service.js");

test("Middleware Controller HTTP (isolated dependencies)", async (t) => {
  const envelope = validEnvelope(); const row = syntheticTransaction(envelope);
  row.leaseToken = "00000000-0000-4000-8000-000000000099";
  const event: ExchangeEvent = {
    logEventId: "00000000-0000-4000-8000-000000000002", exchangeId: row.exchangeId,
    eventType: "RECEIVED", oldStatus: null, newStatus: "RECEIVED", occurredAt: row.receivedAt,
    attemptId: null, detail: { diagnostic: "SELECT password=secret; private-stack-marker" },
  };
  const acknowledgement = {
    accepted: true as const, event_id: envelope.event_id, exchange_id: row.exchangeId,
    source_system: envelope.source_system, source_result_id: envelope.source_result_id, source_hash: envelope.source_hash,
  };
  const dependencies: MiddlewareRouteDependencies = {
    acceptExchange: async () => ({ kind: "accepted", created: true, ...acknowledgement }),
    listExchanges: async () => [row],
    getExchangeById: async (id) => id.toLowerCase() === row.exchangeId ? row : undefined,
    getExchangeEvents: async () => [event],
    getExchangeAttempts: async () => [],
    checkDatabase: async () => ({ status: "ready", database: "dacn_db", role: "integration_app", schema: "integration" }),
  };
  const app = express(); app.use(express.json({ limit: "1mb" }));
  registerMiddlewareRoutes(app, dependencies);
  const server = await startHttpServer(app); t.after(server.close);
  const request = (path: string, options?: RequestInit) => requestJson(server.baseUrl, path, options);
  const post = (body: unknown) => request("/api/exchanges", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const summary = {
    exchange_id: row.exchangeId, event_id: row.eventId, source_system: row.sourceSystem,
    source_result_id: row.sourceResultId, source_hash: row.sourceHash, status: row.status, retry_phase: null,
    send_attempt_count: 0, verify_attempt_count: 0,
    published_at: row.publishedAt!.toISOString(), received_at: row.receivedAt.toISOString(),
    next_retry_at: null, completed_at: null,
  };

  await t.test("health and ready preserve their original response formats", async (t) => {
    assert.deepEqual(await request("/health"), { status: 200, body: { service: "middleware", status: "ok" } });
    assert.deepEqual(await request("/ready"), { status: 200, body: {
      service: "middleware", status: "ready", database: "dacn_db", role: "integration_app", schema: "integration",
    } });
    t.mock.method(dependencies, "checkDatabase", async () => ({ status: "not_configured", schema: "integration" }));
    assert.deepEqual(await request("/ready"), { status: 503, body: {
      service: "middleware", status: "not_configured", schema: "integration",
    } });
    assert.equal((await request("/health")).status, 200);
  });

  await t.test("POST forwards the JSON body to B2 and returns exactly the six acknowledgement fields", async (t) => {
    let received: unknown;
    t.mock.method(dependencies, "acceptExchange", async (input: unknown) => {
      received = input; return { kind: "accepted", created: true, ...acknowledgement };
    });
    assert.deepEqual(await post(envelope), { status: 202, body: acknowledgement });
    assert.deepEqual(received, envelope);
  });

  await t.test("an identical retry also returns 202 and the existing exchange ID", async (t) => {
    t.mock.method(dependencies, "acceptExchange", async () => ({ kind: "accepted", created: false, ...acknowledgement }));
    assert.equal(acceptedId(await post(envelope)), row.exchangeId);
  });

  await t.test("B2 validation, conflict and unavailable outcomes map to their HTTP error envelopes", async (t) => {
    for (const [kind, status, code] of [
      ["malformed", 400, "VALIDATION_ERROR"], ["invalid", 422, "RESULT_NOT_READY"],
      ["conflict", 409, "DUPLICATE_CONFLICT"], ["unavailable", 503, "DEPENDENCY_UNAVAILABLE"],
    ] as const) {
      const failure = t.mock.method(dependencies, "acceptExchange", async () => ({
        kind, error: { code, field: "source_snapshot", message: "Synthetic failure" },
      }));
      assertError(await post(envelope), status, code); failure.mock.restore();
    }
  });

  await t.test("real B2 rejects missing fields, malformed UUID and tampered source hash over HTTP", async (t) => {
    t.mock.method(dependencies, "acceptExchange", acceptExchange);
    for (const input of [{}, [], { ...envelope, event_id: "invalid" }]) assertError(await post(input), 400, "VALIDATION_ERROR");
    const tampered = structuredClone(envelope); tampered.source_snapshot.value_num = 9;
    assertError(await post(tampered), 422, "VALIDATION_ERROR");
    assertError(await request("/api/exchanges", { method: "POST", headers: { "Content-Type": "application/json" } }), 400, "VALIDATION_ERROR");
  });

  await t.test("GET list returns a compact snake_case page with defaults and no payloads or lease tokens", async () => {
    assert.deepEqual(await request("/api/exchanges"), { status: 200, body: { items: [summary], limit: 20, offset: 0 } });
  });

  await t.test("valid filters and pagination reach B1 without coercing source identifiers", async (t) => {
    let received: ListExchangesOptions | undefined;
    t.mock.method(dependencies, "listExchanges", async (options?: ListExchangesOptions) => { received = options; return []; });
    assert.deepEqual(await request("/api/exchanges?status=FAILED&source_result_id=R1&limit=100&offset=2"), {
      status: 200, body: { items: [], limit: 100, offset: 2 },
    });
    assert.deepEqual(received, { status: "FAILED", sourceResultId: "R1", limit: 100, offset: 2 });
    for (const status of ["RECEIVED", "PROCESSING", "VERIFYING", "RETRY_WAIT", "DELIVERED", "REJECTED", "FAILED"]) {
      assert.equal((await request(`/api/exchanges?status=${status}`)).status, 200);
    }
    assert.equal((await request("/api/exchanges?offset=9007199254740991")).status, 200);
  });

  await t.test("unsupported, repeated, structured, empty and malformed queries fail before B1", async (t) => {
    let calls = 0;
    t.mock.method(dependencies, "listExchanges", async () => { calls++; return []; });
    for (const query of [
      "other=1", "limit=0", "limit=101", "limit=-1", "limit=1.5", "limit=1e2", "limit=%201",
      "limit=", "limit=2&limit=3", "limit[]=1", "limit[x]=1", "offset=-1", "offset=1.5",
      "offset=%2B1", "offset=9007199254740992", "offset=1&offset=2", "offset=", "offset=NaN",
      "status=", "status=received", "status=SENT", "status=RECEIVED&status=FAILED", "status[]=FAILED",
      "source_result_id=", "source_result_id=%20", "source_result_id=A&source_result_id=B",
      "source_result_id[]=A", "source_result_id=%00", "source_result_id=%7f",
    ]) assertError(await request(`/api/exchanges?${query}`), 400, "VALIDATION_ERROR");
    assert.equal(calls, 0);
    assertError(await request(`/api/exchanges/${row.exchangeId}?extra=1`), 400, "VALIDATION_ERROR");
    assertError(await request("/api/exchanges?extra=1", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(envelope),
    }), 400, "VALIDATION_ERROR");
  });

  await t.test("detail returns persisted payloads, counters, timestamps and safe event metadata only", async () => {
    const response = await request(`/api/exchanges/${row.exchangeId.toUpperCase()}`);
    assert.deepEqual(response, { status: 200, body: {
      ...summary, source_payload: envelope, fhir_payload: null, payload_hash: null, mapping_version: null,
      validated_at: null, mapping_started_at: null, transformed_at: null, first_sent_at: null,
      target_stored_at: null, verified_at: null,
      events: [{ log_event_id: event.logEventId, exchange_id: row.exchangeId, event_type: "RECEIVED",
        old_status: null, new_status: "RECEIVED", occurred_at: row.receivedAt.toISOString(), attempt_id: null }],
    } });
    assert.doesNotMatch(JSON.stringify(response.body), /SELECT|password|secret|private-stack-marker|lease_token/);
  });

  await t.test("available FHIR JSON is returned as stored without creating or changing it", async (t) => {
    const payload = { synthetic: true };
    t.mock.method(dependencies, "getExchangeById", async () => ({ ...row, fhirPayload: payload }));
    const response = await request(`/api/exchanges/${row.exchangeId}`); assert.ok(isRecord(response.body));
    assert.deepEqual(response.body.fhir_payload, payload);
  });

  await t.test("unknown UUID is 404; malformed IDs and encoding are 400 without querying history", async (t) => {
    let calls = 0;
    t.mock.method(dependencies, "getExchangeEvents", async () => { calls++; return []; });
    assertError(await request("/api/exchanges/00000000-0000-4000-8000-000000000099"), 404, "NOT_FOUND");
    for (const id of ["invalid", "123", "00000000000040008000000000000001", "%20", "%00", "%E0%A4%A"]) {
      assertError(await request(`/api/exchanges/${id}`), 400, "VALIDATION_ERROR");
    }
    assert.equal(calls, 0);
  });

  await t.test("invalid JSON, excessive body size, media type, charset and encoding return safe errors", async () => {
    assertError(await request("/api/exchanges", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"secret":' }), 400, "VALIDATION_ERROR");
    assertError(await request("/api/exchanges", { method: "POST", headers: {
      "Content-Type": "application/json", "Content-Encoding": "gzip",
    }, body: "not-a-gzip-stream" }), 400, "VALIDATION_ERROR");
    assertError(await post({ data: "x".repeat(1024 * 1024) }), 413, "VALIDATION_ERROR");
    const unsupportedHeaders: Record<string, string>[] = [
      { "Content-Type": "text/plain" }, { "Content-Type": "application/fhir+json" },
      { "Content-Type": "application/json; charset=iso-8859-1" },
      { "Content-Type": "application/json", "Content-Encoding": "unsupported" },
    ];
    for (const headers of unsupportedHeaders) {
      assertError(await request("/api/exchanges", { method: "POST", headers, body: "{}" }), 415, "VALIDATION_ERROR");
    }
    assertError(await request("/api/exchanges", { method: "POST" }), 415, "VALIDATION_ERROR");
  });

  await t.test("dependency failures on every business read/write are sanitized 503 responses", async (t) => {
    for (const [method, path, verb] of [
      ["acceptExchange", "/api/exchanges", "POST"], ["listExchanges", "/api/exchanges", "GET"],
      ["getExchangeById", `/api/exchanges/${row.exchangeId}`, "GET"],
      ["getExchangeEvents", `/api/exchanges/${row.exchangeId}`, "GET"],
    ] as const) {
      const failure = t.mock.method(dependencies, method, async () => {
        throw new Error("SELECT private; postgresql://admin:secret@db/dacn_db; private-stack-marker");
      });
      const response = await request(path, { method: verb, headers: { "Content-Type": "application/json" },
        ...(verb === "POST" ? { body: JSON.stringify(envelope) } : {}) });
      assertError(response, 503, "DEPENDENCY_UNAVAILABLE");
      assert.doesNotMatch(JSON.stringify(response.body), /SELECT|postgresql|secret|private-stack-marker/);
      failure.mock.restore();
    }
  });

  await t.test("Monitor attempts: stable read-only DTO, receipt allowlist and pre-HTTP diagnostics", async (t) => {
    const at = new Date("2026-11-04T10:00:00Z");
    const original = { ...row, fhirPayload: { identifier: [{ system: "https://example.org/lis/result", value: row.sourceResultId }] } };
    t.mock.method(dependencies, "getExchangeById", async () => original);
    const attempt = { attemptId: "00000000-0000-4000-8000-000000000010", exchangeId: row.exchangeId,
      phase: "SEND", attemptNo: 2, startedAt: at, sentAt: at, responseAt: at, endedAt: at, httpStatus: 201,
      errorCode: null, errorMessage: "SELECT secret", responseBody: { result: "STORED", external_system: "https://example.org/lis/result",
        external_id: row.sourceResultId, target_id: "00000000-0000-4000-8000-000000000011", patient_key: "00000000-0000-4000-8000-000000000012", secret: "private-stack-marker" } };
    t.mock.method(dependencies, "getExchangeAttempts", async () => [attempt]);
    t.mock.method(dependencies, "getExchangeEvents", async () => [{ ...event, detail: { code: "INVALID_SOURCE", sql: "SELECT secret" } }]);
    const response = await request(`/api/exchanges/${row.exchangeId}/attempts`);
    assert.equal(response.status, 200); assert.ok(isRecord(response.body));
    assert.ok(Array.isArray(response.body.items)); assert.equal(response.body.items.length, 1);
    const item = response.body.items[0]; assert.ok(isRecord(item));
    assert.equal(item.attempt_no, 2); assert.equal(item.phase, "SEND"); assert.equal(item.error_message, null);
    assert.ok(isRecord(item.receipt)); assert.equal(item.receipt.target_id, attempt.responseBody.target_id);
    assert.deepEqual(Object.keys(item.receipt).sort(), ["external_id", "external_system", "patient_key", "result", "target_id"]);
    assert.ok(Array.isArray(response.body.diagnostics)); assert.equal(response.body.diagnostics[0].error_code, "INVALID_SOURCE");
    assert.doesNotMatch(JSON.stringify(response.body), /SELECT|secret|private-stack-marker|response_body|lease_token/);
    assert.deepEqual(await request(`/api/exchanges/${row.exchangeId}/attempts`), response);
    assert.equal(original.status, row.status);
  });

  await t.test("Monitor attempts: malformed/missing/query/database failures stay errors", async (t) => {
    assertError(await request("/api/exchanges/not-uuid/attempts"), 400, "VALIDATION_ERROR");
    assertError(await request(`/api/exchanges/${row.exchangeId}/attempts?phase=SEND`), 400, "VALIDATION_ERROR");
    assertError(await request("/api/exchanges/00000000-0000-4000-8000-000000000099/attempts"), 404, "NOT_FOUND");
    for (const name of ["getExchangeAttempts", "getExchangeEvents"] as const) {
      const failure = t.mock.method(dependencies, name, async () => { throw new Error("SELECT secret; token=private-stack-marker"); });
      const response = await request(`/api/exchanges/${row.exchangeId}/attempts`);
      assertError(response, 503, "DEPENDENCY_UNAVAILABLE"); assert.doesNotMatch(JSON.stringify(response.body), /SELECT|secret|token/); failure.mock.restore();
    }
  });

  await t.test("Monitor attempts: existing exchange without attempts has an empty list", async () => {
    const response = await request(`/api/exchanges/${row.exchangeId}/attempts`);
    assert.equal(response.status, 200); assert.ok(isRecord(response.body)); assert.deepEqual(response.body.items, []);
  });

  await t.test("unknown API routes use the JSON error envelope", async () => {
    assertError(await request("/api/unknown"), 404, "NOT_FOUND");
  });
});
