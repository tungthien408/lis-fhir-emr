# SPP-66 A3 — Gọi các chức năng LIS qua HTTP

A1 lo đọc/lưu dữ liệu. A2 lo kiểm tra và chốt kết quả. **A3 tạo các đường dẫn
API để người dùng hoặc chương trình khác gọi những chức năng đó.** Code chính
nằm trong `backend/src/lis/controller.ts`, gọi là Controller.

Publish hiện chỉ lưu kết quả để chờ gửi, chưa gửi sang Middleware hoặc EMR.

## Có thể gọi những chức năng nào?

| API | Dùng để làm gì? |
|---|---|
| `GET /api/results` | Xem và lọc danh sách kết quả xét nghiệm. |
| `GET /api/results/:resultId` | Xem một kết quả theo mã của nó. |
| `POST /api/results/:resultId/publish` | Yêu cầu Publish một kết quả. |
| `GET /api/publish-events/:eventId` | Xem trạng thái sự kiện Publish. |

`GET` dùng để xem dữ liệu. `POST` ở đây dùng để yêu cầu Publish.
`resultId` là mã kết quả; `eventId` là mã sự kiện được tạo khi Publish lần đầu.

## Khi gọi Publish, A3 làm gì?

A3 lấy mã kết quả từ đường dẫn, nhờ Service A2 xử lý rồi trả lời người gọi:

| Trường hợp | Mã HTTP | Hiểu đơn giản |
|---|---|---|
| Lưu sự kiện mới | `202` | Đã nhận và lưu, đang chờ gửi. |
| Đã Publish trước đó | `200` | Trả lại sự kiện cũ, không tạo thêm. |
| Không có kết quả | `404` | Không tìm thấy mã kết quả đó. |
| Kết quả chưa hợp lệ | `422` | Chưa FINAL, sai đơn vị hoặc dữ liệu không đạt yêu cầu. |
| Không làm việc được với database | `503` | Chưa thể xử lý; không báo Publish thành công. |

Controller không kiểm tra lại toàn bộ quy tắc của A2 và không tự sửa dữ liệu.
Nó cũng không tự đánh dấu `ACK`. `PENDING` chỉ có nghĩa là **đang chờ gửi**.

## Những điểm cần biết khi xem kết quả

- Danh sách lọc được bằng `patient_id`, `test_code`, `result_status`.
  Khi dùng nhiều bộ lọc, kết quả phải thỏa tất cả điều kiện.
- `limit` là số bản ghi muốn lấy: mặc định 20, tối đa 100. `offset` là số
  bản ghi bỏ qua từ đầu: mặc định 0. Trạng thái chỉ nhận `READY` hoặc `FINAL`.
- Tham số sai, trống, bị lặp hoặc không được hỗ trợ trả `400`.
- API xem kết quả giữ số ở dạng chữ, ví dụ `"value_num": "3.4000"`, để không
  mất độ chính xác. Bản sao dùng cho Publish được A2 kiểm tra và xử lý riêng.
- Thời gian được ghi theo UTC, giữ đủ các chữ số sau giây. Thời gian nguồn
  không thể ghi hợp lệ thì API xem trả `null`, còn Publish bị từ chối.
- Publish không cần gửi thêm nội dung. Nếu có JSON gửi kèm, nó không thay mã
  kết quả ở đường dẫn. JSON hỏng trả `400`, quá lớn trả `413`, cách mã hóa
  không được hỗ trợ trả `415`.
- Lỗi trả theo dạng `{ "error": { "code": "...", "message": "..." } }`.
  Không trả nguyên lỗi SQL, mật khẩu hoặc thông tin kết nối ra ngoài.

`/health` vẫn kiểm tra server HTTP còn chạy. `/ready` kiểm tra database có
sẵn sàng không. Vì vậy, database lỗi thì `/health` vẫn có thể trả `200`, còn
`/ready` trả `503`.

Chi tiết các trường và quy tắc đầy đủ nằm trong [API contract](api-contract.md).

## Chạy test tự động trước

Đây là cách kiểm tra A3 nhanh nhất; chưa cần tự thêm dữ liệu hay gọi curl.

### Bước 1: Chuẩn bị database test

Làm theo [các bước Docker ở A1](spp-66-a1-review.md#kiểm-thử-a1-bằng-postgresql-riêng-trong-docker).
Nếu đã có `lis-a1-test` chạy trên port `55466`, đã đặt mật khẩu `lis_app` là
`lis123` và các bảng LIS trống thì dùng lại, không cần tạo container mới.

Đây là database riêng chứa dữ liệu giả, không phải database của dự án.

### Bước 2: Vào backend và chạy test

Nếu terminal đang ở thư mục gốc `lis-fhir-emr/`, chạy:

```bash
cd backend
```

Nếu đã ở `backend/`, bỏ qua lệnh trên. Sau đó chạy:

```bash
npm run check
npm run build
LIS_REPOSITORY_TEST_DATABASE_URL='postgresql://lis_app:lis123@127.0.0.1:55466/dacn_db' npm test
```

Test tự thêm/dọn dữ liệu giả và tự mở/đóng server HTTP. Bạn không cần bật
server LIS bằng tay cho bước này.

Kết quả mong đợi hiện tại:

```text
tests 79
pass 79
fail 0
cancelled 0
skipped 0
```

Đây là tổng A1, A2, A3, Swagger UI và các test dùng chung. Cần thấy `skipped 0` để biết
các test PostgreSQL thực sự đã chạy.

Các test A3 đã thử: tham số sai, tìm kết quả, lọc/phân trang, Publish mới/lặp,
nhiều Publish cùng lúc và lỗi lưu. Có cả thử đóng kết nối database để xác
nhận API trả `503`, trong khi `/health` vẫn hoạt động.

## Thử API bằng giao diện Swagger UI

Swagger UI cho phép chọn API, nhập thông tin rồi bấm nút gửi trên trình duyệt.
Làm phần này **sau khi chạy xong test tự động**. Khi thêm dữ liệu
bằng tay, database không còn trống nên không chạy lại test tự động ngay trên đó.

Tất cả lệnh tiếp theo chạy trong `backend/`. Giữ container `lis-a1-test` ở trên
đang chạy. Cổng **55466 là database**; cổng **33101 là HTTP của LIS** trong ví dụ.

### Bước 1: Bật server ở terminal thứ nhất

```bash
HOST=127.0.0.1 \
LIS_DATABASE_URL='postgresql://lis_app:lis123@127.0.0.1:55466/dacn_db' \
LIS_PORT=33101 MIDDLEWARE_PORT=33102 EMR_PORT=33103 npm run dev
```

Lệnh mở ba server ở các cổng riêng, tránh nhầm với bản Docker cũ có thể đang
chạy ở 3101–3103. LIS được nối tới database test.

Mở terminal thứ hai, cũng vào `backend/`, rồi kiểm tra ba server:

```bash
LIS_PORT=33101 MIDDLEWARE_PORT=33102 EMR_PORT=33103 npm run smoke
```

Mong đợi **3 PASS**. Lệnh này chỉ kiểm tra `/health`, không thử gửi kết quả
sang Middleware hay EMR. Giữ terminal thứ nhất chạy, dùng terminal thứ hai
cho các bước còn lại.

### Bước 2: Thêm hai kết quả giả

Đoạn SQL sau tạo một bệnh nhân giả và hai kết quả: `R1` đã FINAL, `R2` còn READY.
Chỉ chạy một lần trên database test trống sau phần kiểm thử tự động.

```bash
docker exec --interactive lis-a1-test psql -U postgres -d dacn_db -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
INSERT INTO lis.patients(patient_id, source_subject_id, display_label)
VALUES ('A3-DEMO-P1', 'A3-DEMO-P1', 'Synthetic patient');
INSERT INTO lis.test_catalog(test_code, test_name, fluid, category, accepted_units, catalog_version)
VALUES ('A3-DEMO-T1', 'Synthetic test', 'Blood', 'Chemistry', '["mg/dL"]', 'a3-demo');
INSERT INTO lis.results(result_id, patient_id, test_code, value_num, unit, reference_low,
                        effective_at, result_status)
VALUES
  ('A3-DEMO-R1', 'A3-DEMO-P1', 'A3-DEMO-T1', 3.4000, 'mg/dL', 1.2000,
   '2026-10-22T15:00:00.123456+07:00', 'FINAL'),
  ('A3-DEMO-R2', 'A3-DEMO-P1', 'A3-DEMO-T1', 3.4000, 'mg/dL', 1.2000,
   '2026-10-22T15:00:00.123456+07:00', 'READY');
COMMIT;
SQL
```

### Bước 3: Mở Swagger UI và xem danh sách kết quả

Mở trên trình duyệt: **http://127.0.0.1:33101/docs/api/**.
Nếu chạy LIS ở cổng mặc định `3101`, địa chỉ là http://127.0.0.1:3101/docs/api/.

Trang có 4 API LIS và hai mục kiểm tra `/health`, `/ready`. Trang vẫn mở được
khi chưa có database, nhưng muốn xem kết quả hoặc Publish thì cần làm các
bước chuẩn bị ở trên. Nếu server đang chạy từ trước khi thêm Swagger, hãy
khởi động lại. Bản Docker cũ cần build lại trước khi có trang này.

Để xem kết quả:

1. Mở nhóm **Kết quả xét nghiệm**.
2. Chọn `GET /api/results`, bấm **Try it out**.
3. Giữ bộ lọc trống, giữ `limit = 20` và `offset = 0`.
4. Bấm **Execute**.
5. Xem phần **Server response**: mong đợi mã `200` và danh sách có hai kết quả giả.

Muốn xem riêng R1, chọn `GET /api/results/{resultId}`, bấm **Try it out**,
nhập `A3-DEMO-R1` vào ô `resultId`, rồi **Execute**.

### Bước 4: Publish lần đầu rồi Publish lại

1. Mở nhóm **Publish**, chọn `POST /api/results/{resultId}/publish`.
2. Bấm **Try it out**.
3. Nhập `A3-DEMO-R1` vào ô `resultId`. Không cần nhập body JSON.
4. Bấm **Execute**.

Lần đầu mong đợi mã `202`, ví dụ:

```json
{
  "event_id": "00000000-0000-4000-8000-000000000001",
  "result_id": "A3-DEMO-R1",
  "dispatch_status": "PENDING",
  "exchange_id": null
}
```

Mã `event_id` thật do hệ thống tự tạo, không nhất thiết giống ví dụ. Sao chép
mã thật ở phần **Response body** để dùng bước sau.

Bấm **Execute** lần nữa với cùng R1: mong đợi mã `200`, cùng `event_id`
và trạng thái cũ. `PENDING` vẫn chỉ có nghĩa là đang chờ gửi.

### Bước 5: Xem sự kiện đã lưu

1. Chọn `GET /api/publish-events/{eventId}`, bấm **Try it out**.
2. Dán `event_id` thật vừa sao chép vào ô `eventId`.
3. Bấm **Execute**.

Mong đợi mã `200`. API trả trạng thái, số lần gửi và lỗi gần nhất. Chưa gửi
thì số lần gửi là 0, các trường lỗi là `null`.

### Bước 6: Thử trường hợp chưa hợp lệ

Ở API Publish, đổi `resultId` thành `A3-DEMO-R2` rồi bấm **Execute**.
Vì R2 còn READY, mong đợi mã `422`:

```json
{"error":{"code":"RESULT_NOT_READY","message":"Only FINAL results can be published"}}
```

Thông báo này nghĩa là: chỉ kết quả đã FINAL mới được Publish.
Đổi `resultId` thành `does-not-exist` thì mong đợi `404`.

Swagger có thể chặn ngay những giá trị sai định dạng trước khi gửi, ví dụ
mã sự kiện không phải UUID hoặc `limit` vượt 100. Nếu bị chặn, chưa có phản
hồi HTTP từ server. Muốn xem trực tiếp lỗi `400` của server thì có thể dùng:

```bash
curl -i 'http://127.0.0.1:33101/api/results?limit=101'
```

Giao diện gọi đúng server đang mở, không cố định cổng. Nút **Execute** gửi
thật vào database mà LIS đang kết nối, vì vậy hướng dẫn này dùng database giả.

### Bước 7: Dừng môi trường thử

Nhấn Ctrl+C ở terminal thứ nhất để dừng server. Sau đó chạy ở terminal thứ hai:

```bash
docker stop lis-a1-test
```

Container được tạo với `--rm` nên dữ liệu giả cũng được bỏ đi. Muốn chạy lại
test tự động thì tạo lại database theo A1. Không cần xóa volume của dự án.

## Kết quả đã được kiểm tra trước đó

| Kiểm tra | Kết quả |
|---|---|
| `npm run check` | Thành công |
| `npm run build` | Thành công |
| Toàn bộ test A1–A3 | 70 pass, 0 fail, 0 skip |
| `npm run smoke` | 3 PASS |

Lần kiểm tra A3 dùng PostgreSQL 17 riêng, tên container `lis-a3-verification`,
port `55468`, tài khoản `lis_app`. Port đó khác ví dụ `55466` để tách khỏi
môi trường có sẵn. Các server smoke dùng bản build lúc đó, cổng 33101–33103.
Dữ liệu test đã được dọn sạch, server tạm và container test đã dừng.

Các mốc trên là kết quả khi hoàn thành A3 ban đầu. Sau khi thêm Swagger UI,
đã chạy lại `check`, `build` và toàn bộ test: **79 pass, 0 fail, 0 skip**.
Đợt này dùng PostgreSQL riêng ở cổng `55469` và LIS tạm ở `33301` để kiểm tra
mô tả API cùng luồng Publish với dữ liệu giả. Phiên làm việc không có trình
duyệt được kết nối để bấm trực tiếp; trang, file giao diện và lời gọi API được
kiểm tra qua HTTP. Server tạm và container của đợt thử Swagger cũng đã được
dừng; database giả được xóa cùng container.

## Những file chính của A3

- [controller.ts](../backend/src/lis/controller.ts): nhận yêu cầu và trả JSON.
- [repository.ts](../backend/src/lis/repository.ts): đọc thêm thời gian đầy đủ
  cho API xem kết quả, dùng lại cách đọc đã có ở A2.
- [controller.http.test.ts](../backend/tests/lis/controller.http.test.ts): thử
  HTTP với các trường hợp dữ liệu và lỗi được chuẩn bị sẵn.
- [controller.integration.test.ts](../backend/tests/lis/controller.integration.test.ts):
  thử HTTP qua Service/Repository tới PostgreSQL thật.
- [http-test-helpers.ts](../backend/tests/lis/http-test-helpers.ts): mở và đóng
  server test, đọc phản hồi JSON.

Khi thêm Swagger UI, có thêm:

- [api-docs.ts](../backend/src/lis/api-docs.ts): mở trang `/docs/api/` và phục vụ giao diện.
- [openapi.ts](../backend/src/lis/openapi.ts): mô tả sáu API LIS đang có.
- [api-docs.http.test.ts](../backend/tests/lis/api-docs.http.test.ts): kiểm tra trang và cấu hình API.
- `backend/src/lis/main.ts`: đăng ký trang Swagger khi khởi động LIS.
- `backend/package.json` và `backend/package-lock.json`: thư viện Swagger UI và kiểu TypeScript.

README, API contract và tài liệu kiến trúc cũng đã được cập nhật khi làm A3.
Hiện chưa có phần gửi sang Middleware, nhận ACK, chuyển FHIR hoặc lưu ở EMR.
Vì vậy, test pass ở LIS chưa chứng minh toàn bộ luồng LIS → Middleware → EMR
đã hoạt động.
