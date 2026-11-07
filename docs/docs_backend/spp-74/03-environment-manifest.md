# SPP-74 — Bản kê môi trường thực nghiệm

Written for: người chạy thực nghiệm SPP-75 và người viết Chương 3 (mô tả môi trường).

Mọi giá trị đọc từ máy thật ngày 04/11/2026 bằng lệnh ghi ở cột "Cách đọc". Đây là máy dùng cho pilot SPP-73 (cùng máy, cùng ngày). Không có số liệu ước đoán.

## 1. Máy chủ

| Mục | Giá trị | Cách đọc |
|---|---|---|
| Hệ điều hành | Arch Linux (rolling) | `/etc/os-release` |
| Kernel | 7.2.11-arch1-1 | `uname -r` |
| CPU | 13th Gen Intel Core i5-13420H; 8 core, 12 luồng | `lscpu` |
| RAM | 15 GiB (tổng) | `free -h` |
| Ổ đĩa | `/dev/nvme0n1p6` 118 GB, còn 36 GB khả dụng | `df -h` |
| Chế độ nguồn | Laptop. Từng bị suspend giữa lượt B2 (OPS-03). Trạng thái cắm điện của các lượt pilot không được ghi lại | Nhật ký SPP-73 |
| Docker | 29.9.2 (overlayfs, cgroup v2) | `docker --version`, `docker info` |
| Docker Compose | 5.6.1 | `docker compose version` |
| Git | 2.56.0 | `git --version` |

## 2. Phần mềm Node.js (hai môi trường chạy khác phiên bản)

| Thành phần | Chạy ở đâu | Node.js |
|---|---|---|
| LIS, Middleware, EMR | Container `lis-fhir-emr-backend:local` | **v22.23.4** (image `node:22`) |
| LIS Dispatcher, Middleware Worker, công cụ `spp82:*`, `ops:*` | Tiến trình trên máy chủ, chạy trực tiếp từ mã nguồn qua `tsx` | **v26.13.0** (npm 12.2.1) |

`backend/package.json` ghi `engines.node >=22.16.0` nên cả hai hợp lệ. Sự khác phiên bản là điều kiện của pilot và được giữ nguyên.

Thư viện (cố định bởi `backend/package-lock.json`, SHA-256 `524842e3…0466`; `npm ci` cài đúng):

| Gói | Phiên bản |
|---|---|
| typescript | 5.9.3 |
| tsx | 4.21.0 |
| express | 5.3.0 |
| pg | 8.23.1 |
| drizzle-orm | 0.45.4 |
| swagger-ui-express | 5.0.1 |
| @types/node | 22.19.5 |
| concurrently | 9.2.1 |

Ứng dụng: `lis-fhir-emr` 0.2.0.

## 3. Image và container

| Container | Image | ID image | Cổng |
|---|---|---|---|
| `lis-fhir-emr-db-1` | `postgres:17` | `sha256:3b0cda93be7c8dba2ed484d19393d93845dc3dafb88973e248ba8e6d99d784e1` (digest `postgres@sha256:3b0cda93…84e1`) | `127.0.0.1:5433` → 5432 |
| `lis-fhir-emr-lis-1` | `lis-fhir-emr-backend:local` | `sha256:bf9c57ed1a58c104c8c58d80a8d22951baba1f3082e2726c499fe2617b75bcad` (tạo 2026-11-03 14:40 +0700) | `127.0.0.1:3101` |
| `lis-fhir-emr-middleware-1` | như trên | như trên | `127.0.0.1:3102` |
| `lis-fhir-emr-emr-1` | như trên | như trên | `127.0.0.1:3103` |

Mã nguồn trong image khớp repository (32/32 file `src/`), xem [01-source-freeze.md](01-source-freeze.md) mục 4.

**Rủi ro tái lập:** `compose.yaml` dùng tag trôi `postgres:17`, và `Dockerfile` dùng tag trôi `node:22`. Bản đang chạy được chốt bằng ID ở bảng trên. Dựng lại image ở thời điểm khác có thể ra phiên bản khác. Để giữ nguyên, SPP-75 phải **dùng lại image hiện có**, không `docker compose build` lại, hoặc ghi lại ID mới và kiểm lại.

## 4. PostgreSQL

| Mục | Giá trị |
|---|---|
| Phiên bản | 17.11 (Debian 17.11-1.pgdg13+2), x86_64 |
| Cơ sở dữ liệu | `dacn_db`; schema `lis`, `integration`, `emr` |
| Tham số (đọc từ `pg_settings` của DB pilot; image mặc định, không có file cấu hình riêng trong repo) | `max_connections=100`, `shared_buffers=163848kB`, `work_mem=4096kB`, `effective_cache_size=5242888kB`, `fsync=on`, `synchronous_commit=on`, `wal_level=replica`, `max_wal_size=1024MB`, `checkpoint_timeout=300s`, `random_page_cost=4`, `default_transaction_isolation=read committed`, `TimeZone=Etc/UTC` |
| Dung lượng DB sau lượt B3 | 19 MB |
| Dữ liệu | Volume Docker `postgres_data` |
| Tài khoản ứng dụng | `lis_app`, `integration_app`, `emr_app` (mỗi dịch vụ một role; mật khẩu trong `.env`) |

## 5. Dịch vụ và điểm truy cập

| Dịch vụ | Cách chạy | Địa chỉ | Kiểm sẵn sàng | Biến cấu hình chính |
|---|---|---|---|---|
| LIS | Container | `http://127.0.0.1:3101` | `GET /ready` → 200 (đã đo 04/11/2026) | `LIS_PORT`, `LIS_DATABASE_URL` |
| Middleware | Container | `http://127.0.0.1:3102` | `GET /ready` → 200 | `MIDDLEWARE_PORT`, `MIDDLEWARE_DATABASE_URL` |
| EMR | Container | `http://127.0.0.1:3103` | `GET /ready` → 200 | `EMR_PORT`, `EMR_DATABASE_URL` |
| LIS Dispatcher | Host: `npm run dev:lis-dispatcher` (từ `backend/`) | gọi `MIDDLEWARE_BASE_URL` | Đếm tiến trình `src/lis/dispatcher-main.ts` = 1 | `LIS_DISPATCHER_*` |
| Middleware Worker | Host: `npm run dev:middleware-worker` | gọi `EMR_BASE_URL` | Đếm tiến trình `src/middleware/worker-main.ts` = 1 | `MIDDLEWARE_WORKER_*` |

Tất cả cổng chỉ gắn `127.0.0.1`. Dispatcher/Worker không có cổng nghe.

Cấu hình sao cho không lộ bí mật: URL DB và mật khẩu chỉ nằm trong `.env` (bị `.gitignore`) và file môi trường riêng của lượt chạy; tài liệu này không chứa chúng. Dịch vụ trong container nhận biến qua `compose.yaml` từ `.env`. Tên biến cần có: `scripts/pilot/pilot.env.example`, `.env.example`.

## 6. Điều kiện thử nghiệm đã biết ảnh hưởng số đo

- Một máy duy nhất: dịch vụ, DB, Dispatcher, Worker và công cụ đo cùng chia CPU và RAM. Số đo không đại diện môi trường triển khai thật.
- Không có lượt khởi động riêng (warm-up) trong pilot.
- Chạy laptop: không để máy suspend giữa lượt; nên cắm điện. Kiểm tra `journalctl` sau mỗi lượt nếu nghi ngờ.
- Tiến trình khác trên máy (trình duyệt, IDE) có thể chiếm CPU. RAM trống thời điểm đo ~6 GiB trên 15 GiB. SPP-75 nên ghi `uptime` và `free -h` đầu mỗi lượt.

## 7. Ghi nhận môi trường mỗi lượt

`run-all.sh` ghi vào `code-and-environment.txt` của từng lượt: `git_head`, `git_describe`, `source_tree_sha256`, hash oracle, hash 2 file seed, số và biến môi trường của Dispatcher/Worker, phiên bản Node, npm, PostgreSQL và danh sách container. (Phiên bản npm, PostgreSQL và `git_describe` là bổ sung của SPP-74.)
