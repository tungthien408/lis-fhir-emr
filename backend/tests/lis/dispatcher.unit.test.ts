import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { setTimeout as pause } from "node:timers/promises";
import type { DispatcherRepository } from "../../src/lis/dispatcher.js";
import { loadDispatcherConfig, validateDispatcherConfig } from "../../src/lis/dispatcher-config.js";
import type { DispatchAttempt, DispatchAttemptResult, PublishEvent } from "../../src/lis/repository.js";
import { dispatcherConfig, exampleEvent, expectedEnvelope, fakeMiddleware, gate } from "./dispatcher-test-support.js";

delete process.env.LIS_DATABASE_URL;
const { LisDispatcher } = await import("../../src/lis/dispatcher.js");

/** Only orchestration is faked here. PostgreSQL fencing/rollback is tested separately. */
function memoryRepository(event: PublishEvent = exampleEvent()) {
  const finishes: DispatchAttemptResult[] = []; const calls: string[] = [];
  let sent = false;
  const repo: DispatcherRepository = {
    async claimPublishEvent() {
      calls.push("claim");
      if (!["PENDING", "RETRY_WAIT"].includes(event.dispatchStatus)) return undefined;
      event.dispatchStatus = "IN_FLIGHT"; event.leaseToken = randomUUID();
      return structuredClone(event);
    },
    async beginDispatchAttempt(lease, _leaseMs, maxAttempts) {
      calls.push("begin");
      assert.equal(lease.leaseToken, event.leaseToken);
      if (event.dispatchAttemptCount >= maxAttempts) { event.dispatchStatus = "FAILED"; return { kind: "exhausted" }; }
      sent = false; event.dispatchAttemptCount++;
      const attempt: DispatchAttempt = { dispatchAttemptId: randomUUID(), eventId: event.eventId, attemptNo: event.dispatchAttemptCount,
        leaseToken: event.leaseToken, startedAt: new Date(), sentAt: null, responseAt: null, endedAt: null,
        httpStatus: null, responseBody: null, errorCode: null, errorMessage: null };
      return { kind: "started", event: structuredClone(event), attempt };
    },
    async markDispatchAttemptSent() { calls.push("sent"); sent = true; return true; },
    async finishDispatchAttempt(_lease, _id, result) {
      calls.push("finish"); finishes.push(structuredClone(result));
      if (result.httpStatus !== undefined) assert.equal(sent, true);
      event.dispatchStatus = result.kind === "ack" ? "ACK" : result.kind === "retry" ? "RETRY_WAIT" : result.status;
      event.leaseToken = null;
      if (result.kind === "ack") { event.exchangeId = result.acknowledgement.exchange_id; event.ackResponse = result.acknowledgement; }
      return "completed";
    },
  };
  return { repo, event, finishes, calls };
}

test("D2 config: explicit origin, finite bounds, exact retry budget and immutable settings", () => {
  const config = loadDispatcherConfig({ MIDDLEWARE_BASE_URL: "http://127.0.0.1:3102/" });
  assert.equal(config.middlewareBaseUrl, "http://127.0.0.1:3102");
  assert.equal(config.maxAttempts, 4); assert.equal(config.httpTimeoutMs, 3000); assert.equal(config.leaseMs, 15000);
  assert.equal(config.pollMs, 1000); assert.deepEqual(config.retryDelaysMs, [2000, 4000, 8000]);
  assert.ok(Object.isFrozen(config) && Object.isFrozen(config.retryDelaysMs));
  assert.equal(loadDispatcherConfig({ MIDDLEWARE_BASE_URL: config.middlewareBaseUrl, LIS_DISPATCHER_RETRY_DELAYS_MS: "" }).maxAttempts, 1);
  for (const middlewareBaseUrl of ["", "ftp://host", "http://user:secret@host", "http://host/base", "http://host/?q=1", "http://host/#secret"]) {
    assert.throws(() => validateDispatcherConfig({ ...config, middlewareBaseUrl }));
  }
  for (const patch of [{ httpTimeoutMs: 0 }, { httpTimeoutMs: 60001 }, { leaseMs: 3999 }, { leaseMs: 3600001 },
    { pollMs: 9 }, { pollMs: 60001 }, { maxAttempts: 0 }, { maxAttempts: 101 }, { maxAttempts: 2 },
    { retryDelaysMs: [-1, 1, 2] }, { retryDelaysMs: [NaN, 1, 2] }, { retryDelaysMs: [1.5, 1, 2] }, { retryDelaysMs: [86400001, 1, 2] }]) {
    assert.throws(() => validateDispatcherConfig({ ...config, ...patch }));
  }
  for (const value of ["-1", "1e3", "1, 2", "Infinity"]) {
    for (const key of ["LIS_DISPATCHER_RETRY_DELAYS_MS", "LIS_DISPATCHER_MAX_ATTEMPTS", "LIS_DISPATCHER_HTTP_TIMEOUT_MS"]) {
      assert.throws(() => loadDispatcherConfig({ MIDDLEWARE_BASE_URL: config.middlewareBaseUrl, [key]: value }));
    }
  }
});

test("D2 valid HTTP 202: exact persisted envelope, one send, six ACK fields and no mutation", async (t) => {
  const server = await fakeMiddleware(t, (req) => ({ ...req.accept(), body: { ...req.accept().body, private_diagnostic: "discard" } }));
  const c = memoryRepository(); const original = structuredClone(c.event);
  const dispatcher = new LisDispatcher(dispatcherConfig(server.url), c.repo);
  assert.equal(await dispatcher.runOnce(), "acknowledged");
  assert.deepEqual(c.calls, ["claim", "begin", "sent", "finish"]);
  assert.deepEqual(server.requests[0].body, expectedEnvelope(original));
  assert.deepEqual(c.event.sourceSnapshot, original.sourceSnapshot); assert.equal(c.event.sourceHash, original.sourceHash);
  assert.equal(c.event.dispatchStatus, "ACK"); assert.deepEqual(c.event.ackResponse, server.stored.get(c.event.eventId)?.ack);
  assert.equal(await dispatcher.runOnce(), "idle"); assert.equal(server.requests.length, 1);
});

for (const [name, patch] of [
  ["accepted", { accepted: false }], ["accepted string", { accepted: "true" }],
  ["event_id", { event_id: randomUUID() }], ["source_system", { source_system: "wrong" }],
  ["source_result_id", { source_result_id: "wrong" }], ["source_hash", { source_hash: "a".repeat(64) }],
  ["exchange_id", { exchange_id: "invalid" }], ["missing exchange_id", { exchange_id: undefined }],
] as const) {
  test(`D2 HTTP 202 with invalid ${name}: FAILED without false ACK`, async (t) => {
    const server = await fakeMiddleware(t, (req) => ({ status: 202, body: { ...req.accept().body, ...patch } }));
    const c = memoryRepository();
    assert.equal(await new LisDispatcher(dispatcherConfig(server.url), c.repo).runOnce(), "failed");
    assert.deepEqual(c.finishes, [{ kind: "terminal", status: "FAILED", httpStatus: 202, code: "INVALID_ACK" }]);
    assert.equal(c.event.exchangeId, null); assert.equal(c.event.ackResponse, null);
  });
}

for (const [name, reply] of [
  ["malformed JSON", { status: 202, raw: "{" }], ["null", { status: 202, body: null }],
  ["array", { status: 202, body: [] }], ["wrong media type", { status: 202, body: {}, headers: { "Content-Type": "text/html" } }],
  ["oversized body", { status: 202, raw: " ".repeat(65537) }],
] as const) {
  test(`D2 HTTP 202 ${name}: bounded invalid receipt handling`, async (t) => {
    const server = await fakeMiddleware(t, () => reply); const c = memoryRepository();
    assert.equal(await new LisDispatcher(dispatcherConfig(server.url), c.repo).runOnce(), "failed");
    assert.equal(c.finishes[0].kind, "terminal"); assert.equal(c.event.ackResponse, null);
  });
}

for (const status of [400, 401, 403, 404, 409, 413, 415, 422, 408, 429, 500, 502, 503, 599, 200, 201, 204, 302, 307]) {
  test(`D2 HTTP ${status}: explicit failure policy`, async (t) => {
    const server = await fakeMiddleware(t, () => ({ status, body: { secret_diagnostic: "discard" }, headers: { Location: "/must-not-follow" } }));
    const c = memoryRepository(); const temporary = [408, 429].includes(status) || status >= 500;
    const blocked = status >= 400 && status < 500 && !temporary;
    assert.equal(await new LisDispatcher(dispatcherConfig(server.url), c.repo).runOnce(), temporary ? "retry_wait" : blocked ? "blocked" : "failed");
    const code = temporary ? "HTTP_TEMPORARY" : status === 409 ? "DUPLICATE_CONFLICT"
      : [400, 413, 415, 422].includes(status) ? "REMOTE_VALIDATION_ERROR" : "HTTP_PERMANENT";
    assert.deepEqual(c.finishes[0], temporary ? { kind: "retry", httpStatus: status, code, delayMs: 100 }
      : { kind: "terminal", status: blocked ? "BLOCKED" : "FAILED", httpStatus: status, code });
    assert.equal(server.requests.length, 1); assert.equal(c.event.ackResponse, null);
  });
}

test("D2 identical retry after lost committed response keeps the envelope and original exchange_id", async (t) => {
  const server = await fakeMiddleware(t, (req) => { if (req.number === 1) { req.accept(); return { drop: true }; } });
  const c = memoryRepository(); const dispatcher = new LisDispatcher(dispatcherConfig(server.url), c.repo);
  assert.equal(await dispatcher.runOnce(), "retry_wait");
  const originalId = server.stored.get(c.event.eventId)?.ack.exchange_id; assert.ok(originalId);
  assert.equal(c.event.ackResponse, null);
  assert.equal(await dispatcher.runOnce(), "acknowledged");
  assert.equal(server.stored.size, 1); assert.equal(c.event.exchangeId, originalId);
  assert.equal(server.requests[0].raw, server.requests[1].raw); assert.equal(c.event.dispatchAttemptCount, 2);
});

test("D2 nonstandard HTTP 600 is a permanent failure without violating the D1 status constraint", async (t) => {
  const server = await fakeMiddleware(t, () => ({ status: 600, body: {} })); const c = memoryRepository();
  assert.equal(await new LisDispatcher(dispatcherConfig(server.url), c.repo).runOnce(), "failed");
  assert.deepEqual(c.finishes, [{ kind: "terminal", status: "FAILED", code: "HTTP_PERMANENT" }]);
  assert.equal(c.event.ackResponse, null);
});

test("D2 retry exhaustion uses persisted attempt number and configurable delays", async (t) => {
  const server = await fakeMiddleware(t, () => ({ status: 503, body: {} })); const c = memoryRepository();
  const config = dispatcherConfig(server.url);
  for (const outcome of ["retry_wait", "retry_wait", "failed", "idle"]) {
    assert.equal(await new LisDispatcher(config, c.repo).runOnce(), outcome);
  }
  assert.equal(server.requests.length, 3);
  assert.deepEqual(c.finishes.map((r) => r.kind === "retry" ? r.delayMs : r.kind), [100, 200, "terminal"]);
  assert.ok(server.requests.every((r) => r.raw === server.requests[0].raw));
});

test("D2 connection refused records a retry without an invented HTTP status", async () => {
  const listener = createServer(); await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const address = listener.address(); assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const c = memoryRepository();
  assert.equal(await new LisDispatcher(dispatcherConfig(`http://127.0.0.1:${address.port}`), c.repo).runOnce(), "retry_wait");
  assert.deepEqual(c.finishes[0], { kind: "retry", code: "NETWORK_ERROR", httpStatus: undefined, delayMs: 100 });
});

for (const hang of ["headers", "body"] as const) {
  test(`D2 timeout covers ${hang} and never trusts a partial 202`, async (t) => {
    const server = await fakeMiddleware(t, () => ({ status: 202, hang })); const c = memoryRepository();
    assert.equal(await new LisDispatcher(dispatcherConfig(server.url, { httpTimeoutMs: 150 }), c.repo).runOnce(), "retry_wait");
    assert.deepEqual(c.finishes[0], { kind: "retry", code: "HTTP_TIMEOUT", httpStatus: hang === "body" ? 202 : undefined, delayMs: 100 });
    assert.equal(c.event.ackResponse, null);
  });
}

test("D2 must await commit; database failure is never reported as acknowledged", async (t) => {
  const server = await fakeMiddleware(t); const c = memoryRepository(); const entered = gate(); const release = gate();
  c.repo.finishDispatchAttempt = async () => { entered.resolve(); await release.promise; throw new Error("Synthetic commit failure"); };
  let settled = false;
  const result = new LisDispatcher(dispatcherConfig(server.url), c.repo).runOnce().finally(() => { settled = true; });
  const rejected = assert.rejects(result, /Synthetic commit failure/);
  await entered.promise; assert.equal(settled, false); assert.equal(c.event.ackResponse, null);
  release.resolve(); await rejected; assert.equal(c.event.dispatchStatus, "IN_FLIGHT");
});

test("D2 stale completion cannot report success and stale send boundary prevents HTTP", async (t) => {
  const server = await fakeMiddleware(t); const c = memoryRepository();
  c.repo.finishDispatchAttempt = async () => "stale_lease";
  assert.equal(await new LisDispatcher(dispatcherConfig(server.url), c.repo).runOnce(), "not_completed");
  assert.equal(c.event.ackResponse, null);
  const other = memoryRepository(); other.repo.markDispatchAttemptSent = async () => false;
  assert.equal(await new LisDispatcher(dispatcherConfig(server.url), other.repo).runOnce(), "not_completed");
  assert.equal(server.requests.length, 1); assert.deepEqual(other.finishes, []);
});

test("D2 corrupt outbox hash is blocked locally; original content is not repaired or sent", async (t) => {
  const server = await fakeMiddleware(t); const c = memoryRepository(); c.event.sourceHash = "f".repeat(64);
  const original = structuredClone(c.event.sourceSnapshot);
  assert.equal(await new LisDispatcher(dispatcherConfig(server.url), c.repo).runOnce(), "blocked");
  assert.equal(server.requests.length, 0); assert.deepEqual(c.calls, ["claim", "begin", "finish"]);
  assert.deepEqual(c.event.sourceSnapshot, original); assert.equal(c.event.sourceHash, "f".repeat(64));
});

test("D2 graceful shutdown aborts pending HTTP and leaves a recoverable attempt", async (t) => {
  const received = gate(); const server = await fakeMiddleware(t, () => { received.resolve(); return { hang: "headers" }; });
  const c = memoryRepository(); const stop = new AbortController(); const dispatcher = new LisDispatcher(dispatcherConfig(server.url), c.repo);
  const pending = dispatcher.run(stop.signal); await received.promise; stop.abort(); await pending;
  assert.equal(c.event.dispatchStatus, "IN_FLIGHT"); assert.deepEqual(c.finishes, []);
  assert.equal(await dispatcher.runOnce(stop.signal), "idle"); assert.equal(server.requests.length, 1);
});

test("D2 polling waits after database errors and shutdown cancels the wait", async () => {
  const c = memoryRepository(); const stop = new AbortController(); let errors = 0; let claims = 0;
  c.repo.claimPublishEvent = async () => { claims++; throw new Error("Private diagnostic must not reach callback"); };
  const running = new LisDispatcher(dispatcherConfig("http://127.0.0.1:3102", { pollMs: 1000 }), c.repo).run(stop.signal, (...args) => {
    assert.deepEqual(args, []); errors++;
  });
  await pause(30); assert.equal(claims, 1); stop.abort(); await running; assert.equal(errors, 1);
});
