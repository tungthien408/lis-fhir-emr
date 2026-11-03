# Báo cáo kiểm thử bổ sung nghiệm thu Giai đoạn 2.1

Ngày kiểm thử: **03/11/2026**, múi giờ **Asia/Bangkok (UTC+7)**.

**Kết luận: Đạt trong phạm vi nghiệm thu Giai đoạn 2.1.** Ba nhóm thiếu bằng chứng đã được kiểm chứng bằng tương tác trên Chrome với HTTP có kiểm soát. Bộ kiểm thử hiện có với API thật cũng chạy lại thành công. Không phát hiện lỗi chức năng; không sửa mã chức năng, backend, database, Compose, dữ liệu thực nghiệm hoặc dependency. Dừng tại Giai đoạn 2.1, chưa triển khai 2.2.

## 1. Phiên bản, môi trường và cách tạo bằng chứng

- Nhánh giữ nguyên: `feature/frontend/lis-emr-ui`.
- HEAD: `2904f6197f34606d0d877f4cd43726e6023cf5c2`. Phiên bản được kiểm thử là **HEAD cộng working tree**, vì trước đợt này đã có thay đổi chưa commit và file chưa được theo dõi. Không coi HEAD đơn lẻ là toàn bộ mã được kiểm thử.
- [baseline.json](baseline.json) lưu trạng thái Git ban đầu và SHA-256 của từng file frontend, bao gồm file chưa được theo dõi. [git-state.json](git-state.json) đối chiếu lại sau kiểm thử, lưu mã băm nguồn, bộ kiểm thử và sản phẩm build cùng thống kê Git đầy đủ.
- Node.js `24.11.0`, npm `11.12.1`, Chrome `156.0.8078.80`; phiên bản thực tế của React, Vite và TypeScript được ghi trong `git-state.json`.
- Bộ bổ sung chạy **bản production vừa build**, trên preview riêng tại `127.0.0.1:5183`. Chrome CDP `Fetch.fulfillRequest` chặn yêu cầu `/api/*` trước proxy, chỉ chấp nhận GET `/api/lis/results`, trả JSON/HTML kiểm soát từ mã kiểm thử. Không thay `window.fetch`, component, hook hoặc API client của ứng dụng.
- Bộ hiện có chạy giao diện phát triển tại `127.0.0.1:5173`, dùng API LIS thật `127.0.0.1:3101`. Chỉ gửi GET. Ngoại tuyến và trì hoãn phản hồi là thao tác trong trình duyệt kiểm thử, không phải lỗi thực tế của backend.
- Bộ HTTP mô phỏng chạy lúc **14:39:02–14:39:17**; bộ API thật lúc **14:43:22–14:43:29** theo UTC+7. Timestamp gốc UTC có trong các file JSON.

## 2. Danh sách ca bổ sung và kết quả chi tiết

Tất cả 10 ca dưới đây dùng **HTTP mô phỏng**, kiểm tra trực tiếp DOM sau thao tác giao diện; không khẳng định dataset thật có đúng các tổng số này. [http-browser.txt](http-browser.txt) ghi kết quả từng ca; [http-browser.json](http-browser.json) lưu 39 yêu cầu, toàn bộ nội dung phản hồi, 42 bản ghi trạng thái DOM, mã kết quả, ô giá trị, nút, số trang, bộ lọc đang nhập và liên kết mỗi trạng thái với yêu cầu tương ứng. Trường `lastRequest` là chỉ số bắt đầu từ 0 trong mảng `requests`.

### 2.1. Phân trang

Tất cả yêu cầu được xác nhận có `limit=11`. Sau lần mở giao diện không lọc, mỗi ca tìm kiếm với đủ ba bộ lọc rồi đổi bản nháp thành `DRAFT-NOT-APPLIED`/`READY` trước khi chuyển trang. Mọi yêu cầu chuyển trang vẫn giữ bộ lọc **đã áp dụng**. Bảng dưới ghi chuỗi sau thao tác Tìm kiếm; trước đó còn một GET mở giao diện với offset 0, không bộ lọc.

| Ca | Tổng bản ghi | Chuỗi offset thực tế | Số dòng theo từng trang | Mã kết quả kỳ vọng, đã đối chiếu chính xác | Kết quả |
|---|---:|---|---|---|---|
| P10 | 10 | `0` | Trang 1: 10 | `N10-01` đến `N10-10` | PASS |
| P11 | 11 | `0 → 10 → 0 → 10` | Trang 1: 10; trang 2: 1 | Trang 1: `N11-01`…`N11-10`; trang 2: `N11-11` | PASS |
| P20 | 20 | `0 → 10 → 0 → 10` | Trang 1: 10; trang 2: 10 | Trang 1: `N20-01`…`N20-10`; trang 2: `N20-11`…`N20-20` | PASS |
| P21 | 21 | `0 → 10 → 20 → 10 → 0 → 10 → 20` | Trang 1: 10; trang 2: 10; trang 3: 1 | Trang 1: `N21-01`…`N21-10`; trang 2: `N21-11`…`N21-20`; trang 3: `N21-21` | PASS |

Mỗi lần đi tới/quay lại đều so sánh nguyên mảng mã kết quả với lát cắt kỳ vọng, số dòng, nhãn trang và trạng thái nút:

| Ca/trang | Trang trước | Trang sau |
|---|---|---|
| P10 / 1 | Tắt | Tắt |
| P11, P20 / 1 | Tắt | Bật |
| P11, P20 / 2 | Bật | Tắt |
| P21 / 1 | Tắt | Bật |
| P21 / 2 | Bật | Bật |
| P21 / 3 | Bật | Tắt |

Đã thử click nút bị tắt: không phát sinh GET, bảng không đổi. Tập mã khi đi tới có số phần tử duy nhất bằng đúng tổng bản ghi; khi quay lại và đi tới lần hai, từng trang khớp nguyên danh sách kỳ vọng. Không trùng, không mất kết quả và không có trang rỗng thừa. P10 chỉ có một trang nên cả hai chiều đều được kiểm chứng bằng nút tắt và không phát sinh yêu cầu.

### 2.2. Hiển thị số

Các ca đọc `textContent` của **ô thứ tư trong đúng dòng kết quả** trên trình duyệt, rồi so sánh bằng tuyệt đối với chuỗi trong phản hồi HTTP. Không chỉ kiểm tra dữ liệu API hay tìm chuỗi trong toàn bộ HTML.

| Ca | Chuỗi API | Nội dung ô thực tế | Kết quả |
|---|---|---|---|
| V0 | `"0"` | `0` | PASS; không rỗng |
| VNEG | `"-2.50"` | `-2.50` | PASS; giữ dấu âm và số 0 cuối |
| VLONG | `"12345678901234567890.123456789012345678901234567890"` | `12345678901234567890.123456789012345678901234567890` | PASS; giữ nguyên mọi chữ số, không làm tròn |

### 2.3. Xử lý lỗi và phục hồi

Cả ba ca đều bắt đầu với dữ liệu thành công. Phản hồi kế tiếp được giữ ở lớp HTTP để kiểm tra riêng trạng thái đang tải: **0 dòng cũ**, `aria-busy=true`, cả hai nút phân trang tắt. Sau lỗi: **0 dòng**, thông báo chứa đúng mã HTTP và nút **Thử tải lại** khả dụng. Sau phục hồi: không còn thông báo lỗi, mã kết quả khớp chính xác bộ lọc và trang áp dụng.

| Ca | Lỗi và cách phục hồi | Kết quả thực tế | Bằng chứng |
|---|---|---|---|
| E503 | Lọc `P-NEW503` / `T-NEW503` / `FINAL`; trang 1 thành công, sang trang 2 nhận JSON 503 `DEPENDENCY_UNAVAILABLE`; đổi bản nháp rồi bấm Thử tải lại | Hiện “Dịch vụ dữ liệu LIS tạm thời không sẵn sàng. (HTTP 503)”; thử lại vẫn gửi bộ lọc áp dụng với `limit=11&offset=10`, hiển thị `NEW503-11`…`NEW503-20`; sang offset 20 còn `NEW503-21`, quay lại đúng 10 dòng | [Lỗi](E503-error.png), [phục hồi](E503-recovered.png), case `E503` trong JSON |
| E400 | Từ dữ liệu cũ, tìm với `P-NEW400` / `T-NEW400` / `FINAL` nhận JSON 400 `VALIDATION_ERROR`; sửa cả ba trường thành `P-FIX400` / `T-FIX400` / `READY`, tìm lại | Hiện “Bộ lọc hoặc thông tin phân trang không hợp lệ. (HTTP 400)”; tìm lại offset 0 hiển thị `FIX400-01`…`FIX400-10`, trạng thái READY; trang 2 offset 10 còn đúng `FIX400-11`; không lẫn dữ liệu OLD/NEW | [Lỗi](E400-error.png), [phục hồi](E400-recovered.png), case `E400` trong JSON |
| E502 | Lọc `P-NEW502` / `T-NEW502` / `FINAL`; sang trang 2 nhận HTTP 502, `Content-Type: text/html`, body HTML “Bad Gateway”; đổi bản nháp rồi Thử tải lại | Hiện thông báo dễ hiểu kèm HTTP 502, không hiển thị HTML/body upstream; thử lại đúng bộ lọc áp dụng, offset 10 trả `NEW502-11`…`NEW502-20`; trang 3 chỉ `NEW502-21`, quay lại đúng trang 2 | [Lỗi](E502-error.png), [phục hồi](E502-recovered.png), case `E502` trong JSON |

Không có ngoại lệ JavaScript chưa xử lý hoặc lỗi bộ chặn HTTP trong lượt thành công. Không dùng các lỗi mô phỏng này để kết luận backend thật đã trả 400/502/503.

## 3. Kiểm thử hiện có, kiểm tra mã và bằng chứng API thật

| Kiểm tra/lệnh, chạy từ `frontend/` nếu không ghi khác | Kết quả | Log |
|---|---|---|
| `npm run test --workspace apps/lis` | Exit 0, 12 ca PASS; từng tên ca ghi bên dưới | [unit.txt](unit.txt) |
| `npm run build:lis` | Exit 0, build thành công; asset JS `index-eqsBjQJU.js` | [build.txt](build.txt) |
| `npm run check --workspace apps/lis` | Exit 0 | [typecheck.txt](typecheck.txt) |
| `npm run lint --workspace apps/lis` | Exit 0 | [lint.txt](lint.txt) |
| `node --test --test-reporter=spec tests/browser-http.mjs`, tại `apps/lis/` | Exit 0, 10/10 ca bổ sung PASS | [http-browser.txt](http-browser.txt) |
| `node tests/browser.mjs`, tại `apps/lis/`, có `LIS_EVIDENCE_DIR` | Exit 0, 5 nhóm kiểm tra trình duyệt hiện có PASS | [real-browser.txt](real-browser.txt), [real-browser.json](real-browser.json) |

12 ca hiện có, mỗi ca đều PASS:

1. API lấy dư một dòng, giữ mọi ký tự định danh và chuyển tiếp signal.
2. API bỏ bộ lọc rỗng/chỉ khoảng trắng.
3. API bảo toàn số, đơn vị, timestamp gốc và null.
4. API lỗi JSON giữ HTTP/error code cho 400 và 503.
5. API xử lý lỗi HTTP không phải JSON.
6. API lỗi kết nối có thông báo thử lại.
7. API từ chối thành công sai JSON/sai cấu trúc, không coi là danh sách rỗng.
8. API chuyển tiếp hủy yêu cầu.
9. Hàm phân trang chỉ dùng dòng 11 để xác định trang sau.
10. Reducer tìm/xóa/thử lại, giữ bộ lọc áp dụng khi chuyển trang.
11. Render thời gian UTC đến giây, giữ timestamp gốc, null và dữ liệu số.
12. Render form bộ lọc và khóa nút phân trang đúng trạng thái.

Các ca này dùng fetch mô phỏng, reducer hoặc render thành phần tĩnh; không thay thế bằng chứng trình duyệt ở mục 2.

5 nhóm kiểm tra trình duyệt hiện có, mỗi nhóm đều PASS với **dữ liệu API thật**:

| Nhóm | Bằng chứng thực tế |
|---|---|
| R1 – Danh sách | GET trực tiếp `limit=11&offset=0` trả HTTP 200, 11 bản ghi; UI qua proxy hiển thị đúng 10 mã đầu, tám cột, thời gian UTC, chi tiết tắt |
| R2 – Bộ lọc/phân trang | Gõ không gửi GET; Enter tìm `test_code=50912`; trang sau/trước gửi offset 10/0 và giữ test code dù bản nháp patient đã đổi; lọc kết hợp `patient_id=MIMIC-P-10007928`, `test_code=50912`, `result_status=FINAL` trả khớp API |
| R3 – Xóa/rỗng/mất kết nối | Xóa ba bộ lọc; tìm mã không tồn tại trả rỗng; mô phỏng ngoại tuyến rồi kết nối lại, Thử tải lại phục hồi thành công. Payload vẫn từ API thật, lỗi mạng là mô phỏng trong Chrome |
| R4 – Phản hồi muộn | Trì hoãn phản hồi GET thật cũ; tìm truy vấn mới theo patient; phản hồi cũ tới sau không ghi đè kết quả mới |
| R5 – Màn hình hẹp | 375px không tràn ngang toàn trang, bảng cuộn ngang riêng, không có ngoại lệ JavaScript chưa xử lý; [ảnh](lis-mobile.png) |

`real-browser.json` ghi 5 GET đối chiếu trực tiếp (đều HTTP 200, đầy đủ query/body), 13 yêu cầu của giao diện và 5 nhóm PASS. GET đầu có `MIMIC-LAB-100142` ở đầu; bản ghi thứ 11 `MIMIC-LAB-101859` được dùng để xác định trang sau, không hiển thị trên trang 1. Không tạo hoặc sửa dataset để đạt các kết quả này.

## 4. Lỗi phát hiện và lần chạy không hợp lệ

**Không phát hiện lỗi chức năng** trong phạm vi đã kiểm tra. Không có yêu cầu sửa chức năng để nhóm quyết định.

Lần chạy bổ sung đầu trong sandbox bị đóng kết nối CDP ở hook khởi tạo Chrome; cả 10 ca chưa thực hiện được. [http-browser-sandbox-attempt.txt](http-browser-sandbox-attempt.txt) và [JSON](http-browser-sandbox-attempt.json) lưu nguyên thất bại hạ tầng này, không tính là kiểm thử đạt hoặc lỗi sản phẩm. Sau khi được phép chạy ngoài sandbox, cùng bộ mã kiểm thử đạt đủ 10 ca, không chỉnh mã ứng dụng.

## 5. File thay đổi và trạng thái Git sau kiểm thử

Các file được chỉnh trong đợt này:

| File | Nội dung |
|---|---|
| `frontend/apps/lis/tests/browser-http.mjs` | Mới: 10 ca tương tác phân trang, ô số, lỗi/phục hồi; xuất trace và ảnh |
| `frontend/apps/lis/tests/helpers/http-browser.mjs` | Mới: preview production, Chrome CDP và chặn HTTP; không dependency mới |
| `frontend/apps/lis/tests/snapshot-acceptance.mjs` | Mới: đối chiếu baseline, mã băm nguồn/build, trạng thái Git và thống kê từng file untracked |
| `frontend/apps/lis/tests/browser.mjs` | Chỉnh kiểm thử có sẵn: thêm log GET thật, kết quả từng nhóm và xuất ảnh/JSON theo `LIS_EVIDENCE_DIR`; giữ các kiểm tra hiện có |
| `frontend/apps/lis/README.md` | Bổ sung liên kết báo cáo và lệnh tái hiện |
| `frontend/apps/lis/tests/evidence/phase-2.1-2026-11-03/` | Bằng chứng mới, liệt kê bên dưới |

Danh sách file bằng chứng: `BAO_CAO.md`, `baseline.json`, `git-state.json`, `build.txt`, `unit.txt`, `typecheck.txt`, `lint.txt`, `http-browser.txt`, `http-browser.json`, `http-browser-sandbox-attempt.txt`, `http-browser-sandbox-attempt.json`, `real-browser.txt`, `real-browser.json`, `lis-mobile.png`, `E400-error.png`, `E400-recovered.png`, `E502-error.png`, `E502-recovered.png`, `E503-error.png`, `E503-recovered.png`.

Trạng thái Git:

- Giữ nguyên nhánh và HEAD; không stage, commit, push hoặc merge.
- Bảy file tracked đã sửa trước đợt này vẫn giữ nguyên nội dung: `frontend/README.md`, LIS `index.html`, `package.json`, `src/App.css`, `src/App.tsx`, `src/api/lis.ts`, `src/types/lis.ts`.
- Các component, hook, state và file kiểm thử/README untracked đã có trước được phân biệt với file mới bằng baseline. Trong số file cũ, chỉ README LIS và kiểm thử `browser.mjs` được chỉnh trong đợt này.
- `git diff --stat` chỉ phản ánh **7 file tracked, +258/-442 dòng**, đều là thay đổi có sẵn; không dùng con số này làm toàn bộ thống kê bàn giao.
- Sau đợt này có **31 file untracked**, gồm **24 file text và 7 PNG**. So với baseline: tạo mới **23 file**, chỉnh **2 file có sẵn** (README LIS và `tests/browser.mjs`), **47 file trong manifest ban đầu giữ nguyên SHA-256**. Không có file staged. `git diff --check` đạt.
- `git-state.json` lưu `git status --short --untracked-files=all`, danh sách/tổng số file untracked, bytes, số dòng text, file nhị phân và mã băm riêng. PNG được tính là file nhị phân. Các log dùng đuôi `.txt` để không bị quy tắc bỏ qua `*.log` loại khỏi thống kê.
- Mã nguồn chức năng frontend và các cấu hình/dependency đã băm trong baseline phải trùng hoàn toàn khi chạy snapshot; script dừng nếu có file thay đổi/mới ngoài kiểm thử hoặc README LIS. Backend, database, Compose và dữ liệu thực nghiệm không có thay đổi Git.

## 6. Kết luận nghiệm thu Giai đoạn 2.1

**Đạt.** Đã bổ sung bằng chứng giao diện cho đủ bốn biên phân trang 10/11/20/21; ba chuỗi số được giữ nguyên trong ô giá trị; các lỗi 503/400/502 HTML đều có thông báo, không để dữ liệu cũ xuất hiện và phục hồi đúng bộ lọc/trang. Bộ 12 ca hiện có, 5 nhóm kiểm tra trình duyệt với API thật, TypeScript, lint và build đều đạt.

Kết luận giới hạn ở ba điều kiện bổ sung và phạm vi LIS 2.1 được yêu cầu. Không suy rộng sang Firefox/Safari, dữ liệu thay đổi đồng thời giữa các GET, lỗi hạ tầng backend thực tế hoặc Giai đoạn 2.2. Các biên số lượng và lỗi HTTP được chứng minh bằng mô phỏng có kiểm soát, tách rõ với tích hợp API thật. Không còn thiếu bằng chứng trong ba nhóm của đợt nghiệm thu này.

## Tái hiện

Từ `frontend/`, dùng dependency đã có; cần Chrome/Edge (hoặc đặt `CHROME_PATH`) và API thật nếu chạy bộ kiểm thử cũ:

```powershell
npm.cmd run test --workspace apps/lis
npm.cmd run check --workspace apps/lis
npm.cmd run lint --workspace apps/lis
npm.cmd run build:lis
cd apps/lis
$env:LIS_EVIDENCE_DIR = (Resolve-Path 'tests/evidence/phase-2.1-2026-11-03').Path
node --test --test-reporter=spec tests/browser-http.mjs
node tests/browser.mjs
node tests/snapshot-acceptance.mjs
```

Mỗi lần chạy xuất lại JSON/ảnh; để giữ lịch sử, dùng thư mục `LIS_EVIDENCE_DIR` khác và sao chép baseline tương ứng vào đó trước khi chạy snapshot. Lưu stdout/stderr riêng khi cần log của lượt mới. Trên môi trường này Chrome cần chạy ngoài sandbox; không kết luận lỗi sản phẩm từ thất bại khởi động trình duyệt.
