# SPP-72 — Bằng chứng

## Kết quả 1.000/1.000 do người dùng báo cáo
Trạng thái: **USER_REPORTED** — người kiểm thử đã chạy và xác nhận 1.000/1.000, chấp nhận SPP-72 ngày 03/11/2026; **không có log/artifact** (không tạo bù). Về mặt file bằng chứng vẫn là chưa xác minh.

Đã tìm trong repository, `~/Downloads/DACN`, `../dataset` và toàn bộ hệ thống tệp (tên `per-result*`, `comparison-report*`, `before/after*.json`, `*.jsonl`, `*.log`): **không có** file nào của lần chạy 1.000 kết quả.
Chỉ có: (a) `docs/docs_backend/spp-82-b-example/` — dữ liệu **mô phỏng** 3 ID; (b) `docs/docs_backend/spp-82-c-missing-evidence/` — báo cáo NOT_VERIFIED, 0/1000.
Vì vậy chưa thể xác nhận nguồn gốc, số lượng, khớp/thiếu/sai/trùng, hay phạm vi (dữ liệu hay toàn luồng LIS→Middleware→EMR). Không suy hiệu năng từ 100%.

### File cần bổ sung (tùy chọn, nếu sau này cần chuyển sang VERIFIED)
1. `run-manifest.json`, `per-result.jsonl`, `metrics.json`, `summary.md` của run 82-B (hoặc output JSONL của 82-A).
2. `before.json` (chụp **trước** run) và `after.json` (từ `spp82:capture`).
3. Thư mục báo cáo `spp82:verify`: `comparison-report.json`, `per-result-verification.jsonl`, `field-comparisons.jsonl`, `summary.md`.
4. Nếu chạy bằng cách khác: lệnh đã dùng, commit, mô tả môi trường, log truy vấn đếm 1.000 hàng EMR.
Nếu chỉ so dữ liệu (không qua Publish), nói rõ — khi đó chỉ là kiểm dữ liệu, không phải bằng chứng luồng.

## Bằng chứng đã xác minh trong phiên SPP-72 (03/11/2026)
| Kiểm tra | Kết quả | Mức |
|---|---|---|
| `cd backend && npm run check` | exit 0 | VERIFIED |
| `cd backend && npm run test:spp82` | 111 test, 111 pass, 0 fail, 0 skip | VERIFIED |
| `expected.jsonl` | 1.000 `result_id` duy nhất, 100 bệnh nhân | VERIFIED |
| Seed | 1.000 dòng `synthetic:false`, 40 dòng `in_functional_40` | VERIFIED |

Test là kiểm tra bằng dữ liệu giả/reader giả; **không** chứng minh luồng thật.

## Bằng chứng cũ có thể tham chiếu (SPP-66, không chạy lại)
`docs/docs_backend/evidence/spp-66-d3-test-output.txt`, `spp-66-c4-test-output.txt`, `spp-66-d3.json` — fixture tự soạn, DB cô lập.

## Chưa chạy (NOT_RUN)
`npm run test:e2e:postgres`, `test:integration:postgres`, mọi ca TC-01…TC-12, TC-14, TC-15: cần Docker/PostgreSQL cô lập đã được phê duyệt.

## Danh sách đính kèm Jira
`test-cases.md`, `test-data-and-mutations.md`, `independent-verification.md`, `load-test-protocol.md`, `review-checklist.md`, `completion-report.md`, và (khi có) các file ở mục "File cần bổ sung".
