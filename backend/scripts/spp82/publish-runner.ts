/**
 * SPP-82-A: Công cụ phát hành tải chính — gọi POST /api/results/:resultId/publish
 * qua HTTP API LIS thực tế với hàng đợi bounded concurrency.
 *
 * =============================================================================
 * LƯU Ý QUAN TRỌNG VỀ PHẠM VI SPP-82-A:
 * =============================================================================
 * - "Publish" chỉ nghĩa là LIS đã LƯU yêu cầu gửi (publish_events).
 * - HTTP 202 = sự kiện Publish MỚI được tạo (PENDING).
 * - HTTP 200 = sự kiện Publish CŨ đã tồn tại (idempotent).
 * - Cả hai đều CHƯA có nghĩa là kết quả đã đến EMR.
 * - Luồng tiếp theo: Dispatcher → Middleware → Worker → EMR (thuộc SPP-82-B).
 *
 * Concurrency trong SPP-82-A = số Publish HTTP request đang in-flight.
 * Đây là publish-only concurrency, không phải end-to-end.
 *
 * Không có Promise.all([...1000 requests]). Dùng hàng đợi giới hạn.
 * Hỗ trợ graceful shutdown qua AbortSignal.
 * =============================================================================
 */
import { writeFile } from "node:fs/promises";
import type { EligibleResult } from "./load-fixtures.js";
import type { LoadConfig } from "./load-config.js";

// ---------------------------------------------------------------------------
// Kiểu dữ liệu output
// ---------------------------------------------------------------------------

/** Kết quả raw của một lần gọi Publish — quan sát, không phải kết luận. */
export interface PublishRecord {
  /** Định danh thử nghiệm cho lần chạy này. */
  runId: string;
  /** Mã định danh kết quả LIS. */
  resultId: string;
  /** Thời điểm bắt đầu gửi request (ISO 8601). */
  requestStartedAt: string;
  /** Thời điểm nhận response (ISO 8601) hoặc null nếu timeout/lỗi mạng. */
  responseReceivedAt: string | null;
  /** HTTP status code hoặc null nếu không nhận được response. */
  httpStatus: number | null;
  /**
   * event_id từ body response (UUID); null nếu không có hoặc lỗi.
   * Đây là ID của Publish event trong LIS, không phải ID của kết quả ở EMR.
   */
  eventId: string | null;
  /**
   * Kết quả Publish:
   *   "NEW"      = HTTP 202, sự kiện Publish mới được tạo
   *   "EXISTING" = HTTP 200, sự kiện Publish cũ đã tồn tại (idempotent)
   *   "ERROR"    = HTTP khác (4xx/5xx) hoặc lỗi mạng
   * Lưu ý: "NEW" và "EXISTING" đều CHƯA có nghĩa là DELIVERED.
   */
  publishOutcome: "NEW" | "EXISTING" | "ERROR";
  /**
   * Mã lỗi nếu có:
   *   "HTTP_TIMEOUT"    = request bị hủy do timeout
   *   "NETWORK_ERROR"   = lỗi kết nối mạng
   *   "HTTP_<status>"   = lỗi HTTP (vd: HTTP_404, HTTP_422)
   *   null              = không có lỗi
   */
  errorCode: string | null;
}

/** Tóm tắt sau khi hoàn thành toàn bộ workload. */
export interface RunSummary {
  runId: string;
  mode: string;
  concurrency: number;
  totalScheduled: number;
  completed: number;
  newPublications: number;
  existingPublications: number;
  errors: number;
  wasCancelled: boolean;
  /** Chú ý: đây là thời gian phát hành, không phải thời gian giao đến EMR. */
  publishOnlyNote: string;
}

// ---------------------------------------------------------------------------
// HTTP client nội bộ
// ---------------------------------------------------------------------------

/** Kết quả HTTP nội bộ (export để test có thể implement PublishRunnerDependencies). */
export interface HttpOutcome {
  status: number | null;
  eventId: string | null;
  errorCode: string | null;
  receivedAt: string | null;
}

/**
 * Gửi một Publish request và trả kết quả nội bộ.
 * Bounded timeout; không retry (retry là trách nhiệm của Dispatcher).
 * Không lộ dữ liệu lâm sàng trong log lỗi.
 */
export async function sendPublishRequest(
  lisBaseUrl: string,
  resultId: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<HttpOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  const combined = signal
    ? AbortSignal.any([controller.signal, signal])
    : controller.signal;

  try {
    const url = `${lisBaseUrl}/api/results/${encodeURIComponent(resultId)}/publish`;
    const response = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json" },
      redirect: "manual",
      signal: combined,
    });
    const receivedAt = new Date().toISOString();
    const status = response.status;

    // Chỉ parse body khi status là 200 hoặc 202 (cần lấy event_id).
    if (status === 202 || status === 200) {
      try {
        const body = await response.json() as Record<string, unknown>;
        const eventId =
          typeof body.event_id === "string" ? body.event_id : null;
        return { status, eventId, errorCode: null, receivedAt };
      } catch {
        await response.body?.cancel();
        return { status, eventId: null, errorCode: null, receivedAt };
      }
    }

    await response.body?.cancel();
    return {
      status,
      eventId: null,
      errorCode: `HTTP_${status}`,
      receivedAt,
    };
  } catch (error: unknown) {
    const isTimeout =
      controller.signal.reason === "timeout" ||
      (error instanceof Error && error.name === "AbortError" && !signal?.aborted);
    const isShutdown = signal?.aborted === true;
    return {
      status: null,
      eventId: null,
      errorCode: isShutdown
        ? "SHUTDOWN"
        : isTimeout
          ? "HTTP_TIMEOUT"
          : "NETWORK_ERROR",
      receivedAt: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Hàng đợi bounded concurrency
// ---------------------------------------------------------------------------

/**
 * Chạy các hàm async với giới hạn N in-flight đồng thời.
 * Không dùng Promise.all([...1000 items]) — thay vào đó dùng semaphore.
 *
 * Thiết kế:
 *   - Mỗi slot đại diện cho một Publish in-flight.
 *   - Khi hết slot, đợi slot trống trước khi bắt đầu task mới.
 *   - Hỗ trợ abort: khi signal.aborted, không schedule thêm task mới.
 *   - onResult được gọi theo thứ tự hoàn thành (không theo thứ tự submit).
 *
 * @param tasks       Mảng hàm async tạo ra giá trị T.
 * @param concurrency Số in-flight tối đa.
 * @param onResult    Callback sau mỗi task hoàn thành.
 * @param signal      AbortSignal để dừng sớm.
 */
async function runWithBoundedConcurrency<T>(
  tasks: readonly (() => Promise<T>)[],
  concurrency: number,
  onResult: (result: T, index: number) => void,
  signal?: AbortSignal,
): Promise<{ completed: number; cancelled: boolean }> {
  let taskIndex = 0;
  let completed = 0;
  let cancelled = false;
  const inFlight = new Set<Promise<void>>();

  async function scheduleNext(): Promise<void> {
    if (signal?.aborted || taskIndex >= tasks.length) return;

    const currentIndex = taskIndex++;
    const task = tasks[currentIndex];

    const promise: Promise<void> = task().then((result) => {
      inFlight.delete(promise);
      onResult(result, currentIndex);
      completed++;
    });
    inFlight.add(promise);
  }

  // Seed ban đầu: điền đủ slot.
  while (!signal?.aborted && taskIndex < tasks.length && inFlight.size < concurrency) {
    await scheduleNext();
  }

  // Loop: khi một task xong, bắt đầu task tiếp theo nếu còn.
  while (inFlight.size > 0) {
    if (signal?.aborted) {
      cancelled = true;
      break;
    }
    await Promise.race(inFlight);
    // Điền slot trống sau khi một task hoàn thành.
    while (inFlight.size < concurrency && taskIndex < tasks.length) {
      if (signal?.aborted) break;
      await scheduleNext();
    }
  }

  // Drain cancelled HTTP work before returning: no late records after final artifacts.
  await Promise.all(inFlight);
  return { completed, cancelled: cancelled || signal?.aborted === true };
}

// ---------------------------------------------------------------------------
// Giao diện phụ thuộc (để mock trong test)
// ---------------------------------------------------------------------------

/** Phụ thuộc có thể được mock trong unit test. */
export interface PublishRunnerDependencies {
  sendPublish: (
    lisBaseUrl: string,
    resultId: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ) => Promise<HttpOutcome>;
}

const defaultDependencies: PublishRunnerDependencies = {
  sendPublish: sendPublishRequest,
};

// ---------------------------------------------------------------------------
// Runner chính
// ---------------------------------------------------------------------------

/**
 * Chạy workload Publish cho danh sách kết quả đã khám phá.
 *
 * Chỉ gửi Publish khi config.isPublishAllowed = true.
 * Dry-run chỉ trả planned workload, không gửi bất kỳ request nào.
 *
 * @param config      Cấu hình đã parse và validate.
 * @param results     Danh sách kết quả đủ điều kiện (từ load-fixtures).
 * @param onRecord    Callback sau mỗi record hoàn thành (để stream output).
 * @param signal      AbortSignal để graceful shutdown.
 * @param deps        Phụ thuộc (mock trong test).
 */
export async function runPublishWorkload(
  config: LoadConfig,
  results: readonly EligibleResult[],
  onRecord: (record: PublishRecord) => void,
  signal?: AbortSignal,
  deps: PublishRunnerDependencies = defaultDependencies,
): Promise<RunSummary> {
  const { runId, lisBaseUrl, httpTimeoutMs, concurrency, mode } = config;

  if (config.dryRun || !config.isPublishAllowed) {
    // Dry-run: không gửi bất kỳ request nào.
    // Trả danh sách kế hoạch để xem trước.
    return {
      runId,
      mode,
      concurrency,
      totalScheduled: results.length,
      completed: 0,
      newPublications: 0,
      existingPublications: 0,
      errors: 0,
      wasCancelled: false,
      publishOnlyNote:
        "DRY-RUN: No Publish requests were sent. " +
        "202/200 status codes represent Publish-only outcomes, not EMR delivery.",
    };
  }

  // Xây dựng danh sách task. Thứ tự theo results (đã được sắp xếp tất định
  // từ load-fixtures: ORDER BY result_id ASC).
  let newCount = 0;
  let existingCount = 0;
  let errorCount = 0;

  const tasks = results.map((result) => async (): Promise<PublishRecord> => {
    const requestStartedAt = new Date().toISOString();
    const outcome = await deps.sendPublish(
      lisBaseUrl,
      result.resultId,
      httpTimeoutMs,
      signal,
    );
    const publishOutcome: PublishRecord["publishOutcome"] =
      outcome.status === 202
        ? "NEW"
        : outcome.status === 200
          ? "EXISTING"
          : "ERROR";
    return {
      runId,
      resultId: result.resultId,
      requestStartedAt,
      responseReceivedAt: outcome.receivedAt,
      httpStatus: outcome.status,
      eventId: outcome.eventId,
      publishOutcome,
      errorCode: outcome.errorCode,
    };
  });

  const { completed, cancelled } = await runWithBoundedConcurrency(
    tasks,
    concurrency,
    (record) => {
      if (record.publishOutcome === "NEW") newCount++;
      else if (record.publishOutcome === "EXISTING") existingCount++;
      else errorCount++;
      onRecord(record);
    },
    signal,
  );

  return {
    runId,
    mode,
    concurrency,
    totalScheduled: results.length,
    completed,
    newPublications: newCount,
    existingPublications: existingCount,
    errors: errorCount,
    wasCancelled: cancelled,
    publishOnlyNote:
      "HTTP 202 = new Publish event created (PENDING, not yet delivered to EMR). " +
      "HTTP 200 = existing idempotent Publish event (not a new experimental transaction). " +
      "End-to-end delivery tracking (Dispatcher → Middleware → Worker → EMR) is SPP-82-B.",
  };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** Ghi PublishRecord ra stream (JSON Lines). Không lộ patient_id. */
export function formatRecord(record: PublishRecord): string {
  // Không lộ dữ liệu lâm sàng — chỉ xuất metadata thử nghiệm.
  return JSON.stringify({
    run_id: record.runId,
    result_id: record.resultId,
    request_started_at: record.requestStartedAt,
    response_received_at: record.responseReceivedAt,
    http_status: record.httpStatus,
    event_id: record.eventId,
    publish_outcome: record.publishOutcome,
    error_code: record.errorCode,
  });
}

/** Ghi JSON Lines ra file hoặc stdout. */
export async function writeOutput(
  output: string,
  records: readonly PublishRecord[],
  summary: RunSummary,
): Promise<void> {
  const lines = [
    ...records.map(formatRecord),
    JSON.stringify({ type: "summary", ...summary }),
  ].join("\n");

  if (output === "stdout") {
    process.stdout.write(lines + "\n");
  } else {
    await writeFile(output, lines + "\n", "utf-8");
  }
}
