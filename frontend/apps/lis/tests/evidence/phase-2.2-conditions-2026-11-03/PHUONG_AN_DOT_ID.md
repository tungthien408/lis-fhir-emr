# Phương án sửa resultId dấu chấm – trình bày trước khi sửa mã ứng dụng

Ngày 03/11/2026. Đây là **đề xuất chưa triển khai, chưa kiểm thử đầu cuối**. Không phải một ngoại lệ loại bỏ ID hợp lệ khỏi hợp đồng.

## Lỗi đã xác minh

- Backend `controller.ts:31` chấp nhận mã không rỗng, không có ký tự điều khiển; OpenAPI chỉ ghi string/minLength1. Không có quy tắc cấm `.` hoặc `..`.
- Raw HTTP GET đến `/api/results/.`, `/api/results/..` và dạng %2E trả 404 “Laboratory result not found”, đi vào tra cứu kết quả. Dataset hiện không có bản ghi này; không được coi404 là bằng chứng mã không hợp lệ.
- Fragment URL giữ được `#/results/.` và `#/results/..`. Frontend tự chặn ở `routes.ts:49` và `api/lis.ts:71`.
- URL parser của fetch chuẩn hóa dot segment. `.` và `%2E` đều thành `/api/lis/results/`, nhận object danh sách 200. `..` và `%2E%2E` thành `/api/lis/`, nhận404 route.
- Double encoding đơn thuần gửi `%252E`; backend giải mã một lần thành chuỗi `%2E`, là ID khác với `.`. Phải phân biệt hai ID.

## Phương án frontend + proxy LIS

Giữ hợp đồng backend và endpoint GET hiện có; thêm quy ước vận chuyển có đánh dấu giữa frontend và proxy LIS. Không đổi ID trong model, hash hay object response; vẫn so khớp response.result_id nghiêm ngặt.

Ví dụ marker dự kiến: `X-LIS-Dot-Segment: 1`. Chỉ gửi marker cho chính xác hai ID `.`/`..`.

| ID gốc | Path browser gửi (sau /api/lis/results/) | Marker | Path raw proxy gửi (sau /api/results/) | ID backend giải mã |
|---|---|---|---|---|
| . | %252E | 1 | %2E | . |
| .. | %252E%252E | 1 | %2E%2E | .. |
| %2E | %252E | Không | %252E | %2E |
| %2E%2E | %252E%252E | Không | %252E%252E | %2E%2E |


1. Bỏ riêng hai điều kiện từ chối dot ID ở parser/client, vẫn kiểm tra mã rỗng/control; không trim hoặc biến đổi định danh.
2. Khi ID là `.`/`..`, tạo path an toàn như bảng và marker; giữ nguyên AbortSignal và kiểm tra ID trả về. Các ID khác vẫn dùng encodeURIComponent như hiện tại.
3. Cấu hình proxy **riêng ứng dụng LIS** cho cả dev và preview. Trước khi forward, chỉ khi marker đúng và segment nằm trong đúng hai mẫu trên, đổi lớp escape của đường dẫn vận chuyển theo bảng, xóa marker rồi forward raw path sang endpoint backend hiện có. Không giải mã thêm cho các ID khác.
4. Vite hiện có hỗ trợ `ProxyOptions.bypass` trước `rewrite`/proxy.web (đã đọc mã thư viện cục bộ). Có thể dùng hook đó; cần kiểm thử thực tế để xác nhận raw path đến upstream. Không sửa cấu hình proxy của Monitor/EMR hoặc backend.
5. Nếu triển khai với reverse proxy khác Vite, phải cấu hình cùng quy ước tại proxy đó trước khi coi khả năng hỗ trợ dot ID là hoàn tất. Không đề nghị sửa Compose trong đợt này.

Marker phân biệt hai yêu cầu có cùng browser path nhưng ID gốc khác nhau, tránh biến `%2E` thành `.`. Không chọn một sentinel đơn lẻ có thể trùng ID thật. Không thêm endpoint backend mới, không dùng query để đổi định danh và không đưa bộ lọc danh sách vào GET chi tiết.

## File dự kiến cần sửa sau khi chốt phương án

- `frontend/apps/lis/src/state/routes.ts`: cho phép dot ID trong hash.
- `frontend/apps/lis/src/api/lis.ts`: vận chuyển dot ID có marker; bỏ hard reject; giữ response ID check.
- `frontend/apps/lis/vite.config.ts` và có thể một helper cấu hình nằm trong ứng dụng LIS: proxy mapping cho dev/preview, tách khỏi cấu hình hai ứng dụng còn lại.
- Kiểm thử API/router/proxy/Chrome và README LIS: thay kỳ vọng “dot ID sai” bằng hỗ trợ đúng ID, ghi yêu cầu proxy.

**Không file nào ở danh sách trên đã được sửa trong lượt xác minh này.** File mới browser-conditions.mjs chỉ tái hiện lỗi và kiểm chứng điều kiện ba bộ lọc.

## Kiểm chứng bắt buộc trước khi coi sửa xong

- HTTP mô phỏng tại upstream phía sau proxy, có bốn bản ghi ID riêng biệt `.`, `..`, `%2E`, `%2E%2E`; mỗi ID có dữ liệu khác nhau. Dùng proxy thật, không chỉ CDP fulfil trước proxy.
- Ghi raw upstream path, ID sau một lần giải mã, marker đã bị loại bỏ, response 200 và đủ 12 field; không trùng/lẫn bốn ID.
- Mở từ bảng và trực tiếp, F5, Quay lại, Back/Forward, retry, hủy request và chống response muộn cho dot ID.
- Kiểm tra dev và preview; các ID thường/ký tự đặc biệt khác không đổi.
- Raw GET backend thật hiện chỉ chứng minh404 hợp lệ; không tạo thêm dot record trong database. Nếu không có dữ liệu thật, ghi rõ thử200 là mô phỏng.
- Chạy lại toàn bộ hồi quy 2.1/2.2, TypeScript/lint/build; lưu thư mục bằng chứng mới.

Đây là phương án cần xem xét trước thay đổi hành vi vận chuyển. Chưa thể kết luận “dot ID đã mở đúng chi tiết” từ đề xuất này.
