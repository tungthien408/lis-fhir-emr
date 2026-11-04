# Exchange Monitor

Giao diện chỉ đọc theo dõi LIS → Middleware → EMR. React/TypeScript/Vite, không thêm dependency.

## Mở ứng dụng

Tại `frontend/`:

```powershell
npm.cmd run dev:monitor
# http://127.0.0.1:5174/#/exchanges
npm.cmd run build:monitor
npm.cmd run preview:monitor
# http://127.0.0.1:4174/#/exchanges
```

Nếu dev server 5174 đã chạy, dùng URL đó; không khởi động server thứ hai.
Trên Windows nếu Vite không xóa được dist/assets, dùng:
`npm.cmd run build --workspace apps/middleware-monitor -- --emptyOutDir false`.
Không cần xóa cache hoặc assets cũ. Preview cần build mới và backend Middleware 3102.
Proxy dùng cấu hình chung: `/api/middleware` → `http://127.0.0.1:3102/api`, dev và preview như nhau.

## Danh sách và điều hướng

Hai bộ lọc AND chính xác: mã kết quả nguồn và trạng thái Middleware. Tìm kiếm bỏ khoảng trắng đầu/cuối;
chỉ mã khớp `^MIMIC-LAB-[0-9]+$` (không phân biệt hoa/thường) được chuyển về viết hoa trước GET.
Ví dụ `  mimic-lab-100145  ` → `MIMIC-LAB-100145`. Mã khác giữ nguyên hoa/thường, dấu và khoảng trắng
bên trong; không đổi định danh nhận từ API. Mã chỉ có khoảng trắng/control character bị từ chối. Gõ chưa gọi API; Tìm kiếm/Enter mới áp dụng.
Xóa bộ lọc và Làm mới đều gửi GET mới. Ô Exchange ID riêng chỉ nhận UUID rồi mở chi tiết.

20 dòng mỗi trang; GET limit=21, offset=(page-1)*20. Không có total và không tự tạo tổng số trang.
Rỗng nghĩa không có exchange Middleware khớp, không có nghĩa LIS chưa Publish.

```text
#/exchanges
#/exchanges?source_result_id=MIMIC-LAB-100142&status=DELIVERED&page=2
#/exchanges/<uuid>?source_result_id=MIMIC-LAB-100142&status=DELIVERED&page=2
```

Hash giữ bộ lọc đã áp dụng và trang qua chi tiết/Quay lại/F5/Back/Forward. Bản nháp chưa tìm kiếm
không lưu qua rời trang/F5. URL lạ, UUID/query/encoding/trang sai hiện lỗi, không mở rộng truy vấn.

## Chi tiết và xác minh

Các khối định danh, trạng thái Middleware, snapshot lúc Publish, timeline, attempts, receipt và mốc EMR.
Source/FHIR JSON thu gọn mặc định, giới hạn vùng hiển thị. Timestamp hiển thị UTC, datetime/title giữ
chuỗi API; snapshot giữ nguyên timestamp gốc. Cột MW có độ chính xác millisecond theo API hiện có.
READY/FINAL thuộc nguồn LIS; ACK thuộc Dispatcher; không phải trạng thái Middleware.

Chỉ xác nhận đối soát khi MW DELIVERED, có target_stored_at/verified_at/completed_at, envelope khớp
exchange/event/source/result/hash, có receipt SEND đúng định danh và VERIFY kết thúc HTTP 200 không lỗi.
Thiếu API attempts, receipt hay identity/mốc xác minh → chưa đủ bằng chứng, không suy diễn DELIVERED.
Receipt xác nhận lưu không thay thế bước đọc lại. Không có Retry thủ công hoặc POST trong ứng dụng.

Chi tiết GET mỗi 5 giây khi chưa kết thúc, không chồng request; tab ẩn tạm dừng, hiện lại đọc mới.
Kết thúc ở DELIVERED/REJECTED/FAILED; nếu attempts còn lỗi thì tiếp tục GET để phục hồi.
Làm mới chủ động vẫn hoạt động sau khi dừng. Abort + request identity ngăn phản hồi cũ ghi đè.
Lỗi attempts không che định danh/timeline chi tiết; lỗi detail thì không giữ xác nhận EMR cũ.

## API

- GET `/api/exchanges?status=...&source_result_id=...&limit=21&offset=...`
- GET `/api/exchanges/:exchangeId`
- GET `/api/exchanges/:exchangeId/attempts` mới: items SEND/VERIFY và diagnostics đã làm an toàn.

Ứng dụng chỉ dùng GET qua proxy. [Hợp đồng API](../../../docs/api-contract.md).
Nếu source có route nhưng container trả `404 API route not found`, cần build image rồi recreate
riêng Middleware. Trong Compose hiện tại, Middleware dùng image chung, không có build block riêng:

```powershell
# tại root repository; không restart database/LIS/EMR/Worker
 docker build -t lis-fhir-emr-backend:local ./backend
 docker compose up -d --no-deps --force-recreate middleware
```

Không chạy down/xóa volume/reset DB. `404 Exchange not found` là thiếu giao dịch, khác route thiếu.

## Kiểm thử

Tại workspace này:

```powershell
npm.cmd run test
npm.cmd run check
npm.cmd run lint
npm.cmd run build -- --emptyOutDir false
node tests/browser.mjs
node tests/browser.mjs --real --dev
node tests/browser.mjs --real
```

Mock Chrome dùng server riêng cổng 5194, dữ liệu tổng hợp/CDP, chỉ GET. `--real --dev` dùng 5174,
`--real` dùng preview 4174; reuse server có sẵn, chỉ đóng server do test tạo. Cần Chrome/Edge hoặc CHROME_PATH.
Bộ real cần exchange đã tồn tại và API attempts đã cập nhật; không tạo dữ liệu thật để chạy test.
32 ca mock và 6 ca real trên mỗi mode, ghi JSON và ảnh có chọn lọc vào thư mục mới mỗi lượt.
Có thể đặt thư mục bằng chứng riêng trước khi chạy browser (đường dẫn tương đối workspace Monitor):

```powershell
$env:MONITOR_EVIDENCE_DIR='tests/evidence/2026-11-05/browser'
```


Tại root:

```powershell
node scripts/verify-monitor-backend.mjs
# chỉ chạy một bộ khi cần:
node scripts/verify-monitor-backend.mjs --suites=test:middleware
```

Với runner backend, `MONITOR_EVIDENCE_DIR` được tính từ root repository, ví dụ:

```powershell
$env:MONITOR_EVIDENCE_DIR='frontend/apps/middleware-monitor/tests/evidence/2026-11-05/backend'
node scripts/verify-monitor-backend.mjs
```

Mỗi runner tạo thư mục con duy nhất, giữ nguyên bằng chứng các lượt trước.
Backend runner dùng image đã cache + PostgreSQL17 tmpfs riêng, marker và roles riêng, mật khẩu ngẫu nhiên.
Source/tests/scripts/DDL gắn chỉ đọc; làm sạch giữa suite trên đúng container riêng. Không gắn Compose volume.
Mặc định chạy TypeScript/build và LIS/Middleware/EMR/C4/D3; không dùng test lịch sử thay kết quả mới.

Raw logs/runs giữ cục bộ trong tests/evidence và được ignore. `tests/evidence/acceptance/` chỉ giữ bản
tổng hợp kiểm chứng và hai ảnh thực tế được chọn để review. Bằng chứng LIS hồi quy đặt thư mục mới riêng;
không ghi đè nghiệm thu 2.1/2.2/2.3.

[Báo cáo nghiệm thu](../../../docs/exchange-monitor-implementation-2026-11-04.md).
