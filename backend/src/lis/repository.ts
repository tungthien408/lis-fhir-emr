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
import { and, asc, eq, sql } from "drizzle-orm";
import { lisDatabase } from "./db.js";
import { patients, publishEvents, results, testCatalog } from "./schema.js";

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
