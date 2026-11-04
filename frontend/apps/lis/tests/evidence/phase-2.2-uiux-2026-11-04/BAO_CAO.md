# Báo cáo hoàn thiện UI/UX LIS Giai đoạn 2.1–2.2

Ngày 04/11/2026 (Asia/Bangkok). Phạm vi: LIS trong repository hiện tại, dừng sau triển khai và kiểm thử. Không Publish/Giai đoạn 2.3.

## 1. Kết quả

Đã triển khai đủ bộ lọc bốn trường, tìm trực tiếp theo mã kết quả, bảng chín cột và màn hình chi tiết hai card. Đã kiểm thử giao diện thật trên **Google Chrome headless 156.0.8078.80**, qua Vite proxy tới API thật `127.0.0.1:3101`. Đã quan sát trực quan ảnh danh sách, chi tiết desktop và chi tiết mobile toàn trang; đối chiếu nội dung DOM với dữ liệu API. Không chỉ căn cứ vào HTTP 200 hay unit test.

- **36/36 unit test đạt.**
- **12/12 bộ Chrome đạt, tổng 137/137 ca/nhóm kiểm tra đạt.** Mỗi nhóm có thể chứa nhiều bước hoặc nhiều biến thể dữ liệu.
- TypeScript, lint toàn frontend và build LIS đều exit 0.
- 20/20 ca UI/UX mới dùng API thật; 21/21 ca mới dùng HTTP mô phỏng. Các ca lỗi, dữ liệu biên được ghi nhãn nguồn riêng.
- Chi tiết thực tế: `MIMIC-LAB-100145` / `MIMIC-P-10007928` / `50971` / Potassium / `3.6` / `mEq/L` / `FINAL` / `2129-04-05 21:30:00` UTC.

Bằng chứng chính: [tổng hợp](summary.json), [kết quả 12 bộ Chrome](verification-hQEfyw/verification.json), [20 ca API thật và DOM/HTTP](verification-hQEfyw/uiux-real/browser-uiux.json), [21 ca HTTP mô phỏng](verification-hQEfyw/uiux-mock/browser-uiux.json).

## 2. Thay đổi đã triển khai

- Bốn ô đúng thứ tự: Mã bệnh nhân, Mã kết quả xét nghiệm, Mã loại xét nghiệm, Trạng thái kết quả. Hai ô/hàng ở desktop; một cột trên mobile. Có placeholder riêng, Tìm kiếm/Enter và Xóa bộ lọc.
- Có gợi ý khi nhập `MIMIC-LAB-...` vào mã loại xét nghiệm, không tự chuyển hoặc bỏ nội dung người dùng nhập.
- Trim bộ lọc trước khi tìm. Chỉ chuẩn hóa chữ hoa với `MIMIC-P-[0-9]+` cho bệnh nhân và `MIMIC-LAB-[0-9]+` cho kết quả (nhận biết mẫu không phân biệt hoa/thường). Quy ước được đối chiếu từ `database/seed/01_reference_data.sql`, `database/seed/02_lis_results.sql` và bản ghi API thật. ID khác giữ nguyên hoa/thường và ký tự bên trong.
- Bảng đủ chín cột theo đặc tả, bổ sung `test_code` sau bệnh nhân; các mã không bị cắt, bảng có vùng cuộn ngang riêng.
- Thêm thông báo tải thành công; giữ trạng thái loading/rỗng/lỗi URL/lỗi API hoặc mạng, thử lại và chống phản hồi muộn.
- URL lưu đủ bốn bộ lọc; F5, xem chi tiết, quay lại và Back/Forward giữ ngữ cảnh. Bản nháp chưa tìm kiếm không trở thành bộ lọc đã áp dụng.
- Chi tiết có dòng mã kết quả, badge READY/FINAL và nút quay lại. Hai card sáu trường/card; desktop cạnh nhau, tablet/mobile xếp dọc. Các trường con cũng về một cột trên mobile.
- Giá trị xét nghiệm dùng chữ 28px/đậm, không dùng màu để suy diễn bất thường. Số/đơn vị giữ nguyên chuỗi API; năm trường nullable dùng `—`; UTC hiển thị đến giây, ISO gốc giữ trong datetime/title. Không thay `result_status`, không đưa kết luận lâm sàng.

## 3. Phương án tìm bằng result_id

`src/api/searchResults.ts` là hàm chung cho luồng tải danh sách:

1. Chuẩn hóa bộ lọc ở phạm vi nêu trên.
2. Nếu không có `result_id`, giữ GET danh sách cũ, `limit=11`, `offset=pageIndex*10`, hiển thị tối đa 10 dòng; dòng 11 xác định trang sau.
3. Nếu có `result_id`, gọi `getLisResult` với GET chi tiết sẵn có. Không gọi GET danh sách và không lọc trên 10 dòng của trang hiện tại.
4. Kiểm tra AND chính xác `patient_id`, `test_code`, `result_status` trên bản ghi vừa trả về. Khớp hiển thị một dòng, không khớp hiển thị rỗng.
5. Chỉ 404 bản ghi đúng hợp đồng backend hiện tại (`error.code=NOT_FOUND`, `error.message=Laboratory result not found`) được đổi thành rỗng. 404 route/HTML, 400, 502/503, JSON/cấu trúc sai, sai ID và mạng lỗi vẫn ở trạng thái lỗi. Điều này tránh coi route hỏng là mã không tồn tại.
6. Có mã kết quả thì luôn trang đầu, không hiển thị phân trang. Context trong URL chi tiết vẫn giữ đủ bốn bộ lọc.
7. Dùng lại mã hóa một lần và cơ chế dot segment/header/proxy của 2.2. Không thay `src/api/resultRequest.ts`, `proxy/lis.ts`, `vite.config.ts`, backend hoặc database.
8. Hook giữ AbortController và kết quả gắn với object query; phản hồi cũ không ghi đè query mới.

## 4. Kiểm thử từng trường hợp nghiệm thu trên API thật

Nguồn chi tiết từng bước, request và dữ liệu DOM nằm trong [browser-uiux.json](verification-hQEfyw/uiux-real/browser-uiux.json). Các kiểm tra sau đều PASS:

| Trường hợp | Kết quả quan sát |
|---|---|
| Danh sách mặc định | Bốn nhãn đúng thứ tự, bộ lọc hai cột, bảng chín cột; 10 dòng khớp API |
| `MIMIC-P-10007928` | Hiển thị kết quả đúng bệnh nhân |
| `mimic-p-10007928` | GET gửi mã chuẩn, dữ liệu khớp ca chữ hoa |
| `  mimic-p-10007928  ` | Trim và chuẩn hóa trước GET |
| `MIMIC-LAB-100145` | Một GET chi tiết, một dòng đúng mã, không phân trang |
| `mimic-lab-100145` | Gửi `MIMIC-LAB-100145`, dữ liệu đúng |
| `  MiMiC-LaB-100145  ` | Trim và chuẩn hóa, ô nhập sau tìm hiển thị mã chuẩn |
| ` 50971 ` | Gửi `test_code=50971`, danh sách khớp dữ liệu backend |
| Bốn bộ lọc tương thích | Đúng một dòng Potassium của bệnh nhân yêu cầu |
| Mã kết quả đúng nhưng bệnh nhân `OTHER` | Rỗng dù GET chi tiết HTTP 200 |
| Mã kết quả đúng nhưng loại `50912` | Rỗng dù GET chi tiết HTTP 200 |
| Mã kết quả FINAL nhưng lọc READY | Rỗng dù GET chi tiết HTTP 200 |
| Mã kết quả không tồn tại | 404 đúng hợp đồng trở thành thông báo không có kết quả, không có alert |
| Mã bệnh nhân không tồn tại | Danh sách rỗng, không báo lỗi URL/kết nối |
| Mã loại không tồn tại | Danh sách rỗng |
| Nhập MIMIC-LAB vào mã loại | Có gợi ý, vẫn gửi đúng bộ lọc người dùng đã nhập, không chuyển ô |
| Xóa bộ lọc | Cả bốn ô rỗng, URL mặc định, trở lại trang 1 |
| Chi tiết/F5/quay lại/Back/Forward | Giữ đủ bốn bộ lọc, đúng bản ghi và URL |
| Phân trang/bản nháp | offset 10 ở trang 2; mã bản nháp chưa tìm không đi vào GET; quay lại giữ trang |
| Desktop/tablet/mobile | 12 trường đúng API; card hai/một/một cột ở 1440/768/375px, không tràn trang |
| `result_id=.` | Wire path `%252E` và marker đúng, API thật trả 404 bản ghi, UI rỗng |
| `result_id=..` | Wire path `%252E%252E` và marker đúng, API thật trả 404 bản ghi, UI rỗng |

Bảng trên mô tả 20 nhóm của bộ UI/UX thật; một số nhóm gộp nhiều bước điều hướng/bố cục. Bằng chứng API thật không dùng CDP fulfill hoặc thay body/status. Quan sát fetch đọc response clone, gọi fetch gốc với nguyên arguments/signal.

## 5. Ảnh giao diện mới

Ảnh do bộ UI/UX API thật chụp; ảnh mobile chụp toàn trang để thấy đủ 12 trường:

- [Danh sách desktop, đủ chín cột](verification-hQEfyw/uiux-real/list-desktop.png).
- [Danh sách bốn bộ lọc, đúng một kết quả](verification-hQEfyw/uiux-real/list-result-combined.png).
- [Danh sách mobile, vùng bảng cuộn ngang](verification-hQEfyw/uiux-real/list-mobile.png).
- [Chi tiết desktop, hai card](verification-hQEfyw/uiux-real/detail-desktop.png).
- [Chi tiết tablet](verification-hQEfyw/uiux-real/detail-tablet.png).
- [Chi tiết mobile toàn trang](verification-hQEfyw/uiux-real/detail-mobile.png).
- [Trạng thái rỗng với mã kết quả không tồn tại](verification-hQEfyw/uiux-real/empty-result-id.png).

Đã xem trực quan ảnh danh sách desktop mặc định, danh sách lọc một kết quả, chi tiết desktop và mobile. Assertion DOM kiểm tra dữ liệu từng ô, số cột, 12 trường chi tiết, breakpoint và chiều rộng trang.

## 6. Unit test, TypeScript, lint và build

Thực thi tại `frontend/`, tất cả exit 0 trên phiên bản mã đã nghiệm thu:

| Lệnh | Kết quả | Log |
|---|---|---|
| `npm.cmd run test --workspace apps/lis` | 36/36 đạt, 0 bỏ qua | [unit.log](checks/unit.log) |
| `npm.cmd run check --workspace apps/lis` | TypeScript đạt | [typescript.log](checks/typescript.log) |
| `npm.cmd run lint` | Lint toàn frontend đạt | [lint.log](checks/lint.log) |
| `npm.cmd run build:lis` | TypeScript + Vite production build đạt | [build.log](checks/build.log) |

Unit mới kiểm tra chuẩn hóa đúng phạm vi, AND ba bộ lọc, GET trực tiếp ngoài trang hiện tại, giữ phân trang cũ, phân biệt 404 bản ghi/route, mã hóa đặc biệt, truyền signal hủy và round trip bốn bộ lọc. Assertion cũ được cập nhật theo hai thay đổi chủ ý của đặc tả: trim bộ lọc và bảng chín cột; bảo toàn ID đường dẫn chi tiết vẫn được kiểm tra.

## 7. Kết quả hồi quy Chrome

Runner: `node tests/verify-uiux.mjs` tại `frontend/apps/lis/`. Mỗi lượt dùng thư mục mới ngẫu nhiên; dừng khi có bộ thất bại. Lượt hoàn tất này: `verification-hQEfyw`.

| Bộ | Nguồn dữ liệu | Số ca đạt |
|---|---|---:|
| [conditions-http](verification-hQEfyw/conditions-http/conditions-mock.json) | HTTP mô phỏng, ba bộ lọc qua trang 1/2/3 | 10/10 |
| [conditions-real](verification-hQEfyw/conditions-real/conditions-real.json) | API thật, ba bộ lọc và ngữ cảnh | 8/8 |
| [detail-http](verification-hQEfyw/detail-http/detail-http-browser.json) | HTTP mô phỏng, dữ liệu biên/lỗi/hủy/phản hồi muộn | 6/6 |
| [detail-real](verification-hQEfyw/detail-real/detail-real-browser.json) | API thật, 12 trường và điều hướng 2.2 | 3/3 |
| [dot-dev-http](verification-hQEfyw/dot-dev-http/browser-dot.json) | HTTP upstream mô phỏng qua proxy dev thật | 22/22 |
| [dot-dev-real](verification-hQEfyw/dot-dev-real/browser-dot.json) | API thật qua Vite dev | 5/5 |
| [dot-preview-http](verification-hQEfyw/dot-preview-http/browser-dot.json) | HTTP upstream mô phỏng qua proxy preview thật | 22/22 |
| [dot-preview-real](verification-hQEfyw/dot-preview-real/browser-dot.json) | API thật qua Vite preview | 5/5 |
| [list-http](verification-hQEfyw/list-http/http-browser.json) | HTTP mô phỏng, phân trang 10/11/20/21 và lỗi | 10/10 |
| [list-real](verification-hQEfyw/list-real/real-browser.json) | API thật, hồi quy danh sách 2.1 | 5/5 |
| [uiux-mock](verification-hQEfyw/uiux-mock/browser-uiux.json) | HTTP mô phỏng CDP, UI/UX mới | 21/21 |
| [uiux-real](verification-hQEfyw/uiux-real/browser-uiux.json) | API thật, UI/UX mới | 20/20 |

Tổng 137/137. Mọi bộ kết thúc exit 0; không có JavaScript exception hoặc lỗi interception trong các báo cáo tương ứng. Chỉ GET được thực thi.

Hồi quy bao gồm giữ số 0, số âm và chuỗi thập phân dài; nullable; UTC và ISO gốc; READY/FINAL; lỗi 400/404/503/502 HTML, 200 HTML, JSON/cấu trúc sai, mạng; thử lại cùng ID; URL lỗi không gửi GET; hủy và phản hồi muộn; ID có Unicode, khoảng trắng, `/ + % ? #`; literal `%2E` phân biệt dot ID; cache Vary, dev/preview và F5/Back/Forward.

API thật chưa có bản ghi `.`/`..`: đã xác minh đường truyền tới backend và 404 đúng bản ghi, không kết luận đã xem được nội dung dot record thật. Upstream mô phỏng sau proxy thật kiểm tra HTTP 200 và nội dung DOM của dot record, không tạo dữ liệu trong database.

Các lượt trước trong cùng thư mục mới được giữ lại: `real/` dừng khi Chrome bị sandbox đóng; `real-run-2/` phát hiện ô nhập còn giữ chữ thường sau tìm lại cùng URL. Đã sửa đồng bộ ô nhập khi submit; `real-run-3/` và toàn bộ lượt cuối đều đạt. Không ghi đè hồ sơ nghiệm thu ngày 03/11.

## 8. Danh sách file thay đổi trong đợt này

Đường dẫn dưới đây tương đối với `frontend/apps/lis/`. Một số file vốn đã có thay đổi/chưa tracked từ 2.2 khi bắt đầu; danh sách này chỉ chỉ ra các file được chỉnh thêm trong đợt UI/UX.

- `README.md`
- `src/App.tsx`
- `src/App.css`
- `src/api/lis.ts`
- `src/api/searchResults.ts`
- `src/components/ResultFilters.tsx`
- `src/components/ResultsTable.tsx`
- `src/components/ResultDetail.tsx`
- `src/hooks/useLisResults.ts`
- `src/state/results.ts`
- `src/state/routes.ts`
- `tests/results.test.mjs`
- `tests/detail.test.mjs`
- `tests/search.test.mjs`
- `tests/browser.mjs`
- `tests/browser-http.mjs`
- `tests/browser-conditions.mjs`
- `tests/browser-uiux.mjs`
- `tests/verify-uiux.mjs`

Ngoài ra có thư mục bằng chứng mới `tests/evidence/phase-2.2-uiux-2026-11-04/`: báo cáo này, JSON/DOM/HTTP, ảnh PNG, log, trạng thái Git và [SHA-256 mã nguồn](source-sha256.json). Không thêm thư viện/dependency.

## 9. Giới hạn và trạng thái Git

- Chỉ xác nhận Chrome trên Windows ở các viewport đã nêu; chưa xác nhận Firefox/Safari hoặc mọi độ phân giải.
- Các lỗi/mạng, số cực dài, nullable và dot record 200 chủ yếu dùng dữ liệu HTTP kiểm soát để kiểm tra biên; không ghi chúng vào API/database thật. Dữ liệu API thật minh họa bản ghi FINAL; biến thể READY còn được kiểm tra trong bộ dữ liệu mô phỏng/unit.
- Nhận diện 404 bản ghi phụ thuộc hợp đồng mã/thông điệp backend hiện tại. Nếu hợp đồng đổi, cần cập nhật frontend; hiện tại không sửa backend để tạo mã lỗi mới.
- Phân trang offset giữ đặc tính cũ: vị trí có thể đổi nếu dữ liệu nguồn đổi giữa hai GET.
- Bộ lọc trim khoảng trắng theo đặc tả mới; ID đường dẫn chi tiết vẫn được bảo toàn nguyên vẹn. Không chuẩn hóa tùy ý ID ngoài mẫu MIMIC.
- Khi phục vụ `dist/` bằng máy chủ khác Vite, vẫn cần reverse proxy đáp ứng quy ước dot ID/header/Vary đã có từ 2.2. Đợt này không triển khai hosting/Publish.

Git hiện tại còn thay đổi chưa commit, bao gồm cả công việc 2.2 có sẵn trước khi bắt đầu. [Trạng thái Git đầy đủ](git-status.txt); [HEAD](git-head.txt). Không có file staged; không commit, push hoặc merge. Không sửa backend/database/Compose hay giao diện Middleware Monitor/EMR. Giữ máy chủ của người dùng đang chạy; các server/browser do bộ kiểm thử tạo đã được đóng khi kết thúc.

**Dừng sau báo cáo và kiểm thử; chưa commit.**
