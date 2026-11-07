# EMR — Bệnh án điện tử

Giao diện chỉ đọc cho hồ sơ mô phỏng và kết quả đã lưu. React/TypeScript/Vite, không thêm dependency.

## Mở ứng dụng

Tại `frontend/`:

```powershell
npm.cmd run dev:emr
# http://127.0.0.1:5175/#/search
npm.cmd run build:emr
npm.cmd run preview:emr
# http://127.0.0.1:4175/#/search
```

Dùng server 5175 đang có; không chạy server thứ hai. Proxy dev/preview `/api/emr` → `3103/api` có sẵn.
Trên Windows nếu assets đang bị khóa, build tại workspace EMR bằng
`npm.cmd run build -- --emptyOutDir false` để giữ assets cũ và cập nhật index.

## Nghiệm thu

1. Chọn mã nguồn LIS, nhập `MIMIC-P-10007928` (hoa/thường/xen kẽ/trim đều nhận diện đúng).
2. Xem hồ sơ bệnh nhân `6eac20d5-c71c-50a6-8adb-17bd7b5677de`; hiện có ba kết quả.
3. Xem `MIMIC-LAB-100145`: target `47a2ffdd-b7b1-490b-bc7e-703c0ecf6e92`, giá trị `3.6`, đơn vị `mEq/L`.
4. F5, Làm mới, Quay lại hồ sơ, Back/Forward. Có thể tra thẳng theo UUID EMR hoặc mở mã kết quả LIS.

Các trường lấy nguyên từ API; nhãn hồ sơ là dữ liệu mô phỏng. Chỉ chuẩn hóa input MIMIC-P/MIMIC-LAB
hậu tố số; định danh trả về và chuỗi giá trị/thời gian không bị biến đổi. Không có POST/chỉnh sửa dữ liệu.

## API và điều hướng

- GET `/api/patients`: cặp identifier_system/value **hoặc** patient_key. 200 `{patient:...}`;
  404 `Patient not found` khác 404 route chưa có; 400/503 theo contract.
- GET `/api/lab-results?patient_key=...&limit=21&offset=...`: 20 dòng hiển thị; thứ tự API, không total giả.
- GET `/api/lab-results?external_system=...&external_id=...`: chi tiết; không trộn bộ lọc/phân trang.

Hash `/search`, `/patients/<uuid>`, `/result?external_system=...&external_id=...`.
Query lưu mode/value và page; kết quả mở từ hồ sơ có patient_key ngữ cảnh.
F5/direct URL luôn GET lại; không phụ thuộc dữ liệu React tạm thời. Bản nháp chưa tìm không lưu qua rời trang.
Mã external đặc biệt được encode bằng URLSearchParams, giữ nguyên trong response.

Danh sách/chi tiết kiểm tra patient_key và FHIR subject identifier với các liên kết hồ sơ.
Thiếu/khác identity, nhiều bản ghi cho cặp nguồn, JSON/schema sai đều báo lỗi, không lấy phần tử đầu.
Hồ sơ 200 nhưng danh sách rỗng khác với hồ sơ lookup 404. Lỗi không giữ kết quả cũ.
Abort + request identity ngăn phản hồi muộn; Làm mới/Thử tải lại chỉ GET, không polling tự động.

Quantity/low/high giữ chuỗi thập phân; null hiện “Không có”, 0 vẫn là 0. Thời gian chính hiển thị
`YYYY-MM-DD HH:MM:SS UTC` (cùng dạng với LIS và Monitor); datetime/title giữ nguyên. Chi tiết có UTC gốc đầy đủ microsecond.
UUID, namespace và FHIR nằm trong mục kỹ thuật thu gọn, có thể mở xem/sao chép đầy đủ.
Nhãn “Đã lưu tại EMR” không xác nhận Worker đã VERIFY; xem trạng thái trao đổi ở Monitor.

## Kiểm thử

Tại workspace EMR:

```powershell
npm.cmd run test
npm.cmd run check
npm.cmd run lint
npm.cmd run build -- --emptyOutDir false
node tests/browser.mjs
node tests/browser.mjs --real --dev
node tests/browser.mjs --real
```

Chrome mock dùng 5195 và chặn HTTP, chỉ cho GET; real dùng dev 5175/preview 4175 và dữ liệu có sẵn.
Reuse server sẵn có, chỉ đóng server do test tạo. Cần Chrome/Edge hoặc CHROME_PATH.
`EMR_EVIDENCE_DIR` đổi thư mục output; mỗi lượt có thư mục con duy nhất.

Tại root repository:

```powershell
node scripts/verify-emr-backend.mjs
# Hoặc chỉ chạy các bộ cần thiết:
node scripts/verify-emr-backend.mjs --suites=test:emr,test:integration,test:e2e
```

Runner PostgreSQL17 tmpfs riêng, mật khẩu/roles và marker riêng; không gắn Compose volume.
Source/tests/DDL chỉ đọc. Mặc định check/build và LIS/Middleware/EMR/C4/D3.
Không chạy test ghi dữ liệu bằng connection string database thật.

Nếu route mới trả `404 API route not found` và dist container chưa có `/api/patients`, áp dụng riêng EMR:

```powershell
docker build -t lis-fhir-emr-backend:local ./backend
docker compose up -d --no-deps --force-recreate emr
```

Không down, reset DB hoặc xóa volume. Bằng chứng chọn lọc nằm `tests/evidence/acceptance/`;
raw runs bị ignore. [Hợp đồng API](../../../docs/api-contract.md).


## Cải thiện UI/UX sau nghiệm thu

Ba bước ở đầu trang: **Tra cứu bệnh nhân → Xem hồ sơ → Xem kết quả xét nghiệm**.
Tìm thấy bệnh nhân thì chọn **Xem hồ sơ bệnh nhân** cạnh tên. Tra cứu nhanh theo mã kết quả là
một lựa chọn riêng trong mục mở rộng, chỉ dùng khi bạn đã biết mã kết quả LIS.

Trang hồ sơ ưu tiên tên xét nghiệm, giá trị, đơn vị, cận tham chiếu và thời gian; mã nguồn hiển thị phụ.
Khi trang đầu không còn trang tiếp, chỉ ghi số kết quả đang hiển thị, không hiện nút phân trang.
Chi tiết có tóm tắt kết quả/bệnh nhân, rồi thông tin xét nghiệm, hồ sơ, thời gian và dữ liệu kỹ thuật.
Tên xét nghiệm nguồn được giữ nguyên; ngày MIMIC không tự đổi hoặc dịch sang năm hiện tại.

Mở **Thông tin kỹ thuật của hồ sơ** để xem khóa hồ sơ và hệ thống định danh nguồn.
Nhãn khớp chính xác `Demo patient <chữ số>` được trình bày thành `Hồ sơ bệnh nhân <chữ số>`
trên cả ba trang; các nhãn khác giữ nguyên, không suy diễn tên từ mã định danh.
`display_label` trong API không đổi. Nhãn gốc có thể xem/sao chép trong **Thông tin kỹ thuật của hồ sơ**.
Mở **Xem mã định danh và dữ liệu FHIR** để xem mã bản ghi EMR, namespace và JSON nguyên vẹn.
“Đã hoàn tất (final)” là trạng thái kết quả; “Đã lưu tại EMR” không xác nhận Middleware đã VERIFY.

[Báo cáo triển khai và UI/UX](../../../docs/docs_frontend/emr-ui-implementation-2026-11-05.md).
