# Cơ sở dữ liệu — LIS → Middleware → EMR

Hệ thống sử dụng **PostgreSQL 17** chạy qua Docker Compose. Tên database là `dacn_db`, bao gồm **13 bảng** chia thành 3 schema:

| Schema | Số bảng | Mục đích sử dụng | Danh sách bảng |
|---|---:|---|---|
| `lis` | 5 | Lưu dữ liệu xét nghiệm gốc | `patients`, `test_catalog`, `results`, `publish_events`, `dispatch_attempts` |
| `integration` | 5 | Quản lý giao dịch trao đổi & lưu kết quả đánh giá | `exchange_transactions`, `exchange_attempts`, `exchange_events`, `experiment_runs`, `field_comparisons` |
| `emr` | 3 | Lưu dữ liệu hồ sơ bệnh án EMR | `patients`, `patient_links`, `lab_results` |

---

## 1. Phân quyền tài khoản

Mỗi dịch vụ sử dụng một tài khoản database riêng biệt và **không được truy cập trực tiếp vào bảng của dịch vụ khác**:

| Tài khoản | Dịch vụ sử dụng | Quyền hạn |
|---|---|---|
| `lis_app` | Dịch vụ LIS | Toàn quyền đọc/ghi trên 5 bảng thuộc schema `lis` |
| `integration_app` | Dịch vụ Middleware | Đọc/ghi trên 3 bảng giao dịch của schema `integration` *(không có quyền ghi 2 bảng đánh giá)* |
| `emr_app` | Dịch vụ EMR | Toàn quyền đọc/ghi trên 3 bảng thuộc schema `emr` |
| `evaluator_app` | Công cụ đánh giá *(chạy riêng)* | Đọc dữ liệu trên cả 3 schema; ghi kết quả vào 2 bảng `experiment_runs` và `field_comparisons` |

---

## 2. Cổng kết nối (Port)

- **Trong mạng nội bộ Docker:** Sử dụng cổng `5432` với tên máy chủ là `db` (ví dụ: `postgresql://lis_app:pass@db:5432/dacn_db`).
- **Từ máy cá nhân (ngoài Docker):** Kết nối qua cổng `5433` tại địa chỉ `127.0.0.1:5433` (khi kết nối bằng pgAdmin, DBeaver hoặc chạy script trên máy thật).

---

## 3. Khởi tạo Database lần đầu

1. **Chuẩn bị cấu hình:** Tạo file `.env` tại thư mục gốc từ mẫu `.env.example`, điền 4 mật khẩu cho admin và 3 dịch vụ.

2. **Khởi chạy PostgreSQL:**
   ```bash
   docker compose up -d db
   ```
   *Khi volume database còn trống, Docker sẽ tự động chạy 2 script trong thư mục `database/`:*
   - `dacn_db_init_v2.sql`: Tạo 3 schema, 13 bảng và các ràng buộc dữ liệu.
   - `access_roles.sql`: Tạo 4 tài khoản và gán quyền tương ứng.

3. **Đặt mật khẩu cho các tài khoản:**
   ```bash
   docker compose exec db psql -U postgres -d dacn_db
   ```
   Trong màn hình `psql`, gõ lần lượt:
   ```text
   \password lis_app
   \password integration_app
   \password emr_app
   \q
   ```
   *(Nhập đúng mật khẩu bạn đã ghi trong `.env`)*

4. **Khởi động các dịch vụ và kiểm tra kết nối:**
   ```bash
   docker compose up -d
   
   cd backend
   npm run db:check
   ```
   Kết quả hiển thị: **PASS cả 3 dịch vụ LIS, Middleware, EMR**.

---

## 4. Kiểm tra thủ công và khắc phục sự cố

### Đếm số bảng trong database
Bạn có thể chạy lệnh sau để kiểm tra nhanh số lượng bảng đã được tạo đủ chưa:

```bash
docker compose exec db psql -U postgres -d dacn_db -c "
SELECT table_schema, COUNT(*) AS so_bang
FROM information_schema.tables
WHERE table_schema IN ('lis', 'integration', 'emr')
  AND table_type = 'BASE TABLE'
GROUP BY table_schema
ORDER BY table_schema;"
```
Kết quả mong muốn: `lis: 5`, `integration: 5`, `emr: 3`.

### Ý nghĩa endpoint `/health` và `/ready`
- `/health`: Báo dịch vụ HTTP backend đang sống.
- `/ready`: Kiểm tra kết nối database, tài khoản đăng nhập có đúng quyền và đã thấy đủ các bảng cần thiết hay chưa.

Nếu `/ready` trả về lỗi **503**:
- Xem log bằng lệnh: `docker compose logs --tail=50 emr` (thay `emr` bằng dịch vụ đang lỗi).
- Kiểm tra xem mật khẩu trong `.env` có khớp với mật khẩu đã đặt qua lệnh `\password` hay không.
- Sau khi chỉnh sửa `.env`, chạy lại `docker compose up -d` để nạp biến môi trường mới.

---

## 5. Lưu ý quan trọng

- Dữ liệu database được lưu trong Docker volume `postgres_data`. **Tuyệt đối không dùng `docker compose down -v`** nếu muốn giữ dữ liệu đã có.
- File SQL khởi tạo chỉ tự động chạy ở lần đầu tiên khi volume còn trống. Nếu bạn cập nhật file SQL sau này, cần tự chạy câu lệnh bổ sung hoặc tạo migration.
- File nguồn định nghĩa bảng là `database/dacn_db_init_v2.sql`. Các file `backend/src/*/schema.ts` chỉ mô tả lại bảng bằng TypeScript cho Drizzle ORM sử dụng trong code backend.
