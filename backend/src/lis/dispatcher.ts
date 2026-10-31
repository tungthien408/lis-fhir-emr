/** D2: send the persisted LIS outbox to Middleware; D1 owns all durable transitions. */
import { setTimeout as pause } from "node:timers/promises";
import { canonicalJson, hashCanonicalJson } from "./canonical-json.js";
import { validateDispatcherConfig, type DispatcherConfig } from "./dispatcher-config.js";
import * as repository from "./repository.js";
import type { DispatchAcknowledgement, DispatchAttemptResult, DispatchErrorCode, JsonValue, PublishEvent } from "./repository.js";

export interface DispatcherRepository extends Pick<typeof repository,
  "claimPublishEvent" | "beginDispatchAttempt" | "markDispatchAttemptSent" | "finishDispatchAttempt"> {}
export type DispatchRunOutcome = "idle" | "acknowledged" | "retry_wait" | "blocked" | "failed" | "not_completed";
interface HttpResult { status?: number; body?: unknown; error?: "HTTP_TIMEOUT" | "NETWORK_ERROR" | "INVALID_ACK" }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const responseLimit = 64 * 1024;

/** Only the six persisted fields go on the wire. Check integrity; never repair/rebuild a snapshot. */
function envelope(event: PublishEvent): string {
  const snapshot = event.sourceSnapshot;
  if (!uuid.test(event.eventId) || !event.resultId.trim() || !event.sourceSystem.trim()
    || !/^[0-9a-f]{64}$/.test(event.sourceHash) || snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)
    || hashCanonicalJson(snapshot as JsonValue) !== event.sourceHash) throw new Error("Invalid persisted publish envelope");
  // A2 persists published_at from a JS Date (milliseconds); never substitute the send time.
  const body = canonicalJson({ event_id: event.eventId, source_system: event.sourceSystem, source_result_id: event.resultId,
    source_snapshot: snapshot as JsonValue, source_hash: event.sourceHash, published_at: event.publishedAt.toISOString() });
  if (Buffer.byteLength(body) > 1024 * 1024) throw new Error("Publish envelope exceeds the Middleware request limit");
  return body;
}

function acknowledgement(body: unknown, event: PublishEvent): DispatchAcknowledgement | undefined {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return undefined;
  const ack = body as Record<string, unknown>;
  if (ack.accepted !== true || typeof ack.event_id !== "string" || ack.event_id.toLowerCase() !== event.eventId.toLowerCase()
    || ack.source_system !== event.sourceSystem || ack.source_result_id !== event.resultId || ack.source_hash !== event.sourceHash
    || typeof ack.exchange_id !== "string" || !uuid.test(ack.exchange_id)) return undefined;
  // Retain the original receipt fields, but discard arbitrary upstream diagnostics/medical content.
  return { accepted: true, event_id: ack.event_id, exchange_id: ack.exchange_id,
    source_system: event.sourceSystem, source_result_id: event.resultId, source_hash: event.sourceHash };
}

/** Bound both headers and body; a redirect must never forward the snapshot to a different endpoint. */
async function send(url: URL, body: string, timeoutMs: number, shutdown?: AbortSignal): Promise<HttpResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = shutdown ? AbortSignal.any([controller.signal, shutdown]) : controller.signal;
  let status: number | undefined;
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body, redirect: "manual", signal });
    status = response.status;
    if (status !== 202) { await response.body?.cancel(); return { status }; }
    if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json" || !response.body) {
      await response.body?.cancel(); return { status, error: "INVALID_ACK" };
    }
    const chunks: Uint8Array[] = []; let bytes = 0;
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > responseLimit) { await reader.cancel(); return { status, error: "INVALID_ACK" }; }
      chunks.push(value);
    }
    try { return { status, body: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))) as unknown }; }
    catch { return { status, error: "INVALID_ACK" }; }
  } catch {
    return { status, error: controller.signal.aborted ? "HTTP_TIMEOUT" : "NETWORK_ERROR" };
  } finally { clearTimeout(timer); }
}

export class LisDispatcher {
  private readonly config: DispatcherConfig;
  constructor(config: DispatcherConfig, private readonly repo: DispatcherRepository = repository) {
    this.config = validateDispatcherConfig(config);
  }

  private retry(attemptNo: number, code: DispatchErrorCode, httpStatus?: number): DispatchAttemptResult {
    if (attemptNo >= this.config.maxAttempts) return { kind: "terminal", status: "FAILED", code, httpStatus };
    return { kind: "retry", code, httpStatus, delayMs: this.config.retryDelaysMs[attemptNo - 1] };
  }

  private classify(result: HttpResult, event: PublishEvent, attemptNo: number): DispatchAttemptResult {
    // D1/DDL only permits standard status values. A nonstandard reply is not a database fault.
    if (result.status !== undefined && (result.status < 100 || result.status > 599)) {
      return { kind: "terminal", status: "FAILED", code: "HTTP_PERMANENT" };
    }
    if (result.error === "HTTP_TIMEOUT" || result.error === "NETWORK_ERROR") return this.retry(attemptNo, result.error, result.status);
    const status = result.status;
    if (status === 408 || status === 429 || (status !== undefined && status >= 500)) {
      return this.retry(attemptNo, "HTTP_TEMPORARY", status);
    }
    if (status === 202) {
      const ack = result.error ? undefined : acknowledgement(result.body, event);
      return ack ? { kind: "ack", httpStatus: 202, acknowledgement: ack }
        : { kind: "terminal", status: "FAILED", httpStatus: status, code: "INVALID_ACK" };
    }
    if (status !== undefined && status >= 400 && status < 500) {
      return { kind: "terminal", status: "BLOCKED", httpStatus: status,
        code: status === 409 ? "DUPLICATE_CONFLICT" : [400, 413, 415, 422].includes(status) ? "REMOTE_VALIDATION_ERROR" : "HTTP_PERMANENT" };
    }
    return { kind: "terminal", status: "FAILED", code: "HTTP_PERMANENT", httpStatus: status };
  }

  /** At most one event/HTTP attempt; no waiting for retries and no success before D1 commits. */
  async runOnce(shutdown?: AbortSignal): Promise<DispatchRunOutcome> {
    if (shutdown?.aborted) return "idle";
    const claimed = await this.repo.claimPublishEvent(this.config.leaseMs);
    if (!claimed) return "idle";
    if (!claimed.leaseToken) throw new Error("Dispatcher claim did not contain a lease");
    if (shutdown?.aborted) return "not_completed";
    const lease = { eventId: claimed.eventId, leaseToken: claimed.leaseToken };
    const started = await this.repo.beginDispatchAttempt(lease, this.config.leaseMs, this.config.maxAttempts);
    if (started.kind === "exhausted") return "failed";
    if (started.kind !== "started" || shutdown?.aborted) return "not_completed";
    const { event, attempt } = started;
    let body: string | undefined;
    let outcome: DispatchAttemptResult;
    try { body = envelope(event); }
    catch { /* Corrupt persisted data must stop, without exposing or rewriting it. */ }
    if (body === undefined) {
      outcome = { kind: "terminal", status: "BLOCKED", code: "VALIDATION_ERROR" };
    } else {
      if (!await this.repo.markDispatchAttemptSent(lease, attempt.dispatchAttemptId) || shutdown?.aborted) return "not_completed";
      const result = await send(new URL("/api/exchanges", this.config.middlewareBaseUrl), body, this.config.httpTimeoutMs, shutdown);
      // Shutdown interrupts I/O; the persisted lease/attempt will be recovered without assuming remote failure.
      if (shutdown?.aborted) return "not_completed";
      outcome = this.classify(result, event, attempt.attemptNo);
    }
    const saved = await this.repo.finishDispatchAttempt(lease, attempt.dispatchAttemptId, outcome);
    if (saved !== "completed") return "not_completed";
    return outcome.kind === "ack" ? "acknowledged" : outcome.kind === "retry" ? "retry_wait"
      : outcome.status === "BLOCKED" ? "blocked" : "failed";
  }

  /** Always pause between iterations, including stale results and database faults. */
  async run(signal: AbortSignal, onError: () => void = () => {}): Promise<void> {
    while (!signal.aborted) {
      try { await this.runOnce(signal); }
      catch { onError(); } // Caller gets no raw exception, URL, source data or response body.
      try { await pause(this.config.pollMs, undefined, { signal }); }
      catch { if (!signal.aborted) throw new Error("Dispatcher polling failed"); }
    }
  }
}
