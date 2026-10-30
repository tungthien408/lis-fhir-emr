# Tài liệu Bàn giao Kỹ thuật SPP-66 (Technical Handover Document)

**Người bàn giao:** Senior Software Engineer / Backend Lead  
**Người tiếp nhận:** Đồng nghiệp phụ trách Cross-check và Tích hợp Frontend (SPP-67)  
**Mục tiêu:** Bàn giao toàn bộ thông tin vận hành, cấu trúc API, kịch bản thử nghiệm luồng thông suốt (Happy-path Demo) và danh mục kiểm tra thủ công phục vụ nghiệm thu SPP-66.

---

## 1. Tổng quan các Endpoint Backend

Hệ thống cung cấp đầy đủ các API phục vụ hiển thị frontend và tích hợp luồng dữ liệu:

### 1.1. LIS Service (`http://127.0.0.1:3101`)
| Endpoint | Phương thức | Mô tả & Cấu trúc Payload |
|---|:---:|---|
| `/health` | GET | Trả `{ "status": "ok", "service": "lis" }` |
| `/ready` | GET | Trả `{ "status": "ready", "schema": "lis", "role": "lis_app" }` |
| `/docs/api/` | GET | Giao diện tương tác Swagger UI |
| `/api/results` | GET | Lọc danh sách kết quả: `?patient_id=...&test_code=...&result_status=FINAL&limit=20&offset=0`<br>Trả `{ "items": [...], "limit": 20, "offset": 0 }` |
| `/api/results/:resultId` | GET | Chi tiết kết quả xét nghiệm nguồn |
| `/api/results/:resultId/publish` | POST | Duyệt gửi kết quả xét nghiệm vào Outbox.<br>Không cần body.<br>Lần đầu trả **202 Accepted**; lần sau cùng ID trả **200 OK**:<br>`{ "event_id": "UUID", "result_id": "...", "dispatch_status": "PENDING", "exchange_id": null }` |
| `/api/publish-events/:eventId` | GET | Kiểm tra tiến độ gửi:<br>`{ "event_id": "UUID", "result_id": "...", "dispatch_status": "ACK", "exchange_id": "UUID", "dispatch_attempt_count": 1, "last_error_code": null, "last_error_message": null }` |

### 1.2. Middleware Service (`http://127.0.0.1:3102`)
| Endpoint | Phương thức | Mô tả & Cấu trúc Payload |
|---|:---:|---|
| `/health` | GET | Trả `{ "status": "ok", "service": "middleware" }` |
| `/ready` | GET | Trả `{ "status": "ready", "schema": "integration", "role": "integration_app" }` |
| `/api/exchanges` | POST | LIS Dispatcher gọi để gửi gói tin outbox.<br>Trả **202 Accepted**:<br>`{ "accepted": true, "event_id": "UUID", "exchange_id": "UUID", "source_system": "lis-demo", "source_result_id": "...", "source_hash": "SHA256" }` |
| `/api/exchanges` | GET | Lọc danh sách giao dịch: `?status=DELIVERED&source_result_id=...&limit=20&offset=0` |
| `/api/exchanges/:exchangeId` | GET | Chi tiết giao dịch kèm toàn bộ lịch sử audit `events`, bản chụp gói nguồn `source_payload`, và tài nguyên `fhir_payload` (nếu đã chuyển đổi). |

### 1.3. EMR Service (`http://127.0.0.1:3103`)
| Endpoint | Phương thức | Mô tả & Cấu trúc Payload |
|---|:---:|---|
| `/health` | GET | Trả `{ "status": "ok", "service": "emr" }` |
| `/ready` | GET | Trả `{ "status": "ready", "schema": "emr", "role": "emr_app" }` |
| `/api/observations` | POST | Nhận HL7 FHIR R4 Observation (`Content-Type: application/fhir+json`).<br>Lần đầu trả **201 Created**:<br>`{ "result": "STORED", "external_system": "https://example.org/lis/result", "external_id": "...", "target_id": "UUID", "patient_key": "UUID" }`<br>Gửi lại giống hệt trả **200 OK** (`result = "ALREADY_EXISTS"`). |
| `/api/lab-results` | GET | **Chế độ 1 (Đọc lại đối soát):** `?external_system=...&external_id=...`<br>Trả `{ "items": [ { "target_id": "UUID", "patient_key": "UUID", "quantity": "3.4000", "unit_text": "mg/dL", "low": "1.2000", "high": null, "effective_at": "...", "clinical_status": "final", "fhir_json": { ... } } ] }`<br>**Chế độ 2 (Hồ sơ bệnh nhân cho frontend):** `?patient_key=UUID&limit=20&offset=0` |

---

## 2. Hướng dẫn Khởi chạy Môi trường Phát triển

### Bước 1: Khởi động cơ sở dữ liệu
```bash
# Tại thư mục gốc lis-fhir-emr:
cp .env.example .env
# Chỉnh sửa mật khẩu trong .env nếu cần
docker compose up -d db
```

Nếu chạy lần đầu trên volume mới, vào đặt mật khẩu cho 3 user ứng dụng:
```bash
docker compose exec db psql -U postgres -d dacn_db -c "
ALTER ROLE lis_app PASSWORD 'lis_password';
ALTER ROLE integration_app PASSWORD 'middleware_password';
ALTER ROLE emr_app PASSWORD 'emr_password';
"
```
*(Thay thế các chuỗi mật khẩu trên khớp với file `.env`)*

### Bước 2: Khởi động các tiến trình nghiệp vụ
Có hai cách vận hành:

#### Cách 1: Chạy qua Docker Compose (Khuyên dùng)
```bash
# Bật cả 3 API server VÀ 2 tiến trình nền (Dispatcher + Worker)
docker compose --profile dispatcher --profile worker up -d
docker compose ps
```

#### Cách 2: Chạy trực tiếp bằng Node.js trên máy (Phục vụ debug)
```bash
cd backend
npm ci

# Cửa sổ terminal 1: Chạy 3 API servers (LIS :3101, Middleware :3102, EMR :3103)
npm run dev

# Cửa sổ terminal 2: Chạy LIS Dispatcher (quét outbox và gửi sang Middleware)
npm run dev:lis-dispatcher

# Cửa sổ terminal 3: Chạy Middleware Worker (chuyển đổi FHIR và gửi sang EMR)
npm run dev:middleware-worker
```

---

## 3. Kịch bản Thử nghiệm Luồng Thông suốt (Reproducible Happy-path Demo)

Sau khi hệ thống đã khởi động, thực hiện theo các bước mẫu dưới đây bằng `curl` (hoặc Postman) với dữ liệu giả định:

### Bước 3.1: Chuẩn bị dữ liệu mẫu trong cơ sở dữ liệu
Chèn một kết quả xét nghiệm giả định tại LIS và liên kết bệnh nhân tương ứng tại EMR:

```bash
docker compose exec -i db psql -U postgres -d dacn_db << 'EOF'
-- 1. Bệnh nhân và kết quả xét nghiệm tại LIS
INSERT INTO lis.patients (patient_id, full_name, birth_date, gender)
VALUES ('DEMO-P1', 'Nguyễn Văn Thử Nghiệm', '1990-01-01', 'M')
ON CONFLICT (patient_id) DO NOTHING;

INSERT INTO lis.test_catalog (test_code, test_name, fluid, category, default_unit)
VALUES ('GLU-01', 'Glucose máu', 'Blood', 'Biochemistry', 'mmol/L')
ON CONFLICT (test_code) DO NOTHING;

INSERT INTO lis.results (result_id, patient_id, test_code, value_num, unit, reference_low, reference_high, effective_at, result_status)
VALUES ('DEMO-R1', 'DEMO-P1', 'GLU-01', 5.60, 'mmol/L', 3.90, 6.40, '2026-10-30 08:30:00+07', 'FINAL')
ON CONFLICT (result_id) DO UPDATE SET result_status = 'FINAL';

-- 2. Bệnh nhân và liên kết định danh tại EMR
INSERT INTO emr.patients (patient_key, display_label)
VALUES ('a0000000-0000-4000-8000-000000000001', 'DEMO PATIENT 01')
ON CONFLICT (patient_key) DO NOTHING;

INSERT INTO emr.patient_links (patient_key, identifier_system, identifier_value)
VALUES ('a0000000-0000-4000-8000-000000000001', 'https://example.org/lis/patient', 'DEMO-P1')
ON CONFLICT (identifier_system, identifier_value) DO NOTHING;
EOF
```

### Bước 3.2: Bác sĩ duyệt phát hành (Publish) tại LIS
```bash
curl -i -X POST http://127.0.0.1:3101/api/results/DEMO-R1/publish
```
**Kết quả mong đợi:** HTTP `202 Accepted`
```json
{
  "event_id": "<EVENT_UUID>",
  "result_id": "DEMO-R1",
  "dispatch_status": "PENDING",
  "exchange_id": null
}
```

### Bước 3.3: Quan sát quá trình xử lý tự động
Nếu `lis-dispatcher` và `middleware-worker` đang chạy:
1. Dispatcher nhận sự kiện $\rightarrow$ Gọi Middleware `POST /api/exchanges` $\rightarrow$ LIS nhận xác nhận $\rightarrow$ LIS cập nhật `dispatch_status = 'ACK'`.
2. Worker nhận việc $\rightarrow$ Gọi Mapper tạo FHIR R4 Observation $\rightarrow$ Gọi EMR `POST /api/observations` $\rightarrow$ Nhận `201 STORED`.
3. Worker gọi EMR `GET /api/lab-results?external_id=DEMO-R1` $\rightarrow$ Nhận dữ liệu đã lưu $\rightarrow$ Đối chiếu khớp $\rightarrow$ Cập nhật giao dịch thành **`DELIVERED`**.

### Bước 3.4: Kiểm tra kết quả tại các endpoint
```bash
# 1. Kiểm tra trạng thái LIS (Phải là ACK):
curl -s http://127.0.0.1:3101/api/publish-events/<EVENT_UUID> | jq .

# 2. Kiểm tra trạng thái Middleware (Phải là DELIVERED):
curl -s "http://127.0.0.1:3102/api/exchanges?source_result_id=DEMO-R1" | jq .

# 3. Kiểm tra kết quả đã lưu tại EMR qua API đọc lại:
curl -s "http://127.0.0.1:3103/api/lab-results?external_system=https://example.org/lis/result&external_id=DEMO-R1" | jq .
```

---

## 4. Bảng kiểm Tra chéo Dành cho Đồng nghiệp (Human Review Checklist)

Vui lòng đối chiếu các bước sau khi thực hiện kiểm tra chéo:

- [ ] **1. Phát hành tại LIS:** Gọi `POST /api/results/:resultId/publish` trả về mã `202` và trường `event_id`. Thử gọi lại lần 2 trả về mã `200` với cùng `event_id`.
- [ ] **2. Kiểm tra Outbox LIS & Trạng thái ACK:** Sau khi Dispatcher chạy, kiểm tra bảng `lis.publish_events`: trường `dispatch_status` chuyển thành `ACK`, có `acked_at`, có `exchange_id` và `lease_until` là `NULL`.
- [ ] **3. Kiểm tra Giao dịch Middleware:** Kiểm tra bảng `integration.exchange_transactions`: trường `status` chuyển thành `DELIVERED`, có `verified_at` và `completed_at` khớp nhau.
- [ ] **4. Kiểm tra Tài nguyên FHIR R4:** Kiểm tra trường `fhir_payload` trong `integration.exchange_transactions` có cấu trúc `resourceType: "Observation"`, mã xét nghiệm đúng, giá trị số đúng `5.6` và đơn vị đúng `mmol/L`.
- [ ] **5. Kiểm tra Lưu trữ tại EMR:** Kiểm tra bảng `emr.lab_results`: tồn tại đúng 1 bản ghi với `external_id = 'DEMO-R1'`, `patient_key = 'a0000000-0000-4000-8000-000000000001'`.
- [ ] **6. Xác minh Hai chiều (Read-back):** Gọi `GET /api/lab-results` tại EMR và đối chiếu các trường số học không bị làm tròn sai lệch.

---

## 5. Các lỗi Thường gặp và Cách Xử lý (Troubleshooting)

| Hiện tượng | Nguyên nhân theo mã nguồn | Hướng xử lý |
|---|---|---|
| LIS Publish trả về `422 Unprocessable Entity` | Kết quả xét nghiệm tại LIS chưa ở trạng thái `FINAL` hoặc thiếu giá trị số `value_num` / thời gian `effective_at` | Cập nhật `result_status = 'FINAL'` trong bảng `lis.results` |
| LIS mãi ở trạng thái `PENDING` hoặc `RETRY_WAIT` | Tiến trình `lis-dispatcher` chưa được khởi động hoặc cấu hình sai `MIDDLEWARE_BASE_URL` | Bật tiến trình Dispatcher (`npm run dev:lis-dispatcher` hoặc profile Docker `dispatcher`) và kiểm tra biến `MIDDLEWARE_BASE_URL` trong `.env` |
| Middleware chuyển trạng thái sang `REJECTED` | EMR từ chối với mã 422 `PATIENT_NOT_LINKED` do không tìm thấy `subject.identifier` trong `emr.patient_links` | Đảm bảo đã chèn bản ghi liên kết định danh bệnh nhân trong bảng `emr.patient_links` trước khi duyệt gửi |
| Giao dịch Middleware ở trạng thái `FAILED` kèm mã `VERIFY_MISMATCH` | Quá trình đọc lại đối soát phát hiện dữ liệu EMR lưu trữ không khớp với FHIR Observation (sai số, sai đơn vị, sai mốc thời gian) | Kiểm tra dữ liệu bị thay đổi bất thường ở tầng EMR; xem chi tiết lỗi trong mảng `events` của `GET /api/exchanges/:exchangeId` |
| Lỗi `503 DEPENDENCY_UNAVAILABLE` trên bất kỳ API nào | Kết nối cơ sở dữ liệu bị ngắt hoặc sai mật khẩu tài khoản của service đó | Chạy `npm run db:check` tại `backend/` để kiểm tra tài khoản nào bị sai quyền hoặc mật khẩu |

---

## 6. Mẫu Bình luận Đề xuất cho Jira (Suggested Jira Review Comment)

Dưới đây là nội dung bình luận mẫu được chuẩn bị sẵn để báo cáo tiến độ trên Jira SPP-66. *(Lưu ý: Không tự ý gửi tự động, hãy sao chép và cập nhật sau khi đồng nghiệp hoàn tất kiểm tra chéo)*:

```markdown
h3. Báo cáo Tiến độ Hoàn thành Kỹ thuật nhiệm vụ SPP-66 (D1–D4)

Đã hoàn thành toàn bộ công tác triển khai kỹ thuật, sửa đổi tài liệu và kiểm toán mã nguồn cho SPP-66:

*1. Hiện trạng triển khai backend:*
- Hoàn thành đầy đủ 3 API service độc lập (LIS, Middleware, EMR) và 2 tiến trình xử lý nền (LIS Dispatcher, Middleware Worker) theo kiến trúc Outbox và Read-back Verification.
- Luồng trao đổi toàn vẹn hai chiều đã vận hành trơn tru: LIS Publish -> Dispatcher -> Middleware API -> Worker & Mapper (FHIR R4 Observation) -> EMR API -> EMR Read-back -> DELIVERED.

*2. Kết quả kiểm thử tự động:*
- Toàn bộ 495 tests hồi quy trên cơ sở dữ liệu PostgreSQL cô lập đều đạt kết quả PASS (0 failures, 0 skipped).
- 15 ca kiểm thử tích hợp E2E toàn luồng (D3-01 đến D3-10) đã kiểm chứng thành công các kịch bản khó: đứt mạng Middleware, mất gói tin ACK, tranh chấp Dispatcher, ngắt tiến trình bằng SIGKILL, và kiểm chứng các biến thể khoảng tham chiếu.
- Đã xác minh mã băm SHA-256 của các tệp schema và fixture hoàn toàn trùng khớp với bằng chứng lưu trữ.

*3. Cập nhật tài liệu:*
- Đã cập nhật `README.md` chính xác hóa năng lực hệ thống hiện tại, hướng dẫn khởi chạy với Docker profiles và Node.js.
- Đã bổ sung biến cấu hình `MIDDLEWARE_BASE_URL` trong `.env.example` và làm sạch các ghi chú cũ.
- Đã phát hành Báo cáo Kiểm toán Kỹ thuật: `docs/spp-66-d4-final-review.md`.
- Đã phát hành Tài liệu Bàn giao: `docs/spp-66-handover.md`.

*4. Yêu cầu phối hợp tiếp theo:*
- Đề nghị đồng nghiệp phụ trách kiểm tra chéo (Human Cross-check) thực hiện chạy thử kịch bản happy-path theo hướng dẫn tại `docs/spp-66-handover.md`.
- Sẵn sàng phối hợp tích hợp với nhánh giao diện Frontend (SPP-67).

*Trạng thái khuyến nghị:* **Ready for Review**
```
