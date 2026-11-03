# SPP-72 — Giao thức thử tải 1.000 kết quả (thiết kế cho SPP-73)

**Đây là thiết kế, chưa chạy. Không có số đo nào trong tài liệu này; pilot chưa đạt/chưa chạy.**
Công cụ có sẵn: 82-A (`spp82:dry-run`, `publish-runner-main.ts`), 82-B (`SPP82_MEASURE=1`), 82-C (`spp82:verify`).

## Tập dữ liệu
1.000 `result_id` FINAL của seed `DACN-MIMIC22-SOURCE-ALIGNED-V2`, sắp `result_id ASC`; 82-A yêu cầu đủ 1.000 trước khi áp `--limit`. Đã kiểm: 1.000 ID duy nhất trong seed và `expected.jsonl`. Không trộn dòng `MUT-*`.

## Cấu hình
| Cấu hình | Mode | Concurrency (Publish in-flight) | Số lượt |
|---|---|---|---|
| A | SEQUENTIAL | 1 | 3 |
| B | CONCURRENT | 5 (tối đa của tool = 10) | 3 |

Ghi `SPP82_SCENARIO` (vd `A-seq-r1`), `SPP82_DECLARED_WORKER_COUNT`, `SPP82_DECLARED_DISPATCHER_COUNT`, `SPP82_MANIFEST_HASH`. Số worker giữ cố định giữa các lượt (đề xuất 1 Dispatcher + 1 Worker; ghi rõ nếu khác).
Lượt đầu nên là lượt khởi động bị loại khỏi thống kê hoặc ghi chú rõ nếu giữ.

## Tham số
| Tham số | Giá trị mặc định của tool | Ghi chú |
|---|---|---|
| HTTP timeout Publish | 10.000 ms (`DEFAULT_HTTP_TIMEOUT_MS`) | Có thể đổi, phải khai báo |
| `SPP82_POLL_MS` | 1000 | Làm tăng độ trễ quan sát |
| `SPP82_RUN_TIMEOUT_MS` | 120000 | **Không đủ cho 1.000 kết quả tuần tự**; SPP-73 phải đặt lại theo pilot nhỏ, không ước đoán ở đây |
| `SPP82_OBSERVER_CONCURRENCY` | 2 (tối đa 10) | |
| Retry Publish | **Không tự retry POST** (mất response = unknown) | Retry của Dispatcher/Worker do service quản lý, ghi lại |

## Quy trình mỗi lượt
1. Tạo DB cô lập mới (volume mới, không dùng DB demo), nạp 2 file seed đã pin checksum; xác nhận 1.000 kết quả, 0 event, 0 exchange, 0 hàng EMR.
   *Chưa có script reset tự động; thao tác thủ công trong môi trường được phê duyệt. Không reset DB đang dùng.*
2. `spp82:capture --phase before`.
3. Dry-run (`spp82:dry-run`) xác nhận chọn đúng 1.000.
4. Chạy thật: `--confirm-publish` + `SPP82_EXPERIMENT_TARGET`, `SPP82_MEASURE=1`, thư mục artifact MỚI.
5. Chờ ổn định (mọi exchange terminal hoặc hết timeout), `spp82:capture --phase after --run-dir ...`.
6. `spp82:verify` → report; lưu artifact; không chạy lại trên artifact cũ.

## Chỉ số (định nghĩa theo 82-B)
- Latency chính = `emr_readback_observed − publish_request_start` (monotonic), chỉ cho Publish NEW đã ACK + DELIVERED + đọc lại đúng. Điểm kết thúc là lúc **client đọc lại được từ EMR**.
- Tổng thời gian = ended − started (gồm queue, polling, chờ timeout). Thông lượng = số hoàn tất / tổng thời gian (kết quả/giây).
- p50/p95: nearest-rank trên số hoàn tất; chỉ báo khi đủ mẫu; null nếu không có.
- Lỗi/mất/trùng: từ `comparison-report.json` (missing, duplicate, field-mismatch, extra) + `metrics.json` (failure/timeout/existing). Mẫu số luôn 1.000.
- Báo cáo trung vị/độ phân tán của 3 lượt mỗi cấu hình; không gộp cấu hình A và B.
- Không suy hiệu năng từ tỷ lệ khớp; không so mốc thời gian giữa các máy.

## Điều kiện dừng / không hợp lệ
Thiếu before, run_id không khớp, DB không qua guard cô lập, hoặc artifact thư mục đã tồn tại ⇒ lượt không hợp lệ (NOT_VERIFIED). Lượt timeout vẫn giữ mẫu số 1.000.
