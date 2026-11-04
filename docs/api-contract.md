# Hợp đồng API V1 — LIS → Middleware → EMR

> **Mục đích:** Thống nhất dữ liệu gửi/nhận để hai thành viên có thể lập trình độc lập.  
> **Trạng thái:** Các API LIS (A3), Middleware (B3), EMR (C3) và Dispatcher D2 đã triển khai. **D3 đã kiểm thử toàn luồng backend thật: LIS Publish → Dispatcher → Middleware → Worker/Mapper → EMR → đọc lại → DELIVERED**, với PostgreSQL cô lập và dữ liệu giả có đáp án riêng. Xem [review D3](spp-66-d3-review.md) cho bằng chứng, cách chạy và giới hạn. Các bộ [C4](spp-66-c4-review.md), [D2](spp-66-d2-review.md) và B4B được giữ riêng. Chưa kiểm thử bộ MIMIC/SPP-65 chính thức, chưa làm D4, frontend hoặc evaluator. `/health` và `/ready` giữ nguyên.

## 1. Quy ước chung

- Ba dịch vụ chỉ trao đổi dữ liệu qua **HTTP**, không truy cập database của nhau.
- URL **trên máy cá nhân**: LIS `http://127.0.0.1:3101`, Middleware `http://127.0.0.1:3102`, EMR `http://127.0.0.1:3103`. **Trong Docker**, các dịch vụ gọi nhau bằng `http://lis:3101`, `http://middleware:3102`, `http://emr:3103`.
- Dùng JSON (`Content-Type: application/json`); riêng API nhận FHIR dùng `application/fhir+json`. Mã định danh là chuỗi; `event_id`, `exchange_id`, `target_id` là UUID. Thời gian dùng ISO 8601 kèm múi giờ.
- Chỉ dùng **dữ liệu thử nghiệm đã khử định danh**. Bản V1 chưa có xác thực người dùng, **không mở API ra Internet**.

## 2. Danh sách API

| Dịch vụ | API | Chức năng | Trạng thái |
|---|---|---|---|
| LIS | `GET /api/results` | Xem/lọc kết quả xét nghiệm | Đã triển khai, kiểm thử A3 |
| LIS | `GET /api/results/:resultId` | Xem chi tiết kết quả | Đã triển khai, kiểm thử A3 |
| LIS | `POST /api/results/:resultId/publish` | Lưu yêu cầu gửi một kết quả | Đã triển khai, kiểm thử A3 |
| LIS | `GET /api/results/:resultId/publish-event` | Tra cứu chỉ đọc trạng thái Publish theo kết quả, khôi phục sau F5 | Đã triển khai Giai đoạn 2.3 |
| LIS | `GET /api/publish-events/:eventId` | Xem tình trạng gửi | Đã triển khai, kiểm thử A3 |
| Middleware | `POST /api/exchanges` | Nhận dữ liệu từ LIS | Đã triển khai, kiểm thử B3 |
| Middleware | `GET /api/exchanges` | Xem/lọc giao dịch | Đã triển khai, kiểm thử B3 |
| Middleware | `GET /api/exchanges/:exchangeId` | Xem chi tiết và lịch sử giao dịch | Đã triển khai, kiểm thử B3 |
| EMR | `POST /api/observations` | Lưu kết quả theo FHIR R4 Observation | Đã triển khai C3; kiểm thử tích hợp Worker thật C4 |
| EMR | `GET /api/lab-results` | Xem/đọc lại kết quả đã lưu | Đã triển khai C3; kiểm thử tích hợp Worker thật C4 |
| Cả ba | `GET /health` | Kiểm tra HTTP đang chạy | Đã có |
| Cả ba | `GET /ready` | Kiểm tra kết nối, tài khoản và bảng database | Đã có |

LIS có giao diện **Swagger UI tại `/docs/api/`** để thử 4 API trên cùng
`/health`, `/ready`. File mô tả OpenAPI ở `/docs/api/openapi.json`. Giao diện
gọi chính server đang mở và không thay đổi hành vi Publish. Cách chuẩn bị dữ
liệu giả và bấm thử: [hướng dẫn A3](spp-66-a3-review.md#thử-api-bằng-giao-diện-swagger-ui).

## 3. Luồng gửi kết quả

### Bước 1 — LIS: Publish

`POST /api/results/:resultId/publish` **không cần body**; chỉ nhận kết quả `FINAL` hợp lệ.

- **Lần đầu:** lưu `event_id`, bản chụp dữ liệu (`source_snapshot`), `source_hash`, thời điểm Publish trong một giao dịch LIS; trả **`202`**.
- **Publish lại cùng nội dung:** trả **`200`** với `event_id` cũ, không tạo sự kiện mới hay đặt lại dispatcher. Dựng lại snapshot theo định dạng JSON number/UTC hiện có; so sánh cả canonical JSON và SHA-256. `3.4000` và `3.4` là cùng nội dung. Thay đổi chính sách `accepted_units` không thuộc snapshot.
- **Nội dung nguồn thay đổi sau Publish:** trả **`409 CONTENT_CONFLICT`**, giữ nguyên event/snapshot/hash và tiến trình cũ. Kết quả đã Publish rồi chuyển về READY cũng xung đột với snapshot FINAL. So sánh và tạo event nằm trong giao dịch giữ SHARE lock trên nguồn; unique constraint hiện có bảo vệ khi gọi đồng thời.
- Không tìm thấy → **`404`**; không đủ điều kiện → **`422`**.
- Body không bắt buộc; ID ở đường dẫn là ID được xử lý. Body JSON hợp lệ nếu
  gửi thêm không thay đổi nội dung Publish. JSON hỏng trả `400`, body JSON vượt
  giới hạn `1mb` hiện có trả `413`; charset/encoding không hỗ trợ trả `415`.

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
- Gửi lại **cùng ID + cùng nội dung** → vẫn trả **`202`**, sáu trường như lần đầu và `exchange_id` cũ; không đổi trạng thái, payload, counters hoặc lịch sử. Cùng `event_id` hoặc `(source_system, source_result_id)` nhưng dữ liệu/sự kiện khác → **`409`**.
- Nếu gửi lại do lỗi mạng, **giữ nguyên** `event_id`, snapshot và hash; không lấy lại dữ liệu nguồn đã thay đổi.

B1–B3 lưu **toàn bộ envelope** trên vào `source_payload` dạng JSONB, không chỉ
snapshot. So sánh retry gồm cả hai định danh, hash và toàn bộ envelope; thứ tự
key object không ảnh hưởng nhưng chuỗi timestamp khác cách viết vẫn là nội dung
khác. B2 kiểm tra/tính lại hash trước khi gọi Repository; xem [chi tiết B2](spp-66-b2-review.md).
`202` chỉ xác nhận Middleware đã lưu, chưa ghi ACK thay LIS và chưa giao EMR.

Dispatcher D2 chạy riêng, gửi sáu trường trên từ outbox qua HTTP, không đọc lại
`lis.results`. Chỉ ghi ACK sau khi kiểm tra đầy đủ receipt và Repository D1
commit. Timeout/mất kết nối, `408/429/5xx` → thử lại có giới hạn; hết lượt →
`FAILED`. `409` và các `4xx` còn lại → `BLOCKED`; `202` sai JSON/UUID/định danh/hash
hoặc mã HTTP ngoài hợp đồng → `FAILED`. Đây là chính sách LIS bổ sung ở D2;
không thay đổi trạng thái Middleware. Lịch thử mặc định 2/4/8 giây, tổng 4 lượt.
Chi tiết cấu hình, phục hồi lease và giới hạn kiểm thử: [review D2](spp-66-d2-review.md).
D3 đã kiểm thử Dispatcher với Middleware thật, kể cả mất phản hồi sau khi lưu,
hai Dispatcher cạnh tranh và khởi động lại; xem [review D3](spp-66-d3-review.md).

### Bước 3 — Middleware gửi sang EMR

B4A đã có `mapObservation(source_snapshot)` chuyển snapshot đã kiểm tra sang
Observation theo MR01–MR09, mapping version nội bộ `lis-observation-v1`.
Hàm không đọc/ghi database hoặc gửi HTTP. Worker B4B chạy riêng, lấy snapshot đã
lưu qua Repository rồi gọi Mapper; API nhận chỉ lưu và trả ACK như B3.
Khi thiếu cả hai cận thì bỏ `referenceRange`; thiếu fluid/category thì bỏ phần
đó khỏi `code.text`. Giá trị không hợp lệ/không biểu diễn được trả lỗi có kiểu,
không tự sửa nguồn. Chi tiết và JSON đầy đủ: [hướng dẫn B4A](spp-66-b4a-review.md).
Worker đã triển khai phần gửi/đọc lại dưới đây. C3 triển khai hai endpoint EMR;
C4 đã chạy Worker/Mapper thật với hai endpoint này qua HTTP và PostgreSQL cô
lập, kiểm tra dữ liệu độc lập, `verifyReadBack`, trạng thái `DELIVERED` và audit.
Các test EMR giả lập của B4B được giữ nguyên. D3 bổ sung toàn luồng từ LIS Publish
và Dispatcher với dữ liệu giả; chưa phải nghiệm thu bằng dataset SPP-65.

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

### Dạng JSON đọc lại từ EMR — bổ sung hợp đồng ở B4B

Trước B4B, contract chỉ nêu `{"items": [...]}` và MR01–MR09, chưa chốt tên/kiểu
trường của từng item. B4B dùng các tên snake_case tương ứng schema EMR hiện có
và bổ sung yêu cầu dưới đây để có thể kiểm tra đầy đủ. **C3 đã triển khai và
kiểm thử hợp đồng này trên HTTP + PostgreSQL EMR thật**. C4 tiếp tục xác nhận
Worker thật gửi, đọc lại và lưu `DELIVERED` theo hợp đồng này. Nghiệm thu toàn
luồng LIS vẫn là bước riêng. Không thay đổi bảng hoặc cột SQL.

`GET /api/lab-results?external_system=...&external_id=...` phải trả `200`,
`Content-Type: application/json`, với `items` chứa mọi kết quả của đúng cặp ID
(không che kết quả trùng bằng phân trang). Chế độ này không yêu cầu `limit/offset`.

| Trường trong mỗi item | Kiểu / yêu cầu |
|---|---|
| `target_id`, `patient_key` | UUID, khớp phản hồi POST đã lưu; so UUID không phân biệt chữ hoa/thường |
| `external_system`, `external_id` | Chuỗi, khớp chính xác `Observation.identifier[0]` |
| `analyte_system`, `analyte_code`, `analyte_display` | Chuỗi, khớp `code.coding[0].system/code/display` |
| `analyte_context` | Chuỗi, khớp `code.text` |
| `quantity` | **Chuỗi số thập phân** từ NUMERIC; ví dụ `"3.4000"`. Không ép sang JS number trước khi trả |
| `unit_text` | Chuỗi đơn vị nguyên gốc |
| `low`, `high` | Chuỗi số thập phân, hoặc **`null` rõ ràng** khi không có cận |
| `effective_at` | ISO 8601 đầy đủ kèm múi giờ, giữ độ chính xác PostgreSQL (đến microsecond) |
| `clinical_status` | `"final"` |
| `fhir_json` | Object Observation nguyên gốc đã lưu, gồm subject identifier và nhóm laboratory |

Worker so sánh số theo chữ số và số mũ, nên `"3.4000"` bằng `3.4` nhưng
`"3.400000000000000000001"` không bằng `3.4`; không làm tròn. Chuỗi số tối đa
4096 ký tự, không có khoảng trắng. So thời gian theo
instant và giữ **toàn bộ phần lẻ giây**: đổi múi giờ được chấp nhận, mất một
microsecond không được chấp nhận. Các số trong `fhir_json` giữ kiểu JSON number
như Observation đã gửi; các cột NUMERIC đọc lại dùng chuỗi như bảng trên.

`fhir_json` phải giữ nguyên Observation theo giá trị JSON (thứ tự key không quan
trọng, `effectiveDateTime` được viết bằng múi giờ tương đương). B4B chưa cho phép
EMR thêm `id/meta` hay đổi cấu trúc FHIR trong trường này. Các cột chỉ chứng minh
một phần MR02/MR09; cần cả FHIR lưu lại để kiểm tra `subject.identifier` và
nhóm `laboratory`. Worker không truy cập `patient_links`; xác minh liên kết
người bệnh độc lập vẫn thuộc bước nghiệm thu/evaluator sau này.

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

### Phản hồi GET của LIS — đã triển khai ở A3

Trước A3, contract chưa có mẫu JSON chi tiết cho hai API đọc kết quả. A3 bổ sung
dạng phản hồi sau; đây là dữ liệu nguồn để xem, không phải `source_snapshot` của Publish:

```json
{
  "items": [{
    "result_id": "A3-DEMO-R1",
    "patient_id": "A3-DEMO-P1",
    "test_code": "A3-DEMO-T1",
    "test_name": "Synthetic test",
    "fluid": "Blood",
    "category": "Chemistry",
    "value_num": "3.4000",
    "unit": "mg/dL",
    "reference_low": "1.2000",
    "reference_high": null,
    "effective_at": "2026-10-22T08:00:00.123456Z",
    "result_status": "FINAL"
  }],
  "limit": 20,
  "offset": 0
}
```

- `GET /api/results/:resultId` trả một object cùng dạng từng phần tử `items`,
  không có lớp bọc danh sách. Không tìm thấy trả `404`/`NOT_FOUND`.
- `value_num`, `reference_low`, `reference_high` của API đọc giữ dạng chuỗi
  PostgreSQL NUMERIC để không làm mất độ chính xác; cận thiếu là `null`.
  Snapshot Publish vẫn dùng JSON number và kiểm tra độ chính xác theo A2.
- `effective_at` trả UTC ISO 8601, giữ đủ sáu chữ số phần giây. Với nguồn không
  có instant ISO hữu hạn trong năm 0001–9999, API đọc trả `null`; Publish sẽ từ
  chối dữ liệu thời gian không hợp lệ theo A2.
- Các bộ lọc kết hợp bằng AND. `result_status` chỉ nhận `READY` hoặc `FINAL`.
  Danh sách sắp theo `result_id` tăng dần trước khi phân trang.
- `limit` nhận số nguyên 1–100, `offset` là số nguyên không âm không vượt
  `Number.MAX_SAFE_INTEGER`. Query phải biểu diễn bằng chữ số, không dùng dấu,
  số thập phân, số mũ hoặc khoảng trắng. Không truyền thì dùng 20/0.
- Tham số không hỗ trợ, tham số lặp, dạng mảng/object hoặc bộ lọc trống trả
  `400`/`VALIDATION_ERROR`. ID kết quả là chuỗi không trống, không có ký tự điều
  khiển; không bắt buộc theo định dạng UUID hoặc tiền tố của dataset.

`GET /api/publish-events/:eventId` trả:

```json
{
  "event_id": "00000000-0000-4000-8000-000000000001",
  "result_id": "A3-DEMO-R1",
  "dispatch_status": "PENDING",
  "exchange_id": null,
  "dispatch_attempt_count": 0,
  "last_error_code": null,
  "last_error_message": null
}
```

UUID phải có dạng `8-4-4-4-12`, không phân biệt chữ hoa/thường; sai định dạng trả
`400`, UUID hợp lệ nhưng không tồn tại trả `404`/`NOT_FOUND`. Trạng thái và số
lần gửi lấy từ sự kiện đã lưu. Khi có lỗi gần nhất, API trả mã lỗi và thông báo
chung `The latest dispatch attempt failed.` thay vì nội dung chẩn đoán thô.
Mã lỗi lưu không đúng dạng chữ hoa/số/gạch dưới (tối đa 64 ký tự, bắt đầu bằng
chữ) được trình bày là `DISPATCH_ERROR`; không sửa bản ghi gốc.

### Tra cứu Publish theo kết quả — Giai đoạn 2.3

`GET /api/results/:resultId/publish-event` không cần body, không nhận query.
`resultId` dùng cùng quy tắc chuỗi định danh như GET chi tiết; encode đúng một lần.
Thao tác chỉ SELECT, không tạo event hoặc cập nhật tiến trình; trả `Cache-Control: no-store`.

Chưa Publish trả **200**, khác với kết quả không tồn tại (**404 NOT_FOUND**):

```json
{"result_id":"R1","result_status":"FINAL","published":false,"event":null}
```

Đã Publish trả **200**:

```json
{
  "result_id": "R1", "result_status": "FINAL", "published": true,
  "event": {
    "event_id": "00000000-0000-4000-8000-000000000001",
    "result_id": "R1", "dispatch_status": "PENDING", "exchange_id": null,
    "dispatch_attempt_count": 0, "last_error_code": null, "last_error_message": null,
    "published_at": "2026-11-04T05:00:00.000Z", "acked_at": null, "next_retry_at": null
  }
}
```

`result_status` là nguồn hiện tại, không phải trạng thái trong snapshot cũ.
Ba thời điểm lấy từ event đã lưu; `acked_at`/`next_retry_at` nullable.
Thông tin lỗi được làm an toàn giống GET event theo UUID. ID/query sai trả
**400 VALIDATION_ERROR**; lỗi truy cập database trả **503 DEPENDENCY_UNAVAILABLE**.
Mọi lỗi dùng `{ "error": { "code": "...", "message": "..." } }`.
GET lặp trả dữ liệu hiện tại, không phát sinh tác dụng phụ. GET theo UUID giữ
nguyên bảy trường cũ và cũng được đánh dấu `no-store`.

Frontend LIS đi qua tiền tố `/api/lis` cho các endpoint LIS; GET middleware
`/api/middleware/exchanges/:exchangeId` đi qua proxy middleware sẵn có.
`ACK` chỉ xác nhận tiếp nhận. UI chỉ hiển thị `DELIVERED` khi phản hồi MW khớp
`exchange_id`, `event_id`, `source_result_id`, `source_system=lis-demo`, và có
`verified_at`/`completed_at` hợp lệ. Lỗi đọc hoặc dữ liệu không khớp là **Chưa xác minh**.
Không có API retry thủ công mới hoặc deep link Monitor.

### Phản hồi Middleware — đã triển khai ở B3

Trước B3, contract chưa chốt JSON cho từng phần tử danh sách/chi tiết và event.
B3 bổ sung quy ước sau; không thay đổi định danh hoặc quy tắc idempotency.

`POST /api/exchanges` nhận `Content-Type: application/json`. Thiếu/sai media type
trả `415`; JSON hỏng hoặc thiếu/sai kiểu trường/UUID/hash format/thời gian trả
`400`; hash không khớp hoặc dữ liệu nghiệp vụ không hợp lệ trả `422`. Giới hạn
JSON hiện có vẫn là `1mb` (`413` khi vượt); charset/encoding không hỗ trợ trả
`415`; body nén bị hỏng trả `400`. Các lỗi này dùng error envelope bên dưới. Body rỗng với media type JSON
trả `400`. Phản hồi thành công chỉ có sáu trường:

```json
{
  "accepted": true,
  "event_id": "00000000-0000-4000-8000-000000000001",
  "exchange_id": "00000000-0000-4000-8000-000000000002",
  "source_system": "lis-demo",
  "source_result_id": "B2-GOLDEN-R1",
  "source_hash": "66d4bb0e7270c1f2983f90de625361cb26dc4c06e65247a1c2627031a9c1bd1d"
}
```

`GET /api/exchanges` trả `{ "items": [...], "limit": 20, "offset": 0 }`.
Mỗi item gồm:

```json
{
  "exchange_id": "00000000-0000-4000-8000-000000000002",
  "event_id": "00000000-0000-4000-8000-000000000001",
  "source_system": "lis-demo",
  "source_result_id": "B2-GOLDEN-R1",
  "source_hash": "66d4bb0e7270c1f2983f90de625361cb26dc4c06e65247a1c2627031a9c1bd1d",
  "status": "RECEIVED",
  "retry_phase": null,
  "send_attempt_count": 0,
  "verify_attempt_count": 0,
  "published_at": "2026-10-22T09:00:00.000Z",
  "received_at": "2026-10-26T02:00:00.000Z",
  "next_retry_at": null,
  "completed_at": null
}
```

- Chỉ hỗ trợ `status`, `source_result_id`, `limit`, `offset`; các bộ lọc kết hợp
  bằng AND. `status` nhận đúng một trong bảy trạng thái Middleware ở bảng trên.
- `source_result_id` là chuỗi không trống, không có ký tự điều khiển; không tự
  trim hoặc đổi chữ hoa/thường trước khi tra. Không lọc bằng patient ID.
- `limit` nguyên 1–100, mặc định 20; `offset` nguyên 0–`Number.MAX_SAFE_INTEGER`,
  mặc định 0. Query chỉ gồm chữ số cho hai trường này, không nhận dấu, số thập
  phân, số mũ hoặc khoảng trắng. Sắp theo `received_at DESC, exchange_id ASC`.
- Query không hỗ trợ, bị lặp, dạng array/object hoặc bộ lọc trống trả
  `400`/`VALIDATION_ERROR`. Không có kết quả trả `items: []`.

`GET /api/exchanges/:exchangeId` trả một object gồm **toàn bộ trường của item**
cộng các trường sau:

| Trường | Nội dung |
|---|---|
| `source_payload` | Toàn bộ envelope JSON đã lưu |
| `fhir_payload` | JSON đã lưu, hoặc `null` nếu chưa có; B3 không tạo FHIR |
| `payload_hash`, `mapping_version` | Giá trị đã lưu hoặc `null` |
| `validated_at`, `mapping_started_at`, `transformed_at`, `first_sent_at`, `target_stored_at`, `verified_at` | Mốc thời gian đã lưu hoặc `null` |
| `events` | Mảng event đã lưu, có dạng dưới đây; rỗng trả `[]` |

```json
{
  "log_event_id": "00000000-0000-4000-8000-000000000003",
  "exchange_id": "00000000-0000-4000-8000-000000000002",
  "event_type": "RECEIVED",
  "old_status": null,
  "new_status": "RECEIVED",
  "occurred_at": "2026-10-26T02:00:00.000Z",
  "attempt_id": null
}
```

Lịch sử sắp theo `occurred_at ASC, log_event_id ASC`. Không trả JSON chẩn đoán
thô `exchange_events.detail`, lease/token nội bộ hoặc response/error body của
attempt. Tất cả trạng thái, counters và events lấy từ dữ liệu đã lưu.
Timestamp cột được trả UTC ISO 8601 qua `Date` hiện có, đến millisecond;
chuỗi trong `source_payload` giữ nguyên độ chính xác gốc.

`exchangeId` phải là UUID `8-4-4-4-12`, không phân biệt chữ hoa/thường:
sai định dạng trả `400`, hợp lệ nhưng không tồn tại trả `404`/`NOT_FOUND`.
POST và GET chi tiết không hỗ trợ query parameter, có query trả `400`.
Lỗi database trên ba API trả `503`/`DEPENDENCY_UNAVAILABLE`, không lộ lỗi driver.
Hướng dẫn thử bằng `curl` và kết quả test: [SPP-66 B3](spp-66-b3-review.md).

### Phản hồi EMR — đã triển khai ở C3

`POST /api/observations` yêu cầu `Content-Type: application/fhir+json`, không
nhận query parameter. Parser đọc JSON trực tiếp, giới hạn `1mb`; các endpoint
JSON khác vẫn nhận `application/json`. Body phải là một Observation thuộc tập
FHIR dự án đã kiểm tra tại C2, không phải Bundle hoặc một validator FHIR tổng quát.

- `201`/`STORED` chỉ trả sau khi transaction commit; retry giống hệt trả
  `200`/`ALREADY_EXISTS`, cùng `target_id` và `patient_key`.
- Cùng cặp định danh nhưng nội dung hoặc liên kết người bệnh khác trả
  `409`/`DUPLICATE_CONFLICT`; không ghi đè.
- Observation sai/không hỗ trợ, body JSON rỗng hoặc sai kiểu trả
  `422`/`VALIDATION_ERROR`; thiếu liên kết trả `422`/`PATIENT_NOT_LINKED`.
- Query sai hoặc JSON hỏng trả `400`/`VALIDATION_ERROR`; vượt `1mb` trả `413`.
  Thiếu/sai media type, charset không hỗ trợ hoặc Content-Encoding khác
  `identity` trả `415`/`VALIDATION_ERROR`. Body nén không được hỗ trợ.
- Lỗi database trả `503`/`DEPENDENCY_UNAVAILABLE`, không trả SQL, thông tin
  kết nối, stack trace hay nội dung bệnh nhân trong thông báo lỗi.

Thành công chỉ trả năm trường:

```json
{
  "result": "STORED",
  "external_system": "https://example.org/lis/result",
  "external_id": "B4A-SYNTHETIC-R1",
  "target_id": "00000000-0000-4000-8000-000000000066",
  "patient_key": "00000000-0000-4000-8000-000000000067"
}
```

`GET /api/lab-results` hỗ trợ đúng hai chế độ:

- Cặp `external_system` + `external_id`: trả `{ "items": [...] }`, không phân
  trang hoặc gộp kết quả. Không có kết quả trả `{ "items": [] }`. Không kết hợp
  với `patient_key`, `limit` hoặc `offset`.
- `patient_key`: UUID dạng `8-4-4-4-12`; tùy chọn `limit` (1–100, mặc định 20)
  và `offset` (0–`Number.MAX_SAFE_INTEGER`, mặc định 0). Hai tham số phân trang
  chỉ nhận chữ số. Trả `{ "items": [...], "limit": 20, "offset": 0 }`, sắp theo
  `effective_at DESC, target_id ASC` trước phân trang.

Thiếu bộ lọc, chỉ có một nửa cặp định danh, trộn hai chế độ, tham số không hỗ
trợ/lặp/dạng array hoặc object, giá trị rỗng, ký tự điều khiển hoặc mã hóa query
hỏng đều trả `400`/`VALIDATION_ERROR`. Giữ nguyên khoảng trắng và chữ hoa/thường
trong định danh hợp lệ khi tra cứu. Lỗi database ở cả hai chế độ trả `503`.
Item trả dữ liệu Repository đã lưu như mục 4, cộng `received_at`, `stored_at`
đầy đủ microsecond. Không ép NUMERIC thành number hoặc timestamp thành `Date`.

Ví dụ tại thư mục gốc repo, sau khi đã có liên kết người bệnh giả
`https://example.org/lis/patient` + `B4A-SYNTHETIC-P1` trong EMR:

```bash
curl -i http://127.0.0.1:3103/api/observations \
  -H 'Content-Type: application/fhir+json' \
  --data-binary @backend/tests/middleware/fixtures/observation-r4-golden.json

curl -G http://127.0.0.1:3103/api/lab-results \
  --data-urlencode 'external_system=https://example.org/lis/result' \
  --data-urlencode 'external_id=B4A-SYNTHETIC-R1'

# Thay patient_key bằng UUID EMR nhận từ POST.
curl -G http://127.0.0.1:3103/api/lab-results \
  --data-urlencode 'patient_key=00000000-0000-4000-8000-000000000067' \
  --data-urlencode 'limit=20' --data-urlencode 'offset=0'
```

Cách tạo fixture, ví dụ phản hồi GET, giải thích Controller bằng tiếng Việt và
kết quả test thực tế: [SPP-66 C3](spp-66-c3-review.md).

Khi lỗi nghiệp vụ, trả JSON `{"error":{"code":"DUPLICATE_CONFLICT","message":"..."}}`. Mã lỗi: `VALIDATION_ERROR`, `RESULT_NOT_READY`, `PATIENT_NOT_LINKED`, `DUPLICATE_CONFLICT`, `INVALID_TEST_CODE`, `INVALID_UNIT`, `VERIFY_MISMATCH`, `DEPENDENCY_UNAVAILABLE`; LIS A3, Middleware B3 và EMR C3 dùng `NOT_FOUND` cho `404` vì bản dự thảo trước A3 chưa chốt mã cho trường hợp này.

Các lỗi khi gọi Service/Repository từ API LIS trả `503`/`DEPENDENCY_UNAVAILABLE`
với thông báo chung, không có SQL, stack trace hoặc thông tin kết nối. Chi tiết
triển khai và ví dụ chạy thử: [SPP-66 A3](spp-66-a3-review.md).

| HTTP | Ý nghĩa | Tự thử lại? |
|---|---|---|
| `400` | JSON/tham số không đúng | Không |
| `404` | Không tìm thấy bản ghi theo ID | Không |
| `409` | Trùng mã nhưng xung đột dữ liệu | Không |
| `413` | Body JSON vượt giới hạn dung lượng | Không |
| `415` | Media type/charset/encoding của body không được hỗ trợ | Không |
| `422` | Dữ liệu không hợp lệ/chưa `FINAL`/sai bệnh nhân | Không |
| `503` hoặc lỗi `5xx` tạm thời | Service/database tạm thời không sẵn sàng | Có, có giới hạn |

- Timeout hoặc mất phản hồi **không có nghĩa dữ liệu chưa lưu**; gửi lại phải giữ nguyên ID. Lưu lịch sử mỗi lần thử.
- Tham số thử nghiệm ban đầu (còn có thể thay đổi): **1 lần đầu + tối đa 3 lần thử lại**, chờ **2/4/8 giây**, timeout **3 giây**. Khi đang đọc lại, `RETRY_WAIT` thuộc giai đoạn `VERIFY`; nếu gửi chưa xong thì thuộc `SEND`.
- B4B áp dụng ngân sách trên **riêng cho SEND và VERIFY**, cấu hình bằng biến
  môi trường. Timeout/mất kết nối, HTTP `408`, `429`, `5xx` được thử lại có giới
  hạn. POST `409/422` → `REJECTED`; lỗi HTTP khác hoặc phản hồi thành công sai
  hợp đồng → `FAILED`. GET đọc được nhưng rỗng, nhiều hơn một item hoặc sai dữ
  liệu → `FAILED` + `VERIFY_MISMATCH`, không thử gửi lại. POST thành công sai
  định danh/UUID/result không được coi là xác nhận lưu.
- Worker lưu xác nhận POST đã kiểm tra trong `exchange_attempts.response_body`
  cùng lần commit chuyển sang `VERIFYING`. Sau khi khởi động lại, dùng xác nhận
  này để đối chiếu `patient_key/target_id`; không đoán ID và không gửi lại khi
  đã xác nhận lưu. Ghi trạng thái/attempt/event luôn kiểm tra lease còn hạn.
- `completed_at` **chỉ có ở DELIVERED**, cùng `verified_at`; `FAILED/REJECTED`
  phải để `completed_at = null` theo `exchange_completed_chk`. Chi tiết cách
  chạy, phục hồi và các mốc lịch sử: [hướng dẫn B4B](spp-66-b4b-review.md).
- `/health` kiểm tra HTTP; `/ready` kiểm tra database. `/ready` trả `200` **không chứng minh** kết quả xét nghiệm đã được trao đổi.

## 6. Trước khi bắt đầu code nghiệp vụ

- [ ] Hai thành viên thống nhất endpoint, dữ liệu JSON và quy tắc MR01–MR09.
- [ ] Chốt và kiểm thử trường hợp Publish lại, gửi lại, lỗi dữ liệu, sai bệnh nhân.
- [ ] Chỉ báo `DELIVERED` khi đã đọc lại và đối chiếu đúng kết quả tại EMR.
- [ ] Cập nhật tài liệu khi API thực sự được triển khai; không coi ví dụ JSON là kết quả thử nghiệm.

**Đọc thêm:** [Kiến trúc](architecture.md) · [Database](database.md) · [HL7 FHIR R4 Observation](https://hl7.org/fhir/R4/observation.html).
