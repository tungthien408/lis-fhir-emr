# SPP-66 D2 — LIS Dispatcher Worker

D2 thêm chương trình tự lấy những yêu cầu Publish đang chờ và gửi qua HTTP
sang Middleware. Sau khi nhận xác nhận hợp lệ, nó dùng Repository D1 để lưu
`ACK`. Bạn phải bật chương trình này riêng; chạy API LIS chưa tự bật Dispatcher.

Tài liệu này ghi nhận phạm vi tại thời điểm D2: không thay đổi DDL, luồng
Publish A1–A3 hoặc nghiệp vụ Middleware/EMR. Kiểm thử toàn luồng được bổ sung
sau đó ở [D3](spp-66-d3-review.md); các số test D2 bên dưới là kết quả lịch sử.

## 1. Kiểm tra trước khi làm

Đã đọc working tree, API contract, kiến trúc, schema LIS, các hàm/test D1,
Service Publish, cách tạo hash, các main và cách chạy Middleware Worker.

- D1 đã có đủ: nhận việc bằng lease, bắt đầu lượt thử, ghi mốc gửi,
  kết thúc lượt thử cùng trạng thái sự kiện, lấy lịch sử. Không cần sửa D1.
- A2 đã lưu snapshot, hash, UUID và thời điểm Publish. Dispatcher dùng những
  giá trị đó, không đọc lại `lis.results` để dựng request.
- Middleware B3 chỉ trả `202` sau khi lưu. Gửi lại cùng gói nhận được
  `exchange_id` cũ. D2 kiểm tra đủ sáu trường xác nhận theo hợp đồng này.
- Contract đã nói lỗi dữ liệu không tự thử lại, lỗi tạm thời được thử có giới
  hạn. Việc chọn cụ thể `BLOCKED` hay `FAILED` cho LIS được bổ sung ở mục 4.
- Không thấy lỗi D1 chặn D2. Các thay đổi có sẵn từ C1–C4/D1 được giữ lại.

## 2. Dispatcher làm gì từ đầu tới cuối?

Ví dụ bạn Publish kết quả R1:

1. LIS lưu một sự kiện E1, trạng thái `PENDING`: “có việc đang chờ gửi”.
2. Dispatcher nhận E1 và được giữ quyền xử lý trong một khoảng thời gian.
3. D1 ghi lượt thử số 1. Dispatcher lấy nguyên sáu trường đã lưu để dựng gói:
   `event_id`, `source_system`, `source_result_id` lấy từ `result_id`,
   `source_snapshot`, `source_hash`, `published_at`.
4. D1 ghi mốc chuẩn bị gửi. Dispatcher gọi `POST /api/exchanges` với
   `Content-Type: application/json`.
5. Dispatcher kiểm tra mã HTTP và nội dung phản hồi.
6. Nếu đúng, D1 lưu kết quả lượt thử, `exchange_id`, `ack_response`,
   `acked_at` và `ACK` trong cùng một lần lưu hoàn chỉnh.

`sent_at` là mốc **chuẩn bị gọi HTTP**, không phải bằng chứng Middleware đã nhận.
Chương trình có thể bị tắt ngay sau mốc này.

Snapshot và hash không đổi khi gửi lại. D2 tính lại hash chỉ để phát hiện dữ
liệu lưu bị hỏng; không thay hash, sửa snapshot hay lấy dữ liệu nguồn mới.
`published_at` dùng thời điểm A2 đã lưu, không dùng thời điểm gửi. A2 tạo mốc
này bằng JavaScript `Date`, đến millisecond; chuỗi thời gian xét nghiệm bên
trong snapshot vẫn giữ nguyên microsecond.

## 3. `runOnce` và việc lưu database khác gửi HTTP thế nào?

`runOnce()` nghĩa là **xử lý tối đa một sự kiện, gửi tối đa một lần rồi trả về**.
Nếu chưa có việc đến hạn thì trả `idle`. Nó không ngồi chờ đến lượt thử tiếp theo.

Kết quả trả về:

| Kết quả | Ý nghĩa |
|---|---|
| `idle` | Không có việc phù hợp, hoặc đã được yêu cầu dừng từ trước |
| `acknowledged` | Đã nhận xác nhận hợp lệ **và D1 đã commit ACK** |
| `retry_wait` | Đã lưu thời điểm thử lại |
| `blocked` | Đã lưu trạng thái cần kiểm tra dữ liệu/cấu hình |
| `failed` | Đã lưu trạng thái thất bại hoặc xác nhận hết lượt thử |
| `not_completed` | Chưa hoàn tất, chẳng hạn hết quyền xử lý hoặc đang dừng |

Lỗi database được trả lên bên gọi, không biến thành “đã nhận”. Hàm `run()`
là vòng chạy liên tục: gọi `runOnce`, nghỉ theo `pollMs`, rồi làm tiếp. Nó cũng
nghỉ khi gặp lỗi hoặc mất quyền xử lý, tránh hỏi database liên tục không nghỉ.

**Lưu database** là sửa sổ theo dõi của LIS. **Gửi HTTP** là chuyển gói sang
Middleware. Hai việc này không thể gộp thành một lần lưu chung: Middleware có
thể đã nhận nhưng LIS chưa kịp ghi ACK. Vì vậy D2 lưu lượt thử trước khi gửi,
rồi lưu kết quả sau khi nhận phản hồi. Không giữ transaction database suốt
thời gian chờ mạng.

## 4. Vì sao HTTP `202` chưa đủ? Khi lỗi thì xử lý ra sao?

`202` giống như câu “đã nhận”. LIS còn cần biết **đã nhận đúng gói nào**.
Chỉ ghi ACK khi:

- `accepted` đúng bằng `true`.
- `event_id`, `source_system`, `source_result_id`, `source_hash` khớp gói đã gửi.
- `exchange_id` có dạng UUID hợp lệ.

UUID so không phân biệt chữ hoa/thường theo quy ước dự án; các chuỗi định danh
nguồn và hash phải khớp chính xác. Receipt lưu đúng sáu trường này, bỏ trường
thừa. Phản hồi `202` phải là JSON, được đọc đầy đủ, tối đa 64 KiB. HTTP timeout
bao gồm cả chờ header và đọc body. Dispatcher không đi theo redirect.

| Tình huống | Cách xử lý | Mã lỗi lưu |
|---|---|---|
| Mất kết nối, mất phản hồi | `RETRY_WAIT`; hết lượt → `FAILED` | `NETWORK_ERROR` |
| Quá thời gian chờ, kể cả body `202` chưa đọc xong | `RETRY_WAIT`; hết lượt → `FAILED` | `HTTP_TIMEOUT` |
| HTTP `408`, `429`, `5xx` | `RETRY_WAIT`; hết lượt → `FAILED` | `HTTP_TEMPORARY` |
| HTTP `409` xung đột | `BLOCKED`, không tự gửi lại | `DUPLICATE_CONFLICT` |
| HTTP `400`, `413`, `415`, `422` | `BLOCKED`, không tự gửi lại | `REMOTE_VALIDATION_ERROR` |
| HTTP `4xx` khác, như `401/403/404` | `BLOCKED`, cần kiểm tra cấu hình/quyền/đường dẫn | `HTTP_PERMANENT` |
| `202` nhưng JSON/kiểu dữ liệu/UUID sai hoặc thiếu | `FAILED`, không ghi ACK | `INVALID_ACK` |
| `202` nhưng định danh/hash không khớp | `FAILED`, không ghi ACK | `INVALID_ACK` |
| Mã khác như `200/201/204/3xx` | `FAILED`, không ghi ACK | `HTTP_PERMANENT` |
| Gói lưu không dựng được, hash sai hoặc vượt 1 MiB | `BLOCKED`, không gửi HTTP | `VALIDATION_ERROR` |

**Quyết định bổ sung của D2:** `BLOCKED` dành cho yêu cầu bị từ chối hoặc cấu
hình cần người kiểm tra; `FAILED` dành cho hết lượt hoặc phản hồi sai hợp đồng.
Đây là cách dùng các trạng thái đã có, không thêm trạng thái vào DDL. `429`
dùng lịch chờ cấu hình giống Worker; D2 chưa diễn giải `Retry-After`.

Mã không chuẩn ngoài 100–599, ví dụ `600`, cũng dừng ở `FAILED`. Lịch sử chỉ
lưu `HTTP_PERMANENT`, để cột HTTP là `null` vì DDL không cho lưu mã ngoài khoảng
này; không biến phản hồi lạ thành lỗi ghi database.

Lượt cuối thất bại giữ nguyên mã nguyên nhân, ví dụ `HTTP_TIMEOUT`; số lượt
đã dùng bằng giới hạn. Nếu chương trình bị tắt ở lượt cuối, D1 phục hồi và ghi
`RETRY_EXHAUSTED` mà không gửi thêm. Các lượt đã bắt đầu đều tính vào giới hạn,
kể cả lượt bị gián đoạn. `FAILED` không khẳng định Middleware chưa từng nhận.

## 5. Mất phản hồi mà gửi lại có bị trùng không?

Ví dụ Middleware đã lưu E1 thành giao dịch X1, nhưng mạng đứt trước khi LIS
đọc được phản hồi:

1. LIS chưa có bằng chứng nên chưa ghi ACK; lưu lịch thử lại.
2. Đến hạn, LIS gửi lại **cùng E1, cùng snapshot, hash và thời điểm Publish**.
3. Middleware nhận ra gói đã có, trả `202` cùng mã X1 cũ.
4. LIS kiểm tra phản hồi rồi lưu ACK với X1.

D2 không tự tạo mã sự kiện mới cho lượt thử. Bài test mất phản hồi xác nhận
hai request giống hệt nhau và phía giả lập chỉ có một giao dịch.

## 6. ACK khác DELIVERED; lease giúp gì?

**ACK:** Middleware đã nhận và lưu gói. **DELIVERED:** EMR đã lưu kết quả,
Middleware đã đọc lại và đối chiếu đúng. Dispatcher D2 chỉ làm tới ACK; nó
không hỏi EMR và không ghi DELIVERED.

Lease có thể hiểu là **quyền giữ việc có hạn**. A nhận E1 thì có một mã quyền
riêng. Nếu A bị treo và hết hạn, B nhận E1 với mã mới. Lúc A tỉnh lại, dù cầm
phản hồi thành công hay lỗi, D1 cũng không cho A sửa trạng thái bằng mã cũ.

Lease bảo vệ việc ghi database. Nó không thu hồi được một request đã ra mạng.
Việc hai request cùng đến Middleware vẫn được xử lý bằng quy tắc gửi lại cùng
gói ở mục 5. Lượt cũ được ghi `LEASE_EXPIRED`; lượt mới tăng số thứ tự, không
đếm lại từ đầu.

Sơ đồ trạng thái đơn giản:

```text
PENDING ──nhận việc──> IN_FLIGHT ──xác nhận đúng + lưu xong──> ACK
                         │
                         ├──lỗi tạm thời, còn lượt──> RETRY_WAIT
                         │                              │
                         │<─────────đến hạn─────────────┘
                         ├──bị từ chối──────────────> BLOCKED
                         └──hết lượt / phản hồi sai──> FAILED

IN_FLIGHT hết lease → tiến trình mới nhận lại với mã quyền mới.
ACK, BLOCKED và FAILED không được tự nhận lại.
```

## 7. Cấu hình, bật và tắt

Các script dùng `.env` ở thư mục gốc như những dịch vụ hiện có. Giữ
`LIS_DATABASE_URL` của role `lis_app` trong môi trường hoặc `.env`; không đưa
thông tin kết nối vào tài liệu hay commit `.env`.

| Biến môi trường | Mặc định / yêu cầu |
|---|---|
| `MIDDLEWARE_BASE_URL` | Bắt buộc với lệnh npm; chỉ HTTP(S) origin, không chứa mật khẩu/path/query |
| `LIS_DISPATCHER_HTTP_TIMEOUT_MS` | `3000`; từ 1 đến 60000 ms |
| `LIS_DISPATCHER_LEASE_MS` | `15000`; ít nhất timeout + 1000 ms, tối đa 3600000 ms |
| `LIS_DISPATCHER_POLL_MS` | `1000`; từ 10 đến 60000 ms |
| `LIS_DISPATCHER_RETRY_DELAYS_MS` | `2000,4000,8000`; mỗi số từ 1 đến 86400000 ms |
| `LIS_DISPATCHER_MAX_ATTEMPTS` | Mặc định số khoảng chờ + 1, tức 4; giới hạn 1–100 |

Số khoảng chờ phải đúng bằng `maxAttempts - 1`; sai cấu hình thì chương trình
dừng lúc khởi động. Muốn chỉ gửi một lần: đặt max là `1` và chuỗi khoảng chờ
rỗng. Dùng cùng cấu hình giới hạn cho mọi Dispatcher và lần khởi động lại,
vì DDL lưu số lượt đã dùng nhưng không lưu chính sách giới hạn.

Chạy trên máy cá nhân, sau khi PostgreSQL và API Middleware đã sẵn sàng:

```bash
cd backend
MIDDLEWARE_BASE_URL=http://127.0.0.1:3102 npm run dev:lis-dispatcher

# Hoặc chạy bản đã biên dịch:
npm run build
MIDDLEWARE_BASE_URL=http://127.0.0.1:3102 npm run start:lis-dispatcher
```

Nếu đã đặt URL trong `.env`, không cần thêm URL trước lệnh. `Ctrl+C` hoặc
`SIGTERM` yêu cầu dừng: ngừng nhận việc, hủy HTTP đang chờ, đóng kết nối database.
Lượt bị ngắt được để lại cho lần chạy sau phục hồi khi lease hết hạn.

Compose có profile riêng `dispatcher`, không bật cùng `npm run dev` hay
Compose mặc định. Với môi trường Compose đã cấu hình theo dự án, chạy từ gốc repo:

```bash
docker compose build lis
docker compose --profile dispatcher up -d lis-dispatcher
docker compose --profile dispatcher stop lis-dispatcher
```

Compose dùng `http://middleware:3102` bên trong mạng Docker. Đổi đích Docker
bằng `DISPATCHER_MIDDLEWARE_BASE_URL`; biến này được đưa vào
`MIDDLEWARE_BASE_URL` của container, tránh dùng nhầm địa chỉ localhost của máy.
Compose mặc định max là `4`; khi sửa số khoảng chờ, đặt max tương ứng.
Không cần mở cổng riêng cho Dispatcher. D2 đã kiểm tra cấu hình Compose,
chưa khởi động profile này trên database phát triển.

## 8. Kiểm thử và bằng chứng

Test HTTP dùng server giả lập chạy trên localhost, kiểm tra request và lưu
receipt giả trong bộ nhớ, giữ `exchange_id` cũ khi gói giống nhau. Đây chưa phải
kiểm thử Dispatcher với Middleware thật. Phần database dùng **PostgreSQL 17
thật**, role `lis_app`, Repository D1 và Service Publish A2 thật.

Runner tạo container mới với database rỗng, mật khẩu ngẫu nhiên và dấu nhận
diện riêng; test kiểm tra dấu này trước khi nhận việc. Không dùng volume hoặc
database Compose. Fixture mang tiền tố `D2-SYNTHETIC`; chỉ dọn dữ liệu test.

**Nếu chạy `npm test` trực tiếp và thấy `skip`:** lệnh này không tự chuẩn bị
database test. Khi chưa có `LIS_REPOSITORY_TEST_DATABASE_URL`, nó vẫn chạy các
bài không cần PostgreSQL và bỏ qua 5 nhóm cần PostgreSQL: Controller, Repository,
Publish Service, Repository D1 và Dispatcher D2. Đây là điều kiện đã viết sẵn
trong test, để chúng không tự dùng database phát triển.

Đã chạy lại cách này và nhận đúng **84 đạt, 0 lỗi, 5 nhóm bỏ qua**, giống log
chạy tay. `skip` nghĩa là **chưa kiểm tra**, không phải đã đạt hoặc thất bại.
Mỗi nhóm còn có nhiều bài bên trong; khi cả nhóm chưa chạy, những bài đó cũng
chưa được liệt kê. Vì vậy tổng số 89 khác 173 ở bảng bên dưới.

Để chạy đầy đủ, mở Docker rồi chọn lệnh phù hợp, tại thư mục `backend`:

```bash
# Chỉ phần Dispatcher D1 và D2, có PostgreSQL test:
npm run test:lis-dispatch:postgres

# Toàn bộ LIS, Middleware, EMR, C4 và D3 hiện có, có PostgreSQL test:
npm run test:repositories:postgres
```

Các lệnh này cần Docker hoạt động và image `postgres:17` đã có trên máy. Chúng
tự chuẩn bị cấu hình kết nối test, chạy rồi dọn database tạm; không cần tự điền
URL database phát triển hoặc bật các API bằng tay. **Số liệu 173 và 480 bên dưới
là kết quả của cách chạy có database test này.** `npm test` chỉ chạy nhóm LIS,
gồm các test A, D1 và D2. Tại lượt ghi nhận 480 test chưa có D3; sau khi thêm
D3, runner toàn bộ có 495 test. Bộ E2E D3 chạy riêng bằng `test:e2e`, không
nằm trong `npm test`. D4 chưa triển khai.

Đã chạy lại `npm run test:lis-dispatch:postgres` để đối chiếu log chạy tay:
**94 đạt, 0 lỗi, 0 bỏ qua**. Hai nhóm D1/D2 từng bị bỏ qua đã thực sự chạy.

Đã kiểm tra:

- Gói gửi khớp sáu trường outbox, kể cả khi `lis.results` đã bị sửa sau Publish.
- Toàn bộ trường ACK, JSON lỗi, body quá lớn, sai media type, mọi nhóm mã HTTP.
- Mất kết nối, timeout ở header/body, mất phản hồi sau khi phía nhận đã lưu.
- Lịch chờ dùng thời gian PostgreSQL, số lượt/lịch sử tăng đúng, hết lượt dừng.
- Hai Dispatcher cạnh tranh; tiến trình cũ không ghi đè ACK bằng ACK hoặc FAILED.
- Lỗi PostgreSQL khi đang lưu ACK: rollback cả lượt thử và trạng thái, không báo thành công.
- Tắt tiến trình bằng `SIGKILL`, đợi lease thật hết hạn, chạy tiến trình mới,
  nhận ACK cũ và dừng bằng `SIGTERM` với exit code 0.
- Giữ snapshot/hash; không lưu body chẩn đoán thô, không log nội dung xét nghiệm.

Kết quả thực tế của bản cuối:

| Lệnh | Kết quả |
|---|---|
| `cd backend && npm run check` | Đạt, gồm TypeScript source và tests |
| `cd backend && npm run build` | Đạt |
| `npm test` trong runner PostgreSQL cô lập | 173 đạt, 0 lỗi, 0 bỏ qua |
| `npm run test:middleware` trong runner | 191 đạt, 0 lỗi, 0 bỏ qua |
| `npm run test:emr` trong runner | 100 đạt, 0 lỗi, 0 bỏ qua |
| `npm run test:integration` trong runner | 16 đạt, 0 lỗi, 0 bỏ qua |
| `docker compose --profile dispatcher config --quiet` | Đạt; chỉ kiểm tra cấu hình |

Tổng **480 test đạt**, không lỗi hoặc bỏ qua. Trong 173 test LIS có 66 test
D2 mới: 45 test unit/HTTP và 21 test PostgreSQL tính cả test cha (20 tình huống).
28 test D1 được giữ và chạy lại. Kết quả đầy đủ:
[spp-66-d2-test-output.txt](evidence/spp-66-d2-test-output.txt).

Lệnh chạy toàn bộ ở trên là `cd backend && npm run test:repositories:postgres`;
runner tự chạy lần lượt các lệnh test trong bảng. Bộ riêng D1/D2 cũng đã được
chạy bằng `npm run test:lis-dispatch:postgres`; bản cuối, gồm ca HTTP `600`
bổ sung khi rà soát, được xác nhận trong lượt toàn bộ 480 test.

Lượt test trực tiếp trong sandbox chỉ trả lỗi ở cấp file, không có kết quả
từng assertion. Kết quả trên lấy từ lượt chạy có quyền localhost/Docker, với
assertions thực sự thực thi và database cô lập; không tính lượt sandbox bị
lỗi là test đạt. Các container test tạm đã được dọn xong.

File chính: `backend/src/lis/dispatcher.ts`; cấu hình và điểm khởi động ở
`dispatcher-config.ts`, `dispatcher-main.ts`. Test D2 ở
`backend/tests/lis/dispatcher.unit.test.ts`, `dispatcher.integration.test.ts`
và helper `dispatcher-test-support.ts`. Script `test:lis-dispatch` chạy cả
D1/D2; `test:lis-dispatch:postgres` chuẩn bị database cô lập cho chúng.

Giới hạn của bộ D2: dùng Middleware giả lập; kiểm thử Middleware thật được bổ
sung riêng ở D3, chưa nghiệm thu D4. Lỗi cấu trúc
outbox/history đã nêu ở D1 vẫn cần kiểm tra thủ công. Khoảng dự phòng lease
không đảm bảo thắng mọi lần treo/khóa database; D1 từ chối ghi khi đã hết hạn.
HTTP bị mất phản hồi ở lượt cuối có thể đã được nhận từ xa; cần đối chiếu trước
khi quyết định xử lý thủ công. D2 không tự sửa hay tạo lại sự kiện.

## 9. Năm câu hỏi tự kiểm tra

1. Sau Publish, dữ liệu nguồn đổi thì Dispatcher gửi bản cũ hay bản mới? Vì sao?
2. Nhận `202` nhưng `source_hash` sai thì có được ghi ACK không?
3. Middleware đã lưu nhưng LIS mất phản hồi: lần gửi tiếp phải giữ những gì?
4. A hết lease, B đã nhận việc: A còn được cập nhật trạng thái không?
5. LIS có ACK rồi thì đã chắc EMR lưu đúng kết quả chưa?
