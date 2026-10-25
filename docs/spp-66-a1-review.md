# SPP-66 A1 — Đọc và lưu dữ liệu xét nghiệm

A1 xây phần làm việc với database. Trong mã nguồn, phần này gọi là
**Repository**, nằm trong `backend/src/lis/repository.ts`.

Nó giúp hệ thống tìm kết quả xét nghiệm, lọc danh sách và lưu yêu cầu Publish.
**Publish nghĩa là chốt và lưu lại kết quả để gửi sau**, chưa phải đã gửi thành công.

Ba bước liên quan với nhau như sau:

| Bước | Công việc |
|---|---|
| A1 — Repository | Đọc và lưu dữ liệu trong database. |
| [A2 — Service](spp-66-a2-review.md) | Kiểm tra kết quả có được Publish hay không. |
| [A3 — Controller](spp-66-a3-review.md) | Nhận yêu cầu HTTP và trả kết quả cho người gọi. |

Hiện cả ba bước đã được làm. Phần gửi sang Middleware và EMR vẫn chưa có.

## A1 có những chức năng gì?

| Hàm trong code | Công dụng |
|---|---|
| `getResultById` | Tìm một kết quả, kèm thông tin bệnh nhân và xét nghiệm. |
| `listResults` | Lọc theo bệnh nhân, mã xét nghiệm, trạng thái; lấy từng trang kết quả. |
| `getPublishEventByResultId` | Kiểm tra một kết quả đã được Publish chưa. |
| `getPublishEventByEventId` | Tìm sự kiện Publish theo mã sự kiện. |
| `createPublishEvent` | Lưu sự kiện mới hoặc trả lại sự kiện đã có. |

Không tìm thấy bản ghi thì hàm tìm chi tiết trả `undefined`. Danh sách không
có kết quả thì trả mảng rỗng `[]`.

Khi lưu Publish, hàm trả `{ event, created }`: `event` là bản ghi đã lưu,
`created` cho biết vừa tạo mới (`true`) hay dùng lại bản cũ (`false`).

## A1 lưu Publish như thế nào?

Một sự kiện Publish chứa mã sự kiện, mã kết quả, bản sao nội dung xét nghiệm,
mã kiểm tra nội dung, thời điểm Publish và trạng thái ban đầu `PENDING` — chờ gửi.

Các thông tin này được lưu cùng một lần. Nếu việc lưu thất bại, hệ thống báo
lỗi và không giữ lại bản lưu dở dang.

Mỗi kết quả chỉ được có một sự kiện Publish. Vì vậy, khi bấm Publish lại hoặc
có nhiều yêu cầu đến cùng lúc, hệ thống trả lại sự kiện đã lưu. Nó không thay
mã sự kiện, nội dung, thời điểm Publish hoặc trạng thái gửi cũ.

Lỗi lưu khác, chẳng hạn mã sự kiện bị trùng với một kết quả khác, vẫn được báo
lỗi; không bị coi nhầm là Publish lại.

## Vì sao file Repository còn được sửa ở A2 và A3?

Khi làm tiếp, có hai yêu cầu cần bổ sung:

- **Giữ dữ liệu ổn định lúc Publish.** Tránh kết quả hoặc danh mục xét nghiệm
  bị sửa giữa lúc hệ thống đang kiểm tra và lưu bản sao.
- **Giữ đầy đủ thời gian xét nghiệm.** Tránh mất một phần chữ số sau giây khi
  đọc dữ liệu và trả kết quả ra HTTP.

A2 thêm `withPublishTransaction` để giữ dữ liệu ổn định trong lúc xử lý. A3
cho các API xem kết quả dùng chung cách đọc thời gian đầy đủ đó. Năm hàm A1
ở trên vẫn được giữ; phần giải thích cụ thể nằm trong tài liệu A2 và A3.

## Những file chính của A1

- [repository.ts](../backend/src/lis/repository.ts): các hàm đọc/lưu dữ liệu.
- [repository.integration.test.ts](../backend/tests/lis/repository.integration.test.ts):
  thử các hàm với PostgreSQL thật và dữ liệu giả.
- [repository.unconfigured.test.ts](../backend/tests/lis/repository.unconfigured.test.ts):
  kiểm tra khi chưa cấu hình kết nối database.
- `backend/package.json` và `backend/tsconfig.test.json`: lệnh chạy test và
  kiểm tra TypeScript của cả mã nguồn lẫn test.

## Kiểm thử A1 bằng PostgreSQL riêng trong Docker

**Phần này dùng chung cho A1, A2 và A3.** Lệnh `npm test` hiện chạy cả ba bước và kiểm tra trang Swagger UI.
Database là PostgreSQL thật; dữ liệu bệnh nhân và xét nghiệm trong test đều
là giả. Test tự thêm rồi dọn dữ liệu, không cần nhập dataset.

Cần Docker đang chạy, Node.js từ 22.16.0 trở lên và các thư viện backend đã
được cài. Nếu chưa cài thư viện, chạy `npm ci` trong `backend/`.

### Bước 1: Vào thư mục backend

Nếu terminal đang ở thư mục gốc `lis-fhir-emr/`, chạy:

```bash
cd backend
```

Nếu đã ở `lis-fhir-emr/backend/`, bỏ qua lệnh trên. Các lệnh bên dưới đều chạy
ở `backend/`. Kiểm tra vị trí và hai file SQL:

```bash
pwd
ls -l package.json ../database/dacn_db_init_v2.sql ../database/access_roles.sql
```

`pwd` phải kết thúc bằng `/lis-fhir-emr/backend`. Hai đường dẫn SQL phải trỏ
tới file, không phải thư mục.

### Bước 2: Tạo database test

Nếu đã có container `lis-a1-test` đang chạy và các bảng LIS trống, có thể dùng
lại, chuyển sang bước 3. Nếu chưa có, chạy:

```bash
docker run --detach --rm \
  --name lis-a1-test \
  --publish 127.0.0.1:55466:5432 \
  --env POSTGRES_DB=dacn_db \
  --env POSTGRES_PASSWORD=a1-test-admin \
  --mount "type=bind,src=$PWD/../database/dacn_db_init_v2.sql,dst=/docker-entrypoint-initdb.d/01-schema.sql,readonly" \
  --mount "type=bind,src=$PWD/../database/access_roles.sql,dst=/docker-entrypoint-initdb.d/02-roles.sql,readonly" \
  postgres:17
```

Lệnh này tạo PostgreSQL riêng và dùng hai file SQL có sẵn để tạo bảng,
tài khoản. Nó không dùng dữ liệu hoặc volume của database dự án.

### Bước 3: Chờ database chạy xong

Sau vài giây, chạy:

```bash
docker ps --filter name=lis-a1-test
docker exec lis-a1-test pg_isready -h 127.0.0.1 -U postgres -d dacn_db
```

Khi thấy `accepting connections` thì tiếp tục. Nếu chưa thấy, chờ một chút
rồi kiểm tra lại. Nếu báo `No such container`, xem phần lỗi thường gặp bên dưới.

### Bước 4: Đặt mật khẩu tài khoản LIS

```bash
docker exec lis-a1-test \
  psql -U postgres -d dacn_db -v ON_ERROR_STOP=1 \
  -c "ALTER ROLE lis_app WITH LOGIN PASSWORD 'lis123';"
```

Mong đợi dòng `ALTER ROLE`. Mật khẩu này chỉ dành cho database test, không cần
sửa `.env` của dự án. Mật khẩu `a1-test-admin` ở bước 2 dành cho tài khoản
quản trị `postgres`, còn `lis123` dành cho tài khoản ứng dụng `lis_app`.

### Bước 5: Chạy kiểm tra

Vẫn ở `backend/`, chạy lần lượt:

```bash
npm run check
npm run build
LIS_REPOSITORY_TEST_DATABASE_URL='postgresql://lis_app:lis123@127.0.0.1:55466/dacn_db' npm test
```

| Lệnh | Nó kiểm tra gì? |
|---|---|
| `npm run check` | Mã nguồn và test có đúng các yêu cầu TypeScript không. |
| `npm run build` | Mã nguồn có biên dịch được không. |
| Lệnh `npm test` có URL ở trên | Chạy các tình huống thử A1, A2 và A3. |

Không cần tự bật server LIS cho bước này. Test HTTP tự mở rồi đóng server
riêng. Các bảng LIS phải trống trước khi test bắt đầu.

Kết quả mong đợi với bộ test hiện tại:

```text
tests 79
pass 79
fail 0
cancelled 0
skipped 0
```

`skipped 0` nghĩa là không có nhóm test nào bị bỏ qua. Nếu chỉ chạy `npm test`
mà thiếu URL, các test cần PostgreSQL sẽ bị bỏ qua.

### Bước 6: Chạy lại hoặc dọn database test

Khi container còn chạy và lần test trước đã dọn dữ liệu xong, chạy lại lệnh
`npm test` có URL như bước 5. Cần ghi lại URL mỗi lần vì nó chỉ áp dụng cho
lệnh đứng ngay sau nó. Không chạy hai bộ test cùng lúc trên database này.

Khi không dùng nữa:

```bash
docker stop lis-a1-test
```

Vì đã dùng `--rm`, Docker tự xóa container và dữ liệu test khi dừng. Lần sau
muốn test thì tạo lại từ bước 2. Không cần xóa volume của dự án.

### Xử lý các lỗi thường gặp

| Lỗi | Cách xử lý |
|---|---|
| Npm không thấy `lis-fhir-emr/package.json` | Đang ở thư mục gốc. Chạy `cd backend` rồi thử lại. |
| Dùng port `3101` và kết nối bị ngắt | `3101` là HTTP, không phải database. URL test phải dùng `55466`. |
| Đường dẫn SQL sai | Từ `backend/`, dùng `../database/`, không dùng `database/`. |
| `No such container: lis-a1-test` | Container đã thoát và bị xóa. Kiểm tra đường dẫn SQL rồi tạo lại. |
| Tên container hoặc port đã được dùng | Kiểm tra `docker ps -a --filter name=lis-a1-test`; có thể container test cũ vẫn chạy. |
| Sai mật khẩu `lis_app` | Chạy lại bước 4 và kiểm tra URL ở bước 5. |
| Test yêu cầu database trống | Có thể còn dữ liệu sau lần thử tay hoặc test bị ngắt. Dừng container test này rồi tạo lại. |
| Cảnh báo `DEP0205` | Xem kết quả pass/fail phía dưới; cảnh báo này từ công cụ chạy TypeScript, không tự làm test thất bại. |

Nếu cần xem vì sao container thoát, tạo lại bằng lệnh bước 2 nhưng bỏ riêng
`--rm`, rồi chạy `docker logs lis-a1-test`. Container tạo theo cách này không tự
xóa khi dừng; có thể xóa riêng container test đã dừng bằng `docker rm lis-a1-test`.

Trước đây, dùng nhầm `-v "$PWD/database/..."` trong `backend/` có thể khiến
Docker tạo các thư mục mang tên `.sql`. Hướng dẫn hiện dùng `--mount` để báo
lỗi ngay khi đường dẫn không tồn tại.

## Test pass cho biết điều gì?

Riêng A1 đã được thử các việc: đọc/lọc/phân trang, tìm bản ghi không tồn tại,
lưu Publish, Publish lặp hoặc đồng thời, giữ nguyên sự kiện cũ và xử lý lỗi lưu.
Nó chưa chứng minh việc gửi kết quả sang Middleware hay EMR đã hoạt động.

Các kết quả đã ghi nhận khi triển khai từng bước:

| Thời điểm | Kết quả công cụ test báo |
|---|---|
| Hoàn thành A1 | 16 pass, 0 fail, 0 skip |
| Hoàn thành A2 | 40 pass, 0 fail, 0 skip |
| Hoàn thành A3 | 70 pass, 0 fail, 0 skip |
| Thêm giao diện Swagger UI | 79 pass, 0 fail, 0 skip |

Đây là các mốc đã ghi nhận khi triển khai. Tổng test tăng khi thêm chức năng;
bộ hiện tại gồm cả Swagger UI. `check` và `build` cũng đã thành công.

Các lần test dùng PostgreSQL 17 như cấu hình Compose. Đầu file SQL có ghi
PostgreSQL 18 và nêu tương thích các phiên bản gần đây; chưa đổi SQL hay
phiên bản database vì việc viết lại tài liệu này.
