# SPP-73 — Nhật ký lỗi

Ngày: 03/11/2026. Không sửa oracle, dataset hay seed; không sửa code để ép PASS.

## Lỗi phát hiện và đã sửa
| Mã | Kịch bản / tái hiện | Expected | Actual | Nguyên nhân | Sửa | Chạy lại |
|---|---|---|---|---|---|---|
| DEF-01 | Chạy `pilot-evidence/reset.sql` sau pilot nhỏ (10 kết quả) | Reset về baseline | `ERROR … exchange_event_attempt_same_exchange_fk`; transaction rollback, không mất dữ liệu | Xóa `exchange_attempts` trước `exchange_events`; bản thử rollback trên DB rỗng không lộ lỗi | Đổi thứ tự DELETE trong `reset.sql` | Reset COMMIT thành công 3 lần; baseline 1 event/1 exchange/1 EMR (bản demo) |
| DEF-02 | Chạy A (1.000, c=1) với `SPP82_MEASURE=1` | Journal vài chục MB | `per-result.jsonl` **19 GB** (368.606 dòng) | `report-writer.record` ghi lại toàn bộ hàng, gồm mọi observation cũ, ở **mỗi lần poll** (tăng bình phương) | `report-writer.ts`: chỉ ghi khi trạng thái hàng đổi (không tính observation) + `finish()` ghi 1 snapshot cuối đầy đủ mỗi hàng; thêm test hồi quy | `test:spp82` 112/112; lượt B journal 328 MiB. Journal A (trước sửa) nén `gzip` không mất dữ liệu còn 1,49 GiB; SHA-256 bản giải nén `cefd0272…3dd478` khớp báo cáo đối chiếu |
| DEF-03 | `spp82:capture/verify` trên journal 19 GB | Đọc được | Loader đọc cả file thành một chuỗi (vượt giới hạn chuỗi JS) | `evidence-loader.ts` dùng `readFileSync(…,'utf8')` | Đọc theo luồng 8 MiB, giữ nguyên hành vi (dòng cuối bị cắt, trùng, checksum toàn file) | 40 test C pass; verify A trên journal 19 GB: PASS 1.000/1.000 |
| OPS-01 | Bắt đầu B | Dispatcher + Worker đang chạy | Hai tiến trình host không còn (mất sau lần ngắt phiên); 1.000 event nằm chờ PENDING | Môi trường, không phải lỗi mã | Hủy lượt, lưu ở `pilot-evidence/_aborted/` (không dùng làm số liệu), reset, khởi động lại 1+1 process, chạy lại B từ đầu | B PASS |

## Ghi nhận / lỗi còn tồn tại
| Mã | Mô tả | Trạng thái |
|---|---|---|
| NOTE-01 | Công cụ 82-C có mẫu số cố định 1.000: lượt con (10 kết quả) luôn trả `FAIL` dù 10/10 khớp. Đúng thiết kế, cần đọc `matched` và `missing` | Ghi nhận, không sửa |
| NOTE-02 | Concurrency của runner chỉ giới hạn Publish; thông lượng bị giới hạn bởi 1 Dispatcher + 1 Worker. Chưa xác định nút cổ chai | Mở — cần thực nghiệm với nhiều process nếu muốn đánh giá |
| NOTE-03 | Journal vẫn lớn (A nén 1,49 GiB; B 328 MiB) vì snapshot cuối chứa toàn bộ observation của mỗi hàng. **Không đưa vào Git**; thư mục `pilot-evidence/` đang không bị `.gitignore` | Mở |
| NOTE-04 | Ca lỗi trên stack pilot đã chạy (F1–F10); TC-06 chạy ngày 03/11 (PASS) | Đóng |
| NOTE-05 | Mã SPP-72/82 và các sửa SPP-73 chưa commit; A và B chạy trên code khác nhau (B sau khi sửa DEF-02/03) | Mở — SPP-74 cần khóa phiên bản |
| NOTE-06 | Mới 1 lượt mỗi scenario | Đóng — đủ 3 lượt A và B trong `final/` |
| NOTE-07 | Dữ liệu `DEMO-R1`/`DEMO-P1` có sẵn trước pilot, nằm ngoài tập 1.000, giữ nguyên qua mọi lần reset | Ghi nhận |

## Lỗi phát hiện từ ca lỗi trên stack pilot — CHƯA sửa
| Mã | Kịch bản / tái hiện | Expected (viết trước) | Actual | Phân tích | Trạng thái |
|---|---|---|---|---|---|
| DEF-04 | `docker stop` Middleware, Publish `MUT-VALID-OUT-LIS-LONG`, chờ ~30 s, `docker start`, chờ rồi Publish lại | Không ACK giả; sau khôi phục có đường gửi lại hợp lệ | Không ACK giả (đúng). Sau 4 lần `NETWORK_ERROR` (khoảng 14 s) event `FAILED` vĩnh viễn; Publish lại trả 200 `FAILED` cũ; 0 exchange, 0 hàng EMR | Ngân sách thử lại mặc định chỉ ~14 s (2/4/8 s). Hết ngân sách là trạng thái cuối; Publish lặp là idempotent nên không kích hoạt lại. Không có API/lệnh vận hành để gửi lại; kết quả mất âm thầm nếu không giám sát | **Mở.** Thiết kế có chủ ý (test "exhausts four-attempt budget"), nhưng thiếu đường phục hồi. Cần quyết định: thêm cơ chế re-drive (thay đổi ngoài phạm vi SPP-73) hoặc chấp nhận và nâng `LIS_DISPATCHER_RETRY_DELAYS_MS` (chưa thử) kèm giám sát `FAILED` |
| DEF-05 | `docker stop` EMR, Publish `MUT-VALID-OUT-EMR-LONG`, chờ 60 s, `docker start`, chờ rồi Publish lại | Không DELIVERED giả; sau khôi phục có đường gửi lại hợp lệ | Không DELIVERED giả, 0 hàng EMR (đúng). 4 lần SEND `NETWORK_ERROR`; exchange `FAILED` vĩnh viễn dù EMR đã lên; Publish lại trả 200 `ACK`, không gửi lại. **LIS vẫn hiển thị `ACK`** | Tương tự DEF-04 ở chặng Middleware→EMR. `ACK` của LIS chỉ nghĩa Middleware đã nhận, dễ bị hiểu nhầm là đã tới EMR | **Mở.** Hướng xử lý như DEF-04 (`MIDDLEWARE_WORKER_RETRY_DELAYS_MS`, chưa thử) |

Cả hai chưa sửa mã: cần quyết định thiết kế, nằm ngoài sửa tối thiểu. Hiện trường hợp mất kết nối ngắn (vài giây) phục hồi đúng (F7, F9); mất lâu hơn ngân sách thì cần can thiệp thủ công.

## Cập nhật 03/11/2026 — xử lý DEF-04/DEF-05 và lỗi mới
| Mã | Trạng thái | Cách xử lý | Chạy lại (bằng chứng) |
|---|---|---|---|
| DEF-04 | **Đã xử lý ở mức MVP** | (1) Tăng `LIS_DISPATCHER_RETRY_DELAYS_MS` lên `2000,4000,8000,16000,32000,64000` (7 lần thử, ~126 s) — không đổi mã. (2) Công cụ vận hành `backend/scripts/ops/requeue-failed.ts` để gửi lại một event `FAILED` do lỗi tạm thời sau khi vượt cửa sổ | F8-R PASS (30 s tự phục hồi); F8-Z vượt cửa sổ vẫn `FAILED` (giới hạn xác nhận) rồi R3 gửi lại PASS, 1 event/1 exchange/1 hàng EMR — `pilot-evidence/faults-retry-config/transcript.log` |
| DEF-05 | **Đã xử lý ở mức MVP** | Tương tự cho Worker (`MIDDLEWARE_WORKER_RETRY_DELAYS_MS`), requeue chặng `middleware` (SEND hoặc VERIFY), ghi `OPERATOR_REQUEUE` vào `exchange_events` | F10-R PASS (60 s); F10-Z `FAILED`; R4 gửi lại PASS (1 exchange, 1 hàng EMR) |
| DEF-06 | **Đã sửa (phần công cụ)** | Việc không có đường gửi lại: thêm `ops:requeue-failed` + 13 test `npm run test:ops` (từ chối lỗi vĩnh viễn, sai trạng thái, ngân sách nhỏ, VERIFY không gửi lại SEND, dry-run không đổi gì) | `test:ops` 13/13; thử thật R1–R4 |
| OPS-02 | Đã khắc phục, ghi nhận | Khi khởi động lại dịch vụ, lệnh tắt tiến trình cũ của tôi không khớp (tên tiến trình `node-MainThread`) nên có ~1 phút chạy **2 Dispatcher + 2 Worker** trước khi F8-R; đã tắt tiến trình cũ trước khi chạy F8-R. Từ đó trình điều khiển `final/run-all.sh` từ chối chạy nếu số tiến trình ≠ 1+1 | Ghi trong `faults-retry-config/transcript.log`; `final/*/code-and-environment.txt` có `dispatcher_processes=1 worker_processes=1` |
| OPS-03 | **Mở** | Máy suspend (đóng nắp) giữa lượt B2 (11:01:53 UTC); số đo thời gian B2 không tin cậy, dữ liệu vẫn PASS | Journal hệ thống; `final/B2/artifact-82b/run-manifest.json` (UTC chênh 3.395,6 s so với 1.067,8 s monotonic). Cần chạy lại B2 để có số đo sạch |

Lưu ý còn mở: NOTE-02 (nút cổ chai, thử nhiều process), NOTE-03 (journal lớn, `pilot-evidence/` ≈ 2 GB, không commit), NOTE-05 (code chưa commit — SPP-74). NOTE-04 đã đóng: F1–F10 và TC-06 đã chạy trên stack pilot. NOTE-06 đã đóng: đủ 3 lượt mỗi chế độ.
