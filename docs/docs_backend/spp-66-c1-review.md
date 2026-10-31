# SPP-66 C1 — EMR Repository

Đã triển khai riêng tầng Repository. Chưa có Service C2, Controller/API C3 hoặc
các bước C4. Không đổi schema SQL, Drizzle schema, LIS hoặc Middleware; không
commit/push. Preflight: nhánh `main`, working tree sạch trước khi sửa.

Ghi chú sau C2: Repository hiện có thêm `withPatientLinkTransaction` để giữ
liên kết bệnh nhân ổn định trong lúc lưu. API C1 cũ vẫn giữ nguyên; chi tiết
bổ sung và Service nằm trong [hướng dẫn C2](spp-66-c2-review.md).

## File thay đổi

| File | Trách nhiệm |
|---|---|
| `backend/src/emr/repository.ts` | Tra liên kết bệnh nhân, lưu an toàn, đọc lại và phân trang |
| `backend/tests/emr/fixtures.ts` | Tạo dữ liệu hoàn toàn giả, UUID riêng cho mỗi ca |
| `backend/tests/emr/repository.integration.test.ts` | Kiểm thử PostgreSQL thật với role `emr_app` |
| `backend/tests/emr/repository.unit.test.ts` | Lỗi kết nối/transaction và tình huống schema bất thường qua giả lập driver |
| `backend/package.json` | Thêm `test:emr`, `test:emr:postgres`; giữ các script cũ |
| `scripts/test-repositories-postgres.mjs` | Bổ sung EMR vào runner cô lập; hỗ trợ `--emr-only` |
| `docs/spp-66-c1-review.md` | Hướng dẫn đọc code và giới hạn nghiệm thu C1 |

## Đọc code theo từng hàm

Repository có thể hình dung là người giữ sổ: tìm và ghi đúng bản ghi, trả đúng
giá trị đã lưu. Quyết định dữ liệu có hợp lệ về nghiệp vụ hay không thuộc Service.

1. `getPatientKeyByIdentifier(identifierSystem, identifierValue)` trả
   `Promise<string | undefined>`. Câu SQL dùng **cả hai** thành phần của khóa
   `patient_links`. Không thấy liên kết thì trả `undefined`, không tạo bệnh nhân,
   không tìm gần đúng hoặc dựa vào tên hiển thị.
2. `createLabResult(input)` nhận dữ liệu cột đã chuẩn bị trong `NewLabResult`.
   Caller cung cấp UUID `targetId`, `patientKey`, số dạng chuỗi, thời gian có múi
   giờ và object Observation nguyên gốc. Hàm trả `{ kind: "created", record }`
   hoặc `{ kind: "existing", record }` sau khi transaction commit. `existing`
   chỉ nói khóa nguồn đã có, **chưa có nghĩa nội dung giống nhau**.
3. `getLabResultsBySource(externalSystem, externalId)` trả mảng mọi bản ghi đúng
   cặp nguồn. Không có `LIMIT`, `DISTINCT` hoặc lọc trùng ở JavaScript. Theo DDL
   hiện tại mảng có 0 hoặc 1 phần tử; nếu uniqueness bị thay đổi ngoài hệ thống,
   truy vấn vẫn không che nhiều bản ghi.
4. `listLabResults({ patientKey, limit?, offset? })` trả mảng bản ghi của một
   bệnh nhân. Mặc định 20/0, sắp `effective_at DESC, target_id ASC`. UUID là khóa
   duy nhất để phân xử các thời điểm bằng nhau. C2/C3 sẽ kiểm tra giới hạn đầu
   vào theo contract; Repository không xử lý query HTTP.

Các kiểu xuất khẩu `NewLabResult`, `LabResult`, `PersistLabResultOutcome`,
`ListLabResultsOptions`, `JsonObject` và `JsonValue` giúp caller dùng đúng kiểu.
`LabResult` chứa toàn bộ cột với tên snake_case theo contract đọc lại. `low/high`,
`analyte_display/analyte_context` thiếu được trả `null`; số giữ chuỗi và cả ba
timestamp trả UTC với sáu chữ số phần lẻ giây.

## Liên kết bệnh nhân và các loại ID

Ví dụ giả: `("https://example.org/lis/patient", "C1-SYNTHETIC-P")` trỏ tới UUID
của một bệnh nhân EMR. Cùng giá trị `C1-SYNTHETIC-P` nhưng namespace `urn:other`
có thể trỏ tới người khác. Khóa chính ghép của `patient_links` ngăn cùng **cặp**
định danh trỏ tới hai `patient_key`; khóa ngoại bảo đảm bệnh nhân EMR có tồn tại.

`patient_id` là mã do LIS quản lý; `patient_key` là UUID do EMR quản lý. Đây là
hai không gian định danh khác nhau. Không được lấy mã LIS ghi thẳng vào cột
patient UUID, và không dùng tên người bệnh để đoán liên kết.

## Lưu trùng và lưu đồng thời

`UNIQUE(external_system, external_id)` xác định duy nhất một kết quả nguồn. Chỉ
dùng `external_id` sẽ lẫn các hệ thống; dùng bệnh nhân + mã xét nghiệm sẽ chặn
nhầm những lần xét nghiệm khác nhau của cùng người bệnh.

Repository bắt đầu transaction `READ COMMITTED`, sau đó thực hiện ngay
`INSERT ... ON CONFLICT (external_system, external_id) DO NOTHING RETURNING ...`.
Không kiểm tra tồn tại trước INSERT và không có UPDATE.

Nếu A và B cùng gửi một cặp nguồn, PostgreSQL dùng unique index để phân xử. B
có thể phải chờ A. Nếu A commit, B không chèn và chạy một SELECT **mới** để thấy
bản ghi A vừa commit. Nếu A rollback, B có thể chèn thành công. SELECT mới cần
thiết vì snapshot của câu INSERT trước đó có thể chưa nhìn thấy A.

Người thua nhận nguyên bản ghi đã lưu: `target_id`, `patient_key`, `stored_at`,
`fhir_json` và mọi trường còn lại giữ nguyên. C1 không so sánh tương đương lâm
sàng. Nếu sau conflict không đọc được đúng một winner, hàm báo lỗi và rollback.
Lỗi UUID trùng ở khóa khác, FK, CHECK, driver hoặc commit không biến thành
`existing`. Khi mất xác nhận commit, caller vẫn phải coi kết quả là chưa chắc
chắn và retry bằng cùng cặp nguồn; Repository không giả định đã rollback ở server.

## Độ chính xác của số, thời gian và JSON

`NUMERIC` chứa được số thập phân vượt khả năng của JavaScript `Number`. Ví dụ
`9007199254740993.123456789012345678901` sẽ mất chữ số nếu ép sang Number.
Repository nhận/trả chuỗi, dùng NUMERIC không khai báo scale của DDL, không
`parseFloat`, `Number`, `toFixed`, đổi đơn vị hoặc tự làm tròn. PostgreSQL có thể
đổi cách viết số mũ thành thập phân nhưng giữ nguyên giá trị toán học.

Drizzle hiện dùng timestamp `mode: "date"`. JavaScript `Date` chỉ giữ đến
millisecond: `.123456` sẽ mất phần `456` microsecond. C1 giữ schema hiện tại và
dùng biểu thức SQL tham số hóa `${value}::timestamptz` khi ghi; khi đọc/RETURNING
dùng `to_char(column AT TIME ZONE 'UTC', ...)`. Giá trị tới driver là TEXT nên
không đi qua parser Date. Điều này áp dụng cho `effective_at`, `received_at`
và `stored_at`; hai mốc cuối mặc định dùng `clock_timestamp()` trong database.

Hàm private `timestampParameter` chặn phần lẻ giây có chữ số khác 0 sau vị trí
thứ sáu, tránh PostgreSQL tự làm tròn. Các số 0 dư vẫn biểu diễn được chính xác.
`utcTimestamp` từ chối infinity, BC và năm UTC ngoài 0001–9999 khi serialize,
thay vì tạo chuỗi ISO sai hoặc mất dữ liệu. Nếu decoder RETURNING báo lỗi sau
INSERT, transaction rollback; ca này đã được kiểm thử trên PostgreSQL thật.
Đây là bảo vệ biểu diễn dữ liệu lưu trữ, chưa phải bộ kiểm tra FHIR.

`fhir_json` lưu nguyên object Observation theo giá trị JSON; không thêm `id`,
`meta` hoặc chỉnh tài nguyên. JSONB có thể đổi thứ tự key object, không đổi ý
nghĩa JSON. Các JSON number trong tài nguyên giữ kiểu number; yêu cầu dùng chuỗi
áp dụng cho các cột NUMERIC đọc lại, không biến đổi nội dung FHIR.

## C1 hỗ trợ C2 như thế nào

C2 sẽ kiểm tra Observation, lấy `subject.identifier` để gọi lookup, chuẩn bị
các cột rồi gọi `createLabResult`. Khi nhận `existing`, C2 dùng bản ghi gốc để
quyết định retry giống nhau hay xung đột. Các quyết định `PATIENT_NOT_LINKED`,
`ALREADY_EXISTS` hoặc `DUPLICATE_CONFLICT` và việc ánh xạ HTTP còn ở bước sau.
C1 không nhận Express request, không tự tạo người bệnh và không nhập module
LIS/Middleware trong mã production. Test được phép dùng verifier Middleware
để chứng minh bản ghi thật đáp ứng contract hiện có.

## Kiểm thử thực tế

Ngày 29/10/2026, chạy trong `backend/`:

| Lệnh | Kết quả |
|---|---|
| `npm run check` | PASS: TypeScript source và tests |
| `npm run build` | PASS |
| `npm run test:repositories:postgres` | PASS: LIS 79, Middleware 191, EMR 22 trước khi bổ sung guard timestamp cuối |
| `npm run test:emr:postgres` | PASS: EMR 23 sau khi bổ sung guard timestamp cuối, không skip/fail |
| `git diff --check` | PASS |

Runner tạo container `postgres:17` mới, không mount volume dự án, dùng tmpfs,
cổng localhost ngẫu nhiên, chạy nguyên DDL và access_roles trong container đó.
Container bị dừng/xóa sau chạy. Test kiểm tra `current_user = emr_app`, opt-in
database dùng một lần và bảng EMR trống; không TRUNCATE. Chỉ dữ liệu giả được tạo.

Các ca kiểm tra bao gồm lookup chính xác/không thấy/namespace khác nhau, INSERT,
retry không ghi đè, chín INSERT đồng thời, chờ UNIQUE lock khi đối thủ commit
hoặc rollback, đọc lại đúng nguồn, phân trang/tie-breaker, NUMERIC rất lớn/rất
nhỏ/số mũ, cả ba timestamp ở microsecond, cận tham chiếu tùy chọn, lỗi CHECK/FK/
UUID và rollback sau INSERT, lỗi đọc/commit giả lập, và EMR bị từ chối đọc/ghi
schema LIS/integration. Tình huống schema mất uniqueness được giả lập ở driver,
không tháo constraint của DDL thật. Node có cảnh báo DEP0205 từ tsx hiện có;
các suite vẫn PASS.

## Điểm cần nhớ và giới hạn

- Không thấy mâu thuẫn chặn C1. DDL là nguồn chuẩn, kể cả các CHECK chưa được
  mô tả lại trong Drizzle schema. Header SQL ghi PostgreSQL 18 tương thích bản
  gần đây; tài liệu/runner dùng 17, và toàn bộ DDL đã chạy thành công trên 17.
- Mapper cho phép chuỗi có hơn sáu chữ số phần lẻ giây. Nếu chữ số dư khác 0,
  PostgreSQL không giữ được chính xác; C1 từ chối. C2 cần xử lý trường hợp không
  biểu diễn được này thành lỗi phù hợp, không sửa Mapper/schema trong C1.
- C2 phải kiểm tra FHIR, lịch, timezone, số hữu hạn, liên kết bệnh nhân và nội
  dung retry. Việc chuẩn bị cột khớp FHIR thuộc caller, không thuộc C1.
- Phải cấu hình `EMR_DATABASE_URL` bằng `emr_app`; `emrDatabase.check()` hiện có
  kiểm tra role/quyền. Chưa kiểm toán database/role của môi trường đang triển
  khai; script access_roles chỉ cấp thêm quyền, không thu hồi quyền cũ.
- OFFSET có thứ tự xác định trên dữ liệu không đổi; nhiều request không chia
  sẻ snapshot nên ghi mới/xóa giữa các trang có thể làm dịch vị trí.
- Chưa có API EMR thật nên chưa nghiệm thu HTTP/end-to-end. Test verifier chỉ
  chứng minh hình dạng/giá trị bản ghi Repository tương thích read-back.
- Không đọc, sửa hoặc truncate dữ liệu của database dự án; không kiểm thử dữ
  liệu bệnh nhân thật. Lỗi driver truyền lên caller; C2/C3 phải ánh xạ lỗi an
  toàn, không log/trả SQL hoặc payload lâm sàng.
