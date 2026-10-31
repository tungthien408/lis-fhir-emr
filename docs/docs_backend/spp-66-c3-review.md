# SPP-66 C3 — EMR Controller

C3 nối HTTP với Service C2 và Repository C1 đã có. Hai endpoint EMR đã được
kiểm thử HTTP + PostgreSQL thật. Chưa nghiệm thu end-to-end SPP-66, chưa triển
khai Dispatcher/ACK tự động phía LIS hoặc C4. Không commit/push.

## Phạm vi thay đổi và preflight

Đã đọc Git diff, contract, kiến trúc, Controller/startup/Service/Repository
EMR, Worker và `worker-verification`, EMR mock, Controller LIS/Middleware và
các test hiện có. Working tree có sẵn C1/C2 chưa commit: Service, Repository,
canonical JSON, test EMR, npm scripts, runner PostgreSQL và tài liệu C1/C2.
Các thay đổi đó được giữ nguyên.

Không phát hiện lỗi C1/C2 chặn C3. Service đã chờ transaction commit rồi mới
trả thành công. Repository đã đọc NUMERIC thành chuỗi, timestamp qua SQL text
đủ microsecond, sắp danh sách bệnh nhân theo thời điểm và UUID. Không cần sửa
Service, Repository, schema hay SQL. Vấn đề startup cần sửa là
`express.json({ limit: "1mb" })` mặc định không nhận `application/fhir+json`.

Các file của C3:

| File | Thay đổi |
|---|---|
| `backend/src/emr/controller.ts` | Parser dùng chung, kiểm tra query, hai route nghiệp vụ và JSON error handler; dependencies tùy chọn cho test |
| `backend/src/emr/main.ts` | Dùng parser EMR thay parser JSON cũ, giữ host/port và cách khởi động |
| `backend/tests/emr/controller.http.test.ts` | HTTP thật với dependencies cô lập và Service C2 thật cho validation |
| `backend/tests/emr/controller.integration.test.ts` | HTTP + PostgreSQL dùng role `emr_app`, transaction thật và hàm xác minh Worker |
| `backend/tests/emr/http-test-helpers.ts` | Localhost port tạm, đọc JSON, kiểm tra envelope và đồng bộ transaction test |
| `docs/api-contract.md` | Cập nhật trạng thái hai endpoint EMR đã kiểm thử, mô tả HTTP và curl |
| `docs/spp-66-c3-review.md` | Giải thích và hướng dẫn review này |

## Express xử lý request FHIR như thế nào?

Luồng POST là:

```text
HTTP request
  → emrJsonParser: kiểm tra media type/encoding của POST, parse JSON với giới hạn; tạo req.body
  → Controller: kiểm tra query và Content-Type
  → await Service.storeObservation(req.body)
  → C2: kiểm tra Observation, tìm/khóa patient link và quyết định retry/conflict
  → C1: transaction PostgreSQL ghi/đọc kết quả rồi COMMIT
  → Controller: chuyển outcome thành status HTTP và JSON
```

Parser đọc trực tiếp JSON, không đọc FHIR thành plain text. Nó nhận cả
`application/json` và `application/fhir+json`, giới hạn `1mb`, chỉ hỗ trợ
Content-Encoding `identity`. `strict: false` cho phép parser nhận mọi giá trị
JSON hợp lệ; C2 vẫn bắt buộc body phải là object Observation. Vì vậy `null`,
`[]`, chuỗi hoặc số JSON hợp lệ trả `422`, còn JSON sai cú pháp trả `400`.
Charset không được parser hỗ trợ trả `415`. Các endpoint JSON khác vẫn được
parse `application/json`; POST Observation yêu cầu riêng `application/fhir+json`.

`Content-Type` mô tả định dạng body gửi lên. Nếu chỉ khai báo parser JSON mặc
định, Express bỏ qua FHIR JSON và `req.body` không chứa Observation. Với parser
mới, FHIR được parse thành object; Controller còn kiểm tra media type để body
`application/json` hoặc `text/plain` không được nhận nhầm tại route FHIR.

Controller không tự kiểm tra toàn bộ cấu trúc FHIR hoặc truy vấn SQL. Nó
`await` Service, rồi ánh xạ `kind` sang HTTP. Service trả các lỗi có kiểu, với
thông báo cố định không chứa giá trị bệnh nhân. Lỗi ngoài dự kiến đi qua error
middleware của Express 5 và được thay bằng thông báo an toàn.

## Các hàm Controller đáng chú ý

| Hàm / thành phần | Vai trò |
|---|---|
| `EmrRouteDependencies` và `defaultDependencies` | Khai báo ba hàm Service cùng readiness check. Production dùng implementation thật; test có thể giả lập lỗi mà không đổi code nghiệp vụ |
| `emrJsonParser()` | Kiểm tra media type/encoding trước khi parse POST Observation; tạo middleware JSON có FHIR media type và giới hạn `1mb`. Startup và test dùng cùng cấu hình |
| `InvalidHttpInput` | Phân biệt lỗi query HTTP với lỗi nghiệp vụ C2 hoặc dependency |
| `queryParameters(req)` | Đọc toàn bộ query gốc bằng `URLSearchParams`, kiểm tra percent/UTF-8 encoding và từ chối key lặp. Không để giới hạn parser query mặc định che tham số thừa |
| `identifier(value, field)` | Bắt buộc chuỗi không rỗng, không có ký tự điều khiển; giữ nguyên định danh khi tra cứu |
| `pagination(...)` | Chỉ nhận chuỗi chữ số, chuyển thành safe integer, kiểm tra khoảng và dùng mặc định nếu thiếu |
| `labResultQuery(req)` | Chọn đúng một trong hai mode source/patient. Kiểm tra UUID, key hỗ trợ và từ chối bộ lọc thiếu hoặc trộn |
| `sendError(...)` | Ghi `{ "error": { "code": "...", "message": "..." } }`, không đưa `field`, stack hay lỗi driver vào phản hồi |
| `registerEmrRoutes(...)` | Giữ health/ready, đăng ký hai API nghiệp vụ, JSON 404 cho API lạ và error middleware |

Trong `registerEmrRoutes`, POST không nhận query. Nó yêu cầu FHIR media type,
chờ `storeObservation`, rồi chỉ trả năm trường receipt công khai. GET gọi
`getLabResultsBySource` khi có đủ cặp ID, hoặc `listLabResults` với UUID và
pagination đã kiểm tra. Dữ liệu item đi từ Repository qua Service tới HTTP,
không được dựng lại từ Observation hoặc ép kiểu số/thời gian.

Error middleware kiểm tra `headersSent`, chuyển lỗi input sang `400`, body
quá lớn sang `413`, charset/encoding không hỗ trợ sang `415`; các lỗi dependency
ngoài dự kiến trả `503`. Nó không gửi nguyên `error.message` của driver.
`/health` vẫn trả `{ "service": "emr", "status": "ok" }`; `/ready` tiếp tục
chạy database check cũ, trả `200` khi ready và `503` khi không ready.

## HTTP 201 khác HTTP 200 thế nào?

| Outcome Service | HTTP | Ý nghĩa |
|---|---|---|
| `stored` | `201`, `result: STORED` | Tạo kết quả mới và transaction đã commit |
| `already_exists` | `200`, `result: ALREADY_EXISTS` | Retry cùng nội dung; trả UUID kết quả và bệnh nhân cũ |
| `conflict` | `409`, `DUPLICATE_CONFLICT` | Cặp nguồn đã có nội dung/liên kết khác; không ghi đè |
| `patient_not_linked` | `422`, `PATIENT_NOT_LINKED` | Không tìm được liên kết bệnh nhân hợp lệ |
| `invalid` / `unsupported` | `422`, `VALIDATION_ERROR` | Observation không hợp lệ/không thuộc tập FHIR dự án hỗ trợ |
| `unavailable` | `503`, `DEPENDENCY_UNAVAILABLE` | Không xác nhận được lưu/đọc database |

Lỗi bộ lọc GET là lỗi request HTTP (`400`), dù Service cũng có kiểm tra phòng
vệ. Kết quả tìm kiếm rỗng là `200` với `items: []`, không phải lỗi dependency.
Test transaction giữ INSERT chưa commit, xác nhận kết nối khác chưa thấy row
và client chưa nhận phản hồi, rồi mới cho commit. Một test khác gây lỗi sau
INSERT để xác nhận rollback trả `503` và không có row.

## Middleware đọc lại và vì sao phải giữ chính xác dữ liệu?

Worker gửi POST với `application/fhir+json`. Nó kiểm tra receipt bằng
`storageReceipt`, sau đó GET bằng **cả** `external_system` và `external_id`.
Mode này không nhận pagination hoặc `patient_key`, trả mọi row khớp cặp nguồn.
Worker chỉ chấp nhận đúng một item và gọi `verifyReadBack` để so sánh UUID,
MR01–MR09 và toàn bộ `fhir_json`. C3 không thay đổi Worker.

PostgreSQL NUMERIC giữ số thập phân chính xác. Nếu Controller chuyển
`"3.400000000000000000001"` thành JS number thì nó có thể thành `3.4`, khiến
một giá trị sai vượt qua đối chiếu. Vì vậy `quantity`, `low`, `high` giữ dạng
chuỗi; thiếu cận trả `null`. Test đã cập nhật NUMERIC trong database bằng số
nhiều chữ số rồi GET để chứng minh API lấy cột đã lưu, không dựng từ FHIR.

`Date` của JavaScript chỉ giữ millisecond. Timestamp
`2026-10-29T08:00:00.123456Z` mà đi qua `Date` có thể mất `456` microsecond.
Repository đã trả chuỗi UTC đủ sáu chữ số; Controller giữ nguyên chuỗi đó.
Worker so instant đầy đủ, chấp nhận đổi múi giờ tương đương nhưng từ chối mất
microsecond. `fhir_json` giữ nguyên giá trị JSON Observation, kể cả chuỗi thời
gian gốc, subject identifier và nhóm laboratory; JSONB có thể đổi thứ tự key.

## Thử API bằng curl

Dùng database phát triển đã chạy DDL và `access_roles.sql`, server EMR cổng
3103. Các ví dụ dưới đây chạy tại thư mục gốc repo. Chỉ dùng fixture giả.
Nếu chưa có patient link tương ứng, POST trả `422`; API không tự tạo bệnh nhân.
Có thể tạo fixture ở **database thử nghiệm** bằng tài khoản `emr_app`:

```bash
psql "$EMR_DATABASE_URL" <<'SQL'
BEGIN;
INSERT INTO emr.patients (patient_key, display_label)
VALUES ('00000000-0000-4000-8000-000000000067', 'C3 synthetic only')
ON CONFLICT DO NOTHING;
INSERT INTO emr.patient_links (identifier_system, identifier_value, patient_key)
VALUES ('https://example.org/lis/patient', 'B4A-SYNTHETIC-P1',
        '00000000-0000-4000-8000-000000000067')
ON CONFLICT DO NOTHING;
COMMIT;
SQL
```

Nếu link đã tồn tại, dùng `patient_key` thực tế từ receipt POST cho GET bệnh
nhân. Khởi động server bằng `cd backend && npm run dev:emr`, rồi tại terminal
khác, từ thư mục gốc:

```bash
curl -i http://127.0.0.1:3103/api/observations \
  -H 'Content-Type: application/fhir+json' \
  --data-binary @backend/tests/middleware/fixtures/observation-r4-golden.json

curl -G http://127.0.0.1:3103/api/lab-results \
  --data-urlencode 'external_system=https://example.org/lis/result' \
  --data-urlencode 'external_id=B4A-SYNTHETIC-R1'

curl -G http://127.0.0.1:3103/api/lab-results \
  --data-urlencode 'patient_key=00000000-0000-4000-8000-000000000067' \
  --data-urlencode 'limit=20' --data-urlencode 'offset=0'
```

POST đầu trả `201`; gửi lại đúng fixture trả `200` với cùng UUID. Ví dụ receipt
(UUID target minh họa; thực tế do Service tạo):

```json
{
  "result": "STORED",
  "external_system": "https://example.org/lis/result",
  "external_id": "B4A-SYNTHETIC-R1",
  "target_id": "00000000-0000-4000-8000-000000000066",
  "patient_key": "00000000-0000-4000-8000-000000000067"
}
```

Exact GET trả item như dưới đây; thời điểm nhận/lưu là timestamp database thực tế:

```json
{
  "items": [{
    "target_id": "00000000-0000-4000-8000-000000000066",
    "patient_key": "00000000-0000-4000-8000-000000000067",
    "external_system": "https://example.org/lis/result",
    "external_id": "B4A-SYNTHETIC-R1",
    "analyte_system": "https://example.org/lis/test-code",
    "analyte_code": "50971",
    "analyte_display": "Potassium",
    "analyte_context": "Potassium / Blood / Chemistry",
    "quantity": "3.4",
    "unit_text": "mEq/L",
    "low": "3.3",
    "high": "5.1",
    "effective_at": "2180-06-03T12:00:00.123456Z",
    "clinical_status": "final",
    "fhir_json": {
      "resourceType": "Observation",
      "identifier": [{"system":"https://example.org/lis/result","value":"B4A-SYNTHETIC-R1"}],
      "status": "final",
      "category": [{"coding":[{"system":"http://terminology.hl7.org/CodeSystem/observation-category","code":"laboratory"}]}],
      "code": {"coding":[{"system":"https://example.org/lis/test-code","code":"50971","display":"Potassium"}],"text":"Potassium / Blood / Chemistry"},
      "subject": {"type":"Patient","identifier":{"system":"https://example.org/lis/patient","value":"B4A-SYNTHETIC-P1"}},
      "effectiveDateTime": "2180-06-03T12:00:00.123456Z",
      "valueQuantity": {"value":3.4,"unit":"mEq/L"},
      "referenceRange": [{"low":{"value":3.3,"unit":"mEq/L"},"high":{"value":5.1,"unit":"mEq/L"}}]
    },
    "received_at": "2026-10-29T08:00:00.123456Z",
    "stored_at": "2026-10-29T08:00:00.123457Z"
  }]
}
```

GET bệnh nhân trả cùng dạng `items` cộng `limit`, `offset`. Query không khớp
trả `items: []`. Ví dụ lỗi khi thiếu patient link:

```json
{"error":{"code":"PATIENT_NOT_LINKED","message":"No valid EMR patient link was found"}}
```

## Kết quả kiểm tra thực tế ngày 29/10/2026

Từ `backend/`:

| Lệnh | Kết quả |
|---|---|
| `npm run check` | PASS: TypeScript source và tests |
| `npm run build` | PASS |
| `node --import tsx tests/emr/controller.http.test.ts` | 14 pass, 0 fail, 0 skip |
| `npm run test:repositories:postgres` | PASS: LIS 79, Middleware 191, EMR 100; tổng 370, 0 fail, 0 skip |

Runner PostgreSQL có sẵn tạo container `postgres:17` mới, dùng tmpfs, không
mount volume dự án, chạy DDL/roles và tự xóa container sau test. EMR Controller
có 14 test HTTP và 9 test HTTP + PostgreSQL (kể cả test cha); các test EMR còn
lại kiểm tra C1/C2. Regression Middleware gồm Mapper và Worker hiện có, Worker
vẫn dùng EMR mock. Test C3 dùng hàm `verifyReadBack` thật trên phản hồi HTTP EMR
thật nhưng không chạy toàn bộ Worker hoặc LIS Dispatcher.

Sandbox không cho bind socket localhost hoặc truy cập Docker, nên các lần
chạy HTTP/PostgreSQL cần quyền thực thi ngoài sandbox. Lần chạy `--test` trong
sandbox chỉ báo pass cấp file, không hiện từng assertion; không dùng kết quả
đó để kết luận. Chạy trực tiếp file HTTP và chạy runner đầy đủ ngoài sandbox
đã thực thi và báo kết quả từng test như bảng. Node 26 có cảnh báo deprecation
`module.register()` từ loader `tsx`; không có lỗi test.

Test dependency unavailable đóng pool EMR thật, kiểm tra POST/cả hai GET/ready
trả `503` và health vẫn `200`; không dừng PostgreSQL đang dùng của người dùng.
Chưa kiểm thử tình huống mất mạng tới máy PostgreSQL từ xa hoặc nghiệm thu
end-to-end. Dừng ở C3 để review.
