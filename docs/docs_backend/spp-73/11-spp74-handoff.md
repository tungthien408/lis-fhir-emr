# SPP-73 → SPP-74 — Bàn giao

Written for: người nhận SPP-74 (khóa phiên bản và môi trường chính thức).

Trạng thái: **NOT_READY** cho đến khi xử lý 2 blocker. Xem `07-pilot-summary.md`, mục 6.

## 1. SPP-74 cần làm gì (theo SPP-73)

- Khóa Git tag và môi trường chính thức. Việc này **không** làm trong SPP-73.
- Quyết định các mục "CHƯA XÁC MINH" trong `08-locked-protocol.md`.
- Dựng môi trường chính thức và chạy lại theo `09-reproduction-guide.md`, không dùng máy pilot làm môi trường chính thức.

## 2. Việc SPP-74 phải nhận trước khi khóa

| # | Việc | Lý do | Ai quyết |
|---|---|---|---|
| 1 | Commit hoặc snapshot mã tương ứng `source_tree_sha256=49e9ebcb…14e2e` | Mã pilot hiện chưa có trong Git | Người phụ trách repo |
| 2 | Quyết định nơi lưu `pilot-evidence/` (~3,9 GB) | Không đưa vào Git | Nhóm |
| 3 | Quyết định có chạy lại B2 không | Số thời gian B2 không tin cậy | Nhóm |
| 4 | Chấp nhận giới hạn gián đoạn dài (cần gửi lại thủ công) | DEF-04/05 | Chủ trì |
| 5 | Quyết định có thử nhiều Dispatcher/Worker không | Chưa biết nút cổ chai | Nhóm |
| 6 | Quyết định có tách thời gian từng chặng không | LIS không công khai thời điểm ACK | Nhóm |

## 3. Giả định SPP-74 không được tự ý thay đổi

- Oracle `spp65-v2`, SHA-256 `55cb4256…7267`. Không sửa để đạt PASS.
- Seed `DACN-MIMIC22-SOURCE-ALIGNED-V2`. Không sửa `database/seed/`.
- Cấu hình thử lại 2 → 64 giây, 8 lần thử (`LIS_DISPATCHER_RETRY_DELAYS_MS`, `MIDDLEWARE_WORKER_RETRY_DELAYS_MS`). Nếu đổi phải chạy lại thử lỗi F8/F10.
- Tiêu chí PASS của lượt: `spp82:verify` trả `outcome=PASS`. `DELIVERED` không đủ.

## 4. Những gì không được kết luận từ pilot

- B nhanh hơn A (bằng chứng không ủng hộ).
- Hiệu năng trên môi trường khác hoặc tải khác.
- Khả năng mở rộng khi tăng số Dispatcher/Worker.
- Thời gian phục hồi tổng quát (chỉ đo với 2 kịch bản gián đoạn 30 s và 60 s).

## 5. Vị trí bằng chứng

| Nội dung | Đường dẫn |
|---|---|
| Thông số đã khóa | `08-locked-protocol.md` |
| Lệnh tái lập | `09-reproduction-guide.md` |
| Kết quả chi tiết | `05-pilot-results.md` |
| Nhật ký lỗi | `06-defect-log.md` |
| 6 lượt chính thức | `pilot-evidence/final/` |
| Script điều khiển | `scripts/pilot/run-scenario.sh`, `scripts/pilot/run-all.sh` |
| Ca lỗi | `pilot-evidence/faults/`, `pilot-evidence/faults-retry-config/` |
| TC-06 | `pilot-evidence/tc06-swapped-patient/` |
| Công cụ gửi lại | `backend/scripts/ops/requeue-failed.ts` (+ test `backend/scripts/ops/requeue-failed.test.ts`) |

## 6. Việc còn mở khi bàn giao

- DEF-04/05: đã xử lý mức MVP, cần thao tác tay với gián đoạn dài.
- OPS-03: B2 chưa có số thời gian sạch.
- NOTE-02: nút cổ chai chưa xác định.
- NOTE-03: journal lớn, không commit.
- NOTE-05: mã chưa commit.

Dispatcher và Worker đang chạy nền trên máy pilot (mỗi loại 1). SPP-74 nên dừng chúng và dựng lại trên môi trường chính thức.
