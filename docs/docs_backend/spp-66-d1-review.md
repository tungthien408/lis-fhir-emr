# SPP-66 D1 — Repository cho LIS Dispatcher

D1 đã bổ sung các thao tác database để một Dispatcher sau này có thể lấy việc,
ghi lịch sử gửi, lưu ACK, hẹn thử lại và dừng khi lỗi. **D1 chưa có chương trình
tự gửi HTTP.** Các hàm Publish A1–A3 tiếp tục giữ nguyên hành vi.

Kết quả ngày 30/10/2026: TypeScript/build đạt; bộ D1 có **28 test đạt**; toàn bộ
hồi quy có **414 test đạt, 0 lỗi, 0 bỏ qua**. Dừng ở D1 để review.

## 1. Preflight và các quyết định theo DDL

Nhánh hiện tại là `main`. Working tree đã có các thay đổi C1–C4 chưa commit;
D1 giữ lại chúng và chỉ mở rộng phần LIS cùng cấu hình test tối thiểu.
Đã đọc DDL, quyền role, contract, schema/Repository/Service LIS, Worker và
Repository Middleware để đối chiếu trước khi sửa.

Không có xung đột bắt buộc đổi bảng hoặc contract. Có các điểm cần xử lý rõ:

| Nguồn hiện tại | Quyết định D1 |
|---|---|
| `lis_publish_ack_chk` yêu cầu `exchange_id`, `acked_at`, `ack_response` cùng có khi ACK | Cập nhật đủ ba trường, trạng thái và attempt trong một transaction |
| DDL chỉ có UNIQUE `(event_id, attempt_no)`; không tự đồng bộ counter/lease | Khóa event trước, kiểm tra lịch sử và tăng counter cùng lúc INSERT attempt |
| Lease trong DDL có thể `null`, không có CHECK trạng thái/lease | Chỉ phục hồi IN_FLIGHT có thời điểm hết hạn xác định và đã quá hạn; không đoán lease hỏng |
| Contract Middleware trả `202` kể cả khi nhận lại cùng gói | ACK D1 yêu cầu `202`, `accepted: true` và toàn bộ ID/hash khớp event |
| Middleware có DELIVERED, LIS không có | D1 chỉ dùng PENDING, IN_FLIGHT, RETRY_WAIT, ACK, BLOCKED, FAILED |
| DDL không lưu số lượt tối đa | Caller truyền cùng `maxAttempts` cho các lượt; D1 chặn tạo attempt khi hết ngân sách |

Không sửa SQL, schema, Service, Controller, Middleware hoặc EMR. Code mới dùng
`lisDatabase`, chỉ thao tác `lis.publish_events` và `lis.dispatch_attempts`.

## 2. Outbox là gì?

Bạn có thể hiểu outbox là **danh sách những gói đang chờ gửi**. Khi Publish,
LIS lưu một sự kiện vào `publish_events` trước. Nó gồm mã sự kiện, bản chụp kết
quả, hash và thời điểm Publish. Nhờ đã nằm trong database, yêu cầu gửi vẫn còn
nếu chương trình bị tắt.

Dispatcher sau này sẽ lấy từng sự kiện để gửi. D1 chuẩn bị phần đọc/ghi
PostgreSQL cho công việc đó. Nó không lấy lại kết quả nguồn đang thay đổi và
không sửa snapshot/hash đã chốt ở A2.

```text
PENDING → IN_FLIGHT → ACK
                  ↘ RETRY_WAIT → IN_FLIGHT
                  ↘ BLOCKED hoặc FAILED
```

ACK có nghĩa là Middleware xác nhận đã nhận và lưu gói. Việc EMR lưu đúng và
được Worker đọc lại thành công vẫn là DELIVERED ở Middleware.

## 3. Vì sao cần lease và khóa database?

Lease là **quyền giữ một việc trong một khoảng thời gian**. Khi lấy việc,
Dispatcher nhận `lease_token` mới và thời điểm hết hạn `lease_until`.
Các lần ghi tiếp theo phải có đúng token và lease còn hạn theo giờ PostgreSQL.

Khi hai Dispatcher cùng chọn một event, PostgreSQL chỉ cho một bên khóa event
đó. `FOR UPDATE SKIP LOCKED` khiến bên còn lại bỏ qua event đang bị khóa và
chọn việc khác. Sau khi bên đầu commit, event đã thành IN_FLIGHT có lease còn
hạn nên cũng không còn đủ điều kiện để claim.

Khóa chỉ giữ trong các transaction database ngắn. D1 không mở transaction để
chờ HTTP. Nếu sau này một yêu cầu HTTP kéo dài quá lease, kết quả trả về muộn
sẽ bị từ chối khi cập nhật database.

## 4. Các hàm và kiểu mới

Tất cả nằm trong `backend/src/lis/repository.ts`.

### `claimPublishEvent(leaseMs)`

Lấy tối đa một event đủ điều kiện:

- PENDING; hoặc RETRY_WAIT đã tới `next_retry_at`.
- IN_FLIGHT có lease đã hết hạn.
- Không lấy ACK, BLOCKED, FAILED hoặc lease IN_FLIGHT chưa hết hạn.

Sắp theo `published_at ASC, event_id ASC`, khóa với SKIP LOCKED, đổi sang
IN_FLIGHT, cấp token và thời hạn mới, xóa lịch hẹn retry cũ. Nếu còn attempt
dang dở của event được phục hồi, đóng nó với `LEASE_EXPIRED` và
`{ "outcome": "ABANDONED" }`. Không giảm counter hoặc tái sử dụng attempt_no.

Trả event sau commit; không có việc trả `undefined`. Lỗi database được throw.
Claim tự nó chưa tạo attempt hoặc tăng số lượt.

### `beginDispatchAttempt(lease, leaseMs, maxAttempts)`

Khóa event, kiểm tra token/thời hạn, đếm lịch sử và kiểm tra counter có khớp
không. Nếu hợp lệ, gia hạn lease, tăng counter rồi INSERT attempt trong cùng
transaction. Attempt nhận UUID mới, số thứ tự tiếp theo, token và `started_at`.

| `kind` trả về | Ý nghĩa |
|---|---|
| `started` | Có `event` và `attempt` đã commit; có thể chuẩn bị gửi |
| `stale_lease` | Không còn quyền giữ event |
| `attempt_active` | Đã có một attempt chưa kết thúc; không tạo thêm |
| `exhausted` | Hết số lượt; chuyển event sang FAILED/RETRY_EXHAUSTED, không tạo lượt mới |

Counter phải bằng số row attempt và bằng attempt_no lớn nhất. Nếu lịch sử bị
xóa/sửa ngoài luồng khiến chúng lệch nhau, hàm throw để báo cần kiểm tra dữ
liệu; không tự sửa rồi dùng lại số cũ.

`leaseMs` nhận số nguyên 1–3.600.000 ms; `maxAttempts` nhận 1–100, tính cả các
attempt bị gián đoạn. Đây là giới hạn tham số persistence, chưa phải cấu hình
retry/backoff của Dispatcher. Caller ở giai đoạn sau cần giữ ngân sách nhất quán.

### `markDispatchAttemptSent(lease, attemptId)`

Ghi `sent_at` ngay trước ranh giới gửi HTTP sau này. Nó không tự gửi request.
Gọi lặp lại vẫn giữ thời điểm gửi đầu tiên. Phải là attempt chưa kết thúc,
thuộc đúng event/token, và lease còn hạn.

Trả `true` khi ghi được; `false` khi không còn quyền hoặc không có attempt phù
hợp. Lỗi database được throw. `sent_at` chỉ xác nhận chương trình đã tới bước
chuẩn bị gửi; không chứng minh bên nhận đã thấy gói.

### `finishDispatchAttempt(lease, attemptId, result)`

Caller chọn một trong ba loại `DispatchAttemptResult`:

| Loại | Trường cần có | Việc D1 lưu |
|---|---|---|
| `ack` | `httpStatus: 202`, `acknowledgement` | Đóng attempt; ACK, exchange_id, acked_at, ack_response; xóa lease/lỗi cũ |
| `retry` | `code`, `delayMs`, tùy chọn `httpStatus` | Đóng attempt; RETRY_WAIT; next_retry_at theo giờ DB; xóa lease |
| `terminal` | `code`, `status: BLOCKED` hoặc FAILED, tùy chọn `httpStatus` | Đóng attempt; trạng thái cuối, mã lỗi; xóa lease/lịch retry |

ACK phải có `accepted`, `event_id`, `exchange_id`, `source_system`,
`source_result_id`, `source_hash`. Event ID, source identity và hash phải khớp
sự kiện đang giữ; exchange ID phải là UUID. UUID được đối chiếu không phân biệt
chữ hoa/thường. Nếu có HTTP status, attempt phải đã ghi `sent_at`.

Hàm trả `completed`, `stale_lease`, `attempt_not_active`, `attempt_not_sent`
hoặc `invalid_ack`. Những kết quả từ chối không ghi nhận thành công. Caller có
thể xử lý ACK sai bằng một lần hoàn tất lỗi thích hợp; D1 không tự chọn policy.

Khi có HTTP response, ghi status và `response_at`; chưa có response thì hai
trường là `null`. Mọi lần hoàn tất ghi `ended_at`. ACK chỉ giữ sáu trường công
khai trong response_body/ack_response; trường dư bị bỏ. Lỗi chỉ giữ outcome,
code và thông báo chung. Không lưu body lỗi thô có thể chứa thông tin nhạy cảm.

`delayMs` phải là số nguyên từ 1 đến 86.400.000 ms. Số lượt bị giới hạn khi
bắt đầu attempt tiếp theo. Nếu đã hết ngân sách, event được kết thúc FAILED
trước khi có attempt gửi mới.

### `getDispatchAttempts(eventId)`

Đọc toàn bộ lịch sử theo `attempt_no ASC`; không có lịch sử trả `[]`.
Mỗi row giữ token của lượt đó nên sau khi đổi chủ vẫn thấy được ai đã giữ
attempt cũ, thời điểm bắt đầu/gửi/kết thúc và kết quả. Lỗi database được throw.

Các kiểu `DispatchLease`, `DispatchAcknowledgement`, `DispatchAttemptResult`
định nghĩa dữ liệu caller cần truyền. `DispatchErrorCode` chỉ cho các mã lỗi
nội bộ đã định nghĩa; không nhận thông báo driver hoặc payload làm mã lỗi.

### Các helper bên trong và phần A1–A3

- `ownedPublishEvent`: khóa event, rồi kiểm tra lease bằng giờ DB mới sau khi
  chờ khóa. Trạng thái phải vẫn là IN_FLIGHT và token phải khớp.
- `liveDispatchLease`: điều kiện cho phép ghi gồm event ID, token, trạng thái
  và `lease_until > clock_timestamp()`.
- `requireLiveDispatchLease`/`requireDispatchWrite`: kiểm tra lại sát cuối
  transaction. Nếu lease hết hạn trong lúc chờ khóa attempt hoặc INSERT, gây
  rollback để các thay đổi dở dang không được commit.
- `dispatchTransaction`: transaction READ COMMITTED, timeout câu lệnh 5 giây,
  chờ khóa tối đa 1 giây. Chỉ tín hiệu lease hết hạn nội bộ được đổi thành kết
  quả từ chối; lỗi kết nối/SQL/commit vẫn throw.
- `copyDispatchLease`/`copyDispatchResult`: giữ bản sao các giá trị trước khi
  chờ database, kiểm tra giới hạn và chỉ nhận các trường ACK cho phép.

Các hàm cũ `getResultById`, `listResults`, hai hàm tra Publish event,
`createPublishEvent`, `withPublishTransaction` tiếp tục làm việc như A1–A3.
D1 không sửa cách đọc nguồn dưới khóa, tạo snapshot/hash hoặc tái sử dụng sự
kiện Publish. Test còn gọi Publish lại sau ACK để xác nhận nó giữ nguyên event.

## 5. Vì sao ACK phải được lưu cùng một transaction?

Nếu chỉ ghi ACK rồi chương trình tắt trước khi lưu exchange_id hoặc receipt,
LIS sẽ báo “đã nhận” nhưng không có bằng chứng tương ứng. Nếu chỉ đóng attempt
mà không cập nhật event, một lần chạy sau có thể tưởng công việc chưa xong.

D1 lưu **attempt và tất cả trường ACK cùng thành công hoặc cùng rollback**.
`lis_publish_ack_chk` tiếp tục bảo vệ các trường bắt buộc. Test dùng khóa bảng
để cho UPDATE attempt chạy trước rồi làm UPDATE event thất bại; cả hai thay
đổi đều được rollback, không có ACK dở dang.

## 6. Ví dụ thành công

Đây là các bước gọi Repository đã được test bằng dữ liệu giả; D1 không gửi HTTP:

```text
1. Publish tạo event E: PENDING, counter = 0.
2. claimPublishEvent: E thành IN_FLIGHT, token T1, lease còn hạn.
3. beginDispatchAttempt: tạo A1, attempt_no = 1, counter = 1.
4. markDispatchAttemptSent: ghi sent_at cho A1.
5. Test truyền receipt giả hợp lệ tương ứng HTTP 202.
6. finishDispatchAttempt: commit A1 đã kết thúc và E = ACK,
   cùng exchange_id, acked_at, ack_response.
```

Trong chương trình gửi sau này, bước HTTP sẽ nằm sau bước 4 và trước bước 5.
D1 hiện chỉ chứng minh các thao tác persistence bằng receipt thử nghiệm.

## 7. Ví dụ cạnh tranh và phục hồi sau crash

```text
A claim E với token T1, bắt đầu attempt 1, rồi bị tắt.
B thử claim trong lúc lease T1 còn hạn: không lấy được E.
Lease T1 hết hạn.
B claim E với token T2; attempt 1 được đóng là LEASE_EXPIRED.
B bắt đầu attempt 2, nhận receipt hợp lệ và ghi ACK.
A quay lại với T1 và phản hồi cũ: finish trả stale_lease.
ACK, receipt và lịch sử của B giữ nguyên.
```

Nếu A tắt trước khi bắt đầu attempt, B không tạo lịch sử giả cho A và vẫn bắt
đầu ở số 1. Nếu A tắt trong attempt cuối cùng được phép, B đóng attempt đó rồi
chuyển FAILED/RETRY_EXHAUSTED; crash không làm số lượt được reset.

Lease ngăn chủ cũ ghi trạng thái. Nó không hủy được một HTTP request đã rời máy.
Vì vậy ở các giai đoạn sau, gửi lại vẫn phải dùng đúng event_id/snapshot/hash
cũ để Middleware nhận ra gói lặp. Đây là cơ chế có thể gửi lặp nhưng không làm
mất việc; D1 chưa chứng minh gửi HTTP hoặc toàn luồng LIS.

## 8. Test và kết quả thực tế

Chạy từ `backend/`:

```bash
npm run check
npm run build
npm run test:lis-dispatch:postgres
npm run test:repositories:postgres
```

| Lệnh | Kết quả |
|---|---|
| `npm run check` | PASS, gồm source và test TypeScript |
| `npm run build` | PASS |
| `npm run test:lis-dispatch:postgres` | 28 pass, 0 fail, 0 skip |
| `npm run test:repositories:postgres` | 414 pass, 0 fail, 0 skip |
| ↳ `npm test` | 107 pass = 79 LIS cũ + 28 D1 |
| ↳ `npm run test:middleware` | 191 pass |
| ↳ `npm run test:emr` | 100 pass |
| ↳ `npm run test:integration` | 16 C4 pass |

Output đầy đủ: [spp-66-d1-test-output.txt](evidence/spp-66-d1-test-output.txt).
Bộ D1 gồm 21 tình huống PostgreSQL, test cha và 6 unit test. Test unit giả lập
ranh giới pg cho lỗi select/update/commit; các bảo đảm về khóa, constraint và
rollback được kiểm tra trên PostgreSQL thật.

Các tình huống PostgreSQL bao phủ claim PENDING/retry đến hạn, bỏ qua retry
chưa tới giờ và lease còn hạn, phục hồi lease, hai bên claim/bắt đầu attempt
đồng thời, SKIP LOCKED, counter/số thứ tự, ACK, lỗi ACK, retry, BLOCKED/FAILED,
chủ cũ ghi muộn, giữ nguyên envelope, rollback, role boundaries và database
không sẵn sàng. Hai test riêng xác nhận hết hạn trong lúc chờ khóa event và
trong lúc chờ khóa attempt đều không ghi ACK.

Runner dùng image PostgreSQL 17 mới, tmpfs và mật khẩu ngẫu nhiên; không mount
volume dự án. D1 yêu cầu dấu nhận diện database tạm trước khi ghi fixture và
không claim từ một outbox có dữ liệu sẵn. Mọi fixture có tiền tố D1-SYNTHETIC
và UUID riêng; cleanup chỉ xóa các ID đó. Không dùng/reset database phát triển.
Các lần chạy Docker/HTTP được thực hiện ngoài sandbox với quyền tương ứng.

## 9. File thay đổi và giới hạn

| File | Thay đổi D1 |
|---|---|
| `backend/src/lis/repository.ts` | Thêm các hàm/type/helper Dispatcher; phần A1–A3 giữ nguyên |
| `backend/tests/lis/dispatcher-repository.integration.test.ts` | PostgreSQL: concurrency, lease, audit, ACK, rollback, quyền role |
| `backend/tests/lis/dispatcher-repository.unit.test.ts` | Thiếu cấu hình, giới hạn input, lỗi database/commit |
| `backend/package.json` | Hai lệnh test D1 riêng |
| `scripts/test-repositories-postgres.mjs` | Token đánh dấu database test cho D1 và chế độ chạy D1 riêng |
| `docs/spp-66-d1-review.md` | Hướng dẫn này |
| `docs/evidence/spp-66-d1-test-output.txt` | Output hồi quy thực tế |

Giới hạn cần giữ khi làm bước tiếp theo:

- Chưa có Dispatcher HTTP, vòng chạy nền, cấu hình retry/backoff hoặc xử lý
  phản hồi mạng. Chưa làm D2–D4 và chưa hoàn tất SPP-66.
- Ngân sách tối đa do caller truyền vì DDL không lưu nó; cần giữ cùng chính
  sách qua các lần khởi động. D1 không tự chọn BLOCKED/FAILED cho mã HTTP.
- Không có heartbeat riêng; lease được cấp ở claim và gia hạn lúc begin.
  Giai đoạn gửi phải chọn thời hạn phù hợp và dừng dùng kết quả nếu lease mất.
- IN_FLIGHT thiếu thời hạn và lịch sử/counter bị sửa ngoài luồng cần kiểm tra
  thủ công. D1 không tự đoán hoặc sửa dữ liệu lịch sử.
- Database errors được throw để caller quyết định retry; không nên log nguyên
  exception có thể chứa SQL. D1 không có logger hoặc lưu body lỗi upstream thô.
- Test dependency unavailable dùng pool đã đóng; không dừng PostgreSQL phát
  triển hoặc giả nhận đã kiểm thử mất mạng tới PostgreSQL từ xa.

Chưa commit, push hoặc mở pull request. Dừng ở D1 để bạn review.

## 10. Năm câu hỏi ngắn

1. Vì sao phải lưu sự kiện vào outbox trước khi gửi?
2. SKIP LOCKED giúp gì khi hai Dispatcher cùng lấy việc?
3. Chủ cũ còn được ghi ACK sau khi lease hết hạn không?
4. Vì sao ACK và lịch sử attempt phải lưu trong cùng transaction?
5. Nếu bị tắt giữa attempt 1, lần phục hồi tiếp theo dùng số mấy?
