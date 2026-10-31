# SPP-66 B3 — Middleware Controller

B3 đã thêm ba endpoint nhận và tra cứu giao dịch. Dữ liệu vẫn được kiểm tra
qua B2 và lưu qua B1; không sửa hai lớp này. Chưa có FHIR Mapper, Worker,
dispatcher, API nghiệp vụ EMR hoặc ACK tự động phía LIS.

## Những file thay đổi ở B3

| File | Nội dung |
|---|---|
| `backend/src/middleware/controller.ts` | Ba route, kiểm tra query/UUID/media type, chuyển kết quả sang HTTP và xử lý lỗi an toàn |
| `backend/tests/middleware/http-test-helpers.ts` | Mở HTTP server test trên cổng localhost tạm và kiểm tra JSON |
| `backend/tests/middleware/controller.http.test.ts` | Test HTTP với các dependency giả để chủ động kiểm tra lỗi |
| `backend/tests/middleware/controller.integration.test.ts` | Test HTTP thật tới B2/B1/PostgreSQL dùng dữ liệu giả |
| `docs/api-contract.md` | Đánh dấu đúng ba API đã kiểm thử và bổ sung JSON cho API đọc |
| `docs/architecture.md` | Cập nhật trạng thái B3 |

Các file B1/B2 chưa commit từ những bước trước vẫn được giữ. Không sửa LIS,
schema, `main.ts`, giới hạn body hoặc thêm dependency. Dùng lại lệnh test cũ.

## Request đi qua những đâu?

Express nhận HTTP và tìm route khớp với phương thức/path. Với JSON, cấu hình
`express.json({ limit: "1mb" })` hiện có đọc body thành object; JSON hỏng hoặc
quá lớn đi vào phần xử lý lỗi.

```text
POST /api/exchanges
  → Controller kiểm tra phần HTTP và gọi acceptExchange(body)
  → Service B2 kiểm tra dữ liệu, tính lại hash snapshot
  → Repository B1 lưu giao dịch + receipt trong một transaction
  → database commit
  → Service trả kết quả → Controller trả HTTP 202
```

API GET gọi các hàm đọc của Repository. Controller chỉ đổi tên trường sang
`snake_case`, chọn dữ liệu được trả và định dạng JSON; không tạo FHIR hoặc
thêm event giả. `/health` và `/ready` giữ nguyên cách phản hồi trước B3.

| HTTP | Nghĩa trong chức năng này |
|---|---|
| `202` | Middleware đã lưu gói và nhận xử lý tiếp; retry giống nhau cũng trả 202 với ID cũ |
| `400` | Sai định dạng JSON, UUID, query hoặc thiếu/sai kiểu trường |
| `404` | UUID hợp lệ nhưng không có giao dịch, hoặc không có API đó |
| `409` | ID hoặc nội dung xung đột với giao dịch cũ |
| `413` | JSON body vượt giới hạn `1mb` |
| `415` | Thiếu/sai Content-Type hoặc charset/encoding không hỗ trợ |
| `422` | Nội dung không hợp lệ, ví dụ hash không khớp hoặc kết quả chưa FINAL |
| `503` | Database/khâu lưu trữ không sẵn sàng; không báo nhận thành công |

Phải chờ **commit trước 202** vì LIS sẽ dựa vào phản hồi này để biết Middleware
đã lưu. Trả quá sớm rồi lưu thất bại có thể làm mất yêu cầu. Trong test, ngay
sau HTTP 202, một connection khác đã đọc được cả giao dịch lẫn receipt.

`RECEIVED` là trạng thái đã lưu ở Middleware. ACK là bước LIS nhận và kiểm tra
phản hồi khớp ID/hash; phần tự động đó chưa được làm. `DELIVERED` còn cần EMR
lưu và Middleware đọc lại đúng. B3 không tự đánh dấu hai mốc sau.

## Những chỗ contract chưa chốt trước B3

Trước đây chưa có JSON chi tiết cho list item/event, chưa nói rõ mã 404 của
Middleware và cách xử lý thiếu Content-Type. B3 đã ghi các lựa chọn sau vào
API contract để review, thay vì để chúng thành hành vi ngầm:

- Danh sách trả thông tin tóm tắt; chi tiết trả thêm `source_payload`,
  `fhir_payload`, các mốc xử lý và `events`.
- `fhir_payload: null` khi chưa có; không tự dựng FHIR.
- Event trả ID, loại, trạng thái cũ/mới, thời gian và attempt ID. Không trả
  JSON chẩn đoán tự do `detail` hoặc response/error body của attempt. Không
  đưa lease/token nội bộ vào JSON.
- 404 dùng `NOT_FOUND`, giống LIS A3. Thiếu/sai media type trả
  `415`/`VALIDATION_ERROR`; body rỗng có media type JSON trả `400`.
- POST và GET chi tiết không nhận query. List chỉ nhận `status`,
  `source_result_id`, `limit`, `offset`; query khác/lặp/array/object bị từ chối.
- Các timestamp cột qua `Date` hiện có trả UTC đến millisecond. Chuỗi thời
  gian trong `source_payload` giữ nguyên, kể cả microsecond.

Chi tiết đầy đủ các trường JSON nằm ở [API contract](api-contract.md#phản-hồi-middleware--đã-triển-khai-ở-b3).

## Thử thủ công với database riêng

Các lệnh dưới chạy từ **thư mục gốc repository**, trừ lệnh bật backend.
Chỉ tạo container test riêng; không dùng hoặc xóa volume dự án.

```bash
docker run --rm -d --name middleware-b3-manual \
  --tmpfs /var/lib/postgresql/data \
  -p 127.0.0.1:55468:5432 \
  -e POSTGRES_DB=dacn_db \
  -e POSTGRES_PASSWORD=b3-disposable-admin postgres:17

docker exec middleware-b3-manual pg_isready -h 127.0.0.1 -U postgres -d dacn_db
```

Chờ lệnh kiểm tra báo `accepting connections` rồi chạy:

```bash
docker exec -i middleware-b3-manual psql -U postgres -d dacn_db -v ON_ERROR_STOP=1 \
  < database/dacn_db_init_v2.sql
docker exec -i middleware-b3-manual psql -U postgres -d dacn_db -v ON_ERROR_STOP=1 \
  < database/access_roles.sql
docker exec middleware-b3-manual psql -U postgres -d dacn_db -v ON_ERROR_STOP=1 \
  -c "ALTER ROLE integration_app PASSWORD 'b3-disposable-integration';"
```

Ở terminal khác, bật Middleware với URL test riêng:

```bash
cd backend
HOST=127.0.0.1 MIDDLEWARE_PORT=3102 \
MIDDLEWARE_DATABASE_URL='postgresql://integration_app:b3-disposable-integration@127.0.0.1:55468/dacn_db' \
npm run dev:middleware
```

Tại terminal gốc, tạo **một lần** file request từ mẫu giả có hash đã đối chiếu
với LIS thật. Không tự chép hash minh họa trong contract cho snapshot khác:

```bash
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const golden = JSON.parse(readFileSync('backend/tests/middleware/fixtures/lis-a2-golden.json', 'utf8'));
const fixture = golden.fixtures.find(item => item.name === 'publish-snapshot');
writeFileSync('/tmp/b3-exchange.json', JSON.stringify({
  event_id: randomUUID(), source_system: 'lis-demo',
  source_result_id: fixture.input.result_id, source_snapshot: fixture.input,
  source_hash: fixture.sha256, published_at: new Date().toISOString(),
}));
JS
```

### 1. POST nhận dữ liệu

```bash
curl -sS -X POST http://127.0.0.1:3102/api/exchanges \
  -H 'Content-Type: application/json' --data-binary @/tmp/b3-exchange.json \
  | tee /tmp/b3-accepted.json
```

HTTP **202**, JSON gồm đúng sáu trường dưới đây; UUID thực tế phụ thuộc lần chạy:

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

Gửi lại **cùng file** vẫn nhận 202 và cùng `exchange_id`. Nếu chạy lại đoạn
tạo file, nó sinh `event_id` mới nhưng cặp nguồn vẫn cũ, nên 409 là đúng.

### 2. GET danh sách và lọc

```bash
curl -sS 'http://127.0.0.1:3102/api/exchanges?status=RECEIVED&source_result_id=B2-GOLDEN-R1&limit=20&offset=0'
```

Dạng JSON là `{"items": [...], "limit": 20, "offset": 0}`. `items` chứa
giao dịch vừa lưu; không có kết quả trả `items: []`. Mỗi item có ID nguồn,
hash, status, counters và các mốc tóm tắt theo contract.
Thứ tự là `received_at DESC, exchange_id ASC`.

### 3. GET chi tiết và lịch sử

```bash
exchange_id=$(node -p "JSON.parse(require('fs').readFileSync('/tmp/b3-accepted.json','utf8')).exchange_id")
curl -sS "http://127.0.0.1:3102/api/exchanges/$exchange_id"
```

JSON là một object, không bọc trong `items`. Có toàn bộ trường tóm tắt,
`source_payload` bằng gói đã gửi, `fhir_payload: null`, các mốc chưa xử lý
là `null`, counters bằng 0 và `events` chứa một receipt. Mỗi event có dạng:

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

UUID/thời gian trên chỉ minh họa; API trả đúng dữ liệu đã lưu. Lịch sử sắp
theo `occurred_at ASC, log_event_id ASC`.

Thử thêm lỗi tham số, dùng `-i` để xem cả HTTP status:

```bash
curl -i 'http://127.0.0.1:3102/api/exchanges?limit=101'
curl -i 'http://127.0.0.1:3102/api/exchanges/not-a-uuid'
```

Cả hai trả 400 với dạng `{"error":{"code":"VALIDATION_ERROR","message":"..."}}`.
UUID hợp lệ nhưng không có dữ liệu trả 404/`NOT_FOUND`.

Khi thử xong, `Ctrl+C` tại terminal backend rồi dừng đúng container test:

```bash
docker stop middleware-b3-manual
```

Container dùng `--rm` nên tự xóa dữ liệu test. Không chạy `compose down -v`.

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
| Middleware B1–B3 | 102 pass, 0 fail, 0 skip |

Chạy trên Node 26.12.0 và PostgreSQL 17 trong container test riêng. Test B3
gồm 14 tình huống HTTP với dependency giả và 10 tình huống HTTP + PostgreSQL;
test runner tính cả hai nhóm nên tổng tăng từ 76 lên 102. Có kiểm tra 202
sau commit, IDs phản hồi, retry/xung đột, hash sai, JSON/query/UUID sai,
lọc/phân trang, lịch sử, tám request đồng thời, lỗi ghi thật và đóng connection.
Các test cũ vẫn được chạy. Container tự dọn sau khi hoàn tất.

Cảnh báo `DEP0205` từ loader TypeScript hiện có không làm test thất bại.
Không có test integration nào còn chưa kiểm chứng trong lần chạy này.
Việc đối chiếu timestamp chỉ đến millisecond ở JSON cột là giới hạn sẵn có
của schema `Date`; B3 không thay đổi B1 để mở rộng độ chính xác này.

Đã dừng ở B3, chưa triển khai B4, chưa commit hoặc push; chờ review.
