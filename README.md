# LIS → Middleware → EMR

Đồ án thử nghiệm trao đổi kết quả xét nghiệm từ **LIS** sang **EMR** thông qua **Middleware**, chuyển đổi sang chuẩn **HL7 FHIR R4 Observation**.

**Trạng thái hiện tại (SPP-66 D1–D4):**
- Đã hoàn thành triển khai và kiểm thử toàn bộ các giai đoạn **A1–A3, B1–B4B, C1–C4, D1–D3**.
- Luồng trao đổi toàn vẹn hai chiều đã hoạt động thật trên backend:
  $$\text{LIS Publish} \longrightarrow \text{LIS Dispatcher} \longrightarrow \text{Middleware API} \longrightarrow \text{Worker \& Mapper (FHIR R4)} \longrightarrow \text{EMR API} \longrightarrow \text{EMR Read-back} \longrightarrow \text{DELIVERED}$$
- Toàn bộ 495 bài kiểm thử tự động (gồm 15 ca E2E D3) đều đạt **PASS** trên PostgreSQL cô lập với dữ liệu giả định kiểm chứng độc lập.
- **Giới hạn phạm vi:** Dữ liệu hiện tại là fixture giả lập có đáp án độc lập (synthetic data), **chưa** nghiệm thu bằng bộ dữ liệu MIMIC / SPP-65 chính thức; **chưa** triển khai môi trường production có TLS; giao diện người dùng frontend (SPP-67) là bước tích hợp tiếp theo.

---

## 1. Kiến trúc hệ thống và Quy ước cổng

Hệ thống bao gồm 3 dịch vụ backend độc lập, 2 tiến trình xử lý nền (opt-in), và 1 cơ sở dữ liệu PostgreSQL (`dacn_db`) chia làm 3 schema cô lập hoàn toàn:

```text
[LIS API :3101] ──(outbox: lis.publish_events)──> [LIS Dispatcher]
                                                          │ (HTTP POST /api/exchanges)
                                                          ▼
                                                 [Middleware API :3102]
                                                          │ (integration.exchange_transactions)
                                                          ▼
                                                 [Middleware Worker & Mapper]
                                                          │ (HTTP POST /api/observations - FHIR R4)
                                                          ▼
                                                  [EMR API :3103]
                                                          │ (emr.lab_results)
                                                          ▼
                                            [Worker Read-back Verification]
                                            (HTTP GET /api/lab-results -> DELIVERED)
```

### Địa chỉ kết nối và Mạng

| Dịch vụ / Thành phần | URL trên máy cá nhân (Host) | URL trong mạng Docker Compose | Ghi chú |
|---|---|---|---|
| **LIS API** | `http://127.0.0.1:3101` | `http://lis:3101` | Quản lý kết quả gốc, Outbox Publish |
| **Middleware API** | `http://127.0.0.1:3102` | `http://middleware:3102` | Tiếp nhận gói tin, quản lý giao dịch |
| **EMR API** | `http://127.0.0.1:3103` | `http://emr:3103` | Tiếp nhận FHIR Observation, hồ sơ bệnh án |
| **PostgreSQL** | `127.0.0.1:5433` | `db:5432` | Database `dacn_db` với 3 schema cô lập |
| **Frontend** | `http://localhost:5173` | — | Vite/React (phát triển riêng) |

> **Quy tắc phân biệt URL:**
> - Khi chạy code trực tiếp trên host bằng Node.js (`npm run dev:*`), các dịch vụ gọi nhau qua IP cục bộ `127.0.0.1:<PORT>`.
> - Khi chạy trong Docker Compose, các container trao đổi qua tên dịch vụ nội bộ Docker (`http://middleware:3102`, `http://emr:3103`).

---

## 2. Danh mục API nghiệp vụ đã triển khai

Tất cả các API nghiệp vụ đã được triển khai đầy đủ và tuân thủ [Hợp đồng API (api-contract.md)](docs/api-contract.md):

### 1. Dịch vụ LIS (Cổng 3101)
- `GET /health`: Kiểm tra HTTP server hoạt động.
- `GET /ready`: Kiểm tra kết nối database, quyền `lis_app` và 5 bảng schema `lis`.
- `GET /api/results`: Xem và lọc danh sách kết quả xét nghiệm (`patient_id`, `test_code`, `result_status`, phân trang `limit`, `offset`).
- `GET /api/results/:resultId`: Xem chi tiết một kết quả xét nghiệm (giữ nguyên độ chính xác số học NUMERIC dạng chuỗi).
- `POST /api/results/:resultId/publish`: Duyệt gửi kết quả xét nghiệm. Lưu snapshot và hash vào outbox `lis.publish_events` (trả `202` lần đầu; trả `200` idempotency nếu gọi lại cùng kết quả).
- `GET /api/publish-events/:eventId`: Tra cứu trạng thái gửi (`PENDING`, `IN_FLIGHT`, `ACK`, `BLOCKED`, `FAILED`), số lượt thử và thông tin lỗi an toàn.
- Giao diện Swagger UI tương tác: `http://127.0.0.1:3101/docs/api/`.

### 2. Dịch vụ Middleware (Cổng 3102)
- `GET /health` & `GET /ready`: Kiểm tra HTTP và quyền `integration_app` trên schema `integration`.
- `POST /api/exchanges`: Tiếp nhận gói tin gửi từ LIS. Kiểm tra format, tính lại canonical SHA-256 hash, lưu vào `integration.exchange_transactions` và trả `202 Accepted` kèm `exchange_id`. Cơ chế Idempotency trả lại đúng `exchange_id` ban đầu nếu gửi lại cùng nội dung; trả `409` nếu xung đột dữ liệu.
- `GET /api/exchanges`: Xem và lọc danh sách giao dịch trao đổi (`status`, `source_result_id`, phân trang).
- `GET /api/exchanges/:exchangeId`: Xem chi tiết giao dịch kèm toàn bộ lịch sử trạng thái audit (`events`), payload snapshot và thông tin đối soát.

### 3. Dịch vụ EMR (Cổng 3103)
- `GET /health` & `GET /ready`: Kiểm tra HTTP và quyền `emr_app` trên schema `emr`.
- `POST /api/observations`: Nhận kết quả xét nghiệm chuẩn **HL7 FHIR R4 Observation** (`Content-Type: application/fhir+json`). Tra cứu liên kết bệnh nhân từ `emr.patient_links` để lấy `patient_key`, kiểm tra tính toàn vẹn và lưu vào `emr.lab_results`. Trả `201 STORED` lần đầu; trả `200 ALREADY_EXISTS` nếu gửi lại cùng nội dung; trả `409` nếu xung đột dữ liệu; trả `422 PATIENT_NOT_LINKED` nếu không tìm thấy liên kết bệnh nhân hợp lệ.
- `GET /api/lab-results`: Tra cứu kết quả đã lưu theo cặp định danh nguồn (`external_system` + `external_id`) để Middleware đọc lại đối soát, hoặc tra cứu theo `patient_key` có phân trang.

---

## 3. Các tiến trình nền (Background Processes)

Dự án có 2 tiến trình nền xử lý hàng đợi bất đồng bộ. Cả hai đều là dịch vụ **opt-in**, độc lập với API server và bảo vệ tránh tranh chấp bằng cơ chế database lease (`SKIP LOCKED`):

1. **LIS Dispatcher (`lis-dispatcher`):**
   - Đọc các sự kiện `PENDING` hoặc `RETRY_WAIT` từ bảng `lis.publish_events`.
   - Giữ khóa phân tán tạm thời (`lease_until`), gửi payload qua HTTP `POST /api/exchanges` sang Middleware.
   - Khi nhận phản hồi 202 hợp lệ khớp mã băm, chuyển trạng thái outbox thành **`ACK`** và xóa lease.
   - Quản lý số lần thử lại (tối đa 4 lượt), lưu nhật ký trong `lis.dispatch_attempts`.

2. **Middleware Worker (`middleware-worker`):**
   - Đọc các giao dịch `RECEIVED` từ bảng `integration.exchange_transactions`.
   - Giữ lease, gọi Mapper chuyển đổi snapshot sang định dạng FHIR R4 Observation.
   - Gửi sang EMR qua `POST /api/observations`, nhận `201 STORED`.
   - Chuyển sang giai đoạn `VERIFYING`, gọi HTTP `GET /api/lab-results` đọc lại kết quả thực tế từ EMR.
   - Đối chiếu chính xác từng trường (bệnh nhân, mã xét nghiệm, giá trị số, đơn vị, khoảng tham chiếu, thời gian microsecond, FHIR JSON gốc). Nếu khớp 100%, chuyển trạng thái sang **`DELIVERED`**.

> **Khái niệm then chốt:**
> - **LIS ACK:** LIS xác nhận Middleware đã tiếp nhận và cất gói tin vào database thành công.
> - **Middleware DELIVERED:** Middleware xác nhận EMR đã lưu trữ và quá trình đọc lại đối soát qua HTTP thành công hoàn toàn.
> - **LIS ACK không đồng nghĩa với EMR DELIVERED.** Nếu EMR từ chối (ví dụ thiếu liên kết bệnh nhân), LIS vẫn giữ ACK nhưng Middleware sẽ chuyển sang trạng thái `REJECTED` (đã được kiểm chứng trong ca test `D3-06`).

---

## 4. Chuẩn bị môi trường

Yêu cầu:
- **Docker** và **Docker Compose**
- **Node.js >= 22.16.0** và **npm**

Tạo file cấu hình môi trường `.env` tại thư mục gốc dự án:

```bash
cp .env.example .env
```

Mở `.env` và cấu hình mật khẩu mong muốn cho các tài khoản:

```dotenv
POSTGRES_ADMIN_PASSWORD=CHANGE_ME
LIS_DB_PASSWORD=CHANGE_ME
MIDDLEWARE_DB_PASSWORD=CHANGE_ME
EMR_DB_PASSWORD=CHANGE_ME

# Cấu hình địa chỉ cho Dispatcher và Worker khi chạy trên Host
MIDDLEWARE_BASE_URL=http://127.0.0.1:3102
EMR_BASE_URL=http://127.0.0.1:3103
```

---

## 5. Hướng dẫn khởi chạy

### Lựa chọn A: Khởi chạy toàn bộ bằng Docker Compose

#### Bước 1: Khởi động cơ sở dữ liệu và đặt mật khẩu
```bash
docker compose up -d db
```
Khi tạo volume database lần đầu, Docker tự chạy theo thứ tự:

1. Tạo cấu trúc bảng (`database/dacn_db_init_v2.sql`).
2. Tạo role và phân quyền (`database/access_roles.sql`).
3. Nạp 100 bệnh nhân LIS, 5 loại xét nghiệm, 100 bệnh nhân EMR và liên kết định danh.
4. Nạp 1.000 kết quả xét nghiệm MIMIC-IV Demo v2.2 vào LIS, bao gồm 40 ca kiểm tra chức năng.

Các script dữ liệu nằm trong [`database/seed/`](database/seed/README.md), được mount chỉ đọc. Bộ dữ liệu sẵn sàng để demo Publish; chưa có kết quả xét nghiệm trong EMR hay sự kiện Publish. **Volume đã tồn tại sẽ giữ nguyên dữ liệu và không tự chạy lại các script khởi tạo.** Database hiện tại của nhóm đã được nạp bộ này; không cần nạp lại hay xóa volume.

Kiểm tra nhanh dữ liệu sau khi database báo `healthy`:

```bash
docker compose exec db psql -U postgres -d dacn_db -c "SELECT COUNT(*) AS mimic_results, COUNT(*) FILTER (WHERE provenance->>'in_functional_40' = 'true') AS functional_40 FROM lis.results WHERE provenance->>'seed_tag' = 'DACN-MIMIC22-SOURCE-ALIGNED-V2';"
```

Kết quả mong đợi: `mimic_results = 1000`, `functional_40 = 40`. Khi khởi tạo mới, toàn bộ LIS có 1.000 kết quả; database có ca demo khác từ trước có thể có tổng lớn hơn.

Đặt mật khẩu các role tương ứng với `.env` (vẫn cần thực hiện khi khởi tạo mới):

```bash
docker compose exec db psql -U postgres -d dacn_db
```
Trong dấu nhắc `psql`, nhập:
```text
\password lis_app
\password integration_app
\password emr_app
\q
```

#### Bước 2: Khởi động các dịch vụ
- **Chỉ chạy 3 API server (mặc định):**
  ```bash
  docker compose up -d
  ```
- **Chạy đầy đủ cả 3 API server VÀ 2 tiến trình nền (Dispatcher + Worker):**
  ```bash
  docker compose --profile dispatcher --profile worker up -d
  ```

Kiểm tra trạng thái container:
```bash
docker compose ps
```

---

### Lựa chọn B: Chạy trực tiếp trên máy phát triển (Local Node.js)

Sau khi PostgreSQL đã chạy trên Docker (cổng `5433` ngoài host):

```bash
cd backend
npm ci

# 1. Chạy cùng lúc cả 3 API server (LIS :3101, Middleware :3102, EMR :3103)
npm run dev

# 2. Mở terminal mới: Chạy LIS Dispatcher
npm run dev:lis-dispatcher

# 3. Mở terminal mới: Chạy Middleware Worker
npm run dev:middleware-worker
```

---

## 6. Kiểm tra và Xác minh chất lượng

Đứng tại thư mục `backend/`:

### 1. Kiểm tra tĩnh và cấu trúc
```bash
npm run check      # Kiểm tra cú pháp và kiểu TypeScript (tsc --noEmit)
npm run build      # Biên dịch mã nguồn sang thư mục dist/
npm run verify:sql # Kiểm tra tính hợp lệ của schema SQL và ràng buộc toàn vẹn
```

### 2. Kiểm tra dịch vụ đang chạy
```bash
npm run smoke      # Kiểm tra HTTP /health của cả 3 dịch vụ
npm run db:check   # Kiểm tra kết nối /ready và schema isolation của cả 3 dịch vụ
```

### 3. Bộ kiểm thử tự động trên PostgreSQL cô lập (Không ảnh hưởng dữ liệu thật)
Runner `scripts/test-repositories-postgres.mjs` sẽ tự động khởi tạo một container PostgreSQL tạm thời trong Docker, nạp schema, gán quyền ngẫu nhiên, chạy kiểm thử và dọn dẹp sạch sẽ sau khi xong:

```bash
# Chỉ chạy bộ kiểm thử toàn luồng End-to-End (D3: 15 tests)
npm run test:e2e:postgres

# Chạy toàn bộ 495 tests hồi quy của cả hệ thống (LIS, Middleware, EMR, Integration, E2E)
npm run test:repositories:postgres
```

Kết quả mong đợi: **495 tests PASS, 0 fail, 0 skipped**.

---

## 7. Cấu trúc thư mục

```text
lis-fhir-emr/
├── backend/
│   ├── src/
│   │   ├── common/           # Kết nối database dùng chung và tiện ích
│   │   ├── lis/              # Dịch vụ LIS (API, Service, Repository, Dispatcher)
│   │   ├── middleware/       # Dịch vụ Middleware (API, Service, Repository, Mapper, Worker)
│   │   └── emr/              # Dịch vụ EMR (API, Service, Repository, canonical JSON)
│   ├── tests/
│   │   ├── lis/              # Unit & Integration tests cho LIS & Dispatcher
│   │   ├── middleware/       # Unit & Integration tests cho Middleware, Mapper, Worker
│   │   ├── emr/              # Unit & Integration tests cho EMR
│   │   ├── integration/      # Test tích hợp Middleware Worker -> EMR (C4)
│   │   └── e2e/              # Test tích hợp toàn luồng LIS -> Dispatcher -> MW -> EMR (D3)
│   ├── Dockerfile            # Multi-stage Dockerfile cho backend
│   └── package.json          # Quản lý dependencies và scripts kiểm thử
├── database/
│   ├── dacn_db_init_v2.sql   # DDL tạo 3 schema, 13 bảng và ràng buộc toàn vẹn
│   └── access_roles.sql      # Phân quyền 4 role (lis_app, integration_app, emr_app, evaluator_app)
├── docs/
│   ├── api-contract.md       # Đặc tả chi tiết Hợp đồng API V1
│   ├── architecture.md       # Tài liệu kiến trúc và hướng dẫn tổ chức mã nguồn
│   ├── database.md           # Tài liệu chi tiết cơ sở dữ liệu và phân quyền
│   ├── spp-66-d4-final-review.md  # Báo cáo đánh giá kỹ thuật và kiểm toán D4
│   ├── spp-66-handover.md    # Tài liệu bàn giao kỹ thuật cho thành viên nhóm
│   └── evidence/             # Bằng chứng kiểm thử JSON và log thực tế (C4, D1, D2, D3)
├── frontend/                 # Giao diện web React/Vite (đang phát triển)
├── scripts/                  # Scripts kiểm tra tự động (smoke, db-check, runner postgres)
├── compose.yaml              # Cấu hình Docker Compose cho DB, 3 API và 2 Worker
└── .env.example              # Mẫu khai báo biến môi trường chuẩn
```

---

## 8. Tài liệu tham khảo kỹ thuật

- [Báo cáo Tổng kết & Đánh giá Kỹ thuật D4](docs/docs_backend/spp-66-d4-final-review.md)
- [Tài liệu Bàn giao Kỹ thuật SPP-66](docs/docs_backend/spp-66-handover.md)
- [Báo cáo Đánh giá Luồng E2E D3](docs/docs_backend/spp-66-d3-review.md)
- [Hợp đồng API Chi tiết](docs/api-contract.md)
- [Kiến trúc & Tổ chức Mã nguồn](docs/architecture.md)
- [Cơ sở Dữ liệu & Phân quyền](docs/database.md)
