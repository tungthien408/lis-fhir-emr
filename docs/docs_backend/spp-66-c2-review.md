# SPP-66 C2 — EMR Service

C2 đã có phần kiểm tra Observation, xác định bệnh nhân, lưu kết quả và xử lý gửi
lặp. Chưa thêm HTTP route; chưa làm C3/C4; chưa commit/push. Các thay đổi C1 chưa
commit trong working tree được giữ lại. Không sửa schema, LIS hoặc Middleware.

## Service làm gì?

Cứ hình dung Observation là một phiếu kết quả gửi từ LIS. **Service đọc phiếu,
kiểm tra có đủ và đúng thông tin không, tìm đúng hồ sơ bệnh nhân rồi nhờ
Repository lưu.** Repository giữ phần đọc/ghi database; Service giữ quyết định
nghiệp vụ. Vì vậy Service không chứa SQL hoặc Express Request/Response.

| Hàm | Cách dùng và trách nhiệm |
|---|---|
| `validateObservation(input)` | Nhận dữ liệu chưa biết kiểu (`unknown`), kiểm tra phần FHIR dự án hỗ trợ, trả bản sao đã kiểm tra hoặc lỗi có kiểu. Không gọi database. |
| `storeObservation(input)` | Kiểm tra phiếu, tra và giữ khóa liên kết bệnh nhân, chuẩn bị cột, lưu qua Repository, phân biệt lưu mới/gửi lại/xung đột. |
| `getLabResultsBySource(externalSystem, externalId)` | Kiểm tra hai chuỗi nguồn và đọc mọi kết quả đúng cặp; không phân trang. |
| `listLabResults({ patientKey, limit?, offset? })` | Kiểm tra UUID và phân trang; trả kết quả của bệnh nhân với `items`, `limit`, `offset`. Mặc định 20/0, limit 1–100. |
| `canonicalJson(value)` | Viết JSON với key object được sắp xếp, giữ thứ tự mảng và giá trị. Dùng so toàn bộ nội dung, không tính hash. |

Các hàm private `record`, `single`, `text`, `exact`, `quantity`, `timestamp` lần
lượt kiểm tra object, mảng một phần tử, chuỗi, giá trị quy định, số/đơn vị và
thời gian. Lỗi chỉ chứa tên trường cố định và thông báo chung, không chứa dữ
liệu bệnh nhân hoặc chẩn đoán driver.

## Phiếu nào được chấp nhận?

Phạm vi là **đúng cấu trúc B4A Mapper của dự án**, không phải mọi Observation
hợp lệ trong FHIR. FHIR đầy đủ có nhiều trường và kiểu giá trị khác;
[mô tả Observation R4](https://hl7.org/fhir/R4/observation-definitions.html)
là tài liệu tham chiếu, còn MR01–MR09 trong `docs/api-contract.md` quyết định
phần được hỗ trợ ở đây.

- `resourceType = "Observation"`, `status = "final"`.
- Một `identifier`, namespace `https://example.org/lis/result`, có mã không rỗng.
- Một `category`, một `coding` với system
  `http://terminology.hl7.org/CodeSystem/observation-category`, code `laboratory`.
- `code.coding` có một item: system `https://example.org/lis/test-code`, mã và
  tên xét nghiệm không rỗng. `code.text` cũng bắt buộc. Không tự gắn mã LOINC.
- `subject.type = "Patient"`, `subject.identifier.system` là
  `https://example.org/lis/patient`, có mã bệnh nhân không rỗng.
- `effectiveDateTime` phải là ngày giờ thực, đủ giây và múi giờ. Chấp nhận đến
  microsecond, offset từ −14:00 đến +14:00, năm UTC từ 0001 đến 9999. Không nhận
  ngày thiếu giờ, giây nhuận hoặc thời gian bị làm tròn khi lưu.
- `valueQuantity` có JSON number hữu hạn và chuỗi đơn vị không rỗng. Không nhận
  chuỗi `"3.4"` thay cho số `3.4`, không đổi đơn vị sang UCUM.
- `referenceRange` có thể bỏ hẳn. Nếu có thì đúng một item, có low, high hoặc
  cả hai; mỗi cận phải có số và đơn vị giống hệt đơn vị kết quả. Low không lớn
  hơn high. `[]`, `[{}]`, `null`, hoặc cận `null` không được chấp nhận.

Các trường bổ sung như `component`, `modifierExtension`, `extension`, `id`,
`meta`, `subject.reference`, `valueString`, `comparator`, system/code của
Quantity hoặc nhiều coding/identifier bị trả `unsupported`. Service không
lặng lẽ bỏ trường. Không suy ra tên xét nghiệm, đơn vị hoặc bệnh nhân bị thiếu.
Chuỗi giữ nguyên khoảng trắng/chữ hoa thường khi được chấp nhận; không tự trim
hoặc sửa mã để khớp dữ liệu.

## Tra đúng bệnh nhân và bổ sung nhỏ ở C1

`subject.identifier.system` nói mã thuộc nơi nào; `subject.identifier.value`
là mã bệnh nhân ở nơi đó. Ví dụ hai nơi đều có mã `BN001`, nhưng có thể là hai
người khác nhau. Vì thế luôn tra **cả hai** trong `emr.patient_links` để lấy
UUID `patient_key` của hồ sơ EMR.

Preflight phát hiện C1 có lookup và INSERT riêng: nếu C2 gọi lần lượt hai hàm
đó, liên kết có thể bị đổi giữa hai lần gọi. C2 bổ sung boundary
`withPatientLinkTransaction(system, value, operation)` trong Repository:

1. Mở một transaction và đọc đúng liên kết bằng `SELECT ... FOR SHARE`.
2. Giữ liên kết đó tới khi lưu xong và commit. Nhiều request cùng đọc được,
   nhưng thao tác đổi/xóa liên kết phải chờ.
3. Callback nhận `patientKey` và hàm `createLabResult` dùng cùng transaction.
   Hàm lưu tự lấy patient key đã khóa; caller không truyền người thay thế.
4. Không thấy liên kết thì không gọi callback và không tạo người bệnh.

Logic INSERT của C1 được tách thành helper nội bộ dùng chung; API cũ và cơ chế
UNIQUE/ON CONFLICT vẫn giữ nguyên. Tests PostgreSQL đã quan sát lock wait thật,
kiểm tra cả trường hợp writer phải chờ Service và Service phải chờ writer.
Nếu writer đổi liên kết trước khi Service lấy khóa, Service đọc patient key
mới đã commit. Sau khi Service commit, quản trị viên vẫn có thể đổi liên kết;
bản ghi cũ không tự bị chuyển sang hồ sơ khác.

## Gửi lặp: lúc nào giống nhau, lúc nào xung đột?

Idempotency ở đây nghĩa là **gửi lại cùng phiếu nhiều lần vẫn chỉ có một kết
quả EMR**. Khóa tìm phiếu cũ là `(external_system, external_id)`.

- Lần đầu: INSERT thành công → `STORED`, trả ID đã lưu từ database.
- Gửi lại: Repository trả bản ghi đã có. Service so **toàn bộ `fhir_json`** và
  `patient_key` đang liên kết. Cùng nội dung và cùng người → `ALREADY_EXISTS`,
  giữ `target_id`, `patient_key`, timestamps và mọi dữ liệu gốc.
- Cùng khóa nguồn nhưng đổi nội dung hoặc liên kết trỏ sang người khác →
  `DUPLICATE_CONFLICT`. Không UPDATE hoặc chuyển kết quả sang người khác.
- Nếu liên kết hiện không còn, trả `PATIENT_NOT_LINKED`, không suy ra bệnh nhân
  từ một kết quả đã lưu trước đó.

Key object đổi thứ tự không tạo xung đột; thứ tự mảng có ý nghĩa. Các số tuân
theo giá trị JSON hiện có trong JavaScript: `3.4` và `3.40` giống nhau, `-0`
và `0` giống nhau. Không chỉ so mã nguồn, hash hoặc vài giá trị xét nghiệm.
Validation luôn chạy trước: phiếu gửi lại có cấu trúc không được hỗ trợ vẫn
trả lỗi validation, không được chấp nhận chỉ vì đã có mã nguồn.

**Điểm contract còn chưa chốt tường minh:** read-back của Worker cho phép hai
chuỗi timestamp cùng instant, còn POST của EMR mock so nguyên chuỗi trong JSON.
C2 chọn hành vi POST của mock: `12:00Z` và `19:00+07:00`, hoặc `.123456` và
`.1234560`, là nội dung retry khác nhau. Giá trị lưu lần đầu giữ nguyên trong
FHIR; cột timestamp đọc lại vẫn là cùng instant. Đây là lựa chọn được ghi rõ
để review, không phải tuyên bố FHIR nói hai instant đó khác nhau.

Khi nhiều request đến cùng lúc, UNIQUE của PostgreSQL quyết định người chèn
thành công. Các request còn lại nhận bản ghi thắng từ C1 và thực hiện cùng
phép so sánh trên. Không có SELECT-then-INSERT thiếu bảo vệ. Service chỉ trả
thành công sau khi transaction hoàn tất; lỗi database/commit trả `unavailable`.

## Số và thời gian có bị mất độ chính xác không?

Service nhận JSON number đã được biểu diễn trong JavaScript, kiểm tra hữu hạn,
rồi dùng `String(value)` chuyển sang chuỗi thập phân để ghi NUMERIC. Không
`toFixed`, làm tròn tùy ý hoặc ép chuỗi thành số. Số rất lớn/nhỏ hữu hạn như
`Number.MAX_VALUE`, `Number.MIN_VALUE` đã được lưu và đọc lại bằng tests thật.
Cột NUMERIC khi đọc vẫn là chuỗi, FHIR gốc vẫn chứa JSON number.

**Giới hạn:** nếu JSON đã bị parser làm mất chữ số trước khi gọi Service thì
`unknown` không còn giữ token số gốc để phục hồi/phát hiện mọi mất mát đó. C2
bảo toàn giá trị number nhận được, không cam kết mọi số thập phân tùy ý trên
đường truyền. Đây cũng là giới hạn cần lưu ý của JSON number trong
[FHIR R4 datatypes](https://hl7.org/fhir/R4/datatypes.html#decimal). Nếu muốn hỗ
trợ decimal vượt phạm vi này, phải thiết kế thêm boundary parse/contract, không
tự đổi FHIR number thành chuỗi trong C2.

Chuỗi thời gian gốc truyền thẳng qua C1; không chuyển phần lẻ giây thành Date.
Date chỉ kiểm tra năm UTC bằng phần giây nguyên. `.1234567` bị từ chối vì
PostgreSQL không giữ chính xác; `.123456000` được nhận vì số 0 dư không đổi
instant. Observation gốc vẫn giữ đúng chuỗi đầu vào.

## Ví dụ đi từ phiếu đến bản ghi

Giả sử đã có liên kết từ `(https://example.org/lis/patient, C2-DEMO-P1)` tới
UUID bệnh nhân EMR. Một phiếu hợp lệ mang mã nguồn `C2-DEMO-R1`, số `3.4`, đơn
vị `mEq/L`, status `final`, và đầy đủ các trường B4A còn lại:

1. `storeObservation` gọi validation, tạo bản sao độc lập để caller sửa dữ
   liệu trong lúc chờ cũng không làm đổi phiếu đang lưu.
2. Repository tìm đúng cặp định danh bệnh nhân và giữ khóa liên kết.
3. Service tạo UUID kết quả mới, chuẩn bị `quantity = "3.4"`, đơn vị và các
   cột khác; `fhirJson` là object phiếu ban đầu.
4. Repository chèn một dòng rồi commit. Service trả `STORED` cùng mã nguồn,
   UUID kết quả và UUID bệnh nhân lấy từ dòng đã lưu.
5. Gửi lại nguyên phiếu → `ALREADY_EXISTS` với UUID cũ. Đổi `3.4` thành `3.5`
   nhưng giữ mã nguồn → `DUPLICATE_CONFLICT`.

## C3 sẽ gọi Service như thế nào?

C3 sẽ đọc body/query HTTP rồi gọi các hàm trên, ánh xạ `kind` thành HTTP. C2
chưa mở endpoint. Dự kiến theo contract hiện tại:

| Outcome C2 | Ý nghĩa cho C3 |
|---|---|
| `stored`, result `STORED` | POST 201, trả receipt bốn định danh và result |
| `already_exists`, result `ALREADY_EXISTS` | POST 200, trả receipt gốc |
| `patient_not_linked` / `PATIENT_NOT_LINKED` | POST 422 |
| `conflict` / `DUPLICATE_CONFLICT` | POST 409 |
| `invalid` hoặc `unsupported` / `VALIDATION_ERROR` | POST 422; bộ lọc GET sai là 400 |
| `unavailable` / `DEPENDENCY_UNAVAILABLE` | 503, thông báo an toàn |
| `found` | GET 200 với `items`; không thấy là mảng rỗng |

Service nhận limit/offset dạng number; C3 sẽ kiểm tra cú pháp query string
trước khi chuyển thành number. Service tiếp tục kiểm tra số nguyên an toàn,
limit 1–100, offset không âm. Chế độ đọc theo nguồn không nhận pagination.

## File thay đổi và kết quả kiểm thử

| File | Thay đổi C2 |
|---|---|
| `backend/src/emr/service.ts` | Validation, lưu và so retry, đọc/list có kiểu |
| `backend/src/emr/canonical-json.ts` | So JSON theo cùng quy ước dự án, không import chéo dịch vụ |
| `backend/src/emr/repository.ts` | Thêm transaction khóa patient link; dùng chung helper INSERT C1 |
| `backend/tests/emr/service-fixtures.ts` | Dùng golden Observation giả của B4A và helper test |
| `backend/tests/emr/service.unit.test.ts` | 39 tests validation/mapping/errors/read filters |
| `backend/tests/emr/service.integration.test.ts` | 14 ca PostgreSQL và một test cha: lưu, retry, concurrency, link locks, rollback, đọc/list |
| `backend/tests/emr/repository.unit.test.ts` | Kiểm tra boundary C2 mới khi database chưa cấu hình |
| `docs/architecture.md`, `docs/spp-66-c1-review.md`, tài liệu này | Cập nhật phạm vi và walkthrough |

Ngày 29/10/2026, `npm run check` và `npm run build`: **PASS**.
`npm run test:repositories:postgres`: **LIS 79, Middleware 191, EMR 77 PASS**,
không fail/skip. EMR gồm 23 tests C1 và 54 tests C2 (kể cả test cha).
`git diff --check`: **PASS**. Node phát cảnh báo DEP0205 từ tsx hiện có; không
làm suite thất bại.

Runner C1 được tái sử dụng, không đổi npm script ở C2. Nó tạo PostgreSQL 17
mới với tmpfs và role `emr_app`, nạp DDL gốc, chỉ dùng dữ liệu giả, dọn container
sau chạy; không truncate bảng hoặc đụng volume database dự án. Tests gồm cả
Worker verifier đối chiếu bản ghi từ Service thật; đây chưa phải kiểm thử
HTTP end-to-end với EMR.

Các giới hạn còn lại: phạm vi FHIR hẹp và timestamp-retry policy cần được
review trước C3; chưa kiểm toán dữ liệu/quyền của database đang triển khai;
OFFSET không tạo snapshot chung giữa các request; không phát triển quy trình
sửa/đổi chủ hồ sơ kết quả đã lưu. C2 đã hoàn tất và dừng để review.
