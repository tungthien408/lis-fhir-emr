/** B4B: one claimed exchange at a time; all durable changes are fenced by B1. */
import { setTimeout as pause } from "node:timers/promises";
import { canonicalJson, hashCanonicalJson } from "./canonical-json.js";
import { mapObservation, type FhirR4LabObservation } from "./mapper.js";
import * as repository from "./repository.js";
import type { AttemptResult, ExchangeAttempt, ExchangeTransaction, WorkerErrorCode, WorkerLease } from "./repository.js";
import { validateExchangeEnvelope } from "./service.js";
import { validateWorkerConfig, type WorkerConfig } from "./worker-config.js";
import { storageReceipt, verifyReadBack } from "./worker-verification.js";

export interface WorkerRepository extends Pick<typeof repository,
  "claimExchange" | "saveExchangeMapping" | "beginExchangeAttempt" | "finishExchangeAttempt"
  | "failExchange" | "getConfirmedStorage"> {}
interface HttpResult { status?: number; body?: unknown; error?: "HTTP_TIMEOUT" | "NETWORK_ERROR" | "INVALID_RESPONSE" }
const responseLimit = 4 * 1024 * 1024;

/** Timeout covers headers AND the bounded body; redirects never forward health data. */
async function request(url: URL, body: string | undefined, timeoutMs: number, shutdown?: AbortSignal): Promise<HttpResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const signal = shutdown ? AbortSignal.any([controller.signal, shutdown]) : controller.signal;
  let status: number | undefined;
  try {
    const response = await fetch(url, { method: body === undefined ? "GET" : "POST", body,
      headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/fhir+json" }) },
      redirect: "manual", signal });
    status = response.status;
    if (status !== 200 && status !== 201) {
      await response.body?.cancel(); return { status };
    }
    const mediaType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if ((mediaType !== "application/json" && mediaType !== "application/fhir+json") || !response.body) {
      await response.body?.cancel(); return { status, error: "INVALID_RESPONSE" };
    }
    const chunks: Uint8Array[] = []; let bytes = 0;
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > responseLimit) { await reader.cancel(); return { status, error: "INVALID_RESPONSE" }; }
      chunks.push(value);
    }
    try { return { status, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown }; }
    catch { return { status, error: "INVALID_RESPONSE" }; }
  } catch {
    return { status, error: controller.signal.aborted ? "HTTP_TIMEOUT" : "NETWORK_ERROR" };
  } finally { clearTimeout(timeout); }
}

export class MiddlewareWorker {
  private readonly config: WorkerConfig;
  constructor(config: WorkerConfig, private readonly repo: WorkerRepository = repository) {
    this.config = validateWorkerConfig(config);
  }

  private retry(attempt: ExchangeAttempt, code: WorkerErrorCode, httpStatus?: number): AttemptResult {
    return { kind: "retry", code, httpStatus, delayMs: this.config.retryDelaysMs[attempt.attemptNo - 1] ?? null };
  }
  private httpFailure(result: HttpResult, attempt: ExchangeAttempt): AttemptResult | undefined {
    if (result.error === "HTTP_TIMEOUT" || result.error === "NETWORK_ERROR") return this.retry(attempt, result.error, result.status);
    if (result.status !== undefined && (result.status >= 500 || result.status === 408 || result.status === 429)) {
      return this.retry(attempt, "HTTP_TEMPORARY", result.status);
    }
    if (attempt.phase === "SEND" && (result.status === 409 || result.status === 422)) {
      return { kind: "terminal", status: "REJECTED", httpStatus: result.status,
        code: result.status === 409 ? "DUPLICATE_CONFLICT" : "REMOTE_VALIDATION_ERROR" };
    }
    if (result.status !== 200 && !(attempt.phase === "SEND" && result.status === 201)) {
      return { kind: "terminal", status: "FAILED", code: "HTTP_PERMANENT", httpStatus: result.status };
    }
    if (result.error) return { kind: "terminal", status: "FAILED", httpStatus: result.status,
      code: attempt.phase === "SEND" ? "INVALID_STORAGE_RESPONSE" : "INVALID_VERIFY_RESPONSE" };
    return undefined;
  }

  /** Public for deterministic scheduling/tests. Unexpected DB faults leave a recoverable lease. */
  async runOnce(shutdown?: AbortSignal): Promise<"idle" | "processed"> {
    if (shutdown?.aborted) return "idle";
    let row = await this.repo.claimExchange(this.config.leaseMs);
    if (!row) return "idle";
    if (!row.leaseToken) throw new Error("Worker claim did not contain a lease");
    const lease: WorkerLease = { exchangeId: row.exchangeId, leaseToken: row.leaseToken };
    const observation = await this.prepare(row, lease);
    if (!observation) return "processed";
    if (row.status === "PROCESSING") {
      const started = await this.repo.beginExchangeAttempt(lease, "SEND", this.config.leaseMs, this.config.retryDelaysMs.length + 1);
      if (!started) return "processed";
      const result = await request(new URL("/api/observations", this.config.emrBaseUrl), canonicalJson(observation), this.config.httpTimeoutMs, shutdown);
      const failure = this.httpFailure(result, started.attempt);
      const receipt = failure ? undefined : storageReceipt(result.status ?? 0, result.body, observation);
      const outcome: AttemptResult = failure ?? (receipt ? { kind: "stored", receipt, httpStatus: result.status }
        : { kind: "terminal", status: "FAILED", code: "INVALID_STORAGE_RESPONSE", httpStatus: result.status });
      const saved = await this.repo.finishExchangeAttempt(lease, started.attempt.attemptId, outcome);
      if (!saved || outcome.kind !== "stored") return "processed";
      row = { ...row, status: "VERIFYING" };
    }
    if (row.status === "VERIFYING" && !shutdown?.aborted) {
      const stored = await this.repo.getConfirmedStorage(lease);
      const receipt = stored && storageReceipt(stored.httpStatus, stored.body, observation);
      if (!receipt) { await this.repo.failExchange(lease, "FAILED", "STORAGE_RECEIPT_MISSING"); return "processed"; }
      const started = await this.repo.beginExchangeAttempt(lease, "VERIFY", this.config.leaseMs, this.config.retryDelaysMs.length + 1);
      if (!started) return "processed";
      const url = new URL("/api/lab-results", this.config.emrBaseUrl);
      url.searchParams.set("external_system", observation.identifier[0].system);
      url.searchParams.set("external_id", observation.identifier[0].value);
      const result = await request(url, undefined, this.config.httpTimeoutMs, shutdown);
      const failure = this.httpFailure(result, started.attempt);
      const fields = failure ? [] : verifyReadBack(result.body, observation, receipt);
      await this.repo.finishExchangeAttempt(lease, started.attempt.attemptId, failure ?? (fields.length
        ? { kind: "terminal", status: "FAILED", code: "VERIFY_MISMATCH", httpStatus: result.status, fields }
        : { kind: "delivered", httpStatus: result.status }));
    }
    return "processed";
  }

  private async prepare(row: ExchangeTransaction, lease: WorkerLease): Promise<FhirR4LabObservation | undefined> {
    const checked = validateExchangeEnvelope(row.sourcePayload);
    if (checked.kind !== "valid" || checked.envelope.event_id.toLowerCase() !== row.eventId.toLowerCase()
      || checked.envelope.source_system !== row.sourceSystem || checked.envelope.source_result_id !== row.sourceResultId
      || checked.envelope.source_hash !== row.sourceHash) {
      await this.repo.failExchange(lease, "REJECTED", "INVALID_SOURCE"); return undefined;
    }
    const mapping = mapObservation(checked.envelope.source_snapshot);
    if (mapping.kind !== "mapped") {
      await this.repo.failExchange(lease, "REJECTED", "MAPPING_UNSUPPORTED"); return undefined;
    }
    if (row.fhirPayload !== null) {
      // A version upgrade or corruption must not silently replace the wire payload.
      let matches = false;
      try {
        matches = row.mappingVersion === mapping.mappingVersion && row.payloadHash === hashCanonicalJson(row.fhirPayload)
          && canonicalJson(row.fhirPayload) === canonicalJson(mapping.observation);
      } catch { /* Corrupt stored JSON must fail closed, not reclaim forever. */ }
      if (!matches) {
        await this.repo.failExchange(lease, "FAILED", "PAYLOAD_INTEGRITY"); return undefined;
      }
      return row.fhirPayload as FhirR4LabObservation;
    }
    if (row.status === "VERIFYING" || row.sendAttemptCount > 0 || row.verifyAttemptCount > 0) {
      await this.repo.failExchange(lease, "FAILED", "PAYLOAD_INTEGRITY"); return undefined;
    }
    const saved = await this.repo.saveExchangeMapping(lease, { ...mapping, payloadHash: hashCanonicalJson(mapping.observation) });
    return saved ? mapping.observation : undefined;
  }

  async run(signal: AbortSignal, onError: () => void = () => {}): Promise<void> {
    while (!signal.aborted) {
      try { if (await this.runOnce(signal) === "processed") continue; }
      catch { onError(); } // No raw exception/response/payload is logged.
      try { await pause(this.config.pollMs, undefined, { signal }); }
      catch { if (!signal.aborted) throw new Error("Worker polling failed"); }
    }
  }
}
