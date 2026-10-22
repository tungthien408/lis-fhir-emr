# Hợp đồng API V1 — LIS → Middleware → EMR

> **Mục đích:** Thống nhất dữ liệu gửi/nhận để hai thành viên có thể lập trình độc lập.  
> **Trạng thái:** Hiện **chỉ `/health` và `/ready` đã chạy**. Chín API nghiệp vụ dưới đây là **thiết kế dự kiến**, chưa được kiểm thử end-to-end.

## 1. Quy ước chung

- Ba dịch vụ chỉ trao đổi dữ liệu qua **HTTP**, không truy cập database của nhau.
- URL **trên máy cá nhân**: LIS `http://127.0.0.1:3101`, Middleware `http://127.0.0.1:3102`, EMR `http://127.0.0.1:3103`. **Trong Docker**, các dịch vụ gọi nhau bằng `http://lis:3101`, `http://middleware:3102`, `http://emr:3103`.
- Dùng JSON (`Content-Type: application/json`); riêng API nhận FHIR dùng `application/fhir+json`. Mã định danh là chuỗi; `event_id`, `exchange_id`, `target_id` là UUID. Thời gian dùng ISO 8601 kèm múi giờ.
- Chỉ dùng **dữ liệu thử nghiệm đã khử định danh**. Bản V1 chưa có xác thực người dùng, **không mở API ra Internet**.

## 2. Danh sách API

| Dịch vụ | API | Chức năng |
|---|---|---|
| LIS | `GET /api/results` | Xem/lọc kết quả xét nghiệm |
| LIS | `GET /api/results/:resultId` | Xem chi tiết kết quả |
| LIS | `POST /api/results/:resultId/publish` | Yêu cầu gửi một kết quả |
| LIS | `GET /api/publish-events/:eventId` | Xem tình trạng gửi |
| Middleware | `POST /api/exchanges` | Nhận dữ liệu từ LIS |
| Middleware | `GET /api/exchanges` | Xem/lọc giao dịch |
| Middleware | `GET /api/exchanges/:exchangeId` | Xem chi tiết và lịch sử giao dịch |
| EMR | `POST /api/observations` | Lưu kết quả theo FHIR R4 Observation |
| EMR | `GET /api/lab-results` | Xem/đọc lại kết quả đã lưu |
| Cả ba | `GET /health` | Kiểm tra HTTP đang chạy (**đã có**) |
| Cả ba | `GET /ready` | Kiểm tra kết nối, tài khoản và bảng database (**đã có**) |

## 3. Luồng gửi kết quả

### Bước 1 — LIS: Publish

`POST /api/results/:resultId/publish` **không cần body**; chỉ nhận kết quả `FINAL` hợp lệ.

- **Lần đầu:** lưu `event_id`, bản chụp dữ liệu (`source_snapshot`), `source_hash`, thời điểm Publish trong một giao dịch LIS; trả **`202`**.
- **Publish lại cùng kết quả:** trả **`200`** với `event_id` cũ, không tạo sự kiện mới.
- Không tìm thấy → **`404`**; không đủ điều kiện → **`422`**.

Ví dụ phản hồi:

```json
{
  "event_id": "00000000-0000-4000-8000-000000000001",
  "result_id": "MIMIC-LAB-174",
  "dispatch_status": "PENDING",
  "exchange_id": null
}
```

### Bước 2 — LIS gửi sang Middleware

`POST /api/exchanges`: LIS gửi **nguyên gói dữ liệu đã lưu khi Publish**:

```json
{
  "event_id": "00000000-0000-4000-8000-000000000001",
  "source_system": "lis-demo",
  "source_result_id": "MIMIC-LAB-174",
  "source_snapshot": {
    "result_id": "MIMIC-LAB-174",
    "patient_id": "MIMIC-P-10000032",
    "test_code": "50971",
    "test_name": "Potassium",
    "fluid": "Blood",
    "category": "Chemistry",
    "value_num": 3.4,
    "unit": "mEq/L",
    "reference_low": 3.3,
    "reference_high": 5.1,
    "effective_at": "2180-06-03T12:00:00Z",
    "result_status": "FINAL"
  },
  "source_hash": "096d1e9454dedb8b48968da02ddb4cdb6a79229d1bcd52c96e7f282fde99a0ba",
  "published_at": "2026-10-22T09:00:00Z"
}
```

- Middleware kiểm tra định dạng, ID và hash; **chỉ trả `202` sau khi lưu giao dịch**.
- Phản hồi `202` gồm: `accepted`, `event_id`, `exchange_id`, `source_system`, `source_result_id`, `source_hash`. LIS chỉ ghi **`ACK`** khi phản hồi khớp toàn bộ ID và hash đã gửi.
- Gửi lại **cùng ID + cùng nội dung** → trả `exchange_id` cũ. Cùng `event_id` hoặc `(source_system, source_result_id)` nhưng dữ liệu/sự kiện khác → **`409`**.
- Nếu gửi lại do lỗi mạng, **giữ nguyên** `event_id`, snapshot và hash; không lấy lại dữ liệu nguồn đã thay đổi.

### Bước 3 — Middleware gửi sang EMR

`POST /api/observations`: Middleware chuyển dữ liệu thành **một FHIR R4 Observation** rồi gửi EMR. Ví dụ rút gọn:

```json
{
  "resourceType": "Observation",
  "identifier": [{"system":"https://example.org/lis/result","value":"MIMIC-LAB-174"}],
  "status": "final",
  "category": [{"coding":[{"system":"http://terminology.hl7.org/CodeSystem/observation-category","code":"laboratory"}]}],
  "code": {
    "coding": [{"system":"https://example.org/lis/test-code","code":"50971","display":"Potassium"}],
    "text": "Potassium / Blood / Chemistry"
  },
  "subject": {"type":"Patient","identifier":{"system":"https://example.org/lis/patient","value":"MIMIC-P-10000032"}},
  "effectiveDateTime": "2180-06-03T12:00:00Z",
  "valueQuantity": {"value":3.4,"unit":"mEq/L"},
  "referenceRange": [{"low":{"value":3.3,"unit":"mEq/L"},"high":{"value":5.1,"unit":"mEq/L"}}]
}
```

EMR tìm người bệnh qua `subject.identifier` trong `emr.patient_links`, sau đó kiểm tra và lưu vào `emr.lab_results`:

- **`201`**: lưu mới; `result = STORED`.
- **`200`**: dữ liệu đã tồn tại và giống nhau; `result = ALREADY_EXISTS`, giữ `target_id` cũ.
- **`409`**: cùng mã kết quả nhưng nội dung khác; không ghi đè.
- **`422`**: không xác định đúng một người bệnh hoặc dữ liệu không hợp lệ; không lưu.

Phản hồi thành công luôn có: `result`, `external_system`, `external_id`, `target_id`, `patient_key`.

### Bước 4 — Middleware đọc lại kết quả

Middleware gọi `GET /api/lab-results` với **cả** `external_system` và `external_id` để kiểm tra dữ liệu đã lưu.

- EMR trả `200` dạng `{"items": [...]}`; không tìm thấy → `items: []`.
- Chỉ đánh dấu **`DELIVERED`** khi đọc lại đúng **một** kết quả, khớp `patient_key` từ phản hồi lưu và các trường cần đối chiếu ở mục 4.
- Nếu lỗi mạng khi **đọc lại**, chỉ thử đọc lại, **không gửi thêm Observation**. Nếu đọc được nhưng sai → `FAILED` (`VERIFY_MISMATCH`).
- Bộ đánh giá độc lập sau này còn phải đối chiếu người bệnh với dữ liệu đáp án chuẩn.

## 4. Các trường phải giữ đúng

| Mã | Dữ liệu từ LIS → FHIR Observation → EMR |
|---|---|
| MR01 | `result_id` → `identifier` → `external_system/external_id` |
| MR02 | `patient_id` → `subject.identifier` → tra `patient_links` lấy `patient_key` |
| MR03 | `test_code/test_name` → `code.coding` → mã và tên xét nghiệm |
| MR04 | `value_num` → `valueQuantity.value` → `quantity` (**không tự làm tròn**) |
| MR05 | `unit` → `valueQuantity.unit` → `unit_text` (**không tự đổi đơn vị**) |
| MR06 | `reference_low/high` → `referenceRange` → `low/high` (cho phép thiếu một cận) |
| MR07 | `effective_at` → `effectiveDateTime` → thời điểm xét nghiệm |
| MR08 | `FINAL` → `final` → `clinical_status` |
| MR09 | `test_name/fluid/category` → `code.text` và nhóm `laboratory` → `analyte_context` |

**Phân biệt ID:** `result_id` là mã nguồn; `event_id` là lần Publish; `exchange_id` là giao dịch Middleware; `target_id` là kết quả lưu ở EMR; `patient_id` (LIS) **khác** `patient_key` (EMR). `source_system` (ví dụ `lis-demo`) **khác** `external_system` (URI của `Observation.identifier.system`).

- Khóa chống trùng: Middleware dùng `event_id` và `(source_system, source_result_id)`; EMR dùng `(external_system, external_id)`. Không dùng `patient_id + test_code` vì một bệnh nhân có thể xét nghiệm nhiều lần.
- Namespace mẫu: `https://example.org/lis/result`, `https://example.org/lis/patient`, `https://example.org/lis/test-code`. Mã xét nghiệm hiện là mã cục bộ, **không mặc định là LOINC**.
- `source_hash`: SHA-256 của JSON snapshot với khóa object sắp theo từ điển, mảng giữ nguyên thứ tự, không thêm khoảng trắng; hai bên cần thống nhất cách biểu diễn số và thời gian trước khi tính. **So sánh cả hash lẫn nội dung**, không chỉ dựa vào hash.

## 5. Trạng thái, tra cứu và lỗi

| Nơi | Trạng thái chính |
|---|---|
| LIS `dispatch_status` | `PENDING`, `IN_FLIGHT`, `RETRY_WAIT`, `ACK`, `BLOCKED`, `FAILED` |
| Middleware `status` | `RECEIVED`, `PROCESSING`, `VERIFYING`, `RETRY_WAIT`, `DELIVERED`, `REJECTED`, `FAILED` |

Các mốc `VALIDATED`, `TRANSFORMED`, `SENT`, `TARGET_STORED` chỉ ghi trong lịch sử, không phải trạng thái chính.

**Nhớ:** Publish = LIS đã lưu yêu cầu; **`ACK` = Middleware đã lưu**; **`DELIVERED` = EMR đã lưu và Middleware đã đọc lại đúng**. Không đánh đồng ba mốc này.

Các API tra cứu dùng quy ước:

- `GET /api/results`: lọc bằng `patient_id`, `test_code`, `result_status`.
- `GET /api/exchanges`: lọc bằng `status`, `source_result_id`. Xem chi tiết giao dịch có `source_payload`, `fhir_payload` (nếu có), trạng thái và `events` (lịch sử).
- `GET /api/publish-events/:eventId`: trả `event_id`, `result_id`, `dispatch_status`, `exchange_id`, số lần gửi và lỗi gần nhất.
- `GET /api/lab-results`: tra bằng cặp `external_system` + `external_id`, **hoặc** bằng `patient_key` (bộ lọc sai/thiếu → `400`). Hai API danh sách phía LIS/Middleware và chế độ danh sách theo bệnh nhân tại EMR dùng `items`, `limit` (mặc định 20, tối đa 100), `offset` (mặc định 0). ID chi tiết không tồn tại → `404`.

Khi lỗi nghiệp vụ, trả JSON `{"error":{"code":"DUPLICATE_CONFLICT","message":"..."}}`. Mã lỗi dự kiến: `VALIDATION_ERROR`, `RESULT_NOT_READY`, `PATIENT_NOT_LINKED`, `DUPLICATE_CONFLICT`, `INVALID_TEST_CODE`, `INVALID_UNIT`, `VERIFY_MISMATCH`, `DEPENDENCY_UNAVAILABLE`.

| HTTP | Ý nghĩa | Tự thử lại? |
|---|---|---|
| `400` | JSON/tham số không đúng | Không |
| `404` | Không tìm thấy bản ghi theo ID | Không |
| `409` | Trùng mã nhưng xung đột dữ liệu | Không |
| `422` | Dữ liệu không hợp lệ/chưa `FINAL`/sai bệnh nhân | Không |
| `503` hoặc lỗi `5xx` tạm thời | Service/database tạm thời không sẵn sàng | Có, có giới hạn |

- Timeout hoặc mất phản hồi **không có nghĩa dữ liệu chưa lưu**; gửi lại phải giữ nguyên ID. Lưu lịch sử mỗi lần thử.
- Tham số thử nghiệm ban đầu (còn có thể thay đổi): **1 lần đầu + tối đa 3 lần thử lại**, chờ **2/4/8 giây**, timeout **3 giây**. Khi đang đọc lại, `RETRY_WAIT` thuộc giai đoạn `VERIFY`; nếu gửi chưa xong thì thuộc `SEND`.
- `/health` kiểm tra HTTP; `/ready` kiểm tra database. `/ready` trả `200` **không chứng minh** kết quả xét nghiệm đã được trao đổi.

## 6. Trước khi bắt đầu code nghiệp vụ

- [ ] Hai thành viên thống nhất endpoint, dữ liệu JSON và quy tắc MR01–MR09.
- [ ] Chốt và kiểm thử trường hợp Publish lại, gửi lại, lỗi dữ liệu, sai bệnh nhân.
- [ ] Chỉ báo `DELIVERED` khi đã đọc lại và đối chiếu đúng kết quả tại EMR.
- [ ] Cập nhật tài liệu khi API thực sự được triển khai; không coi ví dụ JSON là kết quả thử nghiệm.

**Đọc thêm:** [Kiến trúc](architecture.md) · [Database](database.md) · [HL7 FHIR R4 Observation](https://hl7.org/fhir/R4/observation.html).
