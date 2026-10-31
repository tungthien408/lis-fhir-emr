import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { TestContext } from "node:test";
import type { DispatcherConfig } from "../../src/lis/dispatcher-config.js";
import type { DispatchAcknowledgement, PublishEvent } from "../../src/lis/repository.js";

/** Independent test oracle, not the Dispatcher serializer or a Middleware Repository mock. */
export function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${sortedJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function snapshotHash(value: unknown): string { return createHash("sha256").update(sortedJson(value)).digest("hex"); }
export function exampleEvent(): PublishEvent {
  const id = randomUUID();
  const snapshot = { result_id: `D2-SYNTHETIC-${id}-R`, patient_id: `D2-SYNTHETIC-${id}-P`, test_code: "D2-SYNTHETIC-T",
    test_name: "Synthetic test", fluid: "Blood", category: "Chemistry", value_num: 0.30000000000000004, unit: "mg/dL",
    reference_low: null, reference_high: 4.5, effective_at: "2026-10-30T08:00:00.123456Z", result_status: "FINAL" };
  return { eventId: id, resultId: snapshot.result_id, sourceSystem: "lis-demo", sourceSnapshot: snapshot,
    sourceHash: snapshotHash(snapshot), publishedAt: new Date("2026-10-30T09:00:00.123Z"), dispatchStatus: "PENDING",
    dispatchAttemptCount: 0, exchangeId: null, nextRetryAt: null, leaseUntil: null, leaseToken: null,
    ackedAt: null, ackResponse: null, lastErrorCode: null, lastErrorMessage: null };
}
export function expectedEnvelope(event: PublishEvent) {
  return { event_id: event.eventId, source_system: event.sourceSystem, source_result_id: event.resultId,
    source_snapshot: structuredClone(event.sourceSnapshot), source_hash: event.sourceHash, published_at: event.publishedAt.toISOString() };
}
export function dispatcherConfig(url: string, patch: Partial<DispatcherConfig> = {}): DispatcherConfig {
  return { middlewareBaseUrl: url, httpTimeoutMs: 1000, leaseMs: 15000, pollMs: 20, maxAttempts: 3, retryDelaysMs: [100, 200], ...patch };
}
export function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
export interface FakeReply {
  status?: number;
  body?: unknown;
  raw?: string;
  headers?: Record<string, string>;
  drop?: boolean;
  hang?: "headers" | "body";
}
interface FakeRequest {
  body: ReturnType<typeof expectedEnvelope>;
  raw: string;
  headers: IncomingHttpHeaders;
  number: number;
  accept(): { status: number; body: DispatchAcknowledgement | { error: { code: string } } };
}

/** Real localhost HTTP. Keeps original receipt for equal envelopes; conflicting identities return 409. */
export async function fakeMiddleware(t: TestContext, handler?: (request: FakeRequest) => FakeReply | undefined | Promise<FakeReply | undefined>) {
  const requests: FakeRequest[] = [];
  const stored = new Map<string, { envelope: ReturnType<typeof expectedEnvelope>; ack: DispatchAcknowledgement }>();
  const failures: unknown[] = [];
  const server = createServer((req, res) => {
    void (async () => {
      assert.equal(req.method, "POST"); assert.equal(req.url, "/api/exchanges");
      assert.equal(req.headers["content-type"], "application/json");
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = JSON.parse(raw) as ReturnType<typeof expectedEnvelope>;
      const request: FakeRequest = { body, raw, headers: req.headers, number: requests.length + 1, accept() {
        // Tests send the A2 shape. Independently check the contract before pretending to commit.
        assert.match(body.event_id, /^[0-9a-f-]{36}$/i);
        assert.ok(body.source_system && body.source_result_id);
        assert.ok(Number.isFinite(Date.parse(body.published_at)));
        const snapshot = body.source_snapshot as Record<string, unknown>;
        if (!snapshot || snapshot.result_id !== body.source_result_id || snapshot.result_status !== "FINAL"
          || snapshotHash(snapshot) !== body.source_hash) return { status: 422, body: { error: { code: "VALIDATION_ERROR" } } };
        const existing = [...stored.values()].find((row) => row.envelope.event_id.toLowerCase() === body.event_id.toLowerCase()
          || (row.envelope.source_system === body.source_system && row.envelope.source_result_id === body.source_result_id));
        if (existing) return sortedJson(existing.envelope) === sortedJson(body) ? { status: 202, body: existing.ack }
          : { status: 409, body: { error: { code: "DUPLICATE_CONFLICT" } } };
        const ack: DispatchAcknowledgement = { accepted: true, event_id: body.event_id, exchange_id: randomUUID(),
          source_system: body.source_system, source_result_id: body.source_result_id, source_hash: body.source_hash };
        stored.set(body.event_id, { envelope: structuredClone(body), ack });
        return { status: 202, body: ack };
      } };
      requests.push(request);
      const reply: FakeReply = await handler?.(request) ?? request.accept();
      if (reply.drop) { req.socket.destroy(); return; }
      if (reply.hang === "headers") return;
      res.writeHead(reply.status ?? 202, { "Content-Type": "application/json", ...reply.headers });
      if (reply.hang === "body") { res.write('{"accepted":'); return; }
      res.end(reply.raw ?? JSON.stringify(reply.body));
    })().catch((error: unknown) => { failures.push(error); res.destroy(); });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); assert.ok(address && typeof address !== "string");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    assert.deepEqual(failures, [], "Fake Middleware request/contract assertions must pass");
  });
  return { url: `http://127.0.0.1:${address.port}`, requests, stored };
}
