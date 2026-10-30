# SPP-66 B1 — Middleware Repository

B1 chỉ triển khai đọc/ghi PostgreSQL qua `middlewareDatabase.db` và Drizzle,
trong ba bảng `integration.exchange_transactions`, `exchange_events` và
`exchange_attempts`. Chưa triển khai Service, Controller nghiệp vụ, Worker,
kiểm tra hash, chuyển FHIR hay gửi HTTP. Không đổi LIS, EMR, Frontend, SQL
hoặc quyền truy cập.

## File thay đổi

| File | Nội dung |
|---|---|
| `backend/src/middleware/repository.ts` | Kiểu dữ liệu, lưu giao dịch và receipt nguyên tử, xử lý trùng/xung đột, các truy vấn đọc và thêm audit event |
| `backend/tests/middleware/fixtures.ts` | Envelope giả và hàm kiểm tra SQLSTATE cho test |
| `backend/tests/middleware/repository.unit.test.ts` | Kiểm tra thiếu kết nối và sáu nhánh kết quả retry/xung đột bằng driver giả, không mở socket |
| `backend/tests/middleware/repository.integration.test.ts` | Kiểm thử PostgreSQL thật bằng `integration_app`, dữ liệu giả và dọn fixture |
| `backend/package.json` | Thêm lệnh Middleware riêng và lệnh chạy cả LIS/Middleware với PostgreSQL dùng một lần; giữ nguyên `npm test` |
| `scripts/test-repositories-postgres.mjs` | Tạo container PostgreSQL 17 riêng, chạy SQL gốc và cả hai bộ test, dừng/xóa container |
| `docs/spp-66-b1-review.md` | Hướng dẫn đọc code, giả định và kết quả kiểm thử |

## Quy ước cần review trước B2

Contract đưa mẫu body `POST /api/exchanges` nhưng chưa định nghĩa rõ cấu trúc
cột `source_payload`. B1 chọn lưu **toàn bộ envelope sáu trường** sau:

```typescript
{
  event_id,
  source_system,
  source_result_id,
  source_snapshot,
  source_hash,
  published_at,
}
```

`source_snapshot` nằm bên trong envelope; không tự đổi tên thành
`source_payload`. Các cột `event_id`, `source_system`, `source_result_id`,
`source_hash`, `published_at` cũng được lấy từ chính envelope đó, giúp caller
không phải truyền hai bản dữ liệu có thể mâu thuẫn nhau. `received_at` dùng
`clock_timestamp()` của PostgreSQL. Không nhận thời điểm tiếp nhận từ LIS.

JSONB giữ giá trị JSON, không giữ nguyên byte HTTP, khoảng trắng hay thứ tự key.
Vì contract yêu cầu so sánh cả hash và nội dung, retry được coi là giống nhau
khi **cả hai khóa nghiệp vụ, hash và toàn bộ envelope JSONB đều khớp**. Thứ tự
key object không ảnh hưởng; thứ tự array có ảnh hưởng. B1 giữ nguyên chuỗi
`published_at` trong envelope: hai chuỗi cùng instant nhưng khác cách viết
vẫn là nội dung khác. Đây là lựa chọn nghiêm ngặt theo yêu cầu gửi lại nguyên
gói Publish; cần chốt quy tắc chuẩn hóa khác ở B2 nếu muốn thay đổi.

`exchangeId` là UUID tùy chọn do caller cấp; thiếu thì Repository dùng
`randomUUID()`. UUID đề xuất không phải khóa idempotency: một retry khớp
envelope vẫn trả UUID đã lưu. Va chạm UUID với giao dịch khác mà không có
khóa nghiệp vụ khớp sẽ ném lỗi, không báo nhận thành công.

Receipt đầu tiên dùng `event_type = RECEIVED`, `old_status = null`,
`new_status = RECEIVED`, `attempt_id = null`. `occurred_at` lấy trực tiếp
từ `received_at` trong PostgreSQL, giữ chính xác cả microsecond. Contract
chưa chốt chi tiết loại receipt; lựa chọn này theo trạng thái tiếp nhận và
ví dụ smoke test trong SQL gốc.

## Đọc các kiểu TypeScript

- `SourceSnapshot`: nội dung kết quả theo contract, số xét nghiệm là JSON
  number, cận tham chiếu/nhóm/fluid có thể là `null`, trạng thái `FINAL`.
- `SourceEnvelope`: body từ LIS, gồm snapshot và các định danh/hash/thời gian.
- `NewExchange`: `{ sourceEnvelope, exchangeId? }`, đã được Service tương lai
  kiểm tra. Repository không tự xác thực định dạng hay tính lại hash.
- `ExchangeTransaction`, `ExchangeEvent`, `ExchangeAttempt`: kiểu bản ghi suy
  ra từ schema Drizzle. Toàn bộ cột được giữ trong kết quả đọc, kể cả trạng thái,
  payload, lease, counters và timestamps. Theo schema hiện có, timestamp đọc
  ra là `Date`, JSONB đọc ra là `unknown` và cột TEXT trạng thái là `string`.
- `ExchangeStatus` và `AttemptPhase`: các union giới hạn đầu vào đã biết;
  `JsonValue`/`JsonObject` mô tả JSON mà không dùng `any`.
- `PersistExchangeResult`: union phân biệt bằng `kind`. Kiểm tra `kind` giúp
  TypeScript biết được nhánh hiện tại có `transaction` hay thông tin xung đột.

## Các hàm được export

| Hàm | Đầu vào | Đầu ra / ý nghĩa |
|---|---|---|
| `createExchange(input)` | `NewExchange` đã chuẩn bị | `Promise<PersistExchangeResult>`; lưu mới cùng receipt, hoặc trả bản ghi cũ/xung đột |
| `getExchangeById(exchangeId)` | UUID giao dịch Middleware | Bản ghi giao dịch hoặc `undefined` |
| `getExchangeByEventId(eventId)` | UUID Publish từ LIS | Bản ghi giao dịch hoặc `undefined` |
| `getExchangeBySourceResult(sourceSystem, sourceResultId)` | Đúng cặp mã hệ thống và mã kết quả | Bản ghi giao dịch hoặc `undefined` |
| `listExchanges(options = {})` | `status?`, `sourceResultId?`, `limit?`, `offset?` | Mảng giao dịch, lọc bằng AND; mặc định 20/0 |
| `getExchangeEvents(exchangeId)` | UUID giao dịch | Mảng lịch sử thuộc giao dịch, thời gian tăng dần |
| `appendExchangeEvent(input)` | `exchangeId`, `eventType`; tùy chọn UUID log, trạng thái cũ/mới, thời điểm, attempt, detail JSON | Bản ghi event vừa thêm; không đổi trạng thái giao dịch |
| `getExchangeAttempts(exchangeId, phase?)` | UUID giao dịch, tùy chọn `SEND`/`VERIFY` | Mảng attempt phù hợp; chỉ đọc, chưa tạo/chạy attempt |

`appendExchangeEvent` tự sinh `logEventId` và để database cấp `occurredAt`
nếu thiếu. Foreign key gốc ngăn log trỏ đến attempt của giao dịch khác.
Hàm này là thao tác append độc lập; chưa cung cấp boundary chuyển trạng thái
và log cùng transaction cho Worker tương lai.

Danh sách giao dịch sắp theo **`received_at DESC, exchange_id ASC`** trước
khi phân trang. Lịch sử sắp theo **`occurred_at ASC, log_event_id ASC`**.
Attempts sắp theo **`started_at ASC, attempt_id ASC`**. UUID cuối mỗi bộ khóa
giúp ổn định khi thời gian bằng nhau. UUID không chứng minh thứ tự nhân quả
giữa hai event cùng timestamp. Danh sách không có kết quả trả `[]`.
B2 phải kiểm tra `limit` nguyên 1–100 và `offset` nguyên an toàn, không âm,
trước khi gọi Repository. Offset pagination không tạo snapshot cố định giữa
nhiều request nếu dữ liệu mới xuất hiện xen kẽ.

`createExchange` trả ba trường hợp:

```typescript
{ kind: "created", transaction } // Đã COMMIT cả giao dịch và receipt.
{ kind: "existing", transaction } // Giống dữ liệu cũ; không ghi gì thêm.
{
  kind: "conflict",
  reason: "identifiers" | "content",
  byEventId,      // Bản ghi khớp event_id, có thể undefined.
  bySourceResult // Bản ghi khớp cặp nguồn, có thể undefined.
}
```

`identifiers`: một khóa trùng nhưng khóa kia khác, hoặc hai khóa trỏ tới hai
bản ghi khác nhau. `content`: cả hai khóa trỏ cùng bản ghi nhưng hash hoặc
envelope khác. B2 có đủ dữ liệu để quyết định phản hồi API; B1 chưa trả mã HTTP.

## Vì sao cần hai UNIQUE?

`UNIQUE(event_id)` ngăn cùng một lần Publish bị gắn với hai giao dịch, kể cả
khi request lỗi đổi mã kết quả. `UNIQUE(source_system, source_result_id)` ngăn
cùng kết quả nguồn bị tạo hai giao dịch chỉ vì gửi `event_id` mới. Chỉ mã kết
quả là chưa đủ: hai hệ thống LIS khác nhau có thể dùng cùng mã kết quả.

Không dùng `patient_id + test_code` làm khóa: một bệnh nhân có thể xét nghiệm
cùng loại nhiều lần. Không dùng hash làm khóa: cùng hash vẫn phải đối chiếu
nội dung thật.

## Transaction và hai request đồng thời

Database transaction bảo đảm **cả hai write cùng thành công hoặc cùng rollback**.
Không thể nhận kết quả `created` khi mới có giao dịch mà chưa có receipt.
Nếu ghi receipt lỗi, bản ghi giao dịch vừa thêm bị hủy; caller nhận lỗi.

Hai request cùng đến không dựa vào kiểu “SELECT chưa thấy rồi INSERT chắc
sẽ được”. PostgreSQL tự phân xử UNIQUE trong `INSERT ... ON CONFLICT DO NOTHING`:

1. Request đầu chèn được và thêm receipt trong cùng transaction.
2. Request cạnh tranh chờ transaction đó kết thúc nếu có xung đột khóa.
3. Nếu request đầu commit, request chờ không insert. Một câu SELECT mới ở mức
   `READ COMMITTED` nhìn thấy bản ghi đã commit và đối chiếu cả hai khóa cùng
   nội dung. Trùng hoàn toàn trả `existing`; khác trả `conflict`.
4. Nếu request đầu rollback, request chờ có thể insert, tạo receipt và commit.

Repository không chạy UPDATE trong luồng nhận, nên retry không reset về
`RECEIVED`, không thay UUID, payload, timestamps, counters hay lịch sử cũ.
Xóa giao dịch đồng thời ngoài luồng có thể làm không tìm thấy winner; trường
hợp đó ném lỗi để tránh báo thành công giả. Repository truyền lỗi database
lên caller; B2/B3 phải xử lý thông báo an toàn, không đưa SQL/payload ra HTTP.

## Luồng dữ liệu để học lại TypeScript

```text
LIS gửi envelope
  → [B2 tương lai] kiểm tra JSON, UUID, hash và nội dung
  → createExchange({ sourceEnvelope, exchangeId? })
  → Drizzle INSERT integration.exchange_transactions
  → nếu tạo mới: INSERT integration.exchange_events (RECEIVED)
  → COMMIT → trả kind + dữ liệu đã lưu
  → [B2/B3 tương lai] quyết định phản hồi nhận hoặc xung đột
```

`async` trả một `Promise`; `await` chờ kết quả I/O. Dấu `?` là trường tùy chọn;
`undefined` khi không tìm thấy khác với `[]` khi danh sách rỗng. Ví dụ caller:

```typescript
const result = await createExchange({ sourceEnvelope: validatedEnvelope });
if (result.kind === "conflict") {
  // B2 quyết định báo xung đột; không sửa bản ghi cũ.
} else {
  const exchangeId = result.transaction.exchangeId;
  // created và existing đều có exchangeId đã lưu bền vững.
}
```

`RECEIVED` chỉ nghĩa Middleware đã lưu dữ liệu nhận từ LIS. `DELIVERED` đòi
hỏi EMR đã lưu **và** Middleware đã đọc lại, đối chiếu đúng theo MR01–MR09.
B1 không kết nối EMR, nên không thể tự kết luận `DELIVERED`. Sự kiện lịch sử
có `newStatus` cũng không tự làm trạng thái giao dịch thay đổi.

## Chạy lại kiểm thử

```bash
cd backend
npm run check
npm run build
npm run test:repositories:postgres
```

Lệnh cuối cần Docker daemon và image `postgres:17` có sẵn. Nếu chưa có image,
chủ động chuẩn bị bằng `docker pull postgres:17` trước. Runner dùng
`--pull=never`, container tên UUID, cổng localhost ngẫu nhiên, dữ liệu tmpfs,
SQL gốc và mật khẩu chỉ dành cho test. Không đọc `.env`, không gắn volume dự
án và luôn dừng container khi chạy xong bình thường, kể cả khi test thất bại.
Nếu tiến trình bị kill cứng, có thể còn container tên
`spp66-repository-test-<UUID>`; chỉ dừng đúng container test đó.

Muốn chạy riêng Middleware trên database test đã chuẩn bị:

```bash
MIDDLEWARE_REPOSITORY_TEST_DATABASE_URL='postgresql://integration_app:TEST_PASSWORD@127.0.0.1:TEST_PORT/dacn_db' npm run test:middleware
```

Suite từ chối role sai hoặc ba bảng giao dịch có dữ liệu sẵn. Chỉ dùng database
dùng một lần; URL test là opt-in riêng, không lấy URL ứng dụng hiện có.
Thiếu URL test thì nhóm tích hợp được skip. `npm test` vẫn chạy toàn bộ LIS;
runner PostgreSQL đặt cả URL LIS và Middleware rồi chạy lần lượt hai bộ test.

## Kết quả và giới hạn

Kết quả thực tế khi triển khai B1 trên Node 26.12.0, PostgreSQL 17:

| Lệnh / bộ test | Kết quả |
|---|---|
| `npm run check` | Thành công, kiểm tra cả source và tests |
| `npm run build` | Thành công |
| LIS trong runner PostgreSQL | 79 pass, 0 fail, 0 skip |
| Middleware trong runner PostgreSQL | 25 pass, 0 fail, 0 skip |

Node có cảnh báo `DEP0205` từ công cụ nạp TypeScript hiện có; không gây thất
bại test. Chưa thay dependency vì ngoài phạm vi B1.

Test bao gồm: lưu mới/UUID tự sinh, receipt và timestamp chính xác, mọi lookup,
lọc/phân trang/thứ tự có timestamp trùng, lịch sử/attempt, retry giữ nguyên
giao dịch đã DELIVERED, cùng hash nhưng snapshot khác, hash/thời điểm khác,
xung đột từng UNIQUE và hai khóa trỏ hai giao dịch, ba nhóm tám insert đồng
thời, chờ commit/rollback thật, lỗi ghi receipt gây rollback toàn bộ, UUID lỗi,
foreign key attempt khác giao dịch, kiểm tra quyền LIS/EMR/evaluator.

Repository dùng connection cấu hình trong `middleware/db.ts`; triển khai phải
cấp `MIDDLEWARE_DATABASE_URL` đăng nhập bằng `integration_app` và kiểm tra
readiness. B1 không thay cơ chế xác thực connection dùng chung. Các mốc thời
gian lưu ở PostgreSQL và envelope giữ microsecond; trường `Date` khi đọc qua
schema Drizzle hiện có chỉ biểu diễn đến millisecond.

Các điểm cần review là cấu trúc envelope đầy đủ trong `source_payload`, so sánh
chuỗi timestamp nghiêm ngặt và tên receipt nêu trên. Không tự sửa API contract.
Dừng ở B1, chưa commit/push hay mở pull request; chờ review trước B2.
