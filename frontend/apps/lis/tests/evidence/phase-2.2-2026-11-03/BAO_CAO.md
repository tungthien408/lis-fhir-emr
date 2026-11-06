# Báo cáo bàn giao Giai đoạn 2.2 – Chi tiết kết quả LIS

Ngày bàn giao: 03/11/2026, múi giờ Asia/Bangkok. Phạm vi: frontend LIS và tài liệu frontend. Kết quả dưới đây phân biệt API thật, HTTP mô phỏng và kiểm tra mã/Git.

## 1. Nhánh, commit nền và Git

- Nhánh trước/sau triển khai: `feature/frontend/lis-emr-ui`.
- HEAD trước/sau: `e47af51a1fca10092e22297aadbdcc5e75297f6d` (`e47af51`), đúng commit nền người dùng yêu cầu.
- Working tree trước triển khai sạch, không có thay đổi chưa rõ nguồn gốc. Xem [baseline.json](baseline.json).
- Working tree bàn giao có các thay đổi chưa commit được liệt kê ở mục 2 và [git-state.json](git-state.json), bao gồm file untracked.
- Không stage, commit, push hoặc merge. Index giữ nguyên.
- Chỉ thay đổi `frontend/apps/lis/` và `frontend/README.md`. Backend, PostgreSQL, SQL, Compose, dependency/lockfile và thư mục bằng chứng 2.1 giữ nguyên.

## 2. Danh sách file thay đổi

16 file mã nguồn/kiểm thử/tài liệu ngoài thư mục bằng chứng:

| File | Loại | Nội dung |
|---|---|---|
| `frontend/README.md` | Sửa | Cập nhật limit 11, bộ lọc, phân trang và màn hình chi tiết; phân biệt lịch sử workspace |
| `frontend/apps/lis/README.md` | Sửa | Chức năng 2.2, URL, hợp đồng, lệnh tái hiện và giới hạn |
| `src/App.tsx` | Sửa | Chọn trang qua hash, bản nháp bộ lọc, điều hướng danh sách/chi tiết |
| `src/App.css` | Sửa | Bố cục hai cột/một cột, định dạng trường chi tiết |
| `src/api/lis.ts` | Sửa | GET chi tiết, kiểm tra ID và 12 trường, tái sử dụng đọc lỗi |
| `src/components/ResultsTable.tsx` | Sửa | Kích hoạt Xem chi tiết bằng ID của dòng |
| `src/components/ResultDetail.tsx` | Mới | Màn hình chi tiết đủ 12 trường, trạng thái tải/lỗi/thử lại/quay lại |
| `src/hooks/useLisResult.ts` | Mới | Tải chi tiết, AbortController, gắn phản hồi với yêu cầu |
| `src/hooks/useResultsRoute.ts` | Mới | Lịch sử trình duyệt, hashchange và tải lại cùng URL |
| `src/state/routes.ts` | Mới | Đọc/tạo URL, xác thực tham số và ID, giữ ngữ cảnh |
| `tests/results.test.mjs` | Sửa | Giữ 12 kiểm thử cũ; cập nhật nút chi tiết hoạt động |
| `tests/detail.test.mjs` | Mới | 12 kiểm thử định tuyến, API chi tiết và kết xuất |
| `tests/browser.mjs` | Sửa | Hồi quy API thật: nút chi tiết khả dụng |
| `tests/browser-http.mjs` | Sửa | Chuyển mặc định bằng chứng mới vào thư mục 2.2 |
| `tests/helpers/http-browser.mjs` | Sửa | Hỗ trợ GET chi tiết, lỗi mạng, URL trực tiếp, CDP và chế độ API thật |
| `tests/browser-detail.mjs` | Mới | Chrome API thật và HTTP mô phỏng cho 2.2 |

Các đường dẫn tương đối từ `src/`, `tests/` ở bảng trên thuộc `frontend/apps/lis/`.

Thêm bằng chứng trong `frontend/apps/lis/tests/evidence/phase-2.2-2026-11-03/`: báo cáo này, baseline, Git/manifest, log kiểm tra, JSON yêu cầu/phản hồi và ảnh; hồi quy danh sách nằm trong `list-regression/`. Danh sách đầy đủ được ghi trong `git-state.json`.

Không thay `LisResult`, `useLisResults`, reducer phân trang, form lọc hoặc thành phần phân trang đã nghiệm thu.

## 3. Chức năng đã hoàn thành

- Màn hình riêng có hai nhóm, mỗi nhóm sáu trường; chuyển một cột ở chiều rộng ≤640px.
- Tải object chi tiết bằng ID trong hash; encode ID riêng khi gọi API, không gửi các query khôi phục danh sách vào API chi tiết.
- Tái sử dụng kiểm tra 12 trường/nullable và kiểu `LisResult`; từ chối array, thiếu/sai kiểu trường, trạng thái khác READY/FINAL và ID không trùng.
- Danh sách dùng `#/results?...`; chi tiết dùng `#/results/<encodedResultId>?...`. `page` trong URL bắt đầu từ 1.
- Giữ bộ lọc áp dụng và trang qua mở chi tiết/quay lại, F5, Back/Forward; bản nháp không làm thay đổi ngữ cảnh đã áp dụng.
- Tìm kiếm lại/Xóa bộ lọc/Thử tải lại cùng URL vẫn tạo yêu cầu mới.
- Số/đơn vị giữ nguyên chuỗi; null là `—`; cận thấp/cao riêng; UTC đến giây, ISO gốc và phần lẻ nằm trong datetime/title.
- Lỗi URL có thông báo và không gửi GET ngoài ý muốn. Người dùng chủ động chọn về danh sách mặc định nếu URL sai.
- HTTP 400/404 có thông báo riêng; lỗi 503/502, mạng, JSON và cấu trúc có thử lại. Nút quay lại hoạt động trong lúc tải và khi lỗi.
- Hủy controller khi đổi ID/rời trang/thử lại; phản hồi cũ không thay dữ liệu mới.

## 4. Đối chiếu đặc tả

| Yêu cầu | Kết quả và bằng chứng |
|---|---|
| Kiểm tra nhánh/HEAD/Git trước sửa | Đạt; baseline sạch, đúng e47af51 |
| Sáu trường định danh/xét nghiệm bên trái | Đạt; unit kết xuất và so đủ 12 trường trên Chrome với API thật |
| Sáu trường kết quả bên phải | Đạt; cận tham chiếu độc lập, đúng vị trí |
| Màn hình rộng/hẹp | Đạt trên Chrome 1280px và 375px; CSS grid hai/một cột, không tràn toàn trang; đã xem ảnh thật |
| Không biểu đồ/chẩn đoán/kết luận ngoài API | Đạt qua kiểm tra mã và giao diện |
| GET endpoint có sẵn, HTTP 200 object | Đạt; JSON API thật và kiểm thử array/envelope sai |
| Kiểm tra 12 trường/kiểu/nullable | Đạt; unit lần lượt bỏ từng trường, thay kiểu, null trái hợp đồng; Chrome có dữ liệu nullable |
| result_id trùng yêu cầu | Đạt; unit và Chrome từ chối ID khác |
| ID được mã hóa/không chuẩn hóa | Đạt với khoảng trắng, hoa/thường, Unicode, / + % ? # &; giới hạn dấu chấm riêng ở mục 8 |
| Không sửa backend/tạo endpoint | Đạt qua Git |
| Xem chi tiết từ bảng | Đạt với dữ liệu thật từ trang 2 |
| Mở URL trực tiếp/F5 chi tiết | Đã chạy đạt trên API thật và mô phỏng |
| Quay lại/F5 danh sách/Back/Forward | Đã chạy đạt trên API thật và mô phỏng |
| Trang 2/3 giữ bộ lọc và vị trí | Trang 2 API thật; trang 2 và 3 HTTP mô phỏng, đúng limit/offset/query |
| Bản nháp tách bộ lọc áp dụng | Đạt; gõ bản nháp rồi mở chi tiết/chuyển trang không gửi bản nháp |
| Chi tiết không có ngữ cảnh về mặc định | Đã chạy đạt trên API thật |
| URL sai không làm rộng truy vấn | Unit và Chrome: từ chối tham số sai/lặp/lạ, mã hóa lỗi, số trang sai; không gửi GET |
| Tìm lại cùng điều kiện/Thử lại danh sách | Đạt; unit, Chrome chi tiết và toàn bộ hồi quy danh sách |
| Chuỗi số 0/âm/dài và đơn vị | Đạt; so nguyên văn DOM/API và HTTP mô phỏng |
| Nullable và cận thiếu | Đạt; không điền cận còn thiếu hoặc suy ra bình thường |
| UTC đến giây, giữ phần lẻ gốc | Đạt; đối chiếu text và datetime/title, không dùng chuyển múi giờ |
| Chỉ READY/FINAL | Đạt; cả hai trạng thái đã kiểm thử, ACK bị từ chối |
| Loading/success/400/404/503/502 HTML/mạng/sai 200 | Đạt trên Chrome HTTP mô phỏng và unit; các lỗi không khẳng định có sẵn ở API thật |
| Thử lại cùng ID | Đạt; GET mới giữ nguyên ID, không có query ngữ cảnh |
| Hủy và phản hồi muộn | Đạt; quan sát signal.aborted khi đổi ID/rời trang/thử lại; buộc phản hồi cũ đến và dữ liệu mới vẫn giữ |
| Quay lại trong lúc đang tải | Đạt trên Chrome với phản hồi được giữ; danh sách tải được trước khi trả phản hồi cũ |
| Giữ hồi quy 2.1 | 12 unit cũ, 10 ca HTTP danh sách và 5 nhóm API thật đều đạt; không xóa test |
| Cập nhật README, không thêm dependency | Đạt; hai README cập nhật, manifest/lockfile không đổi |
| Bằng chứng 2.1 giữ nguyên, 2.2 riêng | Đạt qua Git; tất cả bằng chứng mới ở thư mục này |
| Chỉ GET, không Publish/commit | Nhật ký kiểm thử ghi GET; kiểm tra mã/Git không có chức năng Publish hoặc commit mới |
| Bàn giao tiếng Việt và dừng | Báo cáo này và liên kết bằng chứng; không bắt đầu giai đoạn sau |

## 5. TypeScript, lint, build

Các lệnh đã chạy thành công, không suy luận từ mã:

| Kiểm tra tại frontend/ | Kết quả | Log |
|---|---|---|
| `npm.cmd run check --workspace apps/lis` | Đạt | [typecheck.txt](typecheck.txt) |
| `npm.cmd run lint` | Đạt, toàn frontend | [lint.txt](lint.txt) |
| `npm.cmd run build:lis` | Đạt, gồm tsc -b và Vite production | [build.txt](build.txt) |
| `git diff --check` | Đạt | Kiểm tra cuối và git-state.json |

Môi trường: Node.js 24.11.0, Chrome headless 156.0.8078.80, React/React DOM theo lockfile hiện có; không cài thêm dependency.

## 6. Kết quả từng nhóm kiểm thử

| Nhóm | Kết quả đã chạy | Bằng chứng |
|---|---|---|
| Unit hồi quy 2.1 | 12/12 đạt | [unit.txt](unit.txt) |
| Unit mới 2.2 | 12/12 đạt; tổng unit 24/24, 0 fail/skipped | [unit.txt](unit.txt) |
| Chi tiết Chrome HTTP mô phỏng | 6/6 nhóm đạt | [log](detail-http-browser.txt), [JSON](detail-http-browser.json) |
| Chi tiết Chrome API thật | 3/3 nhóm đạt | [log](detail-real-browser.txt), [JSON](detail-real-browser.json) |
| Danh sách Chrome HTTP mô phỏng 2.1 | 10/10 ca đạt: P10/P11/P20/P21, V0/VNEG/VLONG, E503/E400/E502 | [log](list-http-browser.txt), [JSON](list-regression/http-browser.json) |
| Danh sách Chrome API thật 2.1 | 5/5 nhóm đạt: bảng/UTC, lọc/Enter/phân trang, reset/rỗng/offline/retry, phản hồi muộn, mobile/JS | [log](list-real-browser.txt), [JSON](list-regression/real-browser.json) |
| Ngoại lệ JavaScript chưa xử lý | Không có trong cả bốn lượt Chrome thành công | Các JSON ở trên, mảng exceptions/browserErrors rỗng |

Sáu nhóm chi tiết mô phỏng gồm: ID đặc biệt/bố cục/UTC; số/nullable/READY/FINAL; trang 2–3/F5/lịch sử/tìm lại; tám dạng lỗi và thử lại; URL sai không GET; hủy và phản hồi muộn.

Kiểm thử phản hồi muộn tạm bọc fetch **chỉ trong trình duyệt kiểm thử**, bỏ signal khỏi lời gọi mạng để không chặn phản hồi cũ, nhưng giữ signal ứng dụng truyền để xác minh controller đã bị hủy. Sau khi truy vấn mới hoàn tất, cho phản hồi cũ đến rồi kiểm tra không đổi dữ liệu. Phần ứng dụng vẫn truyền signal thật cho fetch.

## 7. Bằng chứng API thật và HTTP mô phỏng

### API thật

[detail-real-browser.json](detail-real-browser.json) lưu GET trực tiếp, HTTP status và body, cùng các GET từ Chrome qua proxy.

- Trang danh sách: mã xét nghiệm `50912`, trang 2 (`limit=11&offset=10`).
- Kết quả chọn: `MIMIC-LAB-107261`.
- GET chi tiết: `http://127.0.0.1:3101/api/results/MIMIC-LAB-107261`, HTTP 200.
- Chrome gọi `/api/lis/results/MIMIC-LAB-107261`; query API chi tiết rỗng.
- Ngữ cảnh hash: `#/results/MIMIC-LAB-107261?test_code=50912&page=2`.
- Đối chiếu cả 12 trường bằng assert; kiểm tra lại sau F5. Không chỉ so riêng mã hoặc ảnh.

| Trường | Giá trị API thật đã so với giao diện |
|---|---|
| `result_id` | `MIMIC-LAB-107261` |
| `patient_id` | `MIMIC-P-10009049` |
| `test_code` | `50912` |
| `test_name` | `Creatinine` |
| `fluid` | `Blood` |
| `category` | `Chemistry` |
| `value_num` | `1.5` |
| `unit` | `mg/dL` |
| `reference_low` | `0.5` |
| `reference_high` | `1.2` |
| `effective_at` | `2174-05-26T13:02:00.000000Z` |
| `result_status` | `FINAL` |


Ảnh đã xem trực tiếp: [màn hình rộng 1280px](real-detail-desktop.png), [màn hình hẹp 375px](real-detail-mobile.png). Ảnh mobile chụp viewport đầu trang; các trường bên dưới được cuộn trong trang và được kiểm tra qua DOM, không bị bỏ khỏi giao diện.

Hồi quy với API thật lưu riêng ở [list-regression/real-browser.json](list-regression/real-browser.json). Dữ liệu thật tại lượt này có FINAL; các trạng thái/giá trị biên không có trong mẫu được kiểm tra bằng mô phỏng.

### HTTP mô phỏng

[detail-http-browser.json](detail-http-browser.json) có nhãn rõ, request URL, method, response body/status hoặc network failure; không chuyển dữ liệu mô phỏng vào ứng dụng/database.

Bao gồm ID chứa ký tự đặc biệt, số 0/âm/dài, cận chỉ có một phía, toàn bộ nullable, READY/FINAL, 400/404/503/502 HTML/200 HTML/mạng, thiếu trường, ID lệch, URL sai, thử lại, hủy và phản hồi muộn. Thử thiếu/sai kiểu từng trường đầy đủ nằm trong unit test.

Ảnh: [mô phỏng rộng](mock-detail-desktop.png), [mô phỏng hẹp](mock-detail-mobile.png). Bằng chứng mô phỏng danh sách cũ được chạy lại và lưu tại [list-regression/http-browser.json](list-regression/http-browser.json).

Tất cả lượt kiểm thử chỉ đọc GET. Không gọi Publish hoặc tạo dữ liệu thực nghiệm.

## 8. Lỗi đã gặp, giới hạn và việc chưa kiểm chứng

- Lệnh `npm` ban đầu bị PowerShell ExecutionPolicy chặn `npm.ps1`. Dùng `npm.cmd` để chạy cùng công cụ; không thay cấu hình bảo mật của máy.
- `apply_patch` báo đường dẫn có reparse point; sửa file trực tiếp trong workspace bằng PowerShell/Python. Không thay file bên ngoài phạm vi.
- Lint ban đầu báo no-control-regex ở kiểm tra ID. Đã chuyển sang kiểm tra mã ký tự; lượt lint cuối đạt.
- Chrome trong sandbox bị đóng kết nối CDP. Các lượt thành công nêu trên chạy ngoài sandbox sau khi được cấp quyền. Log bàn giao là lượt thành công cuối, không coi lượt sandbox thất bại là đạt.
- ID chính xác `.` hoặc `..` bị báo đường dẫn không hợp lệ, do URL trình duyệt chuẩn hóa dot segment và có thể gửi GET sang đường dẫn khác. Không biến đổi ID thành giá trị khác. Backend hiện không cần sửa; chưa kiểm chứng dataset có hai ID này.
- Không giữ bản nháp chưa tìm kiếm khi F5 hoặc rời danh sách; đặc tả không bắt buộc.
- Kiểm tra hai kích thước 1280px/375px trên Chrome; chưa kiểm chứng Firefox, Safari hay mọi kích thước/thiết bị.
- Lỗi dịch vụ, mọi trạng thái nullable/giá trị biên và READY được chứng minh bằng HTTP mô phỏng/unit, không khẳng định đã xuất hiện trong dữ liệu thật.
- Phân trang offset có thể thay vị trí nếu nguồn dữ liệu đổi giữa hai GET; đây là cơ chế hiện có, không sửa backend.
- Không phát hiện lỗi cần thay đổi backend; không có ca kiểm thử còn thất bại trong bộ bàn giao.

Các kết luận về hành vi người dùng ở mục 4–7 đều có lượt chạy tương ứng. Nhận định không thêm nghiệp vụ ngoài phạm vi và bảo toàn file dựa trên kiểm tra mã/Git, không coi đó là kiểm thử tích hợp.

## 9. Kết luận bàn giao

Giai đoạn 2.2 đã triển khai và kiểm chứng trên Chrome với API LIS thật, kèm các ca HTTP mô phỏng và toàn bộ hồi quy 2.1. Các kiểm tra TypeScript/lint/build và bộ kiểm thử bàn giao đều đạt; giới hạn môi trường/ID/thiết bị được ghi riêng ở mục 8.

Mã đang ở working tree để người dùng xem xét; HEAD vẫn e47af51. Dừng tại bàn giao này, chưa commit/push/merge và chưa triển khai hoặc gọi Publish.

Lệnh tái hiện có trong [README LIS](../../../README.md). Từ thư mục ứng dụng, đặt `LIS_EVIDENCE_DIR` tới thư mục mới nếu cần giữ nguyên toàn bộ bằng chứng bàn giao hiện tại.
