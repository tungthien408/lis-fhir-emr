# SPP-73 — Hướng dẫn chạy

> **Cập nhật giai đoạn 3 (03/11/2026):** Mục B và C dưới đây là kế hoạch ban đầu trước pilot. Quy trình đã chạy thật và xác minh nằm ở [09-reproduction-guide.md](09-reproduction-guide.md) (lệnh đã dùng) và [08-locked-protocol.md](08-locked-protocol.md) (thông số đã khóa). Tài liệu này không dùng để tuyên bố pilot đạt.

Mục đích: mô tả lệnh **đã xác minh** trong repository và các lệnh **dự kiến** (ban đầu chưa chạy).

## A. Lệnh đã chạy và xác minh (03/11/2026)
Chạy từ `backend/`:
```bash
npm run check                 # exit 0
npm run test:spp82            # 112 pass, 0 fail (cập nhật sau DEF-02/03)
```
Dry-run cần `LIS_BASE_URL` và `LIS_DATABASE_URL`. Đã chạy không có cấu hình: exit 1, báo thiếu `LIS_BASE_URL`. Đã chạy với `LIS_BASE_URL=http://127.0.0.1:3101`: exit 1 do `ECONNREFUSED 127.0.0.1:5433` (DB chưa chạy).
```bash
LIS_BASE_URL=http://127.0.0.1:3101 npm run spp82:dry-run   # dự kiến chạy được khi DB đã lên
```

## B. Lệnh dự kiến — CHƯA CHẠY
Các lệnh sau khớp với `package.json` nhưng **chưa được thực thi** vì môi trường chưa có:

1. Khởi động DB (từ gốc repo): `docker compose up -d db` — DỰ KIẾN.
2. Khởi động dịch vụ, mỗi lệnh một terminal: `npm run dev:lis`, `npm run dev:lis-dispatcher`, `npm run dev:middleware`, `npm run dev:middleware-worker`, `npm run dev:emr` — DỰ KIẾN.
3. Kiểm tra `/ready` của từng dịch vụ — DỰ KIẾN (đường dẫn chưa xác minh trong phiên này).
4. Lượt thử nhỏ (không phải pilot chính thức):
   ```bash
   SPP82_MEASURE=1 SPP82_SCENARIO=pilot-seq-r0 SPP82_ARTIFACT_DIR=<thư-mục-mới> \
   MIDDLEWARE_BASE_URL=http://127.0.0.1:3102 EMR_BASE_URL=http://127.0.0.1:3103 \
   SPP82_DECLARED_DISPATCHER_COUNT=1 SPP82_DECLARED_WORKER_COUNT=1 \
   npm run spp82:dry-run -- --limit 10     # DỰ KIẾN: chỉ kiểm cấu hình
   ```
   Lượt Publish thật cần `--confirm-publish` và `SPP82_EXPERIMENT_TARGET` — DỰ KIẾN, **chưa được phê duyệt**.
5. Chụp trạng thái trước: `npm run spp82:capture -- --oracle scripts/spp82/reference/spp65-v2/manifest.json --oracle-sha256 55cb4256c77d731bff7e8ea1c1ad7f9788df889b4833d9a6b501282c169c7267 --phase before --output <file-mới>` — DỰ KIẾN (đã kiểm tham số trong `verification-main.ts`).
6. Đối chiếu offline: `npm run spp82:verify -- ... --output <thư-mục-mới>` — DỰ KIẾN với artifact thật; đã kiểm tra cú pháp tham số qua `--help` trong mã nguồn, không có artifact để chạy.

## C. Thứ tự cho lượt chính thức (sau khi có phê duyệt)
1. Môi trường cô lập và seed đã kiểm (xem `03-environment-checklist.md`).
2. Dry-run xác nhận chọn đúng 1.000.
3. `capture --phase before`.
4. Publish với `--mode` theo scenario.
5. Chờ hết exchange hoặc hết timeout.
6. `capture --phase after` rồi `verify`.
7. Lưu artifact, không chạy lại trên artifact cũ.

Không tự reset giữa các lượt; xem mục Reset trong checklist.

## D. Cấu hình thử lại và gửi lại giao dịch `FAILED` (bổ sung sau pilot, 03/11/2026)
Đã chạy và xác minh (bằng chứng: `pilot-evidence/faults-retry-config/`).

**Cấu hình thử lại** (truyền qua biến môi trường khi khởi động tiến trình, không sửa `.env`):
```bash
cd backend
LIS_DISPATCHER_RETRY_DELAYS_MS=2000,4000,8000,16000,32000,64000,64000 npm run dev:lis-dispatcher
MIDDLEWARE_WORKER_RETRY_DELAYS_MS=2000,4000,8000,16000,32000,64000,64000 npm run dev:middleware-worker
```
Số lần thử tối đa = số phần tử + 1 (ở đây 8). Mặc định `2000,4000,8000` chỉ chịu được ~14 giây mất kết nối. Với 6 phần tử (7 lần thử, cửa sổ ~126 s) đã xác minh chịu được gián đoạn 30 s (Middleware) và 60 s (EMR) và tự phục hồi; gián đoạn ~140–145 s vượt cửa sổ và dẫn đến `FAILED`.
Lưu ý: lần chạy lại A/B dùng 7 phần tử (ngân sách 8).

**Gửi lại một giao dịch `FAILED`** do lỗi tạm thời (mạng/timeout/408/429/5xx) bằng `backend/scripts/ops/requeue-failed.ts`:
```bash
cd backend
npm run ops:requeue-failed -- lis        <result_id> --budget N             # xem trước (mặc định, không đổi gì)
npm run ops:requeue-failed -- lis        <result_id> --budget N --confirm
npm run ops:requeue-failed -- middleware <result_id> --budget N --confirm
```
Quy trình: (1) khắc phục nguyên nhân (bật lại dịch vụ); (2) khởi động lại Dispatcher/Worker với danh sách thời gian chờ **dài hơn số lần đã dùng** (ngân sách thật = số phần tử + 1); (3) chạy công cụ với `--budget` bằng ngân sách thật đó; (4) Dispatcher/Worker tự gửi lại.
Công cụ chỉ chuyển `FAILED → RETRY_WAIT`, không tự gửi; từ chối nếu: không tìm thấy, không ở `FAILED`, LIS đã có exchange, lỗi cuối không phải tạm thời, hoặc `--budget` ≤ số lần đã dùng. Khai báo ngân sách lớn hơn thực tế chỉ khiến giao dịch quay lại `FAILED` (đã thử, không mất dữ liệu). Chống trùng nhờ cơ chế sẵn có: LIS gửi lại đúng gói đã lưu, Middleware trả exchange cũ, EMR trả `ALREADY_EXISTS`. Ghi sự kiện `OPERATOR_REQUEUE` vào `integration.exchange_events` (Middleware).
Test: `npm run test:ops` (13 test, fake client). Giới hạn: mỗi lần một `result_id`; lỗi vĩnh viễn (4xx, `VERIFY_MISMATCH`, phản hồi sai) không được gửi lại.
