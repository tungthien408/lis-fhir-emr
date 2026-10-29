/**
 * SPP-66 B1: persistence only; B2 supplies validated JSON, IDs and hash.
 * source_payload is the ENTIRE six-field POST /api/exchanges envelope from
 * docs/api-contract.md §3 step 2, including source_snapshot (not just snapshot).
 * The contract does not explicitly define this column's shape: this choice
 * preserves the original inbound envelope for review. JSONB preserves values,
 * not wire bytes/key order. Retries must match the whole envelope, including
 * published_at's original string, plus the indexed identity and hash columns.
 * B4B adds fenced persistence for Worker state changes below the B1 functions.
 * No hashing, HTTP calls or mapping computation lives here.
 */
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import { middlewareDatabase } from "./db.js";
import { exchangeAttempts, exchangeEvents, exchangeTransactions } from "./schema.js";

export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };
export type ExchangeStatus = "RECEIVED" | "PROCESSING" | "VERIFYING" | "RETRY_WAIT"
  | "DELIVERED" | "REJECTED" | "FAILED";
export type AttemptPhase = "SEND" | "VERIFY";
export type ExchangeTransaction = typeof exchangeTransactions.$inferSelect;
export type ExchangeEvent = typeof exchangeEvents.$inferSelect;
export type ExchangeAttempt = typeof exchangeAttempts.$inferSelect;

export interface SourceSnapshot extends JsonObject {
  result_id: string;
  patient_id: string;
  test_code: string;
  test_name: string;
  fluid: string | null;
  category: string | null;
  value_num: number;
  unit: string;
  reference_low: number | null;
  reference_high: number | null;
  effective_at: string;
  result_status: "FINAL";
}

export interface SourceEnvelope extends JsonObject {
  event_id: string;
  source_system: string;
  source_result_id: string;
  source_snapshot: SourceSnapshot;
  source_hash: string;
  published_at: string;
}

export interface NewExchange {
  /** Prepared, validated API body; retained verbatim as JSON values. */
  sourceEnvelope: SourceEnvelope;
  /** Optional caller-generated UUID; otherwise randomUUID(). Never a retry key. */
  exchangeId?: string;
}

export type PersistExchangeResult =
  | { kind: "created"; transaction: ExchangeTransaction }
  | { kind: "existing"; transaction: ExchangeTransaction }
  | {
    kind: "conflict";
    reason: "identifiers" | "content";
    byEventId: ExchangeTransaction | undefined;
    bySourceResult: ExchangeTransaction | undefined;
  };

export interface ListExchangesOptions {
  status?: ExchangeStatus;
  sourceResultId?: string;
  /** B2 validates limit 1–100 and a safe integer offset >= 0. Defaults: 20/0. */
  limit?: number;
  offset?: number;
}

export interface NewExchangeEvent {
  exchangeId: string;
  eventType: string;
  logEventId?: string;
  oldStatus?: ExchangeStatus | null;
  newStatus?: ExchangeStatus | null;
  occurredAt?: Date;
  attemptId?: string | null;
  detail?: JsonValue;
}

function getDatabase() {
  if (!middlewareDatabase.db) throw new Error("MIDDLEWARE_DATABASE_URL is not configured");
  return middlewareDatabase.db;
}

/**
 * Atomically persist RECEIVED + one receipt event, returning only after COMMIT.
 * PostgreSQL UNIQUE arbitration waits for concurrent writers. A fresh SELECT
 * under READ COMMITTED then sees committed winners on EITHER business key.
 * DO NOTHING never resets a winner or appends another receipt on retry.
 * An unrelated exchange UUID collision (or concurrent deletion) throws rather
 * than claiming acceptance. All other database errors propagate and roll back.
 */
export async function createExchange(input: NewExchange): Promise<PersistExchangeResult> {
  const envelope = input.sourceEnvelope;
  return getDatabase().transaction(async (tx) => {
    const [created] = await tx.insert(exchangeTransactions).values({
      exchangeId: input.exchangeId ?? randomUUID(),
      eventId: envelope.event_id,
      sourceSystem: envelope.source_system,
      sourceResultId: envelope.source_result_id,
      sourcePayload: envelope,
      sourceHash: envelope.source_hash,
      // Avoid JS Date truncation when the validated API instant has microseconds.
      publishedAt: sql`${envelope.published_at}::timestamptz`,
      status: "RECEIVED",
      // received_at is the database clock; receipt uses exactly the same instant.
    }).onConflictDoNothing().returning();
    if (created) {
      await tx.insert(exchangeEvents).values({
        logEventId: randomUUID(), exchangeId: created.exchangeId,
        eventType: "RECEIVED", oldStatus: null, newStatus: "RECEIVED",
        // Select the stored timestamp inside PostgreSQL to retain microseconds.
        occurredAt: sql`(select ${exchangeTransactions.receivedAt} from ${exchangeTransactions}
          where ${exchangeTransactions.exchangeId} = ${created.exchangeId})`,
      });
      return { kind: "created", transaction: created };
    }

    const eventMatch = eq(exchangeTransactions.eventId, envelope.event_id);
    const sourceMatch = and(
      eq(exchangeTransactions.sourceSystem, envelope.source_system),
      eq(exchangeTransactions.sourceResultId, envelope.source_result_id),
    );
    const candidates = await tx.select({
      transaction: exchangeTransactions,
      eventMatch: sql<boolean>`${eventMatch}`,
      sourceMatch: sql<boolean>`${sourceMatch}`,
      contentMatch: sql<boolean>`${exchangeTransactions.sourcePayload} = ${JSON.stringify(envelope)}::jsonb
        and ${exchangeTransactions.sourceHash} = ${envelope.source_hash}`,
    }).from(exchangeTransactions).where(or(eventMatch, sourceMatch));
    const byEvent = candidates.find((row) => row.eventMatch);
    const bySource = candidates.find((row) => row.sourceMatch);
    if (!byEvent && !bySource) {
      throw new Error("Exchange UUID collision or conflicting exchange is no longer available");
    }
    if (byEvent && bySource && byEvent.transaction.exchangeId === bySource.transaction.exchangeId) {
      if (byEvent.contentMatch) return { kind: "existing", transaction: byEvent.transaction };
      return {
        kind: "conflict", reason: "content",
        byEventId: byEvent.transaction, bySourceResult: bySource.transaction,
      };
    }
    return {
      kind: "conflict", reason: "identifiers",
      byEventId: byEvent?.transaction, bySourceResult: bySource?.transaction,
    };
  }, { isolationLevel: "read committed" });
}

/** Detail reads return undefined when missing; never update the stored row. */
export async function getExchangeById(exchangeId: string): Promise<ExchangeTransaction | undefined> {
  const [row] = await getDatabase().select().from(exchangeTransactions)
    .where(eq(exchangeTransactions.exchangeId, exchangeId));
  return row;
}

export async function getExchangeByEventId(eventId: string): Promise<ExchangeTransaction | undefined> {
  const [row] = await getDatabase().select().from(exchangeTransactions)
    .where(eq(exchangeTransactions.eventId, eventId));
  return row;
}

export async function getExchangeBySourceResult(
  sourceSystem: string, sourceResultId: string,
): Promise<ExchangeTransaction | undefined> {
  const [row] = await getDatabase().select().from(exchangeTransactions).where(and(
    eq(exchangeTransactions.sourceSystem, sourceSystem),
    eq(exchangeTransactions.sourceResultId, sourceResultId),
  ));
  return row;
}

/** AND filters; newest received_at first, then unique exchange_id ascending. */
export async function listExchanges(options: ListExchangesOptions = {}): Promise<ExchangeTransaction[]> {
  return getDatabase().select().from(exchangeTransactions).where(and(
    options.status === undefined ? undefined : eq(exchangeTransactions.status, options.status),
    options.sourceResultId === undefined ? undefined : eq(exchangeTransactions.sourceResultId, options.sourceResultId),
  )).orderBy(desc(exchangeTransactions.receivedAt), asc(exchangeTransactions.exchangeId))
    .limit(options.limit ?? 20).offset(options.offset ?? 0);
}

/** Oldest occurred_at first, then unique log_event_id ascending for ties. */
export async function getExchangeEvents(exchangeId: string): Promise<ExchangeEvent[]> {
  return getDatabase().select().from(exchangeEvents).where(eq(exchangeEvents.exchangeId, exchangeId))
    .orderBy(asc(exchangeEvents.occurredAt), asc(exchangeEvents.logEventId));
}

/** Append one audit event only; this does NOT transition transaction status. */
export async function appendExchangeEvent(input: NewExchangeEvent): Promise<ExchangeEvent> {
  const [event] = await getDatabase().insert(exchangeEvents).values({
    ...input, logEventId: input.logEventId ?? randomUUID(),
  }).returning();
  return event;
}

/** Optional phase filter; oldest started_at, then unique attempt_id for ties. */
export async function getExchangeAttempts(
  exchangeId: string, phase?: AttemptPhase,
): Promise<ExchangeAttempt[]> {
  return getDatabase().select().from(exchangeAttempts).where(and(
    eq(exchangeAttempts.exchangeId, exchangeId),
    phase === undefined ? undefined : eq(exchangeAttempts.phase, phase),
  )).orderBy(asc(exchangeAttempts.startedAt), asc(exchangeAttempts.attemptId));
}

// B4B: short database transactions only; never hold a row lock during HTTP.
export interface WorkerLease { exchangeId: string; leaseToken: string }
export type WorkerErrorCode = "INVALID_SOURCE" | "MAPPING_UNSUPPORTED" | "PAYLOAD_INTEGRITY"
  | "STORAGE_RECEIPT_MISSING" | "DUPLICATE_CONFLICT" | "REMOTE_VALIDATION_ERROR"
  | "HTTP_TEMPORARY" | "HTTP_PERMANENT" | "HTTP_TIMEOUT" | "NETWORK_ERROR"
  | "INVALID_STORAGE_RESPONSE" | "INVALID_VERIFY_RESPONSE" | "VERIFY_MISMATCH";
export type AttemptResult = {
  httpStatus?: number;
} & (
  | { kind: "stored"; receipt: import("./worker-verification.js").StorageReceipt }
  | { kind: "delivered" }
  | { kind: "retry"; code: WorkerErrorCode; delayMs: number | null }
  | { kind: "terminal"; code: WorkerErrorCode; status: "REJECTED" | "FAILED"; fields?: string[] }
);
type WorkerTx = Parameters<Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]>[0];
const clock = sql`clock_timestamp()`;
const transactions = exchangeTransactions;
const attempts = exchangeAttempts;
const events = exchangeEvents;

async function workerTransaction<T>(fn: (tx: WorkerTx) => Promise<T>): Promise<T> {
  return getDatabase().transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout = '5s'`);
    await tx.execute(sql`set local lock_timeout = '1s'`);
    return fn(tx);
  }, { isolationLevel: "read committed" });
}
async function owned(tx: WorkerTx, lease: WorkerLease): Promise<ExchangeTransaction | undefined> {
  const [row] = await tx.select().from(transactions).where(and(
    eq(transactions.exchangeId, lease.exchangeId), eq(transactions.leaseToken, lease.leaseToken),
    sql`${transactions.status} in ('PROCESSING', 'VERIFYING')`,
  )).for("update");
  if (!row) return undefined;
  // Fresh server-clock check AFTER obtaining the lock (including any wait).
  const [valid] = await tx.select({ id: transactions.exchangeId }).from(transactions)
    .where(and(eq(transactions.exchangeId, row.exchangeId), sql`${transactions.leaseUntil} > ${clock}`));
  return valid ? row : undefined;
}
async function workerEvent(tx: WorkerTx, row: ExchangeTransaction, eventType: string,
  newStatus: string, attemptId: string | null = null, detail: unknown = null): Promise<void> {
  await tx.insert(events).values({ logEventId: randomUUID(), exchangeId: row.exchangeId,
    eventType, oldStatus: row.status, newStatus, attemptId, detail });
}
const release = { leaseUntil: null, leaseToken: null, retryPhase: null, nextRetryAt: null };

/** SKIP LOCKED permits several processes; only due/nonterminal rows are eligible. */
export async function claimExchange(leaseMs: number): Promise<ExchangeTransaction | undefined> {
  return workerTransaction(async (tx) => {
    const [row] = await tx.select().from(transactions).where(sql`
      (${transactions.leaseUntil} is null or ${transactions.leaseUntil} <= ${clock}) and (
        ${transactions.status} = 'RECEIVED'
        or (${transactions.status} = 'RETRY_WAIT' and ${transactions.nextRetryAt} <= ${clock})
        or ${transactions.status} in ('PROCESSING', 'VERIFYING')
      )`).orderBy(asc(transactions.receivedAt), asc(transactions.exchangeId))
      .limit(1).for("update", { skipLocked: true });
    if (!row) return undefined;
    const phase = row.status === "VERIFYING" || (row.status === "RETRY_WAIT" && row.retryPhase === "VERIFY") ? "VERIFY" : "SEND";
    const status = phase === "VERIFY" ? "VERIFYING" : "PROCESSING";
    const abandoned = await tx.update(attempts).set({ endedAt: clock, errorCode: "LEASE_EXPIRED",
      errorMessage: "The worker lease expired; the remote outcome may be unknown.", responseBody: { outcome: "ABANDONED" } })
      .where(and(eq(attempts.exchangeId, row.exchangeId), sql`${attempts.endedAt} is null`)).returning();
    for (const attempt of abandoned) await workerEvent(tx, row, "ATTEMPT_ABANDONED", row.status,
      attempt.attemptId, { phase: attempt.phase, outcome: "ABANDONED", code: "LEASE_EXPIRED" });
    const [claimed] = await tx.update(transactions).set({ status, retryPhase: null, nextRetryAt: null,
      leaseToken: randomUUID(), leaseUntil: sql`${clock} + ${leaseMs} * interval '1 millisecond'` })
      .where(eq(transactions.exchangeId, row.exchangeId)).returning();
    await workerEvent(tx, row, row.status === "PROCESSING" || row.status === "VERIFYING" ? "LEASE_RECOVERED" : "CLAIMED", status);
    return claimed;
  });
}

/** The original mapped JSON is immutable across retries, including new processes. */
export async function saveExchangeMapping(lease: WorkerLease, mapping: {
  observation: import("./mapper.js").FhirR4LabObservation; payloadHash: string; mappingVersion: string;
}): Promise<ExchangeTransaction | undefined> {
  return workerTransaction(async (tx) => {
    const row = await owned(tx, lease);
    if (!row || row.status !== "PROCESSING" || row.fhirPayload !== null) return undefined;
    const [saved] = await tx.update(transactions).set({ fhirPayload: mapping.observation,
      payloadHash: mapping.payloadHash, mappingVersion: mapping.mappingVersion,
      patientIdentifier: mapping.observation.subject.identifier,
      validatedAt: sql`statement_timestamp()`, mappingStartedAt: sql`statement_timestamp()`, transformedAt: sql`statement_timestamp()` })
      .where(eq(transactions.exchangeId, row.exchangeId)).returning();
    await workerEvent(tx, row, "VALIDATED", row.status);
    await workerEvent(tx, row, "TRANSFORMED", row.status);
    return saved;
  });
}

/** Reserve the attempt before I/O. A crash consumes its number and retry budget. */
export async function beginExchangeAttempt(lease: WorkerLease, phase: AttemptPhase, leaseMs: number,
  maxAttempts: number): Promise<{ transaction: ExchangeTransaction; attempt: ExchangeAttempt } | undefined> {
  return workerTransaction(async (tx) => {
    const row = await owned(tx, lease);
    if (!row || row.status !== (phase === "SEND" ? "PROCESSING" : "VERIFYING")) return undefined;
    const [active] = await tx.select({ id: attempts.attemptId }).from(attempts)
      .where(and(eq(attempts.exchangeId, row.exchangeId), sql`${attempts.endedAt} is null`));
    if (active) return undefined;
    const count = phase === "SEND" ? row.sendAttemptCount : row.verifyAttemptCount;
    if (count >= maxAttempts) {
      await tx.update(transactions).set({ ...release, status: "FAILED" }).where(eq(transactions.exchangeId, row.exchangeId));
      await workerEvent(tx, row, "RETRY_EXHAUSTED", "FAILED", null, { phase, code: "RETRY_EXHAUSTED" });
      return undefined;
    }
    const [updated] = await tx.update(transactions).set({
      ...(phase === "SEND" ? { sendAttemptCount: count + 1, firstSentAt: sql`coalesce(${transactions.firstSentAt}, ${clock})` }
        : { verifyAttemptCount: count + 1 }),
      leaseUntil: sql`${clock} + ${leaseMs} * interval '1 millisecond'`,
    }).where(eq(transactions.exchangeId, row.exchangeId)).returning();
    const [attempt] = await tx.insert(attempts).values({ attemptId: randomUUID(), exchangeId: row.exchangeId,
      phase, attemptNo: count + 1, startedAt: sql`statement_timestamp()`, sentAt: sql`statement_timestamp()` }).returning();
    await workerEvent(tx, row, phase === "SEND" ? "SENT" : "VERIFY_STARTED", row.status, attempt.attemptId,
      { phase, attempt_no: count + 1, outcome: "STARTED" });
    return { transaction: updated, attempt };
  });
}

/** Finish attempt + transition + event in ONE commit, fenced against stale owners. */
export async function finishExchangeAttempt(lease: WorkerLease, attemptId: string, result: AttemptResult): Promise<boolean> {
  return workerTransaction(async (tx) => {
    const row = await owned(tx, lease);
    if (!row) return false;
    const [attempt] = await tx.select().from(attempts).where(and(eq(attempts.attemptId, attemptId),
      eq(attempts.exchangeId, row.exchangeId), sql`${attempts.endedAt} is null`));
    if (!attempt || row.status !== (attempt.phase === "SEND" ? "PROCESSING" : "VERIFYING")
      || (result.kind === "stored" && attempt.phase !== "SEND")
      || (result.kind === "delivered" && (attempt.phase !== "VERIFY" || !row.targetStoredAt))) return false;
    const code = result.kind === "retry" || result.kind === "terminal" ? result.code : null;
    await tx.update(attempts).set({ endedAt: clock, responseAt: result.httpStatus === undefined ? null : clock,
      httpStatus: result.httpStatus ?? null, responseBody: result.kind === "stored" ? result.receipt : { outcome: result.kind },
      errorCode: code, errorMessage: code === null ? null : "The exchange attempt did not complete successfully." })
      .where(eq(attempts.attemptId, attemptId));
    let status: ExchangeStatus; let eventType: string;
    if (result.kind === "stored") {
      status = "VERIFYING"; eventType = "TARGET_STORED";
      await tx.update(transactions).set({ status, targetStoredAt: clock, retryPhase: null, nextRetryAt: null })
        .where(eq(transactions.exchangeId, row.exchangeId));
    } else if (result.kind === "delivered") {
      status = "DELIVERED"; eventType = "DELIVERED";
      await tx.update(transactions).set({ ...release, status, verifiedAt: sql`statement_timestamp()`, completedAt: sql`statement_timestamp()` })
        .where(eq(transactions.exchangeId, row.exchangeId));
    } else if (result.kind === "retry" && result.delayMs !== null) {
      status = "RETRY_WAIT"; eventType = "RETRY_SCHEDULED";
      await tx.update(transactions).set({ ...release, status, retryPhase: attempt.phase,
        nextRetryAt: sql`${clock} + ${result.delayMs} * interval '1 millisecond'` })
        .where(eq(transactions.exchangeId, row.exchangeId));
    } else {
      status = result.kind === "terminal" ? result.status : "FAILED";
      eventType = result.kind === "retry" ? "RETRY_EXHAUSTED" : result.code === "VERIFY_MISMATCH" ? "VERIFY_MISMATCH" : status;
      await tx.update(transactions).set({ ...release, status }).where(eq(transactions.exchangeId, row.exchangeId));
    }
    await workerEvent(tx, row, eventType, status, attemptId, { phase: attempt.phase, outcome: result.kind, code,
      ...(result.kind === "terminal" && result.fields ? { fields: result.fields } : {}) });
    return true;
  });
}

/** Used for pre-HTTP invalid snapshots, corrupt mapped JSON or missing receipts. */
export async function failExchange(lease: WorkerLease, status: "REJECTED" | "FAILED", code: WorkerErrorCode): Promise<boolean> {
  return workerTransaction(async (tx) => {
    const row = await owned(tx, lease);
    if (!row) return false;
    await tx.update(transactions).set({ ...release, status }).where(eq(transactions.exchangeId, row.exchangeId));
    await workerEvent(tx, row, status, status, null, { code });
    return true;
  });
}

/** Receipt survived the same commit that set VERIFYING; never infer it from HTTP alone. */
export async function getConfirmedStorage(lease: WorkerLease): Promise<{ httpStatus: number; body: unknown } | undefined> {
  return workerTransaction(async (tx) => {
    const row = await owned(tx, lease);
    if (!row || row.status !== "VERIFYING" || !row.targetStoredAt) return undefined;
    const [attempt] = await tx.select().from(attempts).where(and(eq(attempts.exchangeId, row.exchangeId),
      eq(attempts.phase, "SEND"), sql`${attempts.errorCode} is null and ${attempts.endedAt} is not null`,
      sql`${attempts.httpStatus} in (200, 201)`)).orderBy(desc(attempts.attemptNo)).limit(1);
    return attempt?.httpStatus ? { httpStatus: attempt.httpStatus, body: attempt.responseBody } : undefined;
  });
}
