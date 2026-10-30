# SPP-66 A2 — Kiểm tra và chốt kết quả để gửi sau

A2 quyết định một kết quả xét nghiệm **có được Publish hay không**. Phần này
nằm trong `backend/src/lis/service.ts`, gọi là Service.

**Publish là chốt và lưu một bản sao kết quả để gửi sau.** Nó chưa gửi dữ liệu
sang Middleware hoặc EMR. A3 đã thêm các API để gọi chức năng này qua HTTP.

## Hệ thống làm gì khi nhận yêu cầu Publish?

1. **Kiểm tra đã Publish chưa.** Nếu có rồi, trả lại sự kiện cũ ngay.
2. **Tìm kết quả và giữ dữ liệu ổn định.** Tránh có người sửa kết quả hoặc danh
   mục xét nghiệm trong lúc hệ thống đang kiểm tra và lưu. Không tìm thấy thì
   báo không có kết quả.
3. **Kiểm tra dữ liệu.** Kết quả phải là `FINAL`, đủ thông tin, đúng đơn vị và
   có số liệu, thời gian hợp lệ.
4. **Tạo bản sao nội dung.** Ghi lại đúng thông tin xét nghiệm tại lúc Publish.
5. **Tạo mã sự kiện và mã kiểm tra nội dung**, rồi nhờ Repository lưu cùng
   thời điểm Publish và trạng thái `PENDING` — đang chờ gửi.
6. **Lưu xong mới báo thành công.** Nếu lưu lỗi thì báo lỗi, không giữ bản dở dang.

Nếu nhiều yêu cầu Publish đến cùng lúc, mỗi kết quả vẫn chỉ có **một sự kiện**.
Các yêu cầu còn lại nhận cùng sự kiện đó.

## Những dữ liệu nào được kiểm tra?

- Trạng thái phải là `FINAL`; `READY` chưa được Publish.
- Mã kết quả, mã bệnh nhân, mã xét nghiệm và tên xét nghiệm phải có nội dung.
- Bệnh nhân và xét nghiệm phải khớp với kết quả đang xử lý.
- Đơn vị phải có trong danh sách đơn vị của xét nghiệm. Ví dụ danh mục cho
  `mg/dL` thì không tự coi `g/dL` hoặc `mg/dl` là giống nhau.
- Số liệu phải chuyển được sang dạng dùng trong gói gửi mà không mất giá trị.
- Cận tham chiếu có thể thiếu một hoặc cả hai bên. Nếu có cả hai thì cận dưới
  không được lớn hơn cận trên. Cận thiếu được ghi là `null`.
- Thời gian phải là thời điểm hợp lệ mà hệ thống có thể ghi đầy đủ.

Không tự đặt thêm điều kiện như số phải dương hoặc kết quả phải nằm trong
khoảng tham chiếu.

## Bản sao đã lưu dùng để làm gì?

Trong code, bản sao được gọi là `source_snapshot`. Nó giữ mã kết quả, mã bệnh
nhân, thông tin xét nghiệm, giá trị, đơn vị, cận tham chiếu, thời gian và trạng thái.

Sau khi Publish, bản sao này được **giữ nguyên**. Nếu dữ liệu nguồn bị sửa,
Publish lại vẫn trả bản đã chốt trước đó, không tạo nội dung mới. Trạng thái
gửi cũ cũng không bị đặt lại thành `PENDING`.

Điều này giúp các lần gửi lại sau này luôn dùng cùng một nội dung. Tên nguồn
gửi hiện được đặt là `lis-demo`.

## Hash là gì, tại sao cần nó?

`source_hash` là mã kiểm tra được tính từ nội dung bản sao bằng SHA-256.
Nó giúp bên nhận đối chiếu nội dung đã Publish. Đây không phải mã sự kiện và
không thay thế việc kiểm tra nội dung thật.

Trước khi tính hash, hệ thống viết JSON theo một cách thống nhất:

- Sắp tên trường theo thứ tự chữ, kể cả các nhóm nằm bên trong.
- Giữ nguyên thứ tự phần tử trong danh sách.
- Không thêm khoảng trắng ngoài phần chữ của dữ liệu.

Ví dụ `{"b":2,"a":1}` và `{"a":1,"b":2}` được viết cùng thành
`{"a":1,"b":2}`, nên cho cùng một hash. Các dịch vụ sau này cần dùng cùng quy
ước này khi kiểm tra gói gửi.

## Vì sao phải cẩn thận với số và thời gian?

**Với số:** database có thể lưu số chính xác hơn JavaScript. Service kiểm tra
trước và sau khi chuyển đổi; nếu giá trị bị đổi thì từ chối Publish.

| Ví dụ | Cách xử lý |
|---|---|
| `3.4000` thành `3.4` | Chấp nhận vì giá trị không đổi. |
| Số âm như `-2.5` | Chấp nhận nếu các thông tin khác hợp lệ. |
| `9007199254740993` bị đổi khi chuyển sang số JavaScript | Từ chối, không tự làm tròn rồi gửi. |
| Số quá lớn, quá nhỏ hoặc không hữu hạn | Từ chối nếu không thể giữ đúng giá trị. |

Quy tắc này áp dụng cả giá trị xét nghiệm và hai cận tham chiếu. Hiện chưa hỗ
trợ mọi số rất dài mà PostgreSQL cho phép lưu.

**Với thời gian:** hệ thống đổi cách ghi sang giờ UTC nhưng giữ nguyên thời
điểm, không bỏ các chữ số sau giây. Ví dụ:

```text
Dữ liệu nguồn: 2026-10-22T15:00:00.123456+07:00
Bản sao lưu:  2026-10-22T08:00:00.123456Z
```

Đó vẫn là cùng một thời điểm. Hệ thống hiện hỗ trợ năm UTC từ 0001 đến 9999.

## Vì sao A2 sửa thêm file Repository của A1?

A1 đã đọc và lưu được dữ liệu, nhưng A2 cần giữ dữ liệu không bị sửa trong
suốt lúc kiểm tra và chuẩn bị bản sao. A2 cũng cần đọc đầy đủ thời gian mà
cách dùng `Date` trước đó có thể làm mất một phần rất nhỏ sau giây.

Hai phần này **đã được bổ sung và kiểm thử**. Đây không phải lỗi còn bỏ mặc
khiến A2 không chạy được. Service vẫn nhờ Repository làm mọi việc với database;
Service không tự viết câu lệnh SQL.

## Kết quả trả về cho A3

Hàm `publishResult(resultId)` trả một trong bốn trường hợp:

| Kết quả trong code | Ý nghĩa | HTTP mà A3 trả |
|---|---|---|
| `created` | Vừa lưu một sự kiện mới | `202` |
| `existing` | Đã có sự kiện, dùng lại bản cũ | `200` |
| `not_found` | Không tìm thấy kết quả | `404` |
| `invalid` | Kết quả chưa đủ điều kiện Publish | `422` |

Nếu lỗi ở bước làm việc với database, lỗi đó được báo riêng; A3 trả `503`,
không báo nhầm là Publish thành công.

## Cách chạy kiểm thử

1. Tạo database test theo [hướng dẫn Docker ở A1](spp-66-a1-review.md#kiểm-thử-a1-bằng-postgresql-riêng-trong-docker).
2. Đảm bảo terminal đang ở `backend/`. Nếu đang ở thư mục gốc thì chạy
   `cd backend`; nếu đã ở `backend/` thì giữ nguyên.
3. Chạy:

```bash
npm run check
npm run build
LIS_REPOSITORY_TEST_DATABASE_URL='postgresql://lis_app:lis123@127.0.0.1:55466/dacn_db' npm test
```

Mong đợi **79 pass, 0 fail, 0 skip** vì lệnh hiện chạy A1, A2, A3 và trang Swagger UI.
Không cần tự bật server; test tự chuẩn bị dữ liệu và mở server khi cần.

Riêng các test A2 kiểm tra Publish mới/lặp, kết quả không có, READY, đơn vị
sai, cận thiếu, cách giữ số và thời gian, nhiều Publish cùng lúc và lỗi lưu.
Có cả trường hợp dữ liệu đang bị sửa để xác nhận hệ thống chờ rồi kiểm tra
bản mới nhất. Database trong các test là PostgreSQL thật, dữ liệu đều là giả.

Khi hoàn thành riêng A2 trước đây, kết quả là **40 pass, 0 fail, 0 skip**;
`check` và `build` cũng thành công. Tổng hiện tại là 79 sau khi thêm A3 và
Swagger UI, không phải 79 test chỉ dành cho Service.

## Những file cần xem

- [service.ts](../backend/src/lis/service.ts): luồng Publish và kiểm tra dữ liệu.
- [canonical-json.ts](../backend/src/lis/canonical-json.ts): cách viết JSON thống
  nhất và tính hash.
- [repository.ts](../backend/src/lis/repository.ts): đọc và lưu khi dữ liệu đang
  được giữ ổn định.
- [service.integration.test.ts](../backend/tests/lis/service.integration.test.ts)
  và [canonical-json.test.ts](../backend/tests/lis/canonical-json.test.ts): các test A2.

A3 đã nối phần này với HTTP; xem [hướng dẫn A3](spp-66-a3-review.md). Phần gửi
sang Middleware, nhận ACK, thử gửi lại khi lỗi, chuyển FHIR và lưu ở EMR vẫn
chưa được triển khai.
