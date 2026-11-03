# SPP-73 — Protocol thực nghiệm (dự kiến khóa)

Written for: người chạy thực nghiệm và người nhận bàn giao SPP-74.

Trạng thái: **CHƯA KHÓA CHÍNH THỨC.** Tài liệu liệt kê thông số đã xác minh bằng chạy thật, và thông số chưa xác minh. Chỉ thông số ghi "ĐÃ XÁC MINH" mới được đưa vào protocol. Việc khóa Git tag và môi trường chính thức thuộc SPP-74, không làm ở đây.

Ký hiệu: **ĐÃ XÁC MINH** (có bằng chứng đo), **GIẢ ĐỊNH** (cấu hình có, chưa đo hành vi), **CHƯA XÁC MINH** (không có bằng chứng).

## 1. Tập dữ liệu và cách kiểm nguồn

| Mục | Giá trị | Trạng thái | Bằng chứng |
|---|---|---|---|
| Nguồn | MIMIC-IV Demo 2.2 | ĐÃ XÁC MINH | `database/seed/*.sql` |
| Seed tag | `DACN-MIMIC22-SOURCE-ALIGNED-V2` | ĐÃ XÁC MINH | `final/*/code-and-environment.txt` |
| Số kết quả mỗi lượt | 1.000 (100 bệnh nhân, 40 chức năng) | ĐÃ XÁC MINH | `final/*/artifact-82b/metrics.json` (`planned_count=1000`) |
| SHA-256 `01_reference_data.sql` | `b66613cf…23e5` | ĐÃ XÁC MINH | `final/A1/code-and-environment.txt` |
| SHA-256 `02_lis_results.sql` | `28b21b4e…fe7` | ĐÃ XÁC MINH | như trên |
| Đáp án chuẩn (oracle) | `scripts/spp82/reference/spp65-v2/manifest.json` | ĐÃ XÁC MINH | SHA-256 `55cb4256…7267`, khớp cả 6 lượt |
| Dữ liệu lỗi (MUT-*) | Không được dùng trong lượt chính thức | Quy định | `pilot-evidence/faults/mutations.sql` |

Cách kiểm nguồn trước mỗi lượt: `reset.sql` rồi đếm — phải đúng `events=1 exch=1 emr=1 seed=1000 mut=0` (`final/run-all.sh`). Sai là dừng, không chạy.

## 2. Chế độ thực hiện

| Thông số | Giá trị | Trạng thái | Ghi chú |
|---|---|---|---|
| Chế độ tuần tự | `SEQUENTIAL`, `--concurrency 1` | ĐÃ XÁC MINH | 3 lượt (A1–A3) |
| Chế độ đồng thời | `CONCURRENT`, `--concurrency 5` | ĐÃ XÁC MINH | 3 lượt (B1–B3) |
| Số Publish thực tế đang chờ tới LIS khi c=5 | — | **CHƯA XÁC MINH** | Chưa đo. Chỉ biết đây là giới hạn cấu hình. Xem 05, mục "Cách đọc số đo" |
| Số lượt lặp | 3 mỗi chế độ | ĐÃ XÁC MINH | Đủ 6 lượt, cùng mã và cấu hình |
| Thứ tự chạy | xen kẽ A1 B1 A2 B2 A3 B3 | ĐÃ XÁC MINH | `final/run-all.log` |

Kết luận có thể dùng: **kết quả tuần tự và đồng thời đều đúng 1.000/1.000.** Không dùng để kết luận chế độ nào nhanh hơn (xem 07, mục 2.1).

## 3. Dispatcher, Worker và số tiến trình

| Thông số | Giá trị | Trạng thái |
|---|---|---|
| Số LIS Dispatcher | 1 | ĐÃ XÁC MINH (kiểm tra trước mỗi lượt) |
| Số Middleware Worker | 1 | ĐÃ XÁC MINH |
| Nhiều Dispatcher/Worker song song | — | **CHƯA XÁC MINH** (chưa thử) |

Trình chạy `run-all.sh` từ chối chạy nếu số tiến trình khác 1+1.

## 4. Timeout, retry và polling

| Thông số | Giá trị | Trạng thái | Bằng chứng |
|---|---|---|---|
| Thử lại Dispatcher (LIS) | `LIS_DISPATCHER_RETRY_DELAYS_MS=2000,4000,8000,16000,32000,64000,64000` (8 lần thử, tổng thời gian chờ ~190 s) | ĐÃ XÁC MINH | `faults-retry-config/`, `final/*/code-and-environment.txt` |
| Thử lại Worker (Middleware→EMR) | `MIDDLEWARE_WORKER_RETRY_DELAYS_MS=` cùng giá trị | ĐÃ XÁC MINH | như trên |
| Cấu hình mặc định (không khuyến nghị) | `2000,4000,8000` (4 lần thử, ~14 s) | ĐÃ XÁC MINH là chưa đủ | DEF-04/05 |
| Thời gian chờ HTTP | 10.000 ms | ĐÃ XÁC MINH (ghi trong run) | `05-pilot-results.md` |
| Polling (hỏi trạng thái) | 1.000 ms | ĐÃ XÁC MINH | như trên |
| Thời gian tối đa một lượt | 3.600.000 ms (`SPP82_RUN_TIMEOUT_MS`) | ĐÃ XÁC MINH | `tools/run-scenario.sh` |
| Quan sát (observer) | concurrency 2 | ĐÃ XÁC MINH | |
| Chống trùng | Publish lặp trả event cũ; EMR trả `ALREADY_EXISTS` | ĐÃ XÁC MINH | TC-07, F5 |
| Gián đoạn vượt cửa sổ | Gửi lại thủ công `ops:requeue-failed --budget N --confirm` | ĐÃ XÁC MINH (R3, R4) | `faults-retry-config/` |

## 5. Khởi động dịch vụ

Thứ tự đã dùng:
1. Khởi động PostgreSQL 17 (`docker compose up -d db`, port 5433).
2. Khởi động LIS, Middleware, EMR (container). Kiểm `/ready` của 3101, 3102, 3103 đều trả 200 (xác minh lại ngày 03/11/2026).
3. Khởi động 1 Dispatcher và 1 Worker bằng `npm run dev:lis-dispatcher` và `npm run dev:middleware-worker` kèm biến retry ở mục 4. Tiến trình chạy nền.

Chi tiết lệnh: [09-reproduction-guide.md](09-reproduction-guide.md).

## 6. Reset và kiểm tra reset

| Bước | Thông số | Trạng thái |
|---|---|---|
| Điều kiện an toàn | DB có comment `spp66-disposable:<token>`, token khớp `SPP82_VERIFICATION_ISOLATION_TOKEN` | ĐÃ XÁC MINH (bước đọc comment, không lộ token) |
| Script reset | `pilot-evidence/reset.sql` (xóa theo thứ tự đúng, chỉ dữ liệu 1.000 seed) | ĐÃ XÁC MINH (DEF-01 đã sửa) |
| Kiểm baseline | `events=1 exch=1 emr=1 seed=1000 mut=0` | ĐÃ XÁC MINH mỗi lượt |
| Không reset khi | DB không có comment guard, hoặc không chắc là DB cô lập | Quy định |

## 7. Thu thập và lưu bằng chứng

Mỗi lượt tạo thư mục mới, không ghi đè (`run-all.sh` từ chối nếu thư mục đã tồn tại):
- `before.json`, `after.json`: ảnh chụp trạng thái trước và sau.
- `artifact-82b/`: `run-manifest.json`, `per-result.jsonl` (nhật ký từng kết quả), `metrics.json`, `summary.md`.
- `verification/`: `comparison-report.json`, `field-comparisons.jsonl`, `per-result-verification.jsonl`, `summary.md`.
- `orchestration.log`, `code-and-environment.txt` (commit, hash cây mã, hash seed, số tiến trình, biến retry, container).

Quy định: không chạy lại trên artifact cũ; không sửa đáp án; không xóa bằng chứng đã có.

## 8. Tiêu chí PASS của một lượt

Một lượt PASS khi công cụ đối chiếu độc lập (`spp82:verify`) trả `outcome=PASS`, tức đủ: khớp đủ 1.000; 0 thiếu; 0 trùng; 0 sai trường; 0 sai bệnh nhân; 0 dữ liệu cũ; 0 hàng thừa. Trạng thái `DELIVERED` trong hệ thống **không** đủ để kết luận PASS.

## 9. Việc cần làm trước khi khóa (SPP-74)

1. Commit mã đã chạy, hoặc ghi rõ commit/snapshot tương ứng với `source_tree_sha256=49e9ebcb…14e2e`.
2. Quyết định cách lưu `pilot-evidence/` (khoảng 3,9 GB).
3. Quyết định có chạy lại B2 để có số thời gian sạch không.
4. Nếu muốn kết luận về c=5 hoặc nhiều Dispatcher/Worker, tạo thực nghiệm riêng với giả thuyết và tiêu chí trước khi chạy.
