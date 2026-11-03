# Danh sách kết quả xét nghiệm LIS – Giai đoạn 2.1

Ứng dụng dùng dữ liệu từ API LIS thật qua Vite proxy. Đợt này hoàn thiện danh sách; chưa có Publish hoặc trang chi tiết.

## Chức năng

- Thanh tiêu đề phía trên, không có sidebar.
- Lọc theo mã bệnh nhân, mã xét nghiệm và trạng thái kết quả READY/FINAL/Tất cả.
- Tìm kiếm bằng nút hoặc Enter; không gọi API theo từng ký tự.
- Xóa bộ lọc về trang đầu. Tìm lại cùng điều kiện vẫn tải lại dữ liệu.
- Chuyển trang giữ bộ lọc đã áp dụng, kể cả khi người dùng đang nhập điều kiện khác.
- Bảng tám cột; nút Xem chi tiết luôn vô hiệu hóa trong giai đoạn này.
- Đang tải, danh sách rỗng, lỗi HTTP/kết nối/phản hồi không hợp lệ và nút Thử tải lại.
- Hủy yêu cầu cũ; phản hồi cũ không ghi đè kết quả của truy vấn mới.
- Giao diện bộ lọc thích ứng với màn hình hẹp; bảng cuộn ngang trong vùng riêng.

## Phân trang và dữ liệu

Mỗi yêu cầu dùng `limit=11`, `offset=pageIndex*10`. Chỉ hiển thị mười dòng đầu; dòng thứ 11 cho biết có thể sang trang sau. Không tính tổng số kết quả hoặc tổng số trang.

Ô mã định danh rỗng hoặc chỉ chứa khoảng trắng không được gửi thành bộ lọc. Mọi ký tự của mã không rỗng được giữ nguyên, kể cả khoảng trắng đầu/cuối và chữ hoa/thường.

Số xét nghiệm và đơn vị giữ nguyên từ API. Thời gian hiển thị `YYYY-MM-DD HH:mm:ss` theo UTC, không chuyển sang múi giờ Việt Nam. Giá trị thời gian `null` hiển thị `—`. Chuỗi ISO gốc, bao gồm phần lẻ giây, được giữ trong dữ liệu và thuộc tính `datetime`/`title` của phần tử `time`.

READY/FINAL là trạng thái kết quả xét nghiệm, không phải trạng thái trao đổi dữ liệu.

## Tổ chức mã nguồn

| Tệp | Trách nhiệm |
|---|---|
| `src/App.tsx` | Khung trang, bộ lọc đang nhập, thao tác tìm kiếm/xóa/chuyển trang/thử lại |
| `src/components/ResultFilters.tsx` | Biểu mẫu ba bộ lọc |
| `src/components/ResultsTable.tsx` | Bảng tám cột và thao tác chưa khả dụng |
| `src/components/ResultsPagination.tsx` | Nút Trang trước/Trang sau và số trang hiện tại |
| `src/hooks/useLisResults.ts` | Tải dữ liệu, hủy yêu cầu, gắn kết quả với truy vấn tương ứng |
| `src/state/results.ts` | Bộ lọc đã áp dụng, vị trí trang, lấy mười dòng và định dạng thời gian |
| `src/api/lis.ts` | GET qua proxy, giữ định danh, kiểm tra phản hồi, đọc lỗi |
| `src/types/lis.ts` | Kiểu dữ liệu và nullable theo hợp đồng |
| `src/App.css` | Kế thừa màu sắc/bố cục cũ, thêm biểu mẫu và phân trang thích ứng |
| `tests/results.test.mjs` | Kiểm thử tự động API client, phân trang, truy vấn và kết xuất thành phần |
| `tests/browser.mjs` | Kiểm thử Chrome/Chromium với backend thật, chỉ gửi GET |

Không thêm dependency. Các kiểm thử dùng công cụ Node.js, React và TypeScript đã có.

## Lệnh chạy và kiểm tra

Đứng tại `frontend/`, sau khi đã cài dependency của workspace:

```powershell
npm run dev:lis
npm run build:lis
npm run check --workspace apps/lis
npm run lint
npm run test --workspace apps/lis
npm run test:browser --workspace apps/lis
```

Kiểm thử trình duyệt cần API thật ở `http://127.0.0.1:3101` với ít nhất 11 kết quả và một mã xét nghiệm có hơn mười kết quả. Script tìm Chrome/Edge trên Windows hoặc Chrome/Chromium trên Linux; có thể chỉ định đường dẫn thực thi bằng biến môi trường `CHROME_PATH`.

Nếu cổng 5173 đang phục vụ đúng mã LIS hiện tại, script dùng máy chủ đó. Nếu chưa có máy chủ, script khởi động Vite và đóng sau khi xong. Trình duyệt kiểm thử dùng hồ sơ riêng trong `node_modules/.cache/lis-browser/`, được đóng khi kết thúc. Script không dừng máy chủ LIS đã chạy sẵn.

Trên Windows sandbox, Vite có thể bị chặn cập nhật cache `.vite` với lỗi EPERM. Khi gặp lỗi này, chạy kiểm thử từ terminal host có quyền phù hợp; không xóa ép cache của phiên Vite đang chạy.

Unit test dùng phản hồi HTTP được kiểm soát riêng để kiểm tra lỗi và nullable. Các phản hồi này không được đưa vào mã ứng dụng, không ghi database và không được coi là bằng chứng tích hợp dữ liệu thật.

## Kết quả kiểm chứng ngày 03/11/2026

Môi trường: Node.js 24.11.0, npm workspaces, Chrome headless và API LIS thật.

| Hạng mục | Kết quả |
|---|---|
| TypeScript LIS | Đạt |
| ESLint toàn frontend | Đạt |
| Build LIS | Đạt |
| Unit test | 12/12 đạt |
| API trực tiếp | GET danh sách trả HTTP 200, limit 11 và offset 0 |
| Danh sách qua trình duyệt/proxy | Đối chiếu mã kết quả với GET backend thật; hiển thị đúng mười dòng, tám cột, thời gian UTC |
| Bộ lọc | Gõ không gửi yêu cầu; Enter tìm kiếm; kết hợp ba điều kiện khớp kết quả backend |
| Phân trang | Trước/Sau gửi đúng offset và giữ bộ lọc đã áp dụng khi các ô đang nhập đã thay đổi |
| Xóa bộ lọc | Xóa ba trường và tải lại trang đầu |
| Danh sách rỗng | Tra một mã không tồn tại qua API thật; hiển thị trạng thái rỗng |
| Mất kết nối/thử lại | Tạm đặt trình duyệt kiểm thử ngoại tuyến rồi kết nối lại; hiển thị lỗi và tải lại thành công |
| Phản hồi đến muộn | Trì hoãn phản hồi thật của truy vấn cũ, cho truy vấn mới hoàn tất trước; kết quả mới được giữ nguyên |
| Màn hình hẹp | Kiểm tra 375px, không tràn ngang toàn trang, bảng cuộn ngang được; đã xem ảnh chụp |
| Lỗi JavaScript chưa xử lý | Không phát hiện trong lượt kiểm thử trình duyệt |

Lượt kiểm thử trình duyệt đầu tiên gặp giới hạn cache sandbox, rồi phát hiện cổng 5173 đã được sử dụng. Script được điều chỉnh để nhận diện và dùng đúng máy chủ LIS hiện có. Một lượt khác cần điều chỉnh cách mô phỏng phím Enter của công cụ kiểm thử; lượt cuối cùng đạt toàn bộ các kiểm tra nêu trên.

## Giới hạn và phạm vi bàn giao

Bằng chứng nghiệm thu bổ sung ngày 03/11/2026: [Báo cáo Giai đoạn 2.1](tests/evidence/phase-2.1-2026-11-03/BAO_CAO.md). Đã kiểm tra trên trình duyệt các tổng 10/11/20/21, ô số `0`/`-2.50`/thập phân dài và phục hồi HTTP 503/400/502 HTML bằng HTTP mô phỏng, đồng thời chạy lại bộ API thật. Báo cáo này cập nhật giới hạn bằng chứng của lượt kiểm tra trước bên dưới; không mở rộng chức năng sang 2.2.

Sau `npm run build:lis`, tại `frontend/apps/lis/` chạy `node --test --test-reporter=spec tests/browser-http.mjs`. Đặt `LIS_EVIDENCE_DIR` để lưu JSON/ảnh vào thư mục riêng. Bộ kiểm thử không yêu cầu backend, dùng preview riêng cổng 5183 và không thêm dependency. Xem báo cáo để biết lệnh tái hiện đầy đủ và đối chiếu Git có tính file untracked.

- Trường hợp nullable, lỗi HTTP JSON/không JSON và các kích thước trang 0/1/9/10/11 được kiểm chứng bằng unit test; chưa khẳng định tất cả trường hợp đó có sẵn trong dataset thật.
- Chưa kiểm chứng trên Firefox/Safari hoặc mọi kích thước màn hình.
- Phân trang offset đọc dữ liệu tại từng thời điểm; dữ liệu nguồn thay đổi giữa hai yêu cầu có thể làm vị trí bản ghi thay đổi.
- Nút Xem chi tiết chưa hoạt động theo đúng phạm vi 2.1. Chưa triển khai 2.2, Publish, Monitor hoặc EMR.
- Không sửa backend, database, Compose hoặc hợp đồng API. Không POST, không tạo dữ liệu thực nghiệm và không commit/push/merge.
