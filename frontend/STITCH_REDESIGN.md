# Báo cáo hoàn tất dọn giao diện legacy — 09/11/2026

Nhánh: `feature/frontend/stitch-redesign`. Flow Console theo Stitch là giao diện duy nhất của cả ba frontend. Đợt này hoàn tất việc xóa màn cũ, chuyển hướng và kiểm thử; không triển khai lại Flow Console, API hoặc nghiệp vụ từ đầu.

## 1. Kết quả giao diện và mã nguồn

- Giữ bố cục LIS – Luồng trao đổi – EMR và bằng chứng; không thiết kế lại Flow Console.
- Biểu tượng hai mũi tên ở góc trái header giữ class, màu, vị trí và kích thước 44 × 44 px. Đã đổi từ button mở menu sang phần tử trang trí `span aria-hidden="true"`: không handler, không link, không tab stop và nhấn không đổi URL/gọi API.
- Xóa cửa sổ “Tra cứu chuyên sâu”, thanh điều hướng phụ, ba Workspace và toàn bộ component/hook/CSS chỉ phục vụ màn legacy.
- Các nhãn liên kết bệnh nhân và “Đã lưu EMR” trong thẻ Stitch trở thành nội dung tĩnh. Xóa liên kết chi tiết giao dịch legacy ở nhật ký và thẻ lỗi.
- Hai entry point Monitor/EMR tiếp tục re-export App chung. Không tạo workspace, cổng hoặc ứng dụng thứ tư.
- Giữ API client, validator, kiểu dữ liệu, `useLisResults`, tìm FINAL/phân trang, Publish, polling, mô hình năm trạm, snapshot/FHIR/EMR và đối soát SHA-256. Không thay các file API client hay `flow/api.ts`, `flow/model.ts`, `flow/useFlow.ts` trong đợt dọn này.
- Các file `state/routes.ts` cũ chỉ giữ hàm kiểm tra/chuẩn hóa định danh mà API client dùng; đã bỏ router và hàm tạo URL legacy.
- Rà soát 30 file TS/TSX/CSS trong ba thư mục src: không còn import component cũ, Workspace, menu legacy hoặc liên kết tới URL legacy. Các TSX còn lại là ba App, ba main và FlowConsole.

## 2. Chuyển hướng URL

Router `apps/lis/src/flow/routes.ts` chỉ hỗ trợ `#/flow` và `#/flow?result_id=...`. Các URL cũ/không hỗ trợ về `/#/flow` bằng `history.replaceState`, không render trang legacy và không hiện lỗi cho URL legacy.

Đã kiểm tra trên từng entry point cả development và preview:

- Hash: `#/results`, `#/results/MIMIC-LAB-1?result_status=FINAL`, `#/exchanges`, `#/exchanges/bad`, `#/search?value=x`, `#/patients/key`, `#/result?external_id=x`, `#/results/%ZZ`.
- Đường dẫn trực tiếp: `/results/R1`, `/exchanges/123?status=FAILED`, `/patients/123`, `/search`, `/result?external_id=1`.
- URL chọn kết quả Flow bị lỗi mã hóa/lặp tham số/ID rỗng vẫn báo lỗi, tránh mở nhầm một kết quả khác. Đây không phải URL legacy.
- Unit test giữ định danh đặc biệt của Flow, bao gồm dấu chấm, dấu gạch chéo, percent, Unicode, dấu cách và giải mã đúng một lần.

## 3. Kết quả kiểm thử

| Kiểm tra | Kết quả |
|---|---|
| Build | PASS cả LIS, Middleware Monitor, EMR |
| TypeScript | PASS cả ba workspace |
| Lint | PASS |
| Unit test còn phù hợp | PASS **88**: LIS 44, Monitor 24, EMR 20 |
| Preview 4173 / 4174 / 4175 | PASS **9 nhóm trên mỗi cổng** |
| Development 5173 / 5174 / 5175 | PASS **9 nhóm trên mỗi cổng** |
| API thật qua Flow Console | PASS: FINAL chưa Publish và DELIVERED hiện có; 9 API request, toàn bộ GET, 0 POST |
| Rà soát src | Không còn liên kết/import/component legacy |
| Phạm vi Git | Chỉ frontend thay đổi; không stage, commit hoặc push |

Chín nhóm browser test kiểm tra: A Sẵn sàng; Publish chống nhấp đúp và B Đang xử lý; C DELIVERED với EMR/so khớp; tab JSON/nhật ký và bàn phím; D REJECTED tại SEND; lỗi API 503; mobile 390 px; chuyển hướng URL cũ và icon trang trí; URL Flow sai.

Cả sáu lượt browser đều không có exception JavaScript hoặc lỗi chặn HTTP. Trạng thái A/B/C/D được điều khiển bằng phản hồi HTTP trong bộ test; mã ứng dụng không có fixtures hay timer giả lập thành công. Các test UI/router legacy đã được loại bỏ, còn test API, định danh, precision, lỗi mạng, receipt, VERIFY, hash và logic Flow.

Cổng 5173 đã có server của dự án đang chạy. Lần mở server test ban đầu gặp “Port 5173 is already in use”; sau đó đã xác minh server phục vụ App Flow hiện tại và chạy thành công với `--reuse-server`. Không dừng hoặc thay thế server của người dùng. Server test ở các cổng khác được đóng sau test.

Ba backend 3101/3102/3103 đều trả `/ready` HTTP 200. Kiểm tra thật chỉ đọc dữ liệu đã tồn tại, không Publish mới hoặc thay đổi PostgreSQL.

## 4. Bằng chứng và cách chạy lại

Báo cáo request/exception nằm trong [thư mục evidence](apps/lis/tests/evidence/stitch-redesign/). Ví dụ:

- [LIS dev 5173](apps/lis/tests/evidence/stitch-redesign/mock-development-report.json)
- [Monitor dev 5174](apps/lis/tests/evidence/stitch-redesign/mock-development-middleware-monitor-report.json)
- [EMR dev 5175](apps/lis/tests/evidence/stitch-redesign/mock-development-emr-report.json)
- [LIS preview 4173](apps/lis/tests/evidence/stitch-redesign/mock-preview-report.json)
- [Monitor preview 4174](apps/lis/tests/evidence/stitch-redesign/mock-preview-middleware-monitor-report.json)
- [EMR preview 4175](apps/lis/tests/evidence/stitch-redesign/mock-preview-emr-report.json)
- [API thật](apps/lis/tests/evidence/stitch-redesign/real-preview-report.json)

Ảnh từ bản build đã được cập nhật: [A](apps/lis/tests/evidence/stitch-redesign/mock-preview-ready.png), [B](apps/lis/tests/evidence/stitch-redesign/mock-preview-processing.png), [C](apps/lis/tests/evidence/stitch-redesign/mock-preview-delivered.png), [D](apps/lis/tests/evidence/stitch-redesign/mock-preview-rejected.png); [DELIVERED dùng API thật](apps/lis/tests/evidence/stitch-redesign/real-preview-delivered.png). [Trang đối chiếu Stitch/React](apps/lis/tests/evidence/stitch-redesign/comparison.html) đọc các ảnh này.

Chạy trong `frontend`:

```powershell
npm.cmd run build
npm.cmd run check
npm.cmd run lint
npm.cmd run test --workspaces
node apps/lis/tests/browser-flow.mjs
node apps/lis/tests/browser-flow.mjs --app=middleware-monitor
node apps/lis/tests/browser-flow.mjs --app=emr
node apps/lis/tests/browser-flow.mjs --dev --reuse-server
node apps/lis/tests/browser-flow.mjs --dev --app=middleware-monitor
node apps/lis/tests/browser-flow.mjs --dev --app=emr
node apps/lis/tests/browser-flow.mjs --real
```

Bỏ `--reuse-server` nếu cổng dev tương ứng chưa có server. Tùy chọn này chỉ tái sử dụng server dev sau khi kiểm tra App mà server đang phục vụ.

## 5. Danh sách file của đợt dọn legacy

Đường dẫn tính từ `frontend/`; các thay đổi Stitch của đợt trước vẫn được giữ trong working tree.

**Thêm:**
- `apps/lis/src/flow/routes.ts`.
- `apps/lis/tests/flow-routes.test.mjs`.

**Sửa:**
- `apps/lis/src/App.tsx`, `apps/lis/src/flow/FlowConsole.tsx`, `apps/lis/src/flow/stitch.css`, `apps/lis/src/state/routes.ts`, `apps/lis/package.json`.
- `apps/emr/src/main.tsx`, `apps/emr/src/state/routes.ts`.
- `apps/middleware-monitor/src/main.tsx`, `apps/middleware-monitor/src/state/routes.ts`.
- `apps/lis/tests/browser-flow.mjs`, `apps/lis/tests/helpers/http-browser.mjs`, `apps/lis/tests/detail.test.mjs`, `apps/lis/tests/results.test.mjs`, `apps/lis/tests/dot.test.mjs`, `apps/lis/tests/search.test.mjs`.
- `apps/emr/tests/emr.test.mjs`, `apps/middleware-monitor/tests/exchange.test.mjs`.
- `README.md`, `apps/lis/README.md`, `apps/emr/README.md`, `apps/middleware-monitor/README.md`, `STITCH_REDESIGN.md`.

**Xóa giao diện/hook/CSS legacy:**
- LIS: `src/LisWorkspace.tsx`, `src/App.css`; `src/components/PublishPanel.tsx`, `ResultDetail.tsx`, `ResultFilters.tsx`, `ResultsPagination.tsx`, `ResultsTable.tsx`; `src/hooks/useLisResult.ts`, `usePublishStatus.ts`, `useResultsRoute.ts`.
- Monitor: `src/MonitorWorkspace.tsx`, `src/index.css`, `src/hooks/useExchanges.ts`; `src/components/Common.tsx`, `ExchangeDetail.tsx`, `ExchangeList.tsx`.
- EMR: `src/EmrWorkspace.tsx`, `src/index.css`, `src/components/Views.tsx`, `src/hooks/useRead.ts`, `src/state/presentation.ts`.

**Xóa các test chỉ dành cho giao diện cũ:**
- LIS `tests/`: `browser.mjs`, `browser-uiux.mjs`, `browser-publish.mjs`, `browser-publish-runtime.mjs`, `browser-http.mjs`, `browser-dot.mjs`, `browser-detail.mjs`, `browser-conditions.mjs`, `verify-uiux.mjs`, `snapshot-acceptance.mjs`, `probe-dot-transport.mjs`.
- EMR và Monitor: `tests/browser.mjs`, `tests/helpers/browser.mjs` của mỗi app.
- Trong các unit test hỗn hợp, chỉ bỏ phần render/router legacy; giữ các kiểm tra API và nghiệp vụ.

## 6. Giới hạn còn lại

- Chưa Publish một giao dịch mới vào backend thật trong đợt này. B/D được kiểm thử bằng HTTP fixtures; A/C được kiểm tra thêm bằng API và dữ liệu hiện có.
- Mã lỗi 422 từ Monitor vẫn là `REMOTE_VALIDATION_ERROR`; không suy đoán `PATIENT_NOT_LINKED`. Đây là giới hạn thông tin API đang có.
- Đã kiểm tra Chrome headless desktop/mobile, chưa kiểm tra thêm Firefox/Safari.
- Các nhãn hồ sơ/kết quả trên màn chính không còn mở trang chi tiết, đúng yêu cầu chỉ giữ Flow Console.
- Các ảnh/report là artifact bị Git ignore. ZIP gốc vẫn untracked, thư mục giải nén ở Temp ngoài repo. Không thay backend, Docker, PostgreSQL hoặc `.env`; không commit/push/PR.
