# SPP-75 – Manifest đợt chạy chính thức
- Đợt: SPP-75 official, 04/11/2026, 03:44Z–08:11Z (UTC).
- Application/dữ liệu: tag `spp74-experiment-v1` (64e6265c72eb92fb2868c7d3fe6d3f44db05c468); `source_tree_sha256`=49e9ebcb66b099760e2b8a6431a01bff66a5e1bbc774cb8ca02213f89cd14e2e (VERIFIED, khớp bản khóa trong code-and-environment.txt của cả 7 lượt).
- Runner: tag `spp75-runner-v3` (c986658191ebfe4d9b9d5766d6b4a90e20a9ddcc). Commit HEAD thực tế lúc chạy `11fe6887…` (chỉ thêm tài liệu/bằng chứng nhỏ sau tag; scripts/pilot không đổi). Runner đã sửa lỗi mã thoát; application không đổi.
- Oracle spp65-v2 manifest SHA-256 55cb4256…c7267; dataset 1.000 kết quả (seed_tag DACN-MIMIC22-SOURCE-ALIGNED-V2).
- Cấu hình: 1 Dispatcher + 1 Worker; retry 2000,4000,8000,16000,32000,64000,64000; HTTP timeout 3.000 ms (mặc định); mọi thông số khác theo spp-74/04-experiment-config.md. Môi trường chi tiết: official-evidence/experiment-manifest.txt và code-and-environment.txt từng lượt (Node, PostgreSQL, container).
- Thứ tự chạy: A1 → B1 → A2 → B2 → A3 → B3, sau đó B1R. Baseline sau mỗi reset: events=1 exch=1 emr=1 seed=1000 mut=0 (DEMO-R1 sẵn có; sai lệch so với protocol events=0, xem 06).

| Lượt | Run ID | Chế độ | c | Thư mục | Bắt đầu → kết thúc (UTC) |
|---|---|---|---|---|---|
| A1 | 6f0621f3-ed6b-470c-8d25-ae502167e30c | SEQUENTIAL | 1 | official-evidence/final/A1/ | 2026-11-04T03:44:12.244Z → 2026-11-04T04:01:57.168Z |
| B1 (gốc, INVALID thời gian) | ab6a6a02-abf1-41ae-b15b-e7c906fe1eaa | CONCURRENT | 5 | official-evidence/final/B1/ | 2026-11-04T04:02:05.924Z → 2026-11-04T06:42:08.298Z |
| A2 | ec43da25-a13b-4e7f-86ec-3e46120843e2 | SEQUENTIAL | 1 | official-evidence/final/A2/ | 2026-11-04T06:42:15.542Z → 2026-11-04T06:59:52.981Z |
| B2 | 8296c970-addf-4506-a2d9-16e68e3f5494 | CONCURRENT | 5 | official-evidence/final/B2/ | 2026-11-04T07:00:00.650Z → 2026-11-04T07:17:41.670Z |
| A3 | 73ff42c4-83e4-4259-ba11-e62f54378de7 | SEQUENTIAL | 1 | official-evidence/final/A3/ | 2026-11-04T07:17:48.921Z → 2026-11-04T07:35:25.056Z |
| B3 | b3f71399-8762-4c92-ac3e-5043ca93bddd | CONCURRENT | 5 | official-evidence/final/B3/ | 2026-11-04T07:35:32.338Z → 2026-11-04T07:53:14.341Z |
| B1R (chạy lại) | 3c29a809-ed31-4501-8dae-0e3ee60ffd4e | CONCURRENT | 5 | official-evidence/rerun-B1/final/B1/ | 2026-11-04T07:53:45.261Z → 2026-11-04T08:11:28.235Z |

Mỗi lượt có: run-manifest.json, per-result.jsonl, metrics.json, before.json, after.json, verification/ (comparison-report.json, per-result-verification.jsonl, field-comparisons.jsonl, summary.md), orchestration.log, code-and-environment.txt, run-result.txt.
