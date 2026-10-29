# SPP-66 B2 — Middleware Service

B2 thêm `acceptExchange`: nhận gói LIS, kiểm tra dữ liệu/hash rồi nhờ B1 lưu.
Chưa có route HTTP, FHIR, gửi EMR, Worker hay dispatcher. Không đổi SQL hoặc
mã LIS. Đã xem diff và B1 trước khi làm: B1 đủ chức năng, không có lỗi chặn B2,
nên giữ nguyên Repository.

## File mới và cập nhật

| File | Vai trò |
|---|---|
| `backend/src/middleware/service.ts` | `acceptExchange`, kiểm tra dữ liệu, gọi B1 và trả kết quả có kiểu rõ ràng |
| `backend/src/middleware/canonical-json.ts` | Sắp xếp JSON và tính SHA-256 độc lập, tương thích LIS A2 |
| `backend/tests/middleware/canonical-json.test.ts` | Đối chiếu hash với LIS thật và mẫu cố định; kiểm tra số, Unicode, key và array |
| `backend/tests/middleware/fixtures/lis-a2-golden.json` | Bốn mẫu được tạo bằng `canonicalJson`/`hashCanonicalJson` thực tế của LIS |
| `backend/tests/middleware/service-fixtures.ts` | Dữ liệu giả; dùng hash LIS thật trong test |
| `backend/tests/middleware/service.unit.test.ts` | Kiểm tra dữ liệu sai bị chặn trước khi gọi Repository; các loại kết quả và lỗi |
| `backend/tests/middleware/service.integration.test.ts` | Kiểm tra lưu thật, retry, request đồng thời, rollback và nhận gói từ Service Publish LIS thật |
| `docs/architecture.md` | Cập nhật trạng thái triển khai B1–B2; API nhận HTTP vẫn chưa có |

Các file B1 đã có sẵn trong working tree vẫn được giữ. Không thêm dependency
hoặc đổi lệnh test: `test:middleware` tự nhận các file test B2 mới.

## `acceptExchange` làm gì?

Đầu vào là `unknown`: dữ liệu chưa được tin là đúng kiểu. Hàm lần lượt:

1. Kiểm tra dữ liệu là JSON hợp lệ, tạo bản sao riêng để caller không thể sửa
   gói đang được lưu giữa chừng.
2. Kiểm tra sáu trường envelope, UUID, mã nguồn, hash chữ thường và thời gian.
3. Kiểm tra snapshot: đủ trường, số hữu hạn, đơn vị/mã không trống, trạng thái
   `FINAL`, thời gian có thật, cận dưới không lớn hơn cận trên. Mã kết quả ở
   ngoài phải khớp `source_snapshot.result_id`.
4. Tính lại SHA-256 **chỉ từ `source_snapshot`**, so với `source_hash` nhận được.
5. Nếu mọi thứ hợp lệ, gọi `createExchange` của B1. B1 quyết định tạo mới,
   trả bản ghi cũ hay báo xung đột bằng cả hai khóa UNIQUE.
6. Chỉ trả `accepted` sau khi B1 lưu xong. Lỗi database trả `unavailable`,
   không trả SQL, URL kết nối hay payload trong thông báo lỗi.

```text
Gói LIS → kiểm tra cấu trúc/nội dung → kiểm tra hash snapshot
       → B1 lưu hoặc đối chiếu bản cũ → trả kết quả cho B3 tương lai
```

Đầu ra được phân biệt bằng `kind`:

| `kind` | Ý nghĩa | B3 dự kiến trả |
|---|---|---|
| `accepted` | Đã lưu mới hoặc giống dữ liệu đã lưu | 202 |
| `malformed` | Thiếu trường, sai kiểu/UUID/hash format/thời gian hoặc dữ liệu không hỗ trợ | 400 |
| `invalid` | Sai `FINAL`, mã không khớp, đơn vị trống, cận sai hoặc hash không khớp | 422 |
| `conflict` | Định danh hoặc nội dung khác giao dịch cũ; mã `DUPLICATE_CONFLICT` | 409 |
| `unavailable` | Không xác nhận được việc lưu; mã `DEPENDENCY_UNAVAILABLE` | 503 |

Nhánh `accepted` có sáu trường dùng cho phản hồi: `accepted: true`, `event_id`,
`exchange_id`, `source_system`, `source_result_id`, `source_hash`. Còn `kind`
và `created` là thông tin nội bộ cho B3, không phải trường bổ sung của API.
`created: false` nghĩa request giống bản đã có. `exchange_id` luôn lấy từ B1;
định danh nguồn trả đúng như gói nhận, kể cả chữ hoa/thường trong UUID.

Tham số Repository tùy chọn của `acceptExchange` chỉ giúp unit test thay chỗ
lưu dữ liệu. Khi dùng bình thường, gọi `acceptExchange(body)` là đủ.

## Canonical JSON là gì?

Là cách viết JSON thống nhất trước khi tính hash. Ví dụ cả hai object:

```json
{"b":2,"a":1}
{"a":1,"b":2}
```

đều được viết thành `{"a":1,"b":2}`. Quy tắc giống LIS A2:

- Sắp key của từng object bằng `.sort()` mặc định của JavaScript. Ví dụ key
  `"10"` đứng trước `"2"`; không dùng cách sắp theo ngôn ngữ.
- Giữ nguyên thứ tự phần tử array.
- Dùng cách viết chuỗi/số của `JSON.stringify`, không thêm khoảng trắng.
  `-0` thành `0`; không nhận `NaN`, `Infinity`, `undefined`, function, Date
  hoặc object vòng lặp như dữ liệu JSON.
- Tính SHA-256 trên byte UTF-8 của chuỗi đó.

Code chạy thật của Middleware chỉ import file trong Middleware. Chỉ **test**
import LIS để đối chiếu. Ngoài bốn mẫu hash cố định, integration test còn tạo
nguồn giả, gọi Service Publish LIS thật rồi đưa nguyên snapshot/hash sang B2.
Không dùng hash minh họa trong API contract làm đáp án kiểm thử.

## Hash, mã hóa và so sánh nội dung

Hash giống một dấu kiểm tra: đổi giá trị từ `3.4` thành `9` thì hash tính lại
sẽ khác, giúp phát hiện dữ liệu bị thay đổi. Hash không giấu nội dung và
không dùng để khôi phục dữ liệu gốc. Mã hóa dùng để che nội dung và có thể
giải mã bằng khóa. SHA-256 không có khóa cũng không chứng minh ai là người gửi;
người chủ động sửa dữ liệu có thể tính lại hash.

Hash khớp mới là một phần kiểm tra. Nó chỉ bao phủ snapshot, không bao phủ
`event_id` hay `published_at`. Khi gửi lại, B1 còn so cả hai định danh và toàn
bộ envelope. Vì vậy, cùng hash nhưng đổi `event_id` hoặc thời điểm Publish
vẫn có thể bị báo xung đột.

## Ví dụ hợp lệ, bị sửa và gửi lại xung đột

Gói giả sau dùng hash đã được tạo bởi LIS thật trong golden fixture:

```json
{
  "event_id": "00000000-0000-4000-8000-000000000001",
  "source_system": "lis-demo",
  "source_result_id": "B2-GOLDEN-R1",
  "source_snapshot": {
    "result_id": "B2-GOLDEN-R1",
    "patient_id": "B2-SYNTHETIC-P1",
    "test_code": "B2-TEST",
    "test_name": "Synthetic potassium",
    "fluid": "Blood",
    "category": "Chemistry",
    "value_num": 3.4,
    "unit": "mEq/L",
    "reference_low": null,
    "reference_high": 5.1,
    "effective_at": "2180-06-03T12:00:00.123456Z",
    "result_status": "FINAL"
  },
  "source_hash": "66d4bb0e7270c1f2983f90de625361cb26dc4c06e65247a1c2627031a9c1bd1d",
  "published_at": "2026-10-22T09:00:00Z"
}
```

| Thao tác | Kết quả |
|---|---|
| Gửi lần đầu vào database trống | `accepted`, `created: true`, lưu trạng thái `RECEIVED` và receipt |
| Gửi lại đúng gói; chỉ đổi thứ tự key object | `accepted`, `created: false`, trả `exchange_id` cũ |
| Đổi `value_num` thành `9`, giữ hash cũ | `invalid`, trường `source_hash`; chưa gọi Repository |
| Sau lần đầu, đổi `value_num` thành `9` và tính hash mới đúng | `conflict`; định danh cũ đang gắn với nội dung khác |
| Sau lần đầu, giữ snapshot/hash nhưng đổi `event_id` | `conflict`; cặp nguồn cũ đang gắn với sự kiện khác |

## Gửi lại nhiều lần và ACK

Trong dự án này, idempotency nghĩa là **gửi lại cùng gói chỉ dùng một giao dịch**.
Hai request đến gần như cùng lúc vẫn do PostgreSQL phân xử hai UNIQUE ở B1.
Nếu giống nhau, cả hai nhận cùng `exchange_id`, chỉ một request tạo mới.
Nếu khác nhau, request còn lại nhận xung đột. B2 không đọc trước rồi tự quyết
định insert, nên không bỏ qua được kiểm tra khi request chạy đồng thời.

Giao dịch đang `VERIFYING`, `FAILED`, `DELIVERED` hoặc trạng thái nào khác
đều giữ nguyên khi nhận retry giống nhau; không thêm receipt thứ hai.

LIS ghi **ACK** sau khi nhận phản hồi khớp ID/hash: Middleware đã nhận và lưu.
**DELIVERED** chỉ có sau khi EMR lưu và Middleware đọc lại, đối chiếu đúng.
B2 chưa thực hiện những bước với EMR nên không báo đã giao thành công.

## Quy ước và giới hạn

- Giữ lựa chọn B1: `source_payload` là toàn bộ envelope. Trường JSON bổ sung
  được giữ; nếu nằm trong snapshot thì cũng tham gia tính hash. Không âm thầm
  bỏ trường hoặc tự thay dữ liệu nguồn.
- Các trường nullable trong cấu trúc LIS (`fluid`, `category`, hai cận) vẫn
  phải có, có thể mang giá trị `null`.
- Thời gian dùng dạng `YYYY-MM-DDTHH:mm:ss[.fraction]Z` hoặc có `±HH:mm`.
  Kiểm tra ngày thật, giây 00–59, giờ 00–23, instant UTC trong năm 0001–9999;
  độ lệch múi giờ tối đa 15:59 theo giới hạn PostgreSQL. Không nhận date-only,
  giờ thiếu timezone, `24:00:00`, leap second hoặc định dạng ISO rút gọn.
  Những dạng LIS hiện phát ra đều được hỗ trợ.
- Không chuẩn hóa chuỗi thời gian trước khi hash hoặc lưu envelope. Cùng
  instant nhưng khác cách viết là khác nội dung theo B1. PostgreSQL lưu cột
  timestamp đến microsecond; `Date` khi đọc qua schema hiện tại đến millisecond.
- Không làm tròn/chuyển đơn vị hoặc ép chuỗi thành số. `-0` và `0` cùng biểu
  diễn JSON như LIS. Service nhận số JavaScript sau parse nên không thể khôi
  phục độ chính xác đã mất trước đó; LIS A2 kiểm tra độ chính xác trước Publish.
- Không truy vấn catalog LIS hoặc tra bệnh nhân EMR. B2 kiểm tra mã/đơn vị
  có dữ liệu, không xác minh được chúng thuộc catalog hay liên kết bệnh nhân
  nào. Dữ liệu JSONB có NUL hoặc surrogate Unicode đơn lẻ bị chặn trước DB.
- Nếu lỗi lúc trả kết quả commit, `unavailable` không chứng minh dữ liệu chưa
  được lưu. Caller cần gửi lại nguyên gói; hai UNIQUE tiếp tục chống trùng.

## Kết quả kiểm thử thực tế

```bash
cd backend
npm run check
npm run build
npm run test:repositories:postgres
```

| Kiểm tra | Kết quả |
|---|---|
| TypeScript source và tests | Thành công |
| Build | Thành công |
| LIS regression | 79 pass, 0 fail, 0 skip |
| Middleware B1 + B2 | 76 pass, 0 fail, 0 skip |

Chạy trên Node 26.12.0, PostgreSQL 17, container test riêng có dữ liệu tmpfs
và được dọn sau test; không dùng volume dự án. Có cảnh báo `DEP0205` từ
loader TypeScript hiện có, không làm test thất bại. Runner cũ cũng chạy các
test B2 vì `test:middleware` lấy toàn bộ `tests/middleware/*.test.ts`.
Không có trường hợp integration nào còn chưa được kiểm chứng trong lần chạy này.

Đã dừng tại B2; chưa triển khai B3/B4, chưa commit hoặc push.
