# Frontend LIS → FHIR → EMR

Flow Console theo Google Stitch là **giao diện duy nhất** trên cả ba entry point hiện có. Không có app thứ tư, màn legacy hay cửa sổ “Tra cứu chuyên sâu”.

| Entry point | Development | Preview |
|---|---|---|
| LIS | 5173 | 4173 |
| Middleware Monitor | 5174 | 4174 |
| EMR | 5175 | 4175 |

Chạy trong thư mục `frontend`:

```powershell
npm.cmd ci
npm.cmd run dev:lis
# Hoặc dev:monitor / dev:emr
```

Mở `http://127.0.0.1:5173/#/flow`. Có thể chọn trực tiếp bằng `#/flow?result_id=<mã đã encode>`. Các URL trước đây của LIS, Monitor và EMR tự chuyển về `/#/flow`, kể cả đường dẫn hash và đường dẫn trực tiếp. URL chọn kết quả Flow sai vẫn báo lỗi để không mở nhầm kết quả khác.

Biểu tượng hai mũi tên đầu trang chỉ trang trí, giữ nguyên hình thức Stitch; không có click handler, menu hay liên kết. Bố cục LIS – Luồng trao đổi – EMR và bằng chứng giữ nguyên. Các nhãn hồ sơ/kết quả là thông tin, không mở trang khác. Biểu tượng màu cam của Luồng trao đổi vẫn làm mới trạng thái.

Mã giao diện chung ở `apps/lis/src/App.tsx` và `apps/lis/src/flow/`. Hai App còn lại re-export giao diện này. API client và kiểu dữ liệu nằm trong từng workspace được giữ lại; `state/routes.ts` chỉ còn các hàm kiểm tra/chuẩn hóa định danh được client dùng. Router Flow ở `apps/lis/src/flow/routes.ts`.

Bốn trạng thái dựa trên API thật: FINAL chưa Publish, đang xử lý, DELIVERED có bằng chứng xác minh, REJECTED có mã lỗi và trạm lỗi. Không có dữ liệu giả lập hoặc timer tạo thành công trong ứng dụng. Các HTTP fixtures chỉ nằm trong test. Proxy Vite giữ nguyên backend 3101/3102/3103.

```powershell
npm.cmd run build
npm.cmd run check
npm.cmd run lint
npm.cmd run test --workspaces

node apps/lis/tests/browser-flow.mjs
node apps/lis/tests/browser-flow.mjs --app=middleware-monitor
node apps/lis/tests/browser-flow.mjs --app=emr
# Thêm --dev để dùng cổng 5173/5174/5175.
# Nếu server dev của dự án đang chạy: thêm --reuse-server.
node apps/lis/tests/browser-flow.mjs --real
```

Browser test cần Chrome/Edge headless. `--real` chỉ GET các bản ghi đã có; cần ít nhất một FINAL chưa Publish và một DELIVERED. Test tự mở/đóng server của nó; `--reuse-server` kiểm tra server hiện có là Flow Console và không đóng server đó.

Xem [báo cáo dọn legacy và kiểm thử](STITCH_REDESIGN.md). Ảnh và report nằm trong `apps/lis/tests/evidence/stitch-redesign/` (Git ignore).
