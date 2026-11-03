/**
 * SPP-82-A: Entry point CLI cho Load Publisher.
 *
 * Cách chạy:
 *   LIS_BASE_URL=http://127.0.0.1:3101 \
 *   LIS_DATABASE_URL=postgresql://lis_app:password@127.0.0.1:5433/dacn_db \
 *   node --import tsx scripts/spp82/publish-runner-main.ts --dry-run
 *
 * Hoặc qua npm script:
 *   npm run spp82:dry-run
 *   npm run spp82:dry-run -- --limit 10
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { parseMeasurementConfig } from "./measurement-config.js";
import { runMeasuredWorkload } from "./measurement-runner.js";
import { createReportWriter } from "./report-writer.js";
import {
  parseLoadConfig,
  printUsage,
  ConfigurationError,
} from "./load-config.js";
import {
  discoverEligibleResults,
  summarizeFixtures,
  FixtureError,
} from "./load-fixtures.js";
import {
  runPublishWorkload,
  writeOutput,
  type PublishRecord,
} from "./publish-runner.js";

// Graceful shutdown
const shutdownController = new AbortController();
const shutdownSignal = shutdownController.signal;
let shutdownInitiated = false;

function handleShutdown(signal: string) {
  if (shutdownInitiated) return;
  shutdownInitiated = true;
  process.stderr.write(`\n[SPP82] Nhận signal ${signal}, đang dừng gracefully...\n`);
  shutdownController.abort(signal);
}

process.once("SIGINT", () => handleShutdown("SIGINT"));
process.once("SIGTERM", () => handleShutdown("SIGTERM"));

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printUsage(console.log);
    process.exit(0);
  }

  let config;
  try {
    config = parseLoadConfig(args, process.env, randomUUID());
  } catch (error) {
    if (error instanceof ConfigurationError) {
      process.stderr.write(`[SPP82] Cấu hình không hợp lệ: ${error.message}\n\n`);
      printUsage((line) => process.stderr.write(line + "\n"));
      process.exit(1);
    }
    throw error;
  }

  const measurement = parseMeasurementConfig(process.env, config.lisBaseUrl, config.httpTimeoutMs);

  // Log header.
  const mode = config.dryRun ? "DRY-RUN" : "PUBLISH";
  process.stderr.write(
    `[SPP82] ${mode} | run_id=${config.runId} | mode=${config.mode} | ` +
      `concurrency=${config.concurrency} | ` +
      (config.limit !== undefined ? `limit=${config.limit}` : "limit=ALL") +
      "\n",
  );

  if (!config.dryRun && config.isPublishAllowed) {
    process.stderr.write(
      `[SPP82] Môi trường thử nghiệm: ${config.experimentTarget}\n`,
    );
    process.stderr.write(
      "[SPP82] CẢNH BÁO: Sắp gửi Publish requests thực tế!\n",
    );
    process.stderr.write(
      "[SPP82] HTTP 202 = Publish event mới (PENDING). Chưa có nghĩa là DELIVERED.\n",
    );
  }

  // Khám phá kết quả đủ điều kiện.
  process.stderr.write("[SPP82] Đang khám phá kết quả đủ điều kiện...\n");
  let results;
  try {
    results = await discoverEligibleResults(
      process.env.LIS_DATABASE_URL,
      config.limit,
    );
  } catch (error) {
    if (error instanceof FixtureError) {
      process.stderr.write(`[SPP82] Lỗi dữ liệu: ${error.message}\n`);
      if (error.code === "SEED_ABSENT") {
        process.stderr.write(
          "[SPP82] Hướng dẫn nạp dữ liệu:\n" +
            "  docker compose exec -T db psql -X -U postgres -d dacn_db \\\n" +
            "    -v ON_ERROR_STOP=1 < database/seed/01_reference_data.sql\n" +
            "  docker compose exec -T db psql -X -U postgres -d dacn_db \\\n" +
            "    -v ON_ERROR_STOP=1 < database/seed/02_lis_results.sql\n",
        );
      }
      process.exit(1);
    }
    throw error;
  }

  // Tóm tắt dry-run.
  const summary = summarizeFixtures(results);
  process.stderr.write(
    `[SPP82] Tìm thấy: ${summary.totalEligible} kết quả đủ điều kiện ` +
      `(seed_tag=${summary.seedTag})\n`,
  );
  process.stderr.write(
    `[SPP82] Sẽ xử lý: ${summary.willProcess} kết quả\n`,
  );
  process.stderr.write(
    `[SPP82] Phân bố xét nghiệm: ${JSON.stringify(summary.testCodeDistribution)}\n`,
  );

  if (config.dryRun) {
    process.stderr.write(
      "[SPP82] *** DRY-RUN HOÀN TẤT — Không có Publish request nào được gửi ***\n",
    );
    process.stderr.write(
      "[SPP82] Để chạy Publish thực: --confirm-publish + SPP82_EXPERIMENT_TARGET\n",
    );
    // Output dry-run plan
    const dryRunOutput = {
      type: "dry_run_plan",
      run_id: config.runId,
      mode: config.mode,
      concurrency: config.concurrency,
      total_eligible: summary.totalEligible,
      will_process: summary.willProcess,
      seed_tag: summary.seedTag,
      test_code_distribution: summary.testCodeDistribution,
      sample_result_ids: results.slice(0, 5).map((r) => r.resultId),
      note: "Dry-run: zero mutations. No Publish events created or modified.",
    };
    process.stdout.write(JSON.stringify(dryRunOutput) + "\n");
    return;
  }

  if (measurement) {
    try { measurement.gitCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
    catch { /* Explicit null means unknown; no inferred revision. */ }
    const directory = process.env.SPP82_ARTIFACT_DIR ?? join(".", `spp82-${config.runId}`);
    const measured = await runMeasuredWorkload(config, results, measurement,
      (manifest) => createReportWriter(directory, manifest), shutdownSignal);
    process.stdout.write(JSON.stringify({ artifact_directory: directory, metrics: measured.metrics }) + "\n");
    process.exitCode = measured.rows.every((row) => row.outcome === "completed") ? 0 : 1;
    return;
  }

  // Chạy workload thực.
  const records: PublishRecord[] = [];
  let progressCount = 0;
  const PROGRESS_INTERVAL = 50;

  const runSummary = await runPublishWorkload(
    config,
    results,
    (record) => {
      records.push(record);
      progressCount++;
      if (progressCount % PROGRESS_INTERVAL === 0) {
        process.stderr.write(
          `[SPP82] Tiến độ: ${progressCount}/${results.length} ` +
            `(NEW=${records.filter((r) => r.publishOutcome === "NEW").length}, ` +
            `EXISTING=${records.filter((r) => r.publishOutcome === "EXISTING").length}, ` +
            `ERROR=${records.filter((r) => r.publishOutcome === "ERROR").length})\n`,
        );
      }
    },
    shutdownSignal,
  );

  // Ghi output.
  await writeOutput(config.output, records, runSummary);

  process.stderr.write(
    `[SPP82] Hoàn tất: ${runSummary.completed}/${runSummary.totalScheduled} | ` +
      `NEW=${runSummary.newPublications} | EXISTING=${runSummary.existingPublications} | ` +
      `ERROR=${runSummary.errors}` +
      (runSummary.wasCancelled ? " | ĐÃ BỊ HỦY" : "") +
      "\n",
  );
  process.stderr.write(`[SPP82] ${runSummary.publishOnlyNote}\n`);

  process.exit(runSummary.wasCancelled || runSummary.errors > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `[SPP82] Lỗi nghiêm trọng: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
