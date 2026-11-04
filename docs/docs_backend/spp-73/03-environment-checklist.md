# SPP-73 — Checklist môi trường

Trạng thái ngày 03/11/2026: **chưa sẵn sàng**. Tất cả mục dưới đây là ô kiểm, chưa đánh dấu.
Không in mật khẩu, không ghi connection string có thông tin đăng nhập.

## Dịch vụ và cổng (theo `compose.yaml`)
| Thành phần | Cổng trên máy host | Lệnh khởi chạy (từ `backend/`, có trong `package.json`) | Trạng thái đo |
|---|---|---|---|
| PostgreSQL | 127.0.0.1:5433 | `docker compose up -d db` (từ gốc repo) | ☐ closed (đã kiểm) |
| LIS API | 127.0.0.1:3101 | `npm run start:lis` (sau build) hoặc `dev:lis` | ☐ closed |
| LIS Dispatcher | — | `npm run dev:lis-dispatcher` | ☐ chưa chạy |
| Middleware API | 127.0.0.1:3102 | `npm run dev:middleware` | ☐ closed |
| Middleware Worker | — | `npm run dev:middleware-worker` | ☐ chưa chạy |
| EMR | 127.0.0.1:3103 | `npm run dev:emr` | ☐ closed |

## Biến môi trường (chỉ kiểm tên, không in giá trị)
- Có tệp `.env` ở gốc repo (đã kiểm tra tên biến, không in giá trị). Biến SPP82_* và VERIFY_* chưa kiểm tra trong `.env`: ghi là CHƯA XÁC MINH.
- Bắt buộc cho pilot: `LIS_BASE_URL`, `LIS_DATABASE_URL`, `MIDDLEWARE_BASE_URL`, `MIDDLEWARE_DATABASE_URL`, `EMR_BASE_URL`, `EMR_DB_PASSWORD`, `LIS_DB_PASSWORD`, `MIDDLEWARE_DB_PASSWORD`.
- Cho đo 82-B: `SPP82_MEASURE=1`, `SPP82_SCENARIO`, `SPP82_DECLARED_DISPATCHER_COUNT`, `SPP82_DECLARED_WORKER_COUNT`, `SPP82_POLL_MS`, `SPP82_RUN_TIMEOUT_MS`, `SPP82_OBSERVER_CONCURRENCY`, `SPP82_ARTIFACT_DIR` (thư mục MỚI).
- Cho lượt chính thức: `SPP82_EXPERIMENT_TARGET` (chỉ đặt khi môi trường đã được phê duyệt).
- Cho đối chiếu: `LIS_VERIFY_DATABASE_URL`, `MIDDLEWARE_VERIFY_DATABASE_URL`, `EMR_VERIFY_DATABASE_URL`, `SPP82_VERIFICATION_ISOLATION_TOKEN`.
- Chưa xác định giá trị timeout/retry/số worker cho pilot — **không tự đoán**; ghi khi có quyết định.

## Cơ chế xác nhận môi trường cô lập
- `publish-runner` yêu cầu `--confirm-publish` **và** `SPP82_EXPERIMENT_TARGET`; thiếu một trong hai thì không Publish.
- `spp82:capture` kiểm tra database có comment `spp66-disposable:<token>` khớp `SPP82_VERIFICATION_ISOLATION_TOKEN` trước khi SELECT.
- Các guard này không thay thế việc xác nhận bằng con người: phải có phê duyệt môi trường thử nghiệm riêng.

## Nạp dữ liệu
- Docker tự nạp `database/seed/01_reference_data.sql` và `02_lis_results.sql` **chỉ khi volume mới** (`database/seed/README.md`).
- Kiểm tra sau nạp: 1.000 kết quả, 40 chức năng, 0 event/exchange/EMR. Câu lệnh kiểm tra nằm trong README chính (mục "Lựa chọn A", dòng chứa `functional_40`).
- Nạp lại vào DB đã có dùng `ON CONFLICT DO NOTHING`, không ghi đè nội dung khác — cần kiểm tra lại sau khi nạp.

## Reset (MISSING)
- Không có script reset tự động trong repository.
- Thủ công, chỉ trên DB cô lập đã được phê duyệt: tạo volume mới hoặc `DROP/CREATE` database thử nghiệm riêng; nạp lại seed; xác nhận bằng đếm (`SELECT COUNT(*)`) rằng không còn event/exchange/EMR.
- **Không** thực hiện reset trên DB đang dùng cho bằng chứng.
- Đề xuất cho giai đoạn 2: viết script reset có guard (cần quyết định, không tự làm).

## Ô xác nhận (để trống)
- ☐ Môi trường cô lập được phê duyệt bởi: ____________ (ngày: ______)
- ☐ Các dịch vụ đã chạy và `/ready` trả về đúng
- ☐ Seed đã nạp, đếm 1.000/40 đúng
- ☐ Reset đã được kiểm tra trên môi trường thử
