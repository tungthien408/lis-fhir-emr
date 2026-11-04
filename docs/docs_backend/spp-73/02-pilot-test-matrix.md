# SPP-73 — Ma trận chạy thử

Dữ liệu: 1.000 `result_id` FINAL của seed `DACN-MIMIC22-SOURCE-ALIGNED-V2`. Đáp án: `backend/scripts/spp82/reference/spp65-v2/`. Không dùng dòng `MUT-*`.
Trạng thái mọi scenario: **NOT_RUN** (chưa có môi trường).

## Giới hạn concurrency (phải đọc trước)
- `--concurrency N` chỉ giới hạn số **HTTP Publish đang chờ tới LIS** (`load-config.ts`). Không phải số giao dịch đang được EMR xử lý.
- Dispatcher của LIS xử lý mỗi process một event mỗi vòng; Worker của Middleware cũng vậy. Song song phía sau chỉ đạt được khi chạy nhiều process.
- Vì vậy **không được ghi** "5 kết quả được EMR xử lý song song" nếu chỉ có 1 Dispatcher và 1 Worker. Số process phải khai báo (`SPP82_DECLARED_DISPATCHER_COUNT`, `SPP82_DECLARED_WORKER_COUNT`).

## Scenario A — tuần tự
| Mục | Nội dung |
|---|---|
| Concurrency | 1 (`--mode SEQUENTIAL`) |
| Số kết quả | 1.000 |
| Số lượt | 3 (chính thức); pilot: chạy lượt 0 với `--limit 10` để kiểm tra |
| Điều kiện trước | DB cô lập, seed đúng checksum, 0 event/exchange/EMR, `spp82:capture --phase before` |
| Cấu hình | `SPP82_MEASURE=1`, `SPP82_SCENARIO=A-seq-rN`, Dispatcher 1, Worker 1, HTTP timeout 10 s (mặc định), `SPP82_POLL_MS=1000`, `SPP82_RUN_TIMEOUT_MS` đặt theo pilot |
| Phát dữ liệu | `publish-runner-main.ts --confirm-publish --mode SEQUENTIAL --output <file>` |
| Đợi EMR | observer 82-B theo dõi ACK → DELIVERED → đọc lại EMR |
| Đối chiếu | `spp82:capture --phase after` rồi `spp82:verify` (exit 0/1/2) |
| Ghi thời gian, lỗi | `metrics.json`, `per-result.jsonl`, `comparison-report.json` |
| Reset | Xem `03-environment-checklist.md` mục "Reset" — chưa có lệnh tự động |

## Scenario B — đồng thời
| Mục | Nội dung |
|---|---|
| Concurrency | 5 HTTP Publish in-flight (`--mode CONCURRENT --concurrency 5`) |
| Số kết quả | 1.000 |
| Số lượt | 3 (chính thức); pilot: `--limit 10` |
| Điều kiện trước | Như A; **khai báo số Dispatcher và Worker thực tế** |
| Cấu hình | `SPP82_SCENARIO=B-con5-rN`, `SPP82_OBSERVER_CONCURRENCY=2`, còn lại như A |
| Phát dữ liệu | `--mode CONCURRENT --concurrency 5` |
| Đợi / đối chiếu / ghi | Như A |
| Reset | Như A |

## Điều kiện để pilot được coi là "thực hiện được"
- Scenario A và B đều chạy được ở `--limit 10` với đủ artifact và `spp82:verify` trả kết quả rõ (PASS/FAIL/NOT_VERIFIED).
- Không lượt nào dùng artifact cũ; thư mục output mới.
- Ghi rõ lý do nếu lượt bị loại.

Trạng thái: NOT_RUN. Không có số liệu nào ở đây.
