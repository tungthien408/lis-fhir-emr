/**
 * SPP-82-A: Cấu hình CLI cho công cụ phát hành tải 1,000 kết quả LIS.
 *
 * Chế độ mặc định là --dry-run (không gửi bất kỳ Publish nào).
 * Để phát hành thực sự cần --confirm-publish và biến môi trường
 * SPP82_EXPERIMENT_TARGET xác nhận môi trường cô lập đã được phê duyệt.
 *
 * Concurrency đo số giao dịch end-to-end đang chạy song song trong phạm vi
 * SPP-82-A: một giao dịch = một Publish HTTP request đang in-flight.
 * SPP-82-B sẽ mở rộng để theo dõi toàn bộ end-to-end (Dispatcher → Worker → EMR).
 *
 * SEQUENTIAL = concurrency 1 (một request tại một thời điểm).
 * CONCURRENT = tối đa MAX_CONCURRENCY request song song.
 */
import { randomUUID } from "node:crypto";

export const SEED_TAG = "DACN-MIMIC22-SOURCE-ALIGNED-V2";
export const EXPECTED_RESULT_COUNT = 1000;
export const MAX_CONCURRENCY = 10;
export const DEFAULT_HTTP_TIMEOUT_MS = 10_000;
export const DEFAULT_CONCURRENCY = 1;
export const DEFAULT_OUTPUT = "stdout";

/** Hai chế độ workload được hỗ trợ. */
export type WorkloadMode = "SEQUENTIAL" | "CONCURRENT";

/**
 * Cấu hình đã được phân tích và xác thực.
 *
 * isPublishAllowed chỉ true khi --confirm-publish xuất hiện
 * VÀ biến môi trường SPP82_EXPERIMENT_TARGET đã được đặt.
 */
export interface LoadConfig {
  /** Khi true, không gửi bất kỳ Publish HTTP request nào. */
  dryRun: boolean;
  /** Số kết quả tối đa cần xử lý; undefined = tất cả (1,000). */
  limit: number | undefined;
  /** Chế độ workload: SEQUENTIAL hoặc CONCURRENT. */
  mode: WorkloadMode;
  /**
   * Số giao dịch end-to-end in-flight tối đa trong SPP-82-A.
   * Định nghĩa SPP-82-A: 1 giao dịch = 1 Publish HTTP request đang in-flight.
   * SEQUENTIAL luôn là 1. CONCURRENT giới hạn theo giá trị này.
   * Cảnh báo: đây là publish-only; không phải end-to-end thực sự đến EMR.
   */
  concurrency: number;
  /** Đường dẫn file output; "stdout" để in ra console. */
  output: string;
  /** URL gốc của dịch vụ LIS (không có dấu / cuối). */
  lisBaseUrl: string;
  /** Timeout HTTP tính bằng millisecond cho mỗi Publish request. */
  httpTimeoutMs: number;
  /** true khi --confirm-publish + SPP82_EXPERIMENT_TARGET hợp lệ. */
  isPublishAllowed: boolean;
  /** Giá trị SPP82_EXPERIMENT_TARGET nếu đã được xác nhận; undefined nếu dry-run. */
  experimentTarget: string | undefined;
  /** Định danh thử nghiệm duy nhất cho lần chạy này (UUID v4). */
  runId: string;
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

/**
 * Phân tích đối số dòng lệnh và biến môi trường thành LoadConfig.
 * Ném ConfigurationError nếu tham số không hợp lệ hoặc thiếu.
 *
 * @param args   Mảng đối số (thường là process.argv.slice(2))
 * @param env    Biến môi trường (mặc định process.env)
 * @param runId  UUID thử nghiệm (mặc định sẽ tự tạo)
 */
export function parseLoadConfig(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  runId: string = randomUUID(),
): LoadConfig {
  let dryRun = true; // mặc định an toàn nhất
  let limit: number | undefined = undefined;
  let mode: WorkloadMode = "SEQUENTIAL";
  let concurrency = DEFAULT_CONCURRENCY;
  let output = DEFAULT_OUTPUT;
  let httpTimeoutMs = DEFAULT_HTTP_TIMEOUT_MS;
  let confirmPublish = false;

  const remaining = [...args];
  while (remaining.length > 0) {
    const arg = remaining.shift()!;

    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--confirm-publish") {
      confirmPublish = true;
      dryRun = false;
    } else if (arg === "--limit") {
      const raw = remaining.shift();
      if (raw === undefined || !/^\d+$/.test(raw) || raw === "0") {
        throw new ConfigurationError("--limit requires a positive integer");
      }
      limit = Number(raw);
      if (limit > EXPECTED_RESULT_COUNT) {
        throw new ConfigurationError(
          `--limit cannot exceed ${EXPECTED_RESULT_COUNT} (the full MIMIC dataset size)`,
        );
      }
    } else if (arg === "--mode") {
      const raw = remaining.shift();
      if (raw !== "SEQUENTIAL" && raw !== "CONCURRENT") {
        throw new ConfigurationError(
          "--mode must be SEQUENTIAL or CONCURRENT",
        );
      }
      mode = raw;
    } else if (arg === "--concurrency") {
      const raw = remaining.shift();
      if (raw === undefined || !/^\d+$/.test(raw) || raw === "0") {
        throw new ConfigurationError(
          "--concurrency requires a positive integer",
        );
      }
      concurrency = Number(raw);
      if (concurrency > MAX_CONCURRENCY) {
        throw new ConfigurationError(
          `--concurrency cannot exceed ${MAX_CONCURRENCY} for this experiment`,
        );
      }
    } else if (arg === "--output") {
      const raw = remaining.shift();
      if (!raw) {
        throw new ConfigurationError("--output requires a path or 'stdout'");
      }
      output = raw;
    } else if (arg === "--http-timeout-ms") {
      const raw = remaining.shift();
      if (raw === undefined || !/^\d+$/.test(raw) || raw === "0") {
        throw new ConfigurationError(
          "--http-timeout-ms requires a positive integer",
        );
      }
      httpTimeoutMs = Number(raw);
      if (httpTimeoutMs < 1000 || httpTimeoutMs > 60_000) {
        throw new ConfigurationError(
          "--http-timeout-ms must be between 1000 and 60000 ms",
        );
      }
    } else {
      throw new ConfigurationError(`Unknown argument: ${arg}`);
    }
  }

  // Xác nhận LIS URL từ biến môi trường.
  const rawUrl = env.LIS_BASE_URL ?? "";
  if (!rawUrl) {
    throw new ConfigurationError(
      "LIS_BASE_URL environment variable is required (e.g. http://127.0.0.1:3101)",
    );
  }
  let lisBaseUrl: string;
  try {
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("not http(s)");
    }
    lisBaseUrl = url.origin;
  } catch {
    throw new ConfigurationError(
      `LIS_BASE_URL must be an HTTP(S) origin (e.g. http://127.0.0.1:3101), got: ${rawUrl}`,
    );
  }

  // Xác nhận môi trường thử nghiệm cô lập TRƯỚC KHI cho phép Publish thực.
  // Không coi localhost đơn thuần là bằng chứng database có thể xóa.
  const experimentTarget = env.SPP82_EXPERIMENT_TARGET;
  let isPublishAllowed = false;

  if (confirmPublish) {
    if (!experimentTarget || experimentTarget.trim().length === 0) {
      throw new ConfigurationError(
        "Real publishing requires SPP82_EXPERIMENT_TARGET environment variable " +
          "to be set to an approved isolated experiment target. " +
          "This protects development data from accidental mutation. " +
          "Set this variable only when you have verified that the target is " +
          "a disposable test environment, not a shared or production database.",
      );
    }
    isPublishAllowed = true;
  }

  // SEQUENTIAL luôn dùng concurrency = 1, bất kể --concurrency được truyền vào.
  if (mode === "SEQUENTIAL") {
    concurrency = 1;
  }

  return Object.freeze({
    dryRun,
    limit,
    mode,
    concurrency,
    output,
    lisBaseUrl,
    httpTimeoutMs,
    isPublishAllowed,
    experimentTarget: isPublishAllowed ? experimentTarget : undefined,
    runId,
  });
}

/** In hướng dẫn sử dụng ra hàm callback (mặc định console.log). */
export function printUsage(out: (line: string) => void = console.log): void {
  out("SPP-82-A: LIS Load Publisher — Phát hành 1,000 kết quả MIMIC qua HTTP API LIS");
  out("");
  out("Cách dùng:");
  out("  cd backend");
  out("  npm run spp82:dry-run");
  out("  npm run spp82:dry-run -- --limit 10");
  out("  npm run spp82:dry-run -- --mode CONCURRENT --concurrency 5");
  out("");
  out("Tham số:");
  out("  --dry-run             [mặc định] Chỉ kiểm tra cấu hình, không gửi Publish");
  out("  --confirm-publish     Bật Publish thực (bắt buộc SPP82_EXPERIMENT_TARGET)");
  out("  --limit <N>           Số kết quả tối đa (1–1000)");
  out("  --mode SEQUENTIAL     Tuần tự, một request tại một thời điểm [mặc định]");
  out("  --mode CONCURRENT     Song song, giới hạn bởi --concurrency");
  out("  --concurrency <N>     Số Publish in-flight tối đa (1–10, chỉ CONCURRENT)");
  out("  --output <path>       File kết quả JSON Lines; 'stdout' mặc định");
  out("  --http-timeout-ms <N> Timeout HTTP (1000–60000 ms)");
  out("");
  out("Biến môi trường:");
  out("  LIS_BASE_URL             URL gốc LIS (bắt buộc), vd: http://127.0.0.1:3101");
  out("  LIS_DATABASE_URL         URL PostgreSQL LIS (bắt buộc để truy vấn danh sách kết quả)");
  out("  SPP82_EXPERIMENT_TARGET  Bắt buộc khi --confirm-publish; xác nhận môi trường cô lập");
  out("");
  out("Đo SPP-82-B (opt-in): SPP82_MEASURE=1, MIDDLEWARE_BASE_URL, EMR_BASE_URL");
  out("  SPP82_POLL_MS=1000; SPP82_RUN_TIMEOUT_MS=120000; SPP82_OBSERVER_CONCURRENCY=2");
  out("  SPP82_ARTIFACT_DIR: thư mục MỚI chứa manifest, journal, metrics và summary");
  out("  Chi tiết: docs/docs_backend/spp-82-b-review.md (từ gốc repository)");
  out("");
  out("Ghi chú:");
  out("  Dry-run không gửi Publish, không reset database, không nạp lại dữ liệu.");
  out("  Concurrency trong SPP-82-A đo số Publish HTTP in-flight (chưa phải end-to-end).");
  out("  End-to-end (Dispatcher → Middleware → Worker → EMR) thuộc SPP-82-B.");
}
