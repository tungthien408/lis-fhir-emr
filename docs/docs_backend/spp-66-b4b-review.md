# B4B — Tự gửi kết quả xét nghiệm sang EMR

B4B bổ sung **Worker: chương trình chạy nền để gửi kết quả và kiểm tra xem EMR
đã lưu đúng hay chưa**.

Worker đã được viết và kiểm thử với EMR giả lập. **EMR thật chưa có chức năng
nhận và đọc kết quả**, nên hiện chưa thể xác nhận toàn bộ hệ thống chạy thành công.

## 1. Worker làm việc như thế nào?

Sau khi Middleware nhận và lưu kết quả từ LIS, Worker sẽ:

1. Lấy một kết quả đang chờ xử lý.
2. Kiểm tra dữ liệu, rồi dùng Mapper B4A chuyển sang FHIR — dạng dữ liệu gửi cho EMR.
3. Gửi kết quả sang EMR.
4. Yêu cầu EMR trả lại kết quả vừa lưu và đối chiếu.
5. Nếu mọi thứ khớp, đánh dấu `DELIVERED` — đã giao và kiểm tra thành công.

```text
Nhận và lưu → Chuẩn bị → Gửi EMR → Đọc lại → Đối chiếu đúng → Hoàn tất
```

**Vì sao phải đọc lại?** EMR trả lời “đã lưu” vẫn chưa chứng minh dữ liệu được
lưu đúng. Worker cần kiểm tra mã kết quả, mã người bệnh EMR đã xác nhận, tên/mã
xét nghiệm, giá trị, đơn vị, khoảng tham chiếu, thời gian và thông tin đi kèm.
Phải tìm thấy đúng một kết quả và các thông tin phải khớp.

Ví dụ gửi Kali **3.4 mEq/L** mà đọc lại thành **4.3 mEq/L**, Worker sẽ báo lỗi,
không đánh dấu thành công. Số không được tự làm tròn, đơn vị không được tự đổi.

## 2. Nếu có lỗi thì sao?

Worker chia công việc thành hai bước:

| Bước | Việc cần làm | Khi lỗi mạng hoặc EMR tạm thời không hoạt động |
|---|---|---|
| `SEND` — gửi | Gửi kết quả cho EMR lưu | Thử gửi lại đúng dữ liệu và mã kết quả cũ |
| `VERIFY` — kiểm tra | Đọc lại kết quả đã được EMR xác nhận lưu | Chỉ thử đọc lại |

Mặc định, **mỗi bước được thử tối đa 4 lần**: một lần đầu và ba lần thử lại,
lần lượt chờ **2, 4, 8 giây**. Mỗi yêu cầu chờ phản hồi tối đa **3 giây**.
Các con số này có thể thay đổi trong cấu hình.

Hai ví dụ:

- **EMR đã lưu, nhưng lúc đọc lại bị mất mạng:** Worker chờ rồi đọc lại.
  Không cần gửi thêm kết quả.
- **Gửi xong nhưng mất phản hồi:** Worker chưa biết EMR đã lưu chưa, nên gửi
  lại đúng dữ liệu và mã cũ. EMR phải nhận ra kết quả đã có và tránh tạo bản sao;
  sau đó Worker vẫn đọc lại để kiểm tra.

Nếu dữ liệu không hợp lệ, kết quả đọc lại bị sai hoặc đã hết số lần thử,
Worker dừng và ghi lý do. Kết quả đã kết thúc sẽ không tự được xử lý lại.

## 3. Nếu hai Worker cùng chạy, hoặc một Worker bị tắt?

Mỗi khi nhận việc, Worker được cấp **quyền giữ việc có thời hạn**, gọi là
`lease`. Có thể hình dung như ghi: “Kết quả này đang do Worker A xử lý”.
Trong thời hạn đó, Worker B sẽ chọn việc khác.

Nếu A bị tắt giữa chừng, quyền giữ việc sẽ hết hạn và B có thể tiếp tục.
A quay lại muộn cũng không được ghi đè kết quả của lượt xử lý mới.

Tiến độ được lưu trong database nên Worker biết cần tiếp tục ở đâu:

| Trước khi bị tắt | Khi chạy tiếp |
|---|---|
| Chưa có xác nhận EMR đã lưu | Có thể phải gửi lại cùng dữ liệu và mã cũ |
| Đã lưu xác nhận của EMR | Tiếp tục đọc kiểm tra |
| Đã hoàn tất | Bỏ qua kết quả đó |

Một lần thử đã bắt đầu vẫn được tính vào giới hạn, kể cả khi Worker bị tắt.
Vì vậy việc khởi động lại không làm số lần thử kéo dài vô hạn.

## 4. Đọc các trạng thái trong hệ thống

Luồng thành công:

```text
RECEIVED → PROCESSING → VERIFYING → DELIVERED
Đã nhận    Đang xử lý   Đang kiểm tra  Hoàn tất
```

Các nhánh còn lại:

| Trạng thái | Hiểu đơn giản |
|---|---|
| `RETRY_WAIT` | Chờ đến giờ thử gửi hoặc đọc lại |
| `REJECTED` | Bị từ chối, ví dụ dữ liệu không hợp lệ hoặc trùng mã nhưng khác nội dung |
| `FAILED` | Dừng vì hết lượt thử, phản hồi không hợp lệ hoặc dữ liệu đọc lại không khớp |

Đọc lại thấy sai thì lịch sử ghi thêm `VERIFY_MISMATCH` — nghĩa là **kết quả
đối chiếu không khớp**. Các mốc như “đã chuyển sang FHIR”, “đã gửi” cũng được
lưu trong lịch sử để biết công việc đã đi đến đâu.

Hai điều cần nhớ:

- Middleware trả `202` nghĩa là **đã nhận và lưu yêu cầu**. Chỉ `DELIVERED` mới
  nghĩa là EMR đã xác nhận lưu và Worker đã đọc lại, đối chiếu thành công.
- `FAILED` sau lỗi mạng không khẳng định EMR chưa lưu. Nó cho biết Worker chưa
  có đủ bằng chứng để báo giao thành công.

## 5. Đã kiểm thử đến đâu?

Kết quả lần kiểm thử B4B ngày **26/10/2026**:

| Phần kiểm tra | Kết quả |
|---|---|
| Kiểm tra TypeScript và build | Đạt |
| Kiểm tra từng phần của B4B | 7 test đạt |
| Worker + PostgreSQL thật + EMR giả lập | 58 tình huống đạt |
| Toàn bộ test Middleware | **191 đạt**, không lỗi, không bỏ qua |
| Test LIS hiện có | **79 đạt**, không lỗi, không bỏ qua |
| Worker + EMR thật | **Chưa kiểm thử được** |

Các tình huống đã thử gồm gửi thành công, gửi lại không tạo bản sao, dữ liệu
sai, mất mạng, hết lượt thử, Worker bị tắt và hai Worker cùng nhận việc.
EMR giả lập có kiểm tra dữ liệu và chống trùng theo quy định của dự án.

Để chạy lại bộ kiểm thử:

```bash
cd backend
npm run check
npm run build
npm run test:repositories:postgres
```

Lệnh cuối tự tạo database và EMR giả lập riêng để thử, rồi dọn tài nguyên đó.
Không dùng hoặc xóa dữ liệu database hiện có của dự án.

## 6. Còn thiếu gì để chạy thật?

Phía EMR cần có hai API:

- `POST /api/observations`: nhận và lưu kết quả, liên kết người bệnh, chống trùng.
- `GET /api/lab-results`: trả kết quả đã lưu để Worker đọc kiểm tra.

Hai bên cần thống nhất dữ liệu trả về theo [quy định API](api-contract.md), rồi
kiểm thử Worker với EMR thật. Cần kiểm tra độc lập việc liên kết đúng người
bệnh: mã người bệnh khớp phản hồi EMR chưa đủ chứng minh liên kết đó đúng.

Phía LIS cũng còn thiếu chương trình tự gửi các yêu cầu đã Publish sang
Middleware. Vì vậy, **test với EMR giả lập chưa thay thế được kiểm thử toàn bộ
luồng LIS → Middleware → EMR**.

Khi EMR thật đã sẵn sàng, cấu hình kết nối database của Middleware và địa chỉ
EMR, rồi chạy Worker riêng:

```bash
cd backend
EMR_BASE_URL=http://127.0.0.1:3103 npm run dev:middleware-worker
```

Worker không tự bật cùng server HTTP. Hiện EMR còn thiếu hai API trên, nên dùng
bộ kiểm thử để xem luồng hoạt động; chạy Worker với EMR hiện tại sẽ gặp lỗi.
Cấu hình mẫu nằm trong [`.env.example`](../.env.example).

Nếu muốn xem code: [Worker](../backend/src/middleware/worker.ts) điều phối công
việc; [Repository](../backend/src/middleware/repository.ts) lưu tiến độ;
[phần đối chiếu](../backend/src/middleware/worker-verification.ts) kiểm tra dữ
liệu đọc lại. B4B đã dừng ở đây để review, chưa commit hoặc push.
