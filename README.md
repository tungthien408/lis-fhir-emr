# LIS → Middleware → EMR

Đồ án thử nghiệm trao đổi kết quả xét nghiệm từ **LIS** sang **EMR** thông qua **Middleware**, hướng tới chuẩn **HL7 FHIR R4**.

**Trạng thái hiện tại:** Đã khởi chạy 3 dịch vụ backend và kết nối PostgreSQL qua Docker Compose. **Chưa triển khai** luồng gửi kết quả xét nghiệm, chuyển đổi FHIR và kiểm thử nghiệp vụ.

---

## 1. Chuẩn bị

- Cài **Docker** và **Docker Compose**.
- Cài **Node.js 22+** và **npm** (nếu muốn chạy các lệnh kiểm tra hoặc chạy trực tiếp trên máy).

Tạo file cấu hình môi trường `.env` tại thư mục gốc:

```bash
cp .env.example .env
```

Mở file `.env` và thay đổi các giá trị `CHANGE_ME` thành mật khẩu mong muốn:

```dotenv
POSTGRES_ADMIN_PASSWORD=CHANGE_ME
LIS_DB_PASSWORD=CHANGE_ME
MIDDLEWARE_DB_PASSWORD=CHANGE_ME
EMR_DB_PASSWORD=CHANGE_ME
```

> **Lưu ý:** Tránh dùng các ký tự đặc biệt như `@`, `#`, `%` trong mật khẩu để không làm hỏng chuỗi kết nối URL. Không đưa file `.env` chứa mật khẩu thật lên GitHub.

---

## 2. Khởi chạy lần đầu

Chạy các lệnh sau tại thư mục gốc dự án:

```bash
# 1. Kiểm tra cấu hình và build image backend
docker compose config --quiet
docker compose build

# 2. Khởi động PostgreSQL trước
docker compose up -d db
```

Khi PostgreSQL chạy lần đầu trên volume mới, Docker sẽ tự động nạp 2 file SQL trong thư mục `database/` để tạo bảng và tài khoản. Sau đó, **vào đặt mật khẩu cho 3 tài khoản ứng dụng**:

```bash
docker compose exec db psql -U postgres -d dacn_db
```

Trong giao diện `psql`, nhập lần lượt các lệnh sau (nhập đúng mật khẩu đã đặt trong `.env`):

```text
\password lis_app
\password integration_app
\password emr_app
\q
```

Khởi chạy cả 3 dịch vụ backend:

```bash
docker compose up -d
docker compose ps
```

*(Nếu đã tạo database và đặt mật khẩu từ trước, các lần sau bạn chỉ cần chạy `docker compose up -d`)*

---

## 3. Kiểm tra hoạt động

### Kiểm tra qua trình duyệt / HTTP

| Dịch vụ | Kiểm tra dịch vụ (HTTP) | Kiểm tra kết nối Database |
|---|---|---|
| **LIS** | [localhost:3101/health](http://127.0.0.1:3101/health) | [localhost:3101/ready](http://127.0.0.1:3101/ready) |
| **Middleware** | [localhost:3102/health](http://127.0.0.1:3102/health) | [localhost:3102/ready](http://127.0.0.1:3102/ready) |
| **EMR** | [localhost:3103/health](http://127.0.0.1:3103/health) | [localhost:3103/ready](http://127.0.0.1:3103/ready) |

### Kiểm tra bằng lệnh tự động (trong thư mục `backend/`)

```bash
cd backend

# Cài đặt thư viện nếu chưa cài
npm ci

# Chạy kiểm tra
npm run smoke      # Kiểm tra cả 3 dịch vụ có đang chạy hay không
npm run db:check   # Kiểm tra cả 3 dịch vụ đã kết nối đúng database chưa
npm run check      # Kiểm tra cú pháp TypeScript
```

Kết quả mong đợi: `smoke` và `db:check` đều thông báo **3 PASS**.

### Khởi chạy giao diện Frontend (tùy chọn)

```bash
cd frontend
npm install
npm run dev        # Mở http://localhost:5173
```

---

## 4. Các lệnh thường dùng

```bash
docker compose ps                   # Xem danh sách và trạng thái các container
docker compose logs --tail=50 emr   # Xem 50 dòng log gần nhất của EMR (thay emr bằng lis, middleware hoặc db)
docker compose down                 # Dừng và xóa container (vẫn giữ nguyên dữ liệu database)
docker compose up -d                # Khởi động lại toàn bộ hệ thống
```

> **Lưu ý:** Không dùng `docker compose down -v` nếu bạn muốn giữ lại dữ liệu. Thêm cờ `-v` sẽ xóa sạch dữ liệu trong volume database.
> 
> Cổng PostgreSQL: trong Docker là `5432` (tên máy: `db`), trên máy cá nhân (kết nối từ ngoài qua pgAdmin/DBeaver) là cổng `5433` (`127.0.0.1`).

---

## 5. Cấu trúc dự án

```text
backend/            Mã nguồn 3 dịch vụ backend (LIS, Middleware, EMR)
  ├── src/lis/          Dịch vụ LIS (cổng 3101)
  ├── src/middleware/   Dịch vụ trung gian Middleware (cổng 3102)
  ├── src/emr/          Dịch vụ bệnh án EMR (cổng 3103)
  ├── src/common/       Mã nguồn kết nối database dùng chung
  ├── Dockerfile        Hướng dẫn đóng gói container backend
  └── package.json      Quản lý thư viện và các script kiểm tra backend
frontend/           Giao diện web của hệ thống (React, TypeScript, Vite)
database/           File SQL tạo bảng (dacn_db_init_v2.sql) và phân quyền (access_roles.sql)
scripts/            Các kịch bản kiểm tra tự động (smoke-test, db-check, verify-sql)
docs/               Tài liệu kiến trúc, database và hợp đồng API
compose.yaml        Cấu hình Docker Compose cho PostgreSQL và 3 backend
.env.example        Mẫu khai báo biến môi trường
```

Database `dacn_db` gồm **13 bảng** chia thành 3 schema: `lis` (5 bảng), `integration` (5 bảng), `emr` (3 bảng). Mỗi dịch vụ backend dùng tài khoản riêng và chỉ trao đổi dữ liệu **qua HTTP**, không truy cập trực tiếp vào bảng của nhau.

Đọc thêm: [Kiến trúc](docs/architecture.md) · [Database](docs/database.md) · [Hợp đồng API (dự thảo)](docs/api-contract.md).
