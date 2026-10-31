/**
 * Lớp truy cập dữ liệu của LIS cho kết quả xét nghiệm và Publish (SPP-66 A1–A3).
 * Dùng kết nối lisDatabase và Drizzle ORM hiện có, chỉ truy vấn schema lis.
 *
 * Chức năng chính:
 * - Đọc một kết quả theo resultId, kèm thông tin bệnh nhân và catalog xét nghiệm.
 * - Liệt kê kết quả với bộ lọc patientId, testCode, resultStatus và phân trang
 *   limit/offset; sắp xếp theo resultId để thứ tự phân trang ổn định.
 * - Tra sự kiện Publish đã lưu theo resultId hoặc eventId.
 * - Lưu đồng thời UUID, snapshot, hash, thời điểm Publish và trạng thái PENDING
 *   trong transaction READ COMMITTED; chỉ trả thành công sau khi commit.
 * - Kết hợp UNIQUE(result_id) với ON CONFLICT DO NOTHING để chống tạo sự kiện
 *   trùng khi Publish lặp hoặc đồng thời. Request thua đọc lại sự kiện đã lưu,
 *   không ghi đè snapshot, hash, UUID, thời điểm hoặc trạng thái cũ.
 *
 * Quy ước trả về: truy vấn chi tiết không tìm thấy trả undefined; danh sách
 * không có kết quả trả mảng rỗng; lưu Publish trả { event, created } để caller
 * phân biệt tạo mới và tái sử dụng. Lỗi database được truyền lên lớp gọi;
 * transaction lưu Publish rollback khi có lỗi. NUMERIC giữ dạng chuỗi và
 * timestamp dùng Date theo schema Drizzle, không tự làm tròn giá trị xét nghiệm.
 *
 * Service ở A2 chịu trách nhiệm validation, tạo UUID, snapshot và hash. Luồng
 * Publish dùng withPublishTransaction để đọc nguồn dưới khóa SHARE và chuẩn bị,
 * lưu sự kiện trong cùng transaction. createPublishEvent của A1 vẫn là hàm lưu
 * dữ liệu đã chuẩn bị, không tự khóa nguồn. Repository không xử lý HTTP hoặc
 * gửi dữ liệu sang Middleware/EMR.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { lisDatabase } from "./db.js";
import { dispatchAttempts, patients, publishEvents, results, testCatalog } from "./schema.js";

export type ResultStatus = "READY" | "FINAL";

export interface ResultWithDetails {
  result: typeof results.$inferSelect;
  patient: typeof patients.$inferSelect;
  test: typeof testCatalog.$inferSelect;
  /** UTC text preserves PostgreSQL microseconds for both HTTP reads and Publish. */
  effectiveAtIso: string | null;
}

export interface ListResultsOptions {
  patientId?: string;
  testCode?: string;
  resultStatus?: ResultStatus;
  /** Controller validates pagination: limit 1–100, offset >= 0. */
  limit?: number;
  offset?: number;
}

export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };
export type PublishEvent = typeof publishEvents.$inferSelect;

/** Prepared by A2: validation, UUID generation, snapshot construction and hashing. */
export interface NewPublishEvent {
  eventId: string;
  resultId: string;
  sourceSystem: string;
  sourceSnapshot: JsonObject;
  sourceHash: string;
  publishedAt: Date;
}

export interface PersistPublishEventResult {
  event: PublishEvent;
  created: boolean;
}

export type PublishResultState = ResultWithDetails;

/** All operations are bound to one result ID and one Repository-owned transaction. */
export interface PublishTransactionRepository {
  getPublishEvent(): Promise<PublishEvent | undefined>;
  getResult(): Promise<PublishResultState | undefined>;
  createPublishEvent(input: Omit<NewPublishEvent, "resultId">): Promise<PersistPublishEventResult>;
}

type DatabaseTransaction = Parameters<
  Parameters<NonNullable<typeof lisDatabase.db>["transaction"]>[0]
>[0];

function getDatabase() {
  if (!lisDatabase.db) {
    throw new Error("LIS_DATABASE_URL is not configured");
  }
  return lisDatabase.db;
}

const resultSelection = {
  result: results, patient: patients, test: testCatalog,
  effectiveAtIso: sql<string | null>`case
    when isfinite(${results.effectiveAt})
      and extract(year from ${results.effectiveAt} at time zone 'UTC') between 1 and 9999
    then to_char(${results.effectiveAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    else null end`,
};

/** NUMERIC fields remain strings; the Repository never rounds clinical values. */
export async function getResultById(resultId: string): Promise<ResultWithDetails | undefined> {
  const [row] = await getDatabase()
    .select(resultSelection)
    .from(results)
    .innerJoin(patients, eq(results.patientId, patients.patientId))
    .innerJoin(testCatalog, eq(results.testCode, testCatalog.testCode))
    .where(eq(results.resultId, resultId));
  return row;
}

/** Filters are combined with AND; the unique result ID gives deterministic pages. */
export async function listResults(options: ListResultsOptions = {}): Promise<ResultWithDetails[]> {
  return getDatabase()
    .select(resultSelection)
    .from(results)
    .innerJoin(patients, eq(results.patientId, patients.patientId))
    .innerJoin(testCatalog, eq(results.testCode, testCatalog.testCode))
    .where(and(
      options.patientId === undefined ? undefined : eq(results.patientId, options.patientId),
      options.testCode === undefined ? undefined : eq(results.testCode, options.testCode),
      options.resultStatus === undefined ? undefined : eq(results.resultStatus, options.resultStatus),
    ))
    .orderBy(asc(results.resultId))
    .limit(options.limit ?? 20)
    .offset(options.offset ?? 0);
}

export async function getPublishEventByResultId(resultId: string): Promise<PublishEvent | undefined> {
  const [event] = await getDatabase()
    .select()
    .from(publishEvents)
    .where(eq(publishEvents.resultId, resultId));
  return event;
}

export async function getPublishEventByEventId(eventId: string): Promise<PublishEvent | undefined> {
  const [event] = await getDatabase()
    .select()
    .from(publishEvents)
    .where(eq(publishEvents.eventId, eventId));
  return event;
}

/**
 * Commit the entire first-Publish envelope before returning to A2.
 * Only a result_id conflict is idempotent; FK/UUID/other database errors propagate.
 * This boundary owns its transaction and never updates an existing event.
 */
export async function createPublishEvent(input: NewPublishEvent): Promise<PersistPublishEventResult> {
  return getDatabase().transaction((tx) => persistPublishEvent(tx, input), {
    isolationLevel: "read committed",
  });
}

async function persistPublishEvent(
  tx: DatabaseTransaction,
  input: NewPublishEvent,
): Promise<PersistPublishEventResult> {
  const [existing] = await tx.select().from(publishEvents)
    .where(eq(publishEvents.resultId, input.resultId));
  if (existing) return { event: existing, created: false };

  const [created] = await tx.insert(publishEvents).values({
    eventId: input.eventId,
    resultId: input.resultId,
    sourceSystem: input.sourceSystem,
    sourceSnapshot: input.sourceSnapshot,
    sourceHash: input.sourceHash,
    publishedAt: input.publishedAt,
    dispatchStatus: "PENDING",
  }).onConflictDoNothing({ target: publishEvents.resultId }).returning();
  if (created) return { event: created, created: true };

  // The competing INSERT can be invisible to our INSERT's statement snapshot.
  // A separate SELECT at READ COMMITTED sees it after ON CONFLICT has waited.
  const [winner] = await tx.select().from(publishEvents)
    .where(eq(publishEvents.resultId, input.resultId));
  if (!winner) {
    // Concurrent deletion is outside the Publish workflow; never report success
    // with an event that was not actually read or persisted.
    throw new Error("Conflicting LIS publish event is no longer available");
  }
  return { event: winner, created: false };
}

/**
 * A2 boundary: Service validation and snapshot construction run while source rows
 * are locked, and the event is committed by the same transaction. SHARE locks
 * block source UPDATE/DELETE but allow concurrent Publishers to read each other.
 */
export async function withPublishTransaction<T>(
  resultId: string,
  operation: (repository: PublishTransactionRepository) => Promise<T>,
): Promise<T> {
  return getDatabase().transaction(async (tx) => operation({
    async getPublishEvent() {
      const [event] = await tx.select().from(publishEvents)
        .where(eq(publishEvents.resultId, resultId));
      return event;
    },
    async getResult() {
      // FOR SHARE locks the result, patient and catalog rows until commit/rollback.
      const [locked] = await tx.select({ resultId: results.resultId }).from(results)
        .innerJoin(patients, eq(results.patientId, patients.patientId))
        .innerJoin(testCatalog, eq(results.testCode, testCatalog.testCode))
        .where(eq(results.resultId, resultId)).for("share");
      if (!locked) return undefined;

      // A fresh statement sees changes that committed while we waited for locks.
      // Read timestamp text in UTC so PostgreSQL's microseconds survive JS Date.
      const [state] = await tx.select(resultSelection).from(results)
        .innerJoin(patients, eq(results.patientId, patients.patientId))
        .innerJoin(testCatalog, eq(results.testCode, testCatalog.testCode))
        .where(eq(results.resultId, resultId));
      return state;
    },
    createPublishEvent(input) {
      return persistPublishEvent(tx, { ...input, resultId });
    },
  }), { isolationLevel: "read committed" });
}

// D1: persistence for a future Dispatcher. No HTTP, retry policy or background loop.
export interface DispatchLease { eventId: string; leaseToken: string }
export type DispatchAttempt = typeof dispatchAttempts.$inferSelect;
export interface DispatchAcknowledgement {
  accepted: true;
  event_id: string;
  exchange_id: string;
  source_system: string;
  source_result_id: string;
  source_hash: string;
}
export type DispatchErrorCode = "NETWORK_ERROR" | "HTTP_TIMEOUT" | "HTTP_TEMPORARY" | "HTTP_PERMANENT"
  | "INVALID_ACK" | "DUPLICATE_CONFLICT" | "REMOTE_VALIDATION_ERROR" | "VALIDATION_ERROR";
export type DispatchAttemptResult =
  | { kind: "ack"; httpStatus: 202; acknowledgement: DispatchAcknowledgement }
  | { kind: "retry"; httpStatus?: number; code: DispatchErrorCode; delayMs: number }
  | { kind: "terminal"; httpStatus?: number; code: DispatchErrorCode; status: "BLOCKED" | "FAILED" };
export type BeginDispatchAttemptOutcome =
  | { kind: "started"; event: PublishEvent; attempt: DispatchAttempt }
  | { kind: "stale_lease" | "attempt_active" | "exhausted" };
export type CompleteDispatchAttemptOutcome =
  "completed" | "stale_lease" | "attempt_not_active" | "attempt_not_sent" | "invalid_ack";

const dispatchClock = sql`clock_timestamp()`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dispatchFailureMessage = "The dispatch attempt did not complete successfully.";
const dispatchRelease = { leaseToken: null, leaseUntil: null, nextRetryAt: null };
const dispatchErrorCodes = new Set<DispatchErrorCode>(["NETWORK_ERROR", "HTTP_TIMEOUT", "HTTP_TEMPORARY",
  "HTTP_PERMANENT", "INVALID_ACK", "DUPLICATE_CONFLICT", "REMOTE_VALIDATION_ERROR", "VALIDATION_ERROR"]);

/** Internal signal: rollback writes if the lease expires while waiting on a later lock. */
class DispatchLeaseExpired extends Error {}

function boundedInteger(value: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new RangeError("Invalid dispatch persistence bound");
}
function copyDispatchLease(lease: DispatchLease): DispatchLease {
  if (!uuid.test(lease.eventId) || !uuid.test(lease.leaseToken)) throw new TypeError("Invalid dispatcher lease identity");
  return { eventId: lease.eventId.toLowerCase(), leaseToken: lease.leaseToken.toLowerCase() };
}
function liveDispatchLease(lease: DispatchLease) {
  return and(eq(publishEvents.eventId, lease.eventId), eq(publishEvents.leaseToken, lease.leaseToken),
    eq(publishEvents.dispatchStatus, "IN_FLIGHT"), sql`${publishEvents.leaseUntil} > ${dispatchClock}`);
}
async function dispatchTransaction<T>(operation: (tx: DatabaseTransaction) => Promise<T>, stale: T): Promise<T> {
  try {
    return await getDatabase().transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout = '5s'`);
      await tx.execute(sql`set local lock_timeout = '1s'`);
      return operation(tx);
    }, { isolationLevel: "read committed" });
  } catch (error) {
    if (error instanceof DispatchLeaseExpired) return stale;
    throw error; // Database/commit faults are never stale-lease or successful outcomes.
  }
}
async function ownedPublishEvent(tx: DatabaseTransaction, lease: DispatchLease): Promise<PublishEvent | undefined> {
  const [event] = await tx.select().from(publishEvents).where(and(
    eq(publishEvents.eventId, lease.eventId), eq(publishEvents.leaseToken, lease.leaseToken),
    eq(publishEvents.dispatchStatus, "IN_FLIGHT"),
  )).for("update");
  if (!event) return undefined;
  // Fresh database time after any wait to acquire the event lock.
  const [live] = await tx.select({ id: publishEvents.eventId }).from(publishEvents).where(liveDispatchLease(lease));
  return live ? event : undefined;
}
async function requireLiveDispatchLease(tx: DatabaseTransaction, lease: DispatchLease): Promise<void> {
  const [live] = await tx.select({ id: publishEvents.eventId }).from(publishEvents).where(liveDispatchLease(lease));
  if (!live) throw new DispatchLeaseExpired();
}
function requireDispatchWrite(rows: unknown[]): void {
  if (rows.length !== 1) throw new DispatchLeaseExpired();
}

/** Oldest Publish first, UUID for ties; SKIP LOCKED lets other Dispatchers pick other events. */
export async function claimPublishEvent(leaseMs: number): Promise<PublishEvent | undefined> {
  boundedInteger(leaseMs, 3600000);
  return dispatchTransaction(async (tx) => {
    const [event] = await tx.select().from(publishEvents).where(sql`
      (${publishEvents.leaseUntil} is null or ${publishEvents.leaseUntil} <= ${dispatchClock}) and (
        ${publishEvents.dispatchStatus} = 'PENDING'
        or (${publishEvents.dispatchStatus} = 'RETRY_WAIT' and ${publishEvents.nextRetryAt} <= ${dispatchClock})
        or (${publishEvents.dispatchStatus} = 'IN_FLIGHT' and ${publishEvents.leaseUntil} <= ${dispatchClock})
      )`).orderBy(asc(publishEvents.publishedAt), asc(publishEvents.eventId)).limit(1)
      .for("update", { skipLocked: true });
    if (!event) return undefined;
    // An interrupted attempt consumes its number/budget, even if the remote outcome is unknown.
    await tx.update(dispatchAttempts).set({ endedAt: dispatchClock, errorCode: "LEASE_EXPIRED",
      errorMessage: "The dispatch lease expired; the remote outcome is unknown.", responseBody: { outcome: "ABANDONED" } })
      .where(and(eq(dispatchAttempts.eventId, event.eventId), sql`${dispatchAttempts.endedAt} is null`));
    const [claimed] = await tx.update(publishEvents).set({ dispatchStatus: "IN_FLIGHT",
      leaseToken: randomUUID(), leaseUntil: sql`${dispatchClock} + ${leaseMs} * interval '1 millisecond'`, nextRetryAt: null })
      .where(eq(publishEvents.eventId, event.eventId)).returning();
    return claimed;
  }, undefined);
}

/** Reserve before I/O. maxAttempts includes all interrupted attempts; caller owns retry policy. */
export async function beginDispatchAttempt(
  leaseInput: DispatchLease, leaseMs: number, maxAttempts: number,
): Promise<BeginDispatchAttemptOutcome> {
  const lease = copyDispatchLease(leaseInput);
  boundedInteger(leaseMs, 3600000); boundedInteger(maxAttempts, 100);
  return dispatchTransaction<BeginDispatchAttemptOutcome>(async (tx) => {
    const event = await ownedPublishEvent(tx, lease);
    if (!event) return { kind: "stale_lease" };
    const [history] = await tx.select({
      total: sql<number>`count(*)::integer`.mapWith(Number),
      last: sql<number>`coalesce(max(${dispatchAttempts.attemptNo}), 0)`.mapWith(Number),
      active: sql<number>`count(*) filter (where ${dispatchAttempts.endedAt} is null)::integer`.mapWith(Number),
    }).from(dispatchAttempts).where(eq(dispatchAttempts.eventId, event.eventId));
    if (history.total !== event.dispatchAttemptCount || history.last !== history.total) {
      throw new Error("LIS dispatch attempt history is inconsistent");
    }
    if (history.active > 0) return { kind: "attempt_active" };
    if (history.total >= maxAttempts) {
      requireDispatchWrite(await tx.update(publishEvents).set({ ...dispatchRelease, dispatchStatus: "FAILED",
        lastErrorCode: "RETRY_EXHAUSTED", lastErrorMessage: "The dispatch attempt budget was exhausted." })
        .where(liveDispatchLease(lease)).returning({ id: publishEvents.eventId }));
      return { kind: "exhausted" };
    }
    const [updated] = await tx.update(publishEvents).set({ dispatchAttemptCount: history.last + 1,
      leaseUntil: sql`${dispatchClock} + ${leaseMs} * interval '1 millisecond'` })
      .where(liveDispatchLease(lease)).returning();
    requireDispatchWrite(updated ? [updated] : []);
    const [attempt] = await tx.insert(dispatchAttempts).values({ dispatchAttemptId: randomUUID(),
      eventId: event.eventId, attemptNo: history.last + 1, leaseToken: lease.leaseToken, startedAt: dispatchClock }).returning();
    await requireLiveDispatchLease(tx, lease); // INSERT may have waited behind an external lock.
    return { kind: "started", event: updated, attempt };
  }, { kind: "stale_lease" });
}

/** Persist the send boundary immediately before future HTTP I/O; repeated calls keep the first time. */
export async function markDispatchAttemptSent(leaseInput: DispatchLease, attemptId: string): Promise<boolean> {
  const lease = copyDispatchLease(leaseInput);
  return dispatchTransaction(async (tx) => {
    if (!await ownedPublishEvent(tx, lease)) return false;
    const marked = await tx.update(dispatchAttempts)
      .set({ sentAt: sql`coalesce(${dispatchAttempts.sentAt}, ${dispatchClock})` })
      .where(and(eq(dispatchAttempts.dispatchAttemptId, attemptId), eq(dispatchAttempts.eventId, lease.eventId),
        eq(dispatchAttempts.leaseToken, lease.leaseToken), sql`${dispatchAttempts.endedAt} is null`)).returning();
    if (marked.length === 0) return false;
    await requireLiveDispatchLease(tx, lease);
    return true;
  }, false);
}

function copyDispatchResult(result: DispatchAttemptResult): DispatchAttemptResult {
  if (result.httpStatus !== undefined && (!Number.isInteger(result.httpStatus) || result.httpStatus < 100 || result.httpStatus > 599)) {
    throw new RangeError("Invalid dispatch HTTP status");
  }
  if (result.kind === "ack") {
    // Explicit allowlist; never persist arbitrary upstream JSON or clinical payloads as diagnostics.
    const ack = result.acknowledgement;
    return { kind: "ack", httpStatus: result.httpStatus, acknowledgement: { accepted: ack.accepted,
      event_id: ack.event_id, exchange_id: ack.exchange_id, source_system: ack.source_system,
      source_result_id: ack.source_result_id, source_hash: ack.source_hash } };
  }
  if (!dispatchErrorCodes.has(result.code)) throw new TypeError("Invalid dispatch error code");
  if (result.kind === "retry") { boundedInteger(result.delayMs, 86400000); return { ...result }; }
  if (result.kind !== "terminal" || !["BLOCKED", "FAILED"].includes(result.status)) throw new TypeError("Invalid dispatch terminal state");
  return { ...result };
}
function matchingAcknowledgement(result: Extract<DispatchAttemptResult, { kind: "ack" }>, event: PublishEvent): boolean {
  const ack = result.acknowledgement;
  return result.httpStatus === 202 && ack.accepted === true && typeof ack.event_id === "string"
    && ack.event_id.toLowerCase() === event.eventId && typeof ack.exchange_id === "string" && uuid.test(ack.exchange_id)
    && ack.source_system === event.sourceSystem && ack.source_result_id === event.resultId && ack.source_hash === event.sourceHash;
}

/** Complete attempt + outbox state in one commit, with a fresh lease CAS after attempt writes. */
export async function finishDispatchAttempt(
  leaseInput: DispatchLease, attemptId: string, resultInput: DispatchAttemptResult,
): Promise<CompleteDispatchAttemptOutcome> {
  const lease = copyDispatchLease(leaseInput); const result = copyDispatchResult(resultInput);
  return dispatchTransaction<CompleteDispatchAttemptOutcome>(async (tx) => {
    const event = await ownedPublishEvent(tx, lease);
    if (!event) return "stale_lease";
    const [attempt] = await tx.select().from(dispatchAttempts).where(and(
      eq(dispatchAttempts.dispatchAttemptId, attemptId), eq(dispatchAttempts.eventId, lease.eventId),
      eq(dispatchAttempts.leaseToken, lease.leaseToken), sql`${dispatchAttempts.endedAt} is null`,
    )).for("update");
    if (!attempt) return "attempt_not_active";
    if (result.kind === "ack" && !matchingAcknowledgement(result, event)) return "invalid_ack";
    if (result.httpStatus !== undefined && attempt.sentAt === null) return "attempt_not_sent";
    const code = result.kind === "ack" ? null : result.code;
    await tx.update(dispatchAttempts).set({ endedAt: dispatchClock,
      responseAt: result.httpStatus === undefined ? null : dispatchClock, httpStatus: result.httpStatus ?? null,
      responseBody: result.kind === "ack" ? result.acknowledgement : { outcome: result.kind, code },
      errorCode: code, errorMessage: code === null ? null : dispatchFailureMessage,
    }).where(eq(dispatchAttempts.dispatchAttemptId, attempt.dispatchAttemptId));
    const completion = result.kind === "ack"
      ? { ...dispatchRelease, dispatchStatus: "ACK", exchangeId: result.acknowledgement.exchange_id,
          ackedAt: dispatchClock, ackResponse: result.acknowledgement, lastErrorCode: null, lastErrorMessage: null }
      : { ...dispatchRelease, dispatchStatus: result.kind === "retry" ? "RETRY_WAIT" : result.status,
          nextRetryAt: result.kind === "retry" ? sql`${dispatchClock} + ${result.delayMs} * interval '1 millisecond'` : null,
          lastErrorCode: code, lastErrorMessage: dispatchFailureMessage };
    // If an attempt-row lock delayed us past expiry, this rejects and rolls back BOTH updates.
    requireDispatchWrite(await tx.update(publishEvents).set(completion)
      .where(liveDispatchLease(lease)).returning({ id: publishEvents.eventId }));
    return "completed";
  }, "stale_lease");
}

/** Durable history; no payload reconstruction or querying a different service. */
export async function getDispatchAttempts(eventId: string): Promise<DispatchAttempt[]> {
  return getDatabase().select().from(dispatchAttempts).where(eq(dispatchAttempts.eventId, eventId))
    .orderBy(asc(dispatchAttempts.attemptNo));
}
