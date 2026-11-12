/** B3: real HTTP -> B2 -> B1 -> disposable PostgreSQL, synthetic data only. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { test } from "node:test";
import express from "express";
import { count, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { exchangeAttempts, exchangeEvents, exchangeTransactions } from "../../src/middleware/schema.js";
import { acceptedId, assertError, isRecord, listedIds, requestJson, startHttpServer } from "./http-test-helpers.js";
import { rehash, validEnvelope } from "./service-fixtures.js";

const testUrl = process.env.MIDDLEWARE_REPOSITORY_TEST_DATABASE_URL?.trim();
delete process.env.MIDDLEWARE_DATABASE_URL;
if (testUrl) process.env.MIDDLEWARE_DATABASE_URL = testUrl;

test("Middleware Controller integration (HTTP + PostgreSQL)", {
  skip: testUrl ? false : "Set MIDDLEWARE_REPOSITORY_TEST_DATABASE_URL to an empty disposable PostgreSQL database",
}, async (t) => {
  const { registerMiddlewareRoutes } = await import("../../src/middleware/controller.js");
  const repository = await import("../../src/middleware/repository.js");
  const { middlewareDatabase } = await import("../../src/middleware/db.js");
  const pool = new Pool({ connectionString: testUrl, max: 3, connectionTimeoutMillis: 3000 });
  const db = drizzle({ client: pool });
  const eventIds: string[] = [];
  let server: Awaited<ReturnType<typeof startHttpServer>> | undefined;
  let closed = false;
  t.after(async () => {
    try {
      await server?.close();
      if (eventIds.length) await db.transaction(async (tx) => {
        const rows = await tx.select({ id: exchangeTransactions.exchangeId }).from(exchangeTransactions)
          .where(inArray(exchangeTransactions.eventId, eventIds));
        const ids = rows.map((row) => row.id);
        if (ids.length) {
          await tx.delete(exchangeEvents).where(inArray(exchangeEvents.exchangeId, ids));
          await tx.delete(exchangeAttempts).where(inArray(exchangeAttempts.exchangeId, ids));
          await tx.delete(exchangeTransactions).where(inArray(exchangeTransactions.exchangeId, ids));
        }
      });
    } finally { await Promise.all([pool.end(), closed ? Promise.resolve() : middlewareDatabase.close()]); }
  });
  assert.equal((await pool.query<{ role: string }>("select current_user as role")).rows[0].role, "integration_app");
  for (const table of [exchangeTransactions, exchangeEvents, exchangeAttempts]) {
    const [row] = await db.select({ total: count() }).from(table);
    assert.equal(row.total, 0, "Refusing to use a populated database");
  }
  const app = express(); app.use(express.json({ limit: "1mb" })); registerMiddlewareRoutes(app);
  server = await startHttpServer(app);
  const baseUrl = server.baseUrl;
  const request = (path: string, options?: RequestInit) => requestJson(baseUrl, path, options);
  const post = async (input = validEnvelope()) => {
    eventIds.push(input.event_id);
    return request("/api/exchanges", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  };
  const prefix = `B3TEST-${crypto.randomUUID()}`;
  const inputs = Array.from({ length: 26 }, (_, index) => {
    const input = validEnvelope();
    input.source_system = `${prefix}-S${index}`;
    input.source_result_id = `${prefix}-R${index % 3}`;
    input.source_snapshot.result_id = input.source_result_id;
    return rehash(input);
  });
  const ids: string[] = [];

  await t.test("health and ready retain their formats with the real integration_app connection", async () => {
    assert.deepEqual(await request("/health"), { status: 200, body: { service: "middleware", status: "ok" } });
    assert.deepEqual(await request("/ready"), { status: 200, body: {
      service: "middleware", status: "ready", schema: "integration", database: "dacn_db", role: "integration_app",
    } });
  });

  await t.test("first HTTP POST returns the six-field 202 only after transaction and receipt are committed", async () => {
    const response = await post(inputs[0]); const id = acceptedId(response); ids.push(id);
    assert.deepEqual(response.body, {
      accepted: true, event_id: inputs[0].event_id, exchange_id: id, source_system: inputs[0].source_system,
      source_result_id: inputs[0].source_result_id, source_hash: inputs[0].source_hash,
    });
    // These reads use a different pool: uncommitted records would not be visible.
    const [stored] = await db.select().from(exchangeTransactions).where(eq(exchangeTransactions.exchangeId, id));
    assert.equal(stored.status, "RECEIVED"); assert.deepEqual(stored.sourcePayload, inputs[0]);
    assert.equal(stored.fhirPayload, null); assert.equal(stored.sendAttemptCount, 0);
    const events = await db.select().from(exchangeEvents).where(eq(exchangeEvents.exchangeId, id));
    assert.equal(events.length, 1); assert.equal(events[0].eventType, "RECEIVED");
  });

  await t.test("GET list filters with AND and paginates in received_at DESC / exchange_id ASC order", async () => {
    for (const input of inputs.slice(1)) ids.push(acceptedId(await post(input)));
    await db.update(exchangeTransactions).set({ receivedAt: new Date("2026-10-24T09:00:00Z") })
      .where(inArray(exchangeTransactions.exchangeId, ids));
    const failed = ids.filter((_, index) => index % 2 === 1);
    await db.update(exchangeTransactions).set({ status: "FAILED" }).where(inArray(exchangeTransactions.exchangeId, failed));
    await db.update(exchangeTransactions).set({ receivedAt: new Date("2026-10-25T09:00:00Z") })
      .where(eq(exchangeTransactions.exchangeId, ids[25]));
    const order = [ids[25], ...ids.slice(0, 25).sort()];
    const defaults = await request("/api/exchanges"); assert.deepEqual(listedIds(defaults), order.slice(0, 20));
    assert.ok(isRecord(defaults.body)); assert.equal(defaults.body.limit, 20); assert.equal(defaults.body.offset, 0);
    const pages = await Promise.all([0, 10, 20].map((offset) => request(`/api/exchanges?limit=10&offset=${offset}`)));
    assert.deepEqual(pages.flatMap(listedIds), order);
    const sourceId = inputs[0].source_result_id;
    const expectedSource = order.filter((id) => inputs[ids.indexOf(id)].source_result_id === sourceId);
    assert.deepEqual(listedIds(await request(`/api/exchanges?source_result_id=${sourceId}&limit=100`)), expectedSource);
    assert.deepEqual(listedIds(await request("/api/exchanges?status=FAILED&limit=100")), order.filter((id) => failed.includes(id)));
    assert.deepEqual(listedIds(await request(`/api/exchanges?status=FAILED&source_result_id=${sourceId}&limit=2&offset=1`)),
      expectedSource.filter((id) => failed.includes(id)).slice(1, 3));
    assert.deepEqual(await request("/api/exchanges?offset=26"), { status: 200, body: { items: [], limit: 20, offset: 26 } });
    assert.deepEqual(listedIds(await request("/api/exchanges?source_result_id=missing")), []);
  });

  await t.test("GET detail returns the stored envelope and stable chronological event metadata", async () => {
    const logIds = [crypto.randomUUID(), crypto.randomUUID()].sort();
    for (const logEventId of [...logIds].reverse()) {
      await repository.appendExchangeEvent({ exchangeId: ids[0], logEventId, eventType: "SYNTHETIC_TEST",
        occurredAt: new Date("2026-10-23T00:00:00Z"), detail: { raw_error: "SELECT password=secret" } });
    }
    const response = await request(`/api/exchanges/${ids[0].toUpperCase()}`);
    assert.equal(response.status, 200); assert.ok(isRecord(response.body));
    assert.equal(response.body.exchange_id, ids[0]); assert.equal(response.body.event_id, inputs[0].event_id);
    assert.deepEqual(response.body.source_payload, inputs[0]); assert.equal(response.body.fhir_payload, null);
    assert.equal(response.body.status, "RECEIVED"); assert.equal(response.body.send_attempt_count, 0);
    assert.equal(response.body.verify_attempt_count, 0); assert.equal(response.body.verified_at, null);
    assert.ok(Array.isArray(response.body.events));
    const events = await repository.getExchangeEvents(ids[0]);
    assert.deepEqual(response.body.events.map((event: unknown) => {
      assert.ok(isRecord(event)); assert.equal("detail" in event, false); return event.log_event_id;
    }), events.map((event) => event.logEventId));
    assert.deepEqual(events.filter((event) => event.eventType === "SYNTHETIC_TEST").map((event) => event.logEventId), logIds);
    assert.doesNotMatch(JSON.stringify(response.body), /SELECT|password|secret|lease_token/);
  });

  await t.test("identical HTTP retry returns 202 and preserves DELIVERED data, counters and history", async () => {
    const now = new Date("2026-10-25T09:00:00Z");
    await db.update(exchangeTransactions).set({ status: "DELIVERED", verifiedAt: now, completedAt: now,
      sendAttemptCount: 2, verifyAttemptCount: 1, fhirPayload: { synthetic: true } })
      .where(eq(exchangeTransactions.exchangeId, ids[0]));
    const before = await repository.getExchangeById(ids[0]);
    const events = await repository.getExchangeEvents(ids[0]);
    assert.equal(acceptedId(await post(inputs[0])), ids[0]);
    assert.deepEqual(await repository.getExchangeById(ids[0]), before);
    assert.deepEqual(await repository.getExchangeEvents(ids[0]), events);
    const detail = await request(`/api/exchanges/${ids[0]}`); assert.ok(isRecord(detail.body));
    assert.equal(detail.body.status, "DELIVERED"); assert.deepEqual(detail.body.fhir_payload, { synthetic: true });
  });

  await t.test("conflicting content or new event on the same source pair returns 409 without mutations", async () => {
    const changed = structuredClone(inputs[0]); changed.source_snapshot.value_num = 9; rehash(changed);
    const before = await repository.getExchangeById(ids[0]);
    for (const input of [changed, { ...inputs[0], event_id: crypto.randomUUID() }]) {
      assertError(await post(input), 409, "DUPLICATE_CONFLICT");
    }
    assert.deepEqual(await repository.getExchangeById(ids[0]), before);
  });

  await t.test("invalid source hash, incomplete body, invalid JSON and IDs return safe 4xx responses", async () => {
    const input = validEnvelope(); input.source_snapshot.value_num = 9;
    assertError(await post(input), 422, "VALIDATION_ERROR");
    assert.equal(await repository.getExchangeByEventId(input.event_id), undefined);
    assertError(await request("/api/exchanges", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), 400, "VALIDATION_ERROR");
    assertError(await request("/api/exchanges", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"secret":' }), 400, "VALIDATION_ERROR");
    assertError(await request("/api/exchanges/not-a-uuid"), 400, "VALIDATION_ERROR");
    assertError(await request(`/api/exchanges/${crypto.randomUUID()}`), 404, "NOT_FOUND");
    for (const query of ["status=SENT", "limit=101", "limit=1&limit=2", "offset=-1", "source_result_id=", "unknown=1"]) {
      assertError(await request(`/api/exchanges?${query}`), 400, "VALIDATION_ERROR");
    }
  });

  await t.test("eight concurrent HTTP requests return the same 202 and persist exactly one transaction/receipt", async () => {
    const input = validEnvelope(); const responses = await Promise.all(Array.from({ length: 8 }, () => post(input)));
    const id = acceptedId(responses[0]);
    for (const response of responses) { assert.equal(acceptedId(response), id); assert.deepEqual(response.body, responses[0].body); }
    const rows = await db.select().from(exchangeTransactions).where(eq(exchangeTransactions.eventId, input.event_id));
    assert.equal(rows.length, 1); assert.equal((await repository.getExchangeEvents(id)).length, 1);
  });

  await t.test("real PostgreSQL UUID collision produces 503 without claiming acceptance or changing the existing row", async (t) => {
    const before = await repository.getExchangeById(ids[0]);
    const input = validEnvelope();
    const uuid = t.mock.method(crypto, "randomUUID", () => ids[0]); syncBuiltinESMExports();
    try {
      const response = await post(input); assertError(response, 503, "DEPENDENCY_UNAVAILABLE");
      assert.doesNotMatch(JSON.stringify(response.body), /insert|exchange_transactions|postgresql|password|stack/i);
    } finally { uuid.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(await repository.getExchangeByEventId(input.event_id), undefined);
    assert.deepEqual(await repository.getExchangeById(ids[0]), before);
    acceptedId(await post(input));
  });

  await t.test("Monitor attempts: PostgreSQL order, safe receipt/errors, nulls and repeated GET leave rows unchanged", async () => {
    const input = validEnvelope(); input.source_system = prefix + "-MONITOR";
    input.source_result_id = " Kết quả/🧪+%?# "; input.source_snapshot.result_id = input.source_result_id; rehash(input);
    const id = acceptedId(await post(input));
    await pool.query("update integration.exchange_transactions set fhir_payload=$2::jsonb where exchange_id=$1", [id,
      JSON.stringify({ identifier: [{ system: "urn:uuid:05934370-0df0-5666-8eff-bd5181906b62", value: input.source_result_id }] })]);
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const receipt = { result: "STORED", external_system: "urn:uuid:05934370-0df0-5666-8eff-bd5181906b62", external_id: input.source_result_id,
      target_id: crypto.randomUUID(), patient_key: crypto.randomUUID(), secret: "must-not-leak" };
    for (const [i, phase, code, body, status] of [
      [2, "VERIFY", null, { outcome: "delivered" }, 200],
      [0, "SEND", "HTTP_TEMPORARY", { raw: "SELECT secret" }, 503],
      [1, "SEND", null, receipt, 201],
    ] as const) await pool.query(`insert into integration.exchange_attempts(attempt_id,exchange_id,attempt_no,phase,started_at,ended_at,http_status,error_code,error_message,response_body)
      values ($1,$2,$3,$4,('2026-11-04T10:00:00Z'::timestamptz + $8::integer * interval '1 second'),now(),$5,$6,'SELECT secret',$7::jsonb)`,
      [ids[i], id, phase === "VERIFY" ? 1 : i + 1, phase, status, code, JSON.stringify(body), i + 1]);
    await repository.appendExchangeEvent({ exchangeId: id, eventType: "FAILED", detail: { code: "INVALID_SOURCE", sql: "SELECT secret" } });
    const before = { row: await repository.getExchangeById(id), attempts: await repository.getExchangeAttempts(id), events: await repository.getExchangeEvents(id) };
    const response = await request(`/api/exchanges/${id}/attempts`);
    assert.equal(response.status, 200); assert.ok(isRecord(response.body)); assert.ok(Array.isArray(response.body.items));
    assert.deepEqual(response.body.items.map((x: { attempt_id: string }) => x.attempt_id), ids);
    assert.equal(response.body.source_result_id, input.source_result_id);
    assert.equal(response.body.items[0].error_code, "HTTP_TEMPORARY"); assert.equal(response.body.items[0].receipt, null);
    assert.equal(response.body.items[1].receipt.target_id, receipt.target_id); assert.equal(response.body.items[2].sent_at, null);
    assert.doesNotMatch(JSON.stringify(response.body), /SELECT|secret|must-not-leak|response_body|lease_token/);
    assert.deepEqual(await request(`/api/exchanges/${id}/attempts`), response);
    assert.deepEqual({ row: await repository.getExchangeById(id), attempts: await repository.getExchangeAttempts(id), events: await repository.getExchangeEvents(id) }, before);
  });

  await t.test("closed PostgreSQL connections yield 503 for business routes/ready; health remains 200", async () => {
    await middlewareDatabase.close(); closed = true;
    assertError(await post(validEnvelope()), 503, "DEPENDENCY_UNAVAILABLE");
    assertError(await request("/api/exchanges"), 503, "DEPENDENCY_UNAVAILABLE");
    assertError(await request(`/api/exchanges/${ids[0]}`), 503, "DEPENDENCY_UNAVAILABLE");
    assertError(await request(`/api/exchanges/${ids[0]}/attempts`), 503, "DEPENDENCY_UNAVAILABLE");
    const ready = await request("/ready"); assert.equal(ready.status, 503); assert.ok(isRecord(ready.body));
    assert.equal(ready.body.status, "unavailable");
    assert.deepEqual(await request("/health"), { status: 200, body: { service: "middleware", status: "ok" } });
  });
});
