import { appendFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { calculateMetrics } from './metrics.js';
import type { Measurement, RunManifest } from './run-recorder.js';
/** Exclusive directory: never overwrite evidence from an earlier run. No arbitrary response bodies. */
export function createReportWriter(directory: string, manifest: RunManifest) {
  mkdirSync(directory, { recursive: false, mode: 0o700 });
  const json = (name: string, data: unknown) => {
    const temporary = join(directory, name + '.tmp');
    writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
    renameSync(temporary, join(directory, name));
  };
  json('run-manifest.json', manifest);
  writeFileSync(join(directory, 'per-result.jsonl'), '', { mode: 0o600 });
  // Every poll used to append the whole row, including all earlier observations, so the journal grew
  // quadratically (A1 pilot: 19 GB for 1,000 results). A snapshot is now written only when the row's state
  // changes (ignoring observations); finish() appends one complete, final snapshot per row.
  const journal = join(directory, 'per-result.jsonl'); const written = new Map<string, string>();
  const state = (row: Measurement) => JSON.stringify({ ...row, observations: row.observations.length ? true : false });
  return {
    record: (row: Measurement) => {
      const signature = state(row); if (written.get(row.result_id) === signature) return;
      written.set(row.result_id, signature); appendFileSync(journal, JSON.stringify(row) + '\n');
    },
    finish: (rows: Measurement[]) => {
      for (const row of rows) appendFileSync(journal, JSON.stringify(row) + '\n');
      json('run-manifest.json', manifest);
      const metrics = calculateMetrics(manifest, rows); json('metrics.json', metrics);
      writeFileSync(join(directory, 'summary.md'), `# SPP-82-B${manifest.simulated ? ' — SIMULATED DATA' : ''}\n\n`
        + `Run: ${manifest.run_id}; scenario: ${manifest.scenario}; stop: ${manifest.stop_reason}.\n\n`
        + `Hoàn tất: ${metrics.completion_count}/${metrics.planned_count}; lỗi: ${metrics.failure_count}; timeout: ${metrics.timeout_count}; đã Publish trước: ${metrics.existing_count}.\n\n`
        + `p50: ${metrics.latency_p50_ms ?? 'null'} ms; p95: ${metrics.latency_p95_ms ?? 'null'} ms; throughput: ${metrics.throughput_results_per_second ?? 'null'} kết quả/s.\n\n`
        + `Độ trễ: bắt đầu Publish → client đọc lại EMR đúng, sau ACK và DELIVERED. Đồng hồ monotonic; percentile nearest-rank. Throughput = hoàn tất / toàn bộ thời gian chạy (kể cả chờ kết quả chậm/timeout).\n\n`
        + `Polling ${manifest.polling_interval_ms} ms; timeout run ${manifest.run_timeout_ms} ms; HTTP ${manifest.http_timeout_ms} ms. Polling, lịch hàng đợi và HTTP làm tăng độ trễ quan sát; không cam kết độ chính xác microsecond. Timeout/lỗi đo không chứng minh dịch vụ chưa lưu. Metadata null = chưa biết.\n`, { mode: 0o600 });
      return metrics;
    },
  };
}
