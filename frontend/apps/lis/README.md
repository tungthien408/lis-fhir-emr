# Kết quả xét nghiệm LIS – Giai đoạn 2.2

Ứng dụng gọi API LIS thật qua Vite proxy, gồm danh sách có bộ lọc/phân trang và màn hình chi tiết riêng. Không triển khai Publish, Monitor hoặc EMR.

## Chức năng và điều hướng

- Lọc mã bệnh nhân, mã kết quả, mã loại xét nghiệm, trạng thái READY/FINAL/Tất cả; tìm kiếm bằng nút hoặc Enter.
- Gõ chỉ sửa bản nháp. Tìm kiếm mới áp dụng bộ lọc và trở về trang đầu; tìm lại cùng điều kiện và Thử tải lại vẫn gửi yêu cầu mới.
- Khi không có mã kết quả, mỗi trang hiển thị tối đa 10 dòng, gọi GET với `limit=11`, `offset=pageIndex*10`; dòng thứ 11 chỉ xác định có trang sau.
- Xem chi tiết có hai card cạnh nhau ở desktop, xếp dọc ở màn hình ≤1024px, đủ 12 trường API. Giá trị xét nghiệm nổi bật bằng cỡ chữ/độ đậm.
- Nút quay lại hoạt động cả khi chi tiết đang tải hoặc lỗi.
- F5, URL trực tiếp và Back/Forward dùng hash routing, không thêm thư viện.
- URL sai, bộ lọc không được hỗ trợ/lặp, ID/mã hóa URL sai, trạng thái hoặc số trang sai được báo rõ; không tải danh sách rộng hơn.

## Quy ước URL

```text
#/results
#/results?patient_id=P1&test_code=T1&result_status=FINAL&page=3
#/results/<encodedResultId>?patient_id=P1&test_code=T1&result_status=FINAL&page=3
```

`page` bắt đầu từ 1; mặc định 1. Bốn bộ lọc và số trang trong URL chi tiết chỉ để quay lại danh sách, không gửi vào GET chi tiết. URL chi tiết không có ngữ cảnh quay về danh sách mặc định. Không lưu bản nháp chưa tìm kiếm qua F5/rời danh sách.

ID thông thường được `encodeURIComponent` khi tạo hash và đường dẫn API; giải mã đúng một lần. Đường dẫn chi tiết giữ nguyên khoảng trắng của mã không rỗng, chữ hoa/thường, Unicode và ký tự đặc biệt. Bộ lọc tìm kiếm trim hai đầu và chỉ đổi hoa với `MIMIC-P-[0-9]+` (bệnh nhân) / `MIMIC-LAB-[0-9]+` (kết quả), không phân biệt hoa/thường khi nhận biết mẫu. Không đổi hoa ID khác. Mã rỗng/chỉ khoảng trắng/ký tự điều khiển bị từ chối. Hai ID `.` và `..` được chấp nhận trong hash; API client và proxy LIS phối hợp truyền chúng mà không làm thay đổi định danh (chi tiết bên dưới).

## Tra mã kết quả từ danh sách

Bộ lọc xếp theo thứ tự bệnh nhân → kết quả → loại xét nghiệm → trạng thái, hai cột desktop/một cột mobile. Bảng chín cột bổ sung `test_code` sau `patient_id`, cuộn ngang nếu thiếu chỗ.

Khi có `result_id`, `src/api/searchResults.ts` gọi GET chi tiết sẵn có qua `getLisResult`, kiểm tra AND chính xác bệnh nhân/loại/trạng thái trên bản ghi trả về. Không lọc trên trang 10 dòng, không gọi GET danh sách và không phân trang. Chỉ phản hồi 404 đúng hợp đồng bản ghi (`NOT_FOUND`, `Laboratory result not found`) trở thành trạng thái rỗng; 404 route/HTML, lỗi dữ liệu và kết nối vẫn hiển thị lỗi/thử lại. Thay đổi hợp đồng lỗi backend trong tương lai cần cập nhật nhận diện này.

```text
#/results?patient_id=MIMIC-P-10007928&result_id=MIMIC-LAB-100145&test_code=50971&result_status=FINAL
#/results/MIMIC-LAB-100145?patient_id=MIMIC-P-10007928&result_id=MIMIC-LAB-100145&test_code=50971&result_status=FINAL
```

Mã kết quả trong query là bộ lọc danh sách; ID trong path là bản ghi đang xem. Cả bốn bộ lọc được giữ qua F5/quay lại/Back/Forward. Query có mã kết quả luôn dùng trang đầu.

## Truyền ID dấu chấm và giới hạn triển khai

Hash `#/results/.` và `#/results/..` giữ nguyên ID; dạng escape `%2E` trong hash cũng được giải mã đúng một lần. Literal ID `%2E` dùng hash `#/results/%252E`, khác với ID `.`.

Trình duyệt và bộ phân tích URL của proxy đều có thể rút gọn dot segment. Vì vậy client dùng đường dẫn vận chuyển và header riêng cho đúng hai ID dấu chấm:

| ID gốc | Browser GET /api/lis/results/... | X-LIS-Dot-Segment | Raw path proxy GET /api/results/... |
|---|---|---|---|
| `.` | `%252E` | `1` | `%2E` |
| `..` | `%252E%252E` | `1` | `%2E%2E` |
| `%2E` | `%252E` | không có | `%252E` |
| `%2E%2E` | `%252E%252E` | không có | `%252E%252E` |

Proxy riêng LIS bỏ header trước khi chuyển tiếp, dùng `toProxy: true` để giữ raw path và thêm `Vary: X-LIS-Dot-Segment` cho cả hai biến thể có cùng URL vận chuyển; giữ Vary hiện có. Đây là quy ước giữa client và proxy, backend vẫn nhận endpoint/hợp đồng GET cũ và giải mã một lần. Các ID khác giữ encodeURIComponent như trước; không giải mã thêm %, /, +, #, ? hoặc Unicode.

**Vite development và Vite preview bản build đều có cấu hình này.** Thư mục `dist/` chỉ chứa tệp tĩnh, không chứa proxy. Khi triển khai bằng một máy chủ khác, phải cấu hình cùng xử lý raw path/header/Vary ở reverse proxy trước khi coi dot ID hoạt động. Chỉ phục vụ dist với quy tắc rewrite tiền tố cũ chưa đáp ứng dot ID. Không thay backend/Compose hoặc tự tạo dot record để kiểm thử.

Mã: `src/api/resultRequest.ts`, `proxy/lis.ts`, `vite.config.ts`. Bằng chứng mới tại [báo cáo sửa dot ID](tests/evidence/phase-2.2-dot-fix-2026-11-03/BAO_CAO.md).

## Hợp đồng dữ liệu và lỗi

- GET danh sách: `/api/lis/results?limit=11&offset=...`; GET chi tiết: `/api/lis/results/<encodedResultId>`.
- Chi tiết HTTP 200 phải là object đúng 12 trường/kiểu theo `LisResult`, gồm năm trường nullable: `fluid`, `category`, `reference_low`, `reference_high`, `effective_at`. Kiểm tra ID trả về trùng ID yêu cầu.
- Giữ nguyên mọi chuỗi số/đơn vị; cận thấp/cao hiển thị riêng; null hiển thị `—`.
- Thời gian UTC đến giây; ISO gốc và phần lẻ giữ trong `datetime`/`title`. Không đổi múi giờ.
- Chỉ hiển thị READY/FINAL; không suy đoán kết luận hoặc trộn trạng thái trao đổi.
- HTTP 400/404 có thông báo riêng; 503/502, JSON không hợp lệ, cấu trúc sai và mất mạng có Thử tải lại.
- `AbortController` hủy yêu cầu khi đổi truy vấn/ID, thử lại, rời trang. Kết quả gắn với yêu cầu tạo ra nó, phản hồi muộn không thay dữ liệu hiện tại.

## Tổ chức mã

| Tệp | Trách nhiệm |
|---|---|
| `src/App.tsx` | Chọn màn hình, bản nháp bộ lọc và các thao tác danh sách |
| `src/state/routes.ts` | Kiểm tra, đọc và tạo hash URL/ngữ cảnh danh sách |
| `src/hooks/useResultsRoute.ts` | Điều hướng và đồng bộ lịch sử trình duyệt |
| `src/components/ResultDetail.tsx` | Trang chi tiết và 12 trường |
| `src/hooks/useLisResult.ts` | Tải/hủy/thử lại chi tiết, chặn dữ liệu muộn |
| `src/components/ResultsTable.tsx` | Bảng chín cột, nút Xem chi tiết |
| `src/components/ResultFilters.tsx`, `ResultsPagination.tsx` | Bộ lọc và phân trang đã nghiệm thu |
| `src/hooks/useLisResults.ts`, `src/state/results.ts`, `src/api/searchResults.ts` | Tải/hủy tìm kiếm, chuẩn hóa bộ lọc và tra mã kết quả trực tiếp |
| `src/api/lis.ts`, `src/types/lis.ts` | API client và hợp đồng dữ liệu |
| `src/api/resultRequest.ts`, `proxy/lis.ts` | Vận chuyển dot ID và proxy/Vary riêng LIS |
| `tests/results.test.mjs`, `tests/detail.test.mjs`, `tests/dot.test.mjs` | Unit test hồi quy và chi tiết |
| `tests/browser.mjs`, `tests/browser-http.mjs` | Bộ Chrome hồi quy danh sách thật/mô phỏng |
| `tests/browser-detail.mjs` | Bộ Chrome chi tiết thật/mô phỏng |

## Lệnh kiểm tra

Tại `frontend/` (Windows dùng `npm.cmd` nếu PowerShell chặn `npm.ps1`):

```powershell
npm.cmd run dev:lis
npm.cmd run check --workspace apps/lis
npm.cmd run lint
npm.cmd run build:lis
npm.cmd run test --workspace apps/lis
```

Tại `frontend/apps/lis/`, sau khi build:

```powershell
$env:LIS_EVIDENCE_DIR = 'tests/evidence/phase-2.2-2026-11-03'
node tests/browser-detail.mjs
node tests/browser-detail.mjs --real
$env:LIS_EVIDENCE_DIR = 'tests/evidence/phase-2.2-2026-11-03/list-regression'
node --test --test-reporter=spec tests/browser-http.mjs
node tests/browser.mjs
```

Kiểm thử chi tiết dùng preview cổng 5183. Kiểm thử danh sách thật dùng Vite cổng 5173, nhận diện máy chủ đang chạy và không đóng máy chủ có sẵn. Các bộ dùng Chrome headless với hồ sơ riêng; đặt `CHROME_PATH` nếu cần. Chạy tuần tự các bộ dùng cùng cổng. API thật cần backend `127.0.0.1:3101` và dữ liệu đủ trang; không khởi động/sửa backend từ kiểm thử.

HTTP mô phỏng chỉ dùng ở kiểm thử, có nhãn rõ trong JSON. Ca phản hồi muộn buộc trình duyệt kiểm thử bỏ signal khi gửi fetch, ghi nhận signal mà ứng dụng truyền và kiểm tra nó đã bị hủy; cách này cố tình cho phản hồi cũ đến để kiểm tra chặn ghi đè. Không thêm dependency hay ghi database.

Nếu sandbox chặn Chrome/Vite, cần quyền chạy ngoài sandbox. Không xóa cache hoặc dừng máy chủ của người dùng.

## Báo cáo và giới hạn

- [Báo cáo và bằng chứng 2.2](tests/evidence/phase-2.2-2026-11-03/BAO_CAO.md).
- [Bằng chứng nghiệm thu 2.1](tests/evidence/phase-2.1-2026-11-03/BAO_CAO.md) được giữ nguyên.
- Phân trang offset có thể đổi vị trí khi dữ liệu nguồn thay đổi giữa hai yêu cầu.
- Chưa kiểm tra Firefox/Safari hoặc mọi kích thước màn hình.
- Không sửa backend, database, SQL, Compose; không POST, Publish, commit, push hoặc merge.


## Kiểm thử dot ID qua proxy thật

Sau build, tại `frontend/apps/lis/`, đặt thư mục mới riêng cho mỗi lượt để giữ nguyên bằng chứng nghiệm thu:

```powershell
$env:LIS_EVIDENCE_DIR = 'tests/evidence/<thu-muc-moi>/dev-mock'
node tests/browser-dot.mjs --dev
$env:LIS_EVIDENCE_DIR = 'tests/evidence/<thu-muc-moi>/preview-mock'
node tests/browser-dot.mjs
$env:LIS_EVIDENCE_DIR = 'tests/evidence/<thu-muc-moi>/dev-real'
node tests/browser-dot.mjs --dev --real
$env:LIS_EVIDENCE_DIR = 'tests/evidence/<thu-muc-moi>/preview-real'
node tests/browser-dot.mjs --real
```

Chạy tuần tự vì dùng cùng cổng 5183. Chế độ mock khởi động upstream HTTP riêng phía sau proxy Vite, không chặn bằng CDP trước proxy; ghi raw path, ID sau giải mã, header đã bỏ, body/status và dữ liệu DOM. Kiểm tra cache Chrome có Vary, retry 503, native abort và response đến muộn. Chế độ real chỉ GET backend 3101: có thể 404 nếu không có dot record; không coi 404 là ID không hợp lệ và không tạo dữ liệu.

`tests/dot.test.mjs` bổ sung kiểm tra cấp hàm cho routing/client/proxy/cache headers và bảo toàn cấu hình các ứng dụng khác. Các bộ 2.1/2.2 cũ vẫn phải được chạy hồi quy; đừng chạy script bằng chứng cũ với thư mục đầu ra mặc định nếu cần bảo toàn hồ sơ.

## Nghiệm thu hoàn thiện UI/UX ngày 04/11/2026

Sau build, tại `frontend/apps/lis/`:

```powershell
node tests/verify-uiux.mjs
# Chạy riêng một nhóm khi cần:
node tests/verify-uiux.mjs --only=uiux-real,uiux-mock
```

Runner tạo thư mục `tests/evidence/phase-2.2-uiux-2026-11-04/verification-<ngẫu-nhiên>` cho mỗi lượt, không ghi đè nghiệm thu trước. Chạy tuần tự 12 bộ Chrome: UI/UX mới (thật/mô phỏng), danh sách, chi tiết, bộ lọc kết hợp và dot ID qua dev/preview. Cần Chrome và API thật cổng 3101 đang có sẵn; chỉ GET. Nếu sandbox chặn Chrome/Vite cần quyền thực thi ngoài sandbox.

Bằng chứng và giới hạn: [Báo cáo hoàn thiện UI/UX](tests/evidence/phase-2.2-uiux-2026-11-04/BAO_CAO.md).
