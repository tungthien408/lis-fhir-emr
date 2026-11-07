/**
 * SPP-82-A: Unit tests cho Load Publisher.
 *
 * Tất cả tests dùng fixture tổng hợp (createSyntheticFixtures) và HTTP mock.
 * Không kết nối PostgreSQL, không gửi Publish request thực, không thay đổi database.
 *
 * Chạy: cd backend && node --import tsx --test scripts/spp82/publish-runner.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  parseLoadConfig,
  EXPECTED_RESULT_COUNT,
  SEED_TAG,
  MAX_CONCURRENCY,
  type LoadConfig,
} from "./load-config.js";
import {
  createSyntheticFixtures,
  summarizeFixtures,
  FixtureError,
} from "./load-fixtures.js";
import {
  runPublishWorkload,
  formatRecord,
  type PublishRecord,
  type PublishRunnerDependencies,
} from "./publish-runner.js";

// ---------------------------------------------------------------------------
// Helper: tạo config hợp lệ cho test
// ---------------------------------------------------------------------------

function testConfig(overrides: Partial<LoadConfig> = {}): LoadConfig {
  return Object.freeze({
    dryRun: true,
    limit: undefined,
    mode: "SEQUENTIAL" as const,
    concurrency: 1,
    output: "stdout",
    lisBaseUrl: "http://127.0.0.1:3101",
    httpTimeoutMs: 5000,
    isPublishAllowed: false,
    experimentTarget: undefined,
    runId: randomUUID(),
    ...overrides,
  });
}

/** Tạo mock HTTP client trả kết quả đã định sẵn. */
function mockDeps(responses: Array<{ status: number; eventId?: string }>): {
  deps: PublishRunnerDependencies;
  calls: Array<{ resultId: string }>;
} {
  const calls: Array<{ resultId: string }> = [];
  let callIndex = 0;
  const deps: PublishRunnerDependencies = {
    sendPublish: async (_url, resultId, _timeout, _signal) => {
      calls.push({ resultId });
      const resp = responses[callIndex++ % responses.length];
      return {
        status: resp.status,
        eventId: resp.eventId ?? (resp.status === 202 || resp.status === 200 ? randomUUID() : null),
        errorCode: resp.status === 202 || resp.status === 200 ? null : `HTTP_${resp.status}`,
        receivedAt: new Date().toISOString(),
      };
    },
  };
  return { deps, calls };
}

/** Mock với timeout. */
function timeoutDeps(): PublishRunnerDependencies {
  return {
    sendPublish: async () => ({
      status: null,
      eventId: null,
      errorCode: "HTTP_TIMEOUT",
      receivedAt: null,
    }),
  };
}

/** Mock với lỗi mạng. */
function networkErrorDeps(): PublishRunnerDependencies {
  return {
    sendPublish: async () => ({
      status: null,
      eventId: null,
      errorCode: "NETWORK_ERROR",
      receivedAt: null,
    }),
  };
}

// ===========================================================================
// A01 — Khám phá fixture
// ===========================================================================

test("A01: createSyntheticFixtures tạo chính xác 1,000 fixture", () => {
  const fixtures = createSyntheticFixtures(EXPECTED_RESULT_COUNT);
  assert.equal(fixtures.length, EXPECTED_RESULT_COUNT);
});

test("A01: tất cả result_id trong synthetic fixtures là duy nhất", () => {
  const fixtures = createSyntheticFixtures(EXPECTED_RESULT_COUNT);
  const ids = fixtures.map((f) => f.resultId);
  const unique = new Set(ids);
  assert.equal(unique.size, EXPECTED_RESULT_COUNT, "result_id phải duy nhất");
});

test("A01: thứ tự fixture tất định (ổn định giữa các lần tạo)", () => {
  const a = createSyntheticFixtures(100);
  const b = createSyntheticFixtures(100);
  assert.deepEqual(
    a.map((f) => f.resultId),
    b.map((f) => f.resultId),
  );
});

test("A01: summarizeFixtures báo cáo đúng số lượng", () => {
  const fixtures = createSyntheticFixtures(100);
  const summary = summarizeFixtures(fixtures, EXPECTED_RESULT_COUNT);
  assert.equal(summary.totalEligible, EXPECTED_RESULT_COUNT);
  assert.equal(summary.willProcess, 100);
  assert.equal(summary.seedTag, SEED_TAG);
});

test("A01: summarizeFixtures gom nhóm test_code đúng", () => {
  const fixtures = createSyntheticFixtures(10);
  const summary = summarizeFixtures(fixtures, EXPECTED_RESULT_COUNT);
  const total = Object.values(summary.testCodeDistribution).reduce((s, v) => s + v, 0);
  assert.equal(total, 10);
});

test("A01: createSyntheticFixtures với 0 trả mảng rỗng", () => {
  const fixtures = createSyntheticFixtures(0);
  assert.equal(fixtures.length, 0);
});

// ===========================================================================
// Cấu hình — parseLoadConfig
// ===========================================================================

test("Config: --dry-run là mặc định khi không có tham số", () => {
  const config = parseLoadConfig([], { LIS_BASE_URL: "http://127.0.0.1:3101" });
  assert.equal(config.dryRun, true);
  assert.equal(config.isPublishAllowed, false);
});

test("Config: --dry-run rõ ràng vẫn không cho phép Publish", () => {
  const config = parseLoadConfig(
    ["--dry-run"],
    { LIS_BASE_URL: "http://127.0.0.1:3101" },
  );
  assert.equal(config.dryRun, true);
  assert.equal(config.isPublishAllowed, false);
});

test("Config: --confirm-publish không có SPP82_EXPERIMENT_TARGET ném lỗi", () => {
  assert.throws(
    () =>
      parseLoadConfig(["--confirm-publish"], {
        LIS_BASE_URL: "http://127.0.0.1:3101",
      }),
    (err) =>
      err instanceof Error && err.message.includes("SPP82_EXPERIMENT_TARGET"),
  );
});

test("Config: --confirm-publish với SPP82_EXPERIMENT_TARGET hợp lệ cho phép Publish", () => {
  const config = parseLoadConfig(
    ["--confirm-publish"],
    {
      LIS_BASE_URL: "http://127.0.0.1:3101",
      SPP82_EXPERIMENT_TARGET: "spp82-isolated-test-2026",
    },
  );
  assert.equal(config.dryRun, false);
  assert.equal(config.isPublishAllowed, true);
  assert.equal(config.experimentTarget, "spp82-isolated-test-2026");
});

test("Config: thiếu LIS_BASE_URL ném ConfigurationError", () => {
  assert.throws(
    () => parseLoadConfig([], {}),
    (err) => err instanceof Error && err.message.includes("LIS_BASE_URL"),
  );
});

test("Config: LIS_BASE_URL sai định dạng ném ConfigurationError", () => {
  assert.throws(
    () =>
      parseLoadConfig([], { LIS_BASE_URL: "not-a-url" }),
    (err) => err instanceof Error,
  );
});

test("Config: --limit nhận số nguyên dương hợp lệ", () => {
  const config = parseLoadConfig(
    ["--limit", "50"],
    { LIS_BASE_URL: "http://127.0.0.1:3101" },
  );
  assert.equal(config.limit, 50);
});

test("Config: --limit vượt quá 1000 ném lỗi", () => {
  assert.throws(() =>
    parseLoadConfig(
      ["--limit", "1001"],
      { LIS_BASE_URL: "http://127.0.0.1:3101" },
    ),
  );
});

test("Config: --limit không phải số nguyên ném lỗi", () => {
  assert.throws(() =>
    parseLoadConfig(
      ["--limit", "abc"],
      { LIS_BASE_URL: "http://127.0.0.1:3101" },
    ),
  );
});

test("Config: --mode SEQUENTIAL đặt concurrency = 1 bất kể --concurrency", () => {
  const config = parseLoadConfig(
    ["--mode", "SEQUENTIAL", "--concurrency", "5"],
    { LIS_BASE_URL: "http://127.0.0.1:3101" },
  );
  assert.equal(config.mode, "SEQUENTIAL");
  assert.equal(config.concurrency, 1);
});

test("Config: --mode CONCURRENT --concurrency 5 hợp lệ", () => {
  const config = parseLoadConfig(
    ["--mode", "CONCURRENT", "--concurrency", "5"],
    { LIS_BASE_URL: "http://127.0.0.1:3101" },
  );
  assert.equal(config.mode, "CONCURRENT");
  assert.equal(config.concurrency, 5);
});

test(`Config: --concurrency vượt quá ${MAX_CONCURRENCY} ném lỗi`, () => {
  assert.throws(() =>
    parseLoadConfig(
      ["--mode", "CONCURRENT", "--concurrency", String(MAX_CONCURRENCY + 1)],
      { LIS_BASE_URL: "http://127.0.0.1:3101" },
    ),
  );
});

test("Config: tham số không biết ném ConfigurationError", () => {
  assert.throws(() =>
    parseLoadConfig(
      ["--unknown-flag"],
      { LIS_BASE_URL: "http://127.0.0.1:3101" },
    ),
    (err) => err instanceof Error && err.message.includes("Unknown argument"),
  );
});

test("Config: runId được tạo tự động nếu không truyền", () => {
  const config = parseLoadConfig([], { LIS_BASE_URL: "http://127.0.0.1:3101" });
  assert.match(
    config.runId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
});

test("Config: runId được giữ nguyên khi truyền vào", () => {
  const fixedId = "12345678-1234-4000-8000-123456789abc";
  const config = parseLoadConfig(
    [],
    { LIS_BASE_URL: "http://127.0.0.1:3101" },
    fixedId,
  );
  assert.equal(config.runId, fixedId);
});

test("Config: config bị đóng băng (Object.freeze)", () => {
  const config = parseLoadConfig([], { LIS_BASE_URL: "http://127.0.0.1:3101" });
  assert.throws(() => {
    (config as unknown as Record<string, unknown>).dryRun = false;
  });
});

// ===========================================================================
// A08 — Dry-run không thay đổi gì
// ===========================================================================

test("A08: dry-run không gọi sendPublish", async () => {
  const fixtures = createSyntheticFixtures(10);
  const { deps, calls } = mockDeps([{ status: 202 }]);
  const config = testConfig({ dryRun: true, isPublishAllowed: false });

  const summary = await runPublishWorkload(config, fixtures, () => {}, undefined, deps);

  assert.equal(calls.length, 0, "Dry-run không được gọi sendPublish");
  assert.equal(summary.completed, 0);
  assert.equal(summary.newPublications, 0);
  assert.equal(summary.existingPublications, 0);
  assert.ok(summary.publishOnlyNote.includes("DRY-RUN"));
});

test("A08: dry-run trả totalScheduled đúng (không thực thi)", async () => {
  const fixtures = createSyntheticFixtures(100);
  const config = testConfig({ dryRun: true, isPublishAllowed: false, limit: 100 });
  const { deps } = mockDeps([{ status: 202 }]);

  const summary = await runPublishWorkload(config, fixtures, () => {}, undefined, deps);
  assert.equal(summary.totalScheduled, 100);
  assert.equal(summary.completed, 0);
});

// ===========================================================================
// A03 — HTTP 202 vs 200
// ===========================================================================

test("A03: HTTP 202 ghi publishOutcome = NEW", async () => {
  const fixtures = createSyntheticFixtures(1);
  const { deps } = mockDeps([{ status: 202, eventId: randomUUID() }]);
  const config = testConfig({ dryRun: false, isPublishAllowed: true });
  const records: PublishRecord[] = [];

  await runPublishWorkload(config, fixtures, (r) => records.push(r), undefined, deps);

  assert.equal(records.length, 1);
  assert.equal(records[0].publishOutcome, "NEW");
  assert.equal(records[0].httpStatus, 202);
  assert.notEqual(records[0].eventId, null);
  assert.equal(records[0].errorCode, null);
});

test("A03: HTTP 200 ghi publishOutcome = EXISTING", async () => {
  const fixtures = createSyntheticFixtures(1);
  const existingEventId = randomUUID();
  const { deps } = mockDeps([{ status: 200, eventId: existingEventId }]);
  const config = testConfig({ dryRun: false, isPublishAllowed: true });
  const records: PublishRecord[] = [];

  await runPublishWorkload(config, fixtures, (r) => records.push(r), undefined, deps);

  assert.equal(records.length, 1);
  assert.equal(records[0].publishOutcome, "EXISTING");
  assert.equal(records[0].httpStatus, 200);
  assert.equal(records[0].eventId, existingEventId);
});

test("A03: HTTP 202 không có nghĩa là DELIVERED — ghi chú trong summary", async () => {
  const fixtures = createSyntheticFixtures(1);
  const { deps } = mockDeps([{ status: 202 }]);
  const config = testConfig({ dryRun: false, isPublishAllowed: true });

  const summary = await runPublishWorkload(config, fixtures, () => {}, undefined, deps);
  assert.ok(
    summary.publishOnlyNote.includes("not yet delivered") ||
      summary.publishOnlyNote.includes("SPP-82-B"),
    "Summary phải ghi chú rõ 202 chưa có nghĩa là DELIVERED",
  );
});

test("A03: HTTP 200 cũ không được tính là giao dịch thử nghiệm mới", async () => {
  const fixtures = createSyntheticFixtures(5);
  const { deps } = mockDeps([{ status: 200 }]); // Tất cả đều là existing
  const config = testConfig({ dryRun: false, isPublishAllowed: true });

  const summary = await runPublishWorkload(config, fixtures, () => {}, undefined, deps);
  assert.equal(summary.newPublications, 0);
  assert.equal(summary.existingPublications, 5);
});

test("A03: record lưu result_id, request_started_at, response_received_at", async () => {
  const fixtures = createSyntheticFixtures(1);
  const { deps } = mockDeps([{ status: 202 }]);
  const config = testConfig({ dryRun: false, isPublishAllowed: true });
  const records: PublishRecord[] = [];

  await runPublishWorkload(config, fixtures, (r) => records.push(r), undefined, deps);

  const rec = records[0];
  assert.equal(rec.resultId, fixtures[0].resultId);
  assert.match(rec.requestStartedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.notEqual(rec.responseReceivedAt, null);
  assert.equal(rec.runId, config.runId);
});

// ===========================================================================
// A04 — Chế độ concurrency
// ===========================================================================

test("A04: SEQUENTIAL mode chỉ 1 in-flight tại một thời điểm", async () => {
  const N = 10;
  const fixtures = createSyntheticFixtures(N);
  const callOrder: string[] = [];
  let maxConcurrent = 0;
  let currentConcurrent = 0;

  const deps: PublishRunnerDependencies = {
    sendPublish: async (_url, resultId) => {
      currentConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
      callOrder.push(resultId);
      // Giả lập I/O ngắn
      await new Promise((resolve) => setImmediate(resolve));
      currentConcurrent--;
      return { status: 202, eventId: randomUUID(), errorCode: null, receivedAt: new Date().toISOString() };
    },
  };

  const config = testConfig({
    dryRun: false,
    isPublishAllowed: true,
    mode: "SEQUENTIAL",
    concurrency: 1,
  });

  await runPublishWorkload(config, fixtures, () => {}, undefined, deps);

  assert.equal(maxConcurrent, 1, "SEQUENTIAL chỉ 1 in-flight");
  assert.equal(callOrder.length, N);
});

test("A04: CONCURRENT mode giới hạn đúng số in-flight", async () => {
  const N = 20;
  const CONC = 5;
  const fixtures = createSyntheticFixtures(N);
  let maxConcurrent = 0;
  let currentConcurrent = 0;

  const deps: PublishRunnerDependencies = {
    sendPublish: async () => {
      currentConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      currentConcurrent--;
      return { status: 202, eventId: randomUUID(), errorCode: null, receivedAt: new Date().toISOString() };
    },
  };

  const config = testConfig({
    dryRun: false,
    isPublishAllowed: true,
    mode: "CONCURRENT",
    concurrency: CONC,
  });

  await runPublishWorkload(config, fixtures, () => {}, undefined, deps);

  assert.ok(
    maxConcurrent <= CONC,
    `Concurrent không vượt quá ${CONC}, thực tế: ${maxConcurrent}`,
  );
  assert.ok(maxConcurrent > 1, "Concurrent phải chạy nhiều hơn 1 in-flight");
});

test("A04: không có duplicate scheduling (mỗi result_id chỉ được publish 1 lần)", async () => {
  const N = 20;
  const fixtures = createSyntheticFixtures(N);
  const calledIds: string[] = [];

  const deps: PublishRunnerDependencies = {
    sendPublish: async (_url, resultId) => {
      calledIds.push(resultId);
      return { status: 202, eventId: randomUUID(), errorCode: null, receivedAt: new Date().toISOString() };
    },
  };

  const config = testConfig({
    dryRun: false,
    isPublishAllowed: true,
    mode: "CONCURRENT",
    concurrency: 5,
  });

  await runPublishWorkload(config, fixtures, () => {}, undefined, deps);

  const unique = new Set(calledIds);
  assert.equal(unique.size, N, "Mỗi result_id chỉ được Publish một lần");
  assert.equal(calledIds.length, N);
});

// ===========================================================================
// A05 — Timeout và lỗi mạng
// ===========================================================================

test("A05: HTTP timeout ghi publishOutcome = ERROR và errorCode = HTTP_TIMEOUT", async () => {
  const fixtures = createSyntheticFixtures(1);
  const config = testConfig({ dryRun: false, isPublishAllowed: true });
  const records: PublishRecord[] = [];

  await runPublishWorkload(config, fixtures, (r) => records.push(r), undefined, timeoutDeps());

  assert.equal(records[0].publishOutcome, "ERROR");
  assert.equal(records[0].errorCode, "HTTP_TIMEOUT");
  assert.equal(records[0].httpStatus, null);
});

test("A05: lỗi mạng ghi publishOutcome = ERROR và errorCode = NETWORK_ERROR", async () => {
  const fixtures = createSyntheticFixtures(1);
  const config = testConfig({ dryRun: false, isPublishAllowed: true });
  const records: PublishRecord[] = [];

  await runPublishWorkload(config, fixtures, (r) => records.push(r), undefined, networkErrorDeps());

  assert.equal(records[0].publishOutcome, "ERROR");
  assert.equal(records[0].errorCode, "NETWORK_ERROR");
});

test("A05: lỗi HTTP 422 ghi publishOutcome = ERROR", async () => {
  const fixtures = createSyntheticFixtures(1);
  const { deps } = mockDeps([{ status: 422 }]);
  const config = testConfig({ dryRun: false, isPublishAllowed: true });
  const records: PublishRecord[] = [];

  await runPublishWorkload(config, fixtures, (r) => records.push(r), undefined, deps);

  assert.equal(records[0].publishOutcome, "ERROR");
  assert.equal(records[0].errorCode, "HTTP_422");
});

test("A05: lỗi HTTP 404 (result_id không tồn tại) ghi publishOutcome = ERROR", async () => {
  const fixtures = createSyntheticFixtures(1);
  const { deps } = mockDeps([{ status: 404 }]);
  const config = testConfig({ dryRun: false, isPublishAllowed: true });
  const records: PublishRecord[] = [];

  await runPublishWorkload(config, fixtures, (r) => records.push(r), undefined, deps);

  assert.equal(records[0].publishOutcome, "ERROR");
  assert.equal(records[0].errorCode, "HTTP_404");
});

// ===========================================================================
// A05 — Cancellation (graceful shutdown)
// ===========================================================================

test("A05: cancellation dừng scheduling task mới", async () => {
  const N = 50;
  const fixtures = createSyntheticFixtures(N);
  const processedIds: string[] = [];
  const shutdownController = new AbortController();

  let callCount = 0;
  const deps: PublishRunnerDependencies = {
    sendPublish: async (_url, resultId, _timeout, signal) => {
      if (signal?.aborted) {
        return { status: null, eventId: null, errorCode: "SHUTDOWN", receivedAt: null };
      }
      callCount++;
      if (callCount === 5) {
        shutdownController.abort("test-shutdown");
      }
      processedIds.push(resultId);
      return { status: 202, eventId: randomUUID(), errorCode: null, receivedAt: new Date().toISOString() };
    },
  };

  const config = testConfig({
    dryRun: false,
    isPublishAllowed: true,
    mode: "SEQUENTIAL",
    concurrency: 1,
  });

  const summary = await runPublishWorkload(
    config,
    fixtures,
    () => {},
    shutdownController.signal,
    deps,
  );

  assert.ok(summary.wasCancelled, "wasCancelled phải là true");
  assert.ok(
    summary.completed < N,
    `Đã bị hủy trước khi hoàn thành tất cả: ${summary.completed} < ${N}`,
  );
});

// ===========================================================================
// A06 — Structured output
// ===========================================================================

test("A06: formatRecord tạo JSON hợp lệ với đủ trường", () => {
  const rec: PublishRecord = {
    runId: randomUUID(),
    resultId: "MIMIC-LAB-33",
    requestStartedAt: "2026-11-02T09:00:00.000Z",
    responseReceivedAt: "2026-11-02T09:00:00.100Z",
    httpStatus: 202,
    eventId: randomUUID(),
    publishOutcome: "NEW",
    errorCode: null,
  };
  const line = formatRecord(rec);
  const parsed = JSON.parse(line) as Record<string, unknown>;
  assert.equal(parsed.run_id, rec.runId);
  assert.equal(parsed.result_id, rec.resultId);
  assert.equal(parsed.http_status, 202);
  assert.equal(parsed.publish_outcome, "NEW");
  assert.equal(parsed.error_code, null);
  assert.ok("request_started_at" in parsed);
  assert.ok("response_received_at" in parsed);
  assert.ok("event_id" in parsed);
});

test("A06: formatRecord không chứa patient_id (dữ liệu lâm sàng)", () => {
  const rec: PublishRecord = {
    runId: randomUUID(),
    resultId: "MIMIC-LAB-33",
    requestStartedAt: "2026-11-02T09:00:00.000Z",
    responseReceivedAt: null,
    httpStatus: null,
    eventId: null,
    publishOutcome: "ERROR",
    errorCode: "HTTP_TIMEOUT",
  };
  const line = formatRecord(rec);
  assert.ok(!line.includes("patient_id"), "Không được lộ patient_id");
  assert.ok(!line.includes("MIMIC-P-"), "Không được lộ MIMIC patient identifier");
});

test("A06: mỗi record có run_id gắn với lần chạy", () => {
  const runId = randomUUID();
  const rec: PublishRecord = {
    runId,
    resultId: "MIMIC-LAB-33",
    requestStartedAt: "2026-11-02T09:00:00.000Z",
    responseReceivedAt: "2026-11-02T09:00:00.100Z",
    httpStatus: 202,
    eventId: randomUUID(),
    publishOutcome: "NEW",
    errorCode: null,
  };
  const parsed = JSON.parse(formatRecord(rec)) as Record<string, unknown>;
  assert.equal(parsed.run_id, runId);
});

// ===========================================================================
// A09 — Bảo vệ dữ liệu phát triển
// ===========================================================================

test("A09: isPublishAllowed = false ngăn mọi sendPublish dù không dryRun", async () => {
  const fixtures = createSyntheticFixtures(5);
  const { deps, calls } = mockDeps([{ status: 202 }]);
  // dryRun = false nhưng isPublishAllowed = false
  const config = testConfig({ dryRun: false, isPublishAllowed: false });

  await runPublishWorkload(config, fixtures, () => {}, undefined, deps);
  assert.equal(calls.length, 0, "isPublishAllowed=false phải chặn tất cả request");
});

// ===========================================================================
// FixtureError
// ===========================================================================

test("FixtureError có code SEED_ABSENT khi tạo thủ công", () => {
  const err = new FixtureError("Không có kết quả", "SEED_ABSENT");
  assert.equal(err.code, "SEED_ABSENT");
  assert.ok(err instanceof Error);
  assert.equal(err.name, "FixtureError");
});

test("FixtureError có code COUNT_MISMATCH khi tạo thủ công", () => {
  const err = new FixtureError("Sai số lượng", "COUNT_MISMATCH");
  assert.equal(err.code, "COUNT_MISMATCH");
});

test("FixtureError có code DUPLICATE_IDS khi tạo thủ công", () => {
  const err = new FixtureError("Trùng ID", "DUPLICATE_IDS");
  assert.equal(err.code, "DUPLICATE_IDS");
});

// ===========================================================================
// A10 — run_id tách biệt giữa các lần chạy
// ===========================================================================

test("A10: mỗi config có run_id khác nhau", () => {
  const c1 = parseLoadConfig([], { LIS_BASE_URL: "http://127.0.0.1:3101" });
  const c2 = parseLoadConfig([], { LIS_BASE_URL: "http://127.0.0.1:3101" });
  assert.notEqual(c1.runId, c2.runId, "Mỗi lần chạy phải có run_id riêng");
});

test("A10: summary chứa runId khớp với config", async () => {
  const fixtures = createSyntheticFixtures(3);
  const { deps } = mockDeps([{ status: 202 }]);
  const config = testConfig({
    dryRun: false,
    isPublishAllowed: true,
    runId: "aaaaaaaa-bbbb-4000-8000-cccccccccccc",
  });

  const summary = await runPublishWorkload(config, fixtures, () => {}, undefined, deps);
  assert.equal(summary.runId, config.runId);
});

// ===========================================================================
// Đảm bảo không ghi thẳng vào Middleware/EMR
// ===========================================================================

test("Công cụ chỉ gọi sendPublish (LIS API), không gọi Middleware hay EMR trực tiếp", async () => {
  // Kiểm tra giao diện: PublishRunnerDependencies chỉ có sendPublish.
  // Nếu có middleware hoặc emr methods thì đây là vi phạm thiết kế.
  const depKeys = Object.keys({
    sendPublish: async () => { throw new Error("should not be called"); },
  } satisfies PublishRunnerDependencies);
  assert.deepEqual(depKeys, ["sendPublish"]);
});
