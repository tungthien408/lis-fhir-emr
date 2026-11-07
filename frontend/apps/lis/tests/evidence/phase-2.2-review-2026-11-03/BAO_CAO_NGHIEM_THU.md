# Báo cáo rà soát nghiệm thu Giai đoạn 2.2 – LIS

Ngày rà soát: 03/11/2026 (Asia/Bangkok). **Kết luận: Đạt có điều kiện.** Luồng chính và các ca bắt buộc được chứng minh trong phạm vi ghi nhận; cần chốt ngoại lệ định danh `.`/`..` trước khi nghiệm thu vô điều kiện/commit. Không phát hiện lỗi hồi quy ở các luồng đã có bằng chứng.

Đợt này chỉ đọc mã, Git, log/JSON/ảnh; chạy lại unit test không ghi file ứng dụng; tạo báo cáo và dữ liệu xác minh riêng. Không sửa source/test/README hiện có, không build lại, không chạy lại Chrome, không gọi backend/database, không commit/push/merge hoặc triển khai 2.3/Publish. Không đồng nhất việc đọc log cũ với một lượt browser chạy mới.

## 1. Trạng thái Git và phạm vi thay đổi

| Hạng mục | Xác minh hiện tại |
|---|---|
| Nhánh | feature/frontend/lis-emr-ui |
| HEAD/commit nền | e47af51a1fca10092e22297aadbdcc5e75297f6d (e47af51) |
| Index | Không có file staged; git diff --cached --name-only rỗng |
| Working tree trước khi ghi báo cáo rà soát | 10 tracked sửa + 32 untracked = 42 file; khớp status trong git-state.json bàn giao |
| git diff --stat | 10 file tracked, +223/−139 dòng; không tính untracked |
| git diff --check | Exit 0, không lỗi whitespace. Cảnh báo LF→CRLF là thông báo cấu hình Git, không phải lỗi diff-check. |
| Phạm vi | Chỉ frontend/apps/lis/** và frontend/README.md |
| Backend/database/SQL/Compose | Không có file thay đổi tracked/untracked thuộc các vùng này |
| Dependency | Không đổi package.json/package-lock.json; không có dependency mới trong diff |
| Đối chiếu bản bàn giao | 16/16 sourceManifest, 25/25 evidenceManifest, 5/5 buildManifest khớp SHA-256 |


Danh sách đầy đủ **10 tracked sửa** (đường dẫn tính từ gốc repository):

```text
frontend/README.md
frontend/apps/lis/README.md
frontend/apps/lis/src/App.css
frontend/apps/lis/src/App.tsx
frontend/apps/lis/src/api/lis.ts
frontend/apps/lis/src/components/ResultsTable.tsx
frontend/apps/lis/tests/browser-http.mjs
frontend/apps/lis/tests/browser.mjs
frontend/apps/lis/tests/helpers/http-browser.mjs
frontend/apps/lis/tests/results.test.mjs
```

Danh sách đầy đủ **32 untracked của bản bàn giao** (trước khi tạo tài liệu rà soát):

```text
frontend/apps/lis/src/components/ResultDetail.tsx
frontend/apps/lis/src/hooks/useLisResult.ts
frontend/apps/lis/src/hooks/useResultsRoute.ts
frontend/apps/lis/src/state/routes.ts
frontend/apps/lis/tests/browser-detail.mjs
frontend/apps/lis/tests/detail.test.mjs
frontend/apps/lis/tests/evidence/phase-2.2-2026-11-03/BAO_CAO.md
frontend/apps/lis/tests/evidence/phase-2.2-2026-11-03/baseline.json
frontend/apps/lis/tests/evidence/phase-2.2-2026-11-03/build.txt
frontend/apps/lis/tests/evidence/phase-2.2-2026-11-03/detail-http-browser.json
frontend/apps/lis/tests/evidence/phase-2.2-2026-11-03/detail-http-browser.txt
frontend/apps/lis/tests/evidence/phase-2.2-2026-11-03/detail-real-browser.json
frontend/apps/lis/tests/evidence/phase-2.2-2026-11-03/detail-real-browser.txt
frontend/apps/lis/tests/evidence/phase-2.2-2026-11-03/git-state.json
frontend/apps/lis/tests/evidence/phase-2.2-2026-11-03/lint.txt
frontend/apps/lis/tests/evidence/phase-2.2-2026-11-03/list-http-browser.txt
frontend/apps/lis/tests/evidence/phase-2.2-2026-11-03/list-real-browser.txt
frontend/apps/lis/tests/evidence/phase-2.2-2026-11-03/list-regression/E400-error.png
frontend/apps/lis/tests/evidence/phase-2.2-2026-11-03/list-regression/E400-recovered.png
frontend/apps/lis/tests/evidence/phase-2.2-2026-11-03/list-regression/E502-error.png
frontend/apps/lis/tests/evidence/phase-2.2-2026-11-03/list-regression/E502-recovered.png
frontend/apps/lis/tests/evidence/phase-2.2-2026-11-03/list-regression/E503-error.png
frontend/apps/lis/tests/evidence/phase-2.2-2026-11-03/list-regression/E503-recovered.png
frontend/apps/lis/tests/evidence/phase-2.2-2026-11-03/list-regression/http-browser.json
frontend/apps/lis/tests/evidence/phase-2.2-2026-11-03/list-regression/lis-mobile.png
frontend/apps/lis/tests/evidence/phase-2.2-2026-11-03/list-regression/real-browser.json
frontend/apps/lis/tests/evidence/phase-2.2-2026-11-03/mock-detail-desktop.png
frontend/apps/lis/tests/evidence/phase-2.2-2026-11-03/mock-detail-mobile.png
frontend/apps/lis/tests/evidence/phase-2.2-2026-11-03/real-detail-desktop.png
frontend/apps/lis/tests/evidence/phase-2.2-2026-11-03/real-detail-mobile.png
frontend/apps/lis/tests/evidence/phase-2.2-2026-11-03/typecheck.txt
frontend/apps/lis/tests/evidence/phase-2.2-2026-11-03/unit.txt
```

Đợt rà soát tạo riêng ba file trong `frontend/apps/lis/tests/evidence/phase-2.2-review-2026-11-03/`: `BAO_CAO_NGHIEM_THU.md`, `verification.json`, `unit-review.txt`. Vì vậy, sau rà soát có 10 tracked sửa và 35 untracked, tổng 45 file; 42 file bàn giao không bị sửa. Xem `verification.json` cho lần đối chiếu cuối.

Các module `types/lis.ts`, `state/results.ts`, `hooks/useLisResults.ts`, `ResultFilters.tsx`, `ResultsPagination.tsx` và cấu hình proxy/dependency không đổi so với HEAD. Không có test cũ bị xóa: diff của results.test.mjs chỉ thêm callback và sửa kỳ vọng nút enabled; browser.mjs đổi cùng kỳ vọng; browser-http.mjs đổi thư mục bằng chứng mặc định.

### Bằng chứng 2.1

Đã kiểm tra đủ **20 file tracked** tại `phase-2.1-2026-11-03`. Không có diff Git, không có file untracked mới ở đó. 12 file trùng byte trực tiếp với blob HEAD; 8 file text chỉ khác CRLF/LF do `core.autocrlf=true`, và cả 20 trùng nội dung sau chuẩn hóa xuống dòng để so sánh. Đây là phép so sánh trong bộ nhớ, không sửa file. Không có dấu hiệu bị ghi đè nội dung.

## 2. Đối chiếu yêu cầu đặc tả

Quy ước: vị trí mã bên dưới tính từ `frontend/apps/lis/`, trừ khi ghi `backend/` hoặc `frontend/`. R/L = dữ liệu API thật trong lượt trước; M/P/V/E = HTTP mô phỏng; U = unit mock/SSR. “Đạt” là theo phạm vi và dữ liệu ghi rõ, không suy rộng sang mọi tổ hợp.

| Yêu cầu | Vị trí mã nguồn | Bằng chứng kiểm thử | Kết luận |
|---|---|---|---|
| 12 trường: nhóm định danh/xét nghiệm | src/components/ResultDetail.tsx:9 | R01, M01, U24; ảnh thật rộng | Đạt |
| 12 trường: nhóm giá trị/kết quả, cận thấp/cao riêng | src/components/ResultDetail.tsx:20 | R01, M02, U24 | Đạt |
| Hai cột; màn hình hẹp một cột | src/App.css:216; src/App.css:252 | R01/R03, M01; 4 ảnh chi tiết đã xem | Đạt (1280px/375px) |
| GET đúng resultId; object, không phải array; 12 kiểu/nullable; ID response khớp | src/api/lis.ts:25; src/api/lis.ts:70; src/types/lis.ts:3 | R01; U16/U17; M04 | Đạt |
| Nút Xem chi tiết hoạt động | src/components/ResultsTable.tsx:41; src/App.tsx:42 | R01, M03; L01 và U11 | Đạt |
| Hash list/detail, encode/decode đúng một lần | src/state/routes.ts:17; src/state/routes.ts:56; src/hooks/useResultsRoute.ts:4 | U13/U14, R01–R03, M01/M03 | Đạt |
| Quay lại giữ filter/trang, không dùng draft | src/App.tsx:13; src/App.tsx:62 | R02 (test_code trang 2); M03 (test_code trang 2/3); U14 (ba filter) | Đạt trong các phạm vi đã chạy |
| Ba filter cùng áp dụng + detail/F5/Back/Forward nguyên chuỗi | Cùng vị trí trên | U14 round-trip đủ ba; L02 lọc ba ở list. Chưa có một luồng browser kết hợp cả ba với detail/F5/history. | Chưa đủ bằng chứng tích hợp tổ hợp này |
| Trang3 → detail → F5 → quay lại | src/App.tsx:62; src/hooks/useResultsRoute.ts:5 | M03; request số 12–18 (đếm từ1) có offset20/R-20/offset20 | Đạt bằng HTTP mô phỏng |
| F5 danh sách và chi tiết | src/hooks/useResultsRoute.ts:5; src/state/routes.ts:17 | R02, M03; có GET lặp đúng ID/offset trong JSON | Đạt |
| Mở URL chi tiết trực tiếp; thiếu ngữ cảnh về mặc định | src/App.tsx:62; src/state/routes.ts:39; src/state/routes.ts:43 | R03, U14; M01 mở URL có context | Đạt |
| Back/Forward trình duyệt | src/hooks/useResultsRoute.ts:6 | R02, M03; script history.back/forward và request đúng ID/offset | Đạt |
| URL sai không âm thầm bỏ filter/tải rộng | src/state/routes.ts:20; src/state/routes.ts:29; src/App.tsx:64 | U15 (26 URL); M05 (7 URL và không GET) | Đạt; độ chờ M05 có điểm cần tăng cường |
| ID có %, +, /, #, Unicode, khoảng trắng | src/state/routes.ts:48; src/state/routes.ts:63; src/api/lis.ts:74 | U13/U16; M01 path và body khớp | Đạt bằng mock/unit; chưa có ID này trên API thật |
| Miền ID không có ngoại lệ ngoài hợp đồng | src/state/routes.ts:49; src/api/lis.ts:71; backend/src/lis/controller.ts:31 | Frontend chặn . và ..; backend identifier/schema không nêu chặn. U15/U23 đang cố định hành vi chặn. | Chưa đủ bằng chứng chấp thuận ngoại lệ . / .. |
| Số 0/âm/dài; giữ đơn vị, không đổi/round | src/components/ResultDetail.tsx:23 | U18/U24, M02; V0/VNEG/VLONG; R01 với 1.5 mg/dL | Đạt |
| Nullable; low/high null độc lập | src/components/ResultDetail.tsx:16; src/components/ResultDetail.tsx:25 | M02: low null/high0 và lowâm/highnull; U24 cả 5 null | Đạt bằng mô phỏng/unit |
| UTC đến giây; ISO gốc và phần lẻ | src/state/results.ts:57; src/components/ResultDetail.tsx:28 | R01/R02 (.000000Z), M01/U24 (.123456Z) | Đạt với ISO UTC đúng hợp đồng |
| READY/FINAL, không lẫn trạng thái trao đổi | src/api/lis.ts:39; src/components/ResultDetail.tsx:31 | R01 FINAL; U18/U24/M02 READY/FINAL; U17 từ chối ACK | Đạt; READY mới có mock |
| Loading/success; HTTP400/404/503/502; non-JSON/mạng/sai200 | src/api/lis.ts:81; src/hooks/useLisResult.ts:18; src/components/ResultDetail.tsx:47 | M04/M06, U17/U19–U23; R01 success | Đạt |
| 503 → thử lại cùng ID → 200 | src/components/ResultDetail.tsx:51; src/hooks/useLisResult.ts:11 | M04 /503: hai request liên tiếp status503 rồi200; M06 RETRY | Đạt bằng HTTP mô phỏng |
| Hủy cũ, không cho phản hồi cũ ghi đè | src/hooks/useLisResult.ts:12; src/hooks/useLisResult.ts:26; src/App.tsx:62 | M06 đổiID/rời trang/retry, U23 signal; L04 hồi quy list | Đạt logic ứng dụng; chưa đo native transport abort |
| Quay lại ngay khi đang tải/lỗi | src/components/ResultDetail.tsx:45 | M06 giữ OLD-true rồi quay về list; M04 400/404 quay lại trang 3 | Đạt bằng mô phỏng |
| Tìm lại cùng filter và retry danh sách | src/hooks/useResultsRoute.ts:12; src/App.tsx:16 | U10; M03 tìm lại cùng hash; L03; E503/E502 | Đạt |
| Hồi quy 2.1, không xóa test | tests/results.test.mjs; tests/browser-http.mjs; tests/browser.mjs | 12 unit cũ + 10 ca P/V/E + L01–L05; diff chỉ sửa kỳ vọng nút và đích lưu evidence | Đạt |
| Không Publish/POST nghiệp vụ, biểu đồ/chẩn đoán ngoài API | src/api/lis.ts:84; src/components/ResultDetail.tsx:6 | rg mã app: fetch mặc định GET; request records GET; 12 field; không UI Publish | Đạt qua mã và nhật ký phạm vi đã chạy |
| README, phạm vi file/dependency, bảo toàn bằng chứng | README.md; frontend/README.md; Git/manifest | 16 nguồn,25 evidence,5 build khớp; 20 file2.1 không đổi nội dung | Đạt; tài liệu có lưu ý nhỏ tại mục6 |


## 3. Đánh giá 24 bài kiểm thử và các script Chrome

### 3.1. Toàn bộ 24 unit test

Đã đọc cả hai file. `results.test.mjs` có 12 ca; `detail.test.mjs` có 12 ca thực thi, trong đó vòng lặp HTTP sinh bốn ca 400/404/503/502. Các kiểm thử dùng fetch mock hoặc SSR, **không phải API thật** và không tự chứng minh lịch sử/layout của trình duyệt.

[unit.txt bàn giao](../phase-2.2-2026-11-03/unit.txt) ghi 24/24 PASS, 0 fail/skipped. Đã chạy lại trong lượt rà soát bằng `node --experimental-strip-types --test tests/*.test.mjs`: **24/24 PASS, exit 0**, kết quả riêng tại [unit-review.txt](unit-review.txt). Tất cả hàng sau đều đạt trong cả log bàn giao và lượt chạy lại.

| Mã | Vị trí tests/ | Tên ca | Mục tiêu/dữ liệu đầu vào | Phép kiểm tra thực tế | Kết quả |
|---|---|---|---|---|---|
| U01 | results.test.mjs:47 | API: lấy dư một dòng và giữ nguyên mọi ký tự của mã định danh | offset 20; patient `  AbC+&  `; test ` tCode `; READY | Mock fetch kiểm tra limit 11, offset 20, mã nguyên văn và đúng AbortSignal. | Đạt |
| U02 | results.test.mjs:62 | API: bỏ ô trống và chỉ có khoảng trắng khỏi bộ lọc | patient chỉ dấu cách/tab; test rỗng | URL chỉ có limit/offset, không gửi bộ lọc rỗng. | Đạt |
| U03 | results.test.mjs:71 | API: bảo toàn số, đơn vị, thời gian gốc và các giá trị null | Số dài; mg/dL; ISO .123456Z; thời gian null | deepEqual item trả về với fixture; effective_at null còn nguyên. | Đạt |
| U04 | results.test.mjs:79 | API: lỗi JSON giữ mã HTTP và mã lỗi, thông báo dễ hiểu | 400 VALIDATION_ERROR; 503 DEPENDENCY_UNAVAILABLE | LisApiError có đúng status/code; thông báo chứa mã HTTP. Không assert nguyên văn toàn bộ câu dịch. | Đạt |
| U05 | results.test.mjs:87 | API: lỗi HTTP không phải JSON vẫn được xử lý đúng | 502, body HTML | LisApiError 502, không đưa thẻ HTML vào thông báo. | Đạt |
| U06 | results.test.mjs:92 | API: lỗi kết nối có thông báo thử tải lại | fetch ném TypeError | Promise reject với thông báo kết nối và thử tải lại. | Đạt |
| U07 | results.test.mjs:97 | API: phản hồi thành công sai JSON hoặc sai cấu trúc không bị coi là danh sách rỗng | Non-JSON 200; limit 10; ACK; thiếu effective_at | Tất cả bị reject, không biến thành danh sách rỗng. | Đạt |
| U08 | results.test.mjs:111 | API: chuyển tiếp việc hủy yêu cầu, không đổi thành lỗi kết nối | Controller đã abort trước gọi | Mock signal.throwIfAborted(); reject AbortError. Không chứng minh hủy mạng đang bay. | Đạt |
| U09 | results.test.mjs:118 | Phân trang: dòng thứ 11 chỉ dùng để xác định trang sau | Mảng 0/1/9/10/11 item | Số dòng tối đa 10, hasNext chỉ ở 11, mảng nguồn không đổi độ dài. | Đạt |
| U10 | results.test.mjs:128 | Truy vấn: tìm kiếm, xóa và thử lại; phân trang giữ bộ lọc đã áp dụng | P1/t1/FINAL; sửa đối tượng bản nháp; next/previous/search/reset/retry | Reducer sao chép filter; next giữ filter; retry tạo object mới; search/reset về trang 0. | Đạt |
| U11 | results.test.mjs:146 | Hiển thị: UTC đến giây, giữ nguyên phần lẻ trong dữ liệu gốc | ISO .123456Z; số dài; 0; thời gian null | SSR bảng tám cột, giữ số/đơn vị/ISO, text UTC/—; không có nút disabled. Chưa click handler ở unit. | Đạt |
| U12 | results.test.mjs:162 | Giao diện: bộ lọc dùng form; phân trang khóa đúng các nút | Form mặc định; trang đầu/giữa; loading | SSR có submit/reset và READY/FINAL/Tất cả; số nút disabled đúng 2/0/2. | Đạt |
| U13 | detail.test.mjs:33 | Route: ID mã hóa một lần, giữ nguyên hoa/thường, khoảng trắng, Unicode và ký tự đặc biệt | ` R/AbC+%?#& tiếng Việt `; `%2F`; 0; a/b; a?b#c; AbC có khoảng trắng; emoji | Hash bằng encodeURIComponent; parse trả đúng ID gốc, không giải mã hai lần. | Đạt |
| U14 | detail.test.mjs:41 | Route: khôi phục đủ bộ lọc áp dụng, trang 2/3, không lấy bản nháp | Ba filter patient ` P+&? `, test `t/Code`, READY; pageIndex 0/1/2 | Round-trip serialize/parse cho list/detail deepEqual query; URL trống/detail thiếu query dùng mặc định. Tên ca nhắc bản nháp nhưng không dựng UI/draft. | Đạt |
| U15 | detail.test.mjs:50 | Route: từ chối URL sai thay vì mở rộng danh sách; không sửa định danh | 26 URL sai: route, encoding, mã rỗng/control, dot ID, page, query lặp/lạ/status | kind phải là invalid cho từng URL. Không kiểm tra GET ở unit này; Chrome M05 kiểm tra số request. | Đạt |
| U16 | detail.test.mjs:64 | GET chi tiết: đúng ID, đúng signal, không truyền ngữ cảnh danh sách | Fixture ID đặc biệt; AbortController | Mock kiểm tra path encode đúng ID, signal đúng, query rỗng, trả object deepEqual. | Đạt |
| U17 | detail.test.mjs:75 | GET chi tiết: kiểm tra sự hiện diện và kiểu của từng trường trong 12 trường | Array/null/envelope; sai ID/status; bỏ lần lượt 12 field; thay bằng number; null vào field bắt buộc | Từng payload sai bị reject. Kiểm tra kiểu/nullable, không kiểm tra ngữ nghĩa chuỗi số hay parse ISO. | Đạt |
| U18 | detail.test.mjs:90 | GET chi tiết: nullable, READY/FINAL và số giữ nguyên chuỗi | 0/-2.50/số dài × READY/FINAL; reference/time null | Sáu response được deepEqual với fixture, không ép số. | Đạt |
| U19 | detail.test.mjs:102 | GET chi tiết: HTTP 400 có thông báo và mã HTTP | 400 JSON ERROR/backend | LisApiError status 400, thông báo có HTTP 400 và không lộ chuỗi backend/HTML. | Đạt |
| U20 | detail.test.mjs:102 | GET chi tiết: HTTP 404 có thông báo và mã HTTP | 404 JSON ERROR/backend | LisApiError status 404; cùng phép kiểm tra thông báo. | Đạt |
| U21 | detail.test.mjs:102 | GET chi tiết: HTTP 503 có thông báo và mã HTTP | 503 JSON ERROR/backend | LisApiError status 503; cùng phép kiểm tra thông báo. | Đạt |
| U22 | detail.test.mjs:102 | GET chi tiết: HTTP 502 có thông báo và mã HTTP | 502 HTML Bad Gateway | LisApiError status 502; không hiển thị body HTML. | Đạt |
| U23 | detail.test.mjs:112 | GET chi tiết: JSON lỗi, mạng lỗi, ID sai và hủy yêu cầu | 200 HTML; TypeError; signal abort sẵn; mã rỗng/control/dot | Reject tương ứng JSON/kết nối/AbortError/400; ID sai không được gọi fetch. | Đạt |
| U24 | detail.test.mjs:128 | Chi tiết: đủ 12 trường, số 0/âm/dài, cận riêng, null, UTC và ISO gốc | 0/-2.50/số dài; low -2.5000000000; high 0; FINAL; năm nullable/READY | SSR đủ 12 data-field, giữ chuỗi, ISO trong datetime/title; 2/5 dấu — và READY/FINAL. Không phải phép đo layout browser. | Đạt |


### 3.2. Các kiểm thử trình duyệt, đọc script và xác minh log đã lưu

Không chạy lại Chrome để tránh tạo profile/cache hoặc ghi đè bằng chứng. Kết quả “PASS ghi nhận” dưới đây được đối chiếu giữa mã assert, log text và JSON; không chỉ dựa vào tên ca.

| Mã | Vị trí tests/ | Tên ca/nhóm | Dữ liệu đầu vào | Phép kiểm tra thực tế | Kết quả đã ghi nhận |
|---|---|---|---|---|---|
| R01 | browser-detail.mjs:115 | API thật: mở trang 2 đã lọc, gõ bản nháp, mở chi tiết và đối chiếu đủ 12 trường | test_code=50912, trang 2; bản nháp patient khác | So 10 ID với backend; click; so hash; GET detail trực tiếp; compareFields đủ 12; query detail rỗng; grid 2 cột. | PASS ghi nhận, không chạy lại Chrome. |
| R02 | browser-detail.mjs:133 | API thật: F5 chi tiết, quay lại đúng bộ lọc/trang, F5 danh sách và Back/Forward | Tiếp R01, MIMIC-LAB-107261 | Page.reload, compareFields; quay về trang 2, hash/test_code/patient; reload list; history back/forward và chờ trang đúng. | PASS ghi nhận; 9 GET của toàn bộ R01–R03 khớp thứ tự thao tác. |
| R03 | browser-detail.mjs:149 | API thật: URL trực tiếp không có ngữ cảnh, bố cục rộng/hẹp và quay về danh sách mặc định | Detail không query; 375×812 | Đúng ID, grid 1 cột, scrollWidth không tràn; quay lại hash mặc định. | PASS ghi nhận. |
| M01 | browser-detail.mjs:161 | HTTP mô phỏng: ID đặc biệt, GET không có query, 12 trường, UTC/ISO và bố cục hai/một cột | ID có % + / # Unicode/khoảng trắng; page=3; 1280/375px | compareFields, path encode, query rỗng, 2/1 cột và không tràn toàn trang. | PASS ghi nhận; mở detail trực tiếp, không phải chuỗi từ bảng. |
| M02 | browser-detail.mjs:174 | HTTP mô phỏng: số 0, số âm, thập phân dài, cận thiếu, nullable, READY/FINAL | VALUE-0/1/2: low null/high 0; low âm/high null; time null | So từng field DOM với fixture. effective_at null được suy ra từ thiếu phần tử time; dấu — ở trường này được bổ trợ bằng U24/mã. | PASS ghi nhận. |
| M03 | browser-detail.mjs:186 | HTTP mô phỏng: trang 2/3 giữ bộ lọc đã áp dụng, F5 và Back/Forward, tìm lại cùng điều kiện | 31 dòng R-0…R-30; test_code=T1; bản nháp patient=DRAFT | List → click → reload detail → quay lại; hash, offset 10/20, test_code T1, không có patient; reload list; back/forward; cùng search vẫn tăng request. | PASS ghi nhận; là bằng chứng trực tiếp ca trang 3 yêu cầu. |
| M04 | browser-detail.mjs:217 | HTTP mô phỏng: 400/404/503/502 HTML, 200 HTML, mạng, thiếu trường và sai ID; thử lại cùng ID | Tám lỗi, detail ?page=3 | Alert đúng nhóm lỗi; không còn field cũ; 400/404 không retry nhưng quay lại được; sáu lỗi khác retry cùng path, không query, tăng 1 GET và thấy đúng ID. | PASS ghi nhận; request /503 có status 503 rồi 200. |
| M05 | browser-detail.mjs:251 | HTTP mô phỏng: URL sai hiển thị lỗi và không gửi GET, kể cả ngữ cảnh chi tiết sai | Bảy URL sai: ACK, patient blank, page âm/lặp, %GG, %FF, path thiếu ID | Alert có URL không hợp lệ; request count giữ nguyên; nút về mặc định hoạt động. | PASS ghi nhận; cần lưu ý chờ alert có thể bắt lại alert cũ ở các vòng sau. |
| M06 | browser-detail.mjs:263 | HTTP mô phỏng: hủy khi đổi ID/rời trang/thử lại; phản hồi đến muộn không ghi đè | OLD-false→NEW; OLD-true→list; RETRY 503→200 | Bọc fetch bỏ signal mạng; giữ response trước khi trả app; signal.aborted=true; thả response cũ sau response mới; vẫn NEW/list; retry hủy controller cũ. | PASS ghi nhận; chứng minh logic ứng dụng, không đo native abort ở transport. |
| L01 | browser.mjs:166 | Danh sách thật, 10 dòng, tám cột, UTC và nút chi tiết khả dụng | GET thật limit11, mẫu đầu trang | ID khớp API; tám header; nút enabled; datetime/text UTC. | PASS ghi nhận. |
| L02 | browser.mjs:175 | Không gọi khi gõ, Enter tìm kiếm, lọc kết hợp và phân trang giữ bộ lọc áp dụng | test 50912; patient của mẫu; FINAL; bản nháp patient | Không tăng request khi gõ; Enter; so API filter; offset10/0; trang sau không gửi draft; tổ hợp ba filter tìm kiếm đúng. | PASS ghi nhận; không mở detail khi đang áp dụng cả ba filter. |
| L03 | browser.mjs:204 | Xóa bộ lọc, danh sách rỗng, mất kết nối và thử tải lại | Reset; patient không tồn tại; Chrome offline/online | Input trống, chỉ limit/offset; 0 dòng và thông báo rỗng; có alert khi offline; hết alert sau retry. | PASS ghi nhận; dữ liệu từ API thật, lỗi mạng do CDP tạo. |
| L04 | browser.mjs:219 | Phản hồi cũ đến sau không ghi đè kết quả mới | Giữ response thật test_code; đổi sang patient; thả response cũ | So ID mới với backend trước/sau release, chờ 300ms. | PASS ghi nhận; trì hoãn có điều khiển ở browser, không phải race tự phát của backend. |
| L05 | browser.mjs:245 | Màn hình 375px, bảng cuộn ngang và không có lỗi JavaScript chưa xử lý | 375×812, danh sách thật | Trang không tràn; table-wrapper có cuộn ngang; browserErrors rỗng. | PASS ghi nhận. |
| P10 | browser-http.mjs:149 | 10 bản ghi, đi tới/quay lại, limit/offset, dòng và nút | N=10; cả ba filter FINAL; sửa draft khi paging | So từng trang/mã/nút/query; ghép ID đi tới/quay lại không mất/trùng; nút disabled không GET; offset đúng. | PASS ghi nhận; HTTP mô phỏng. |
| P11 | browser-http.mjs:149 | 11 bản ghi, đi tới/quay lại, limit/offset, dòng và nút | N=11; cả ba filter FINAL; sửa draft khi paging | So từng trang/mã/nút/query; ghép ID đi tới/quay lại không mất/trùng; nút disabled không GET; offset đúng. | PASS ghi nhận; HTTP mô phỏng. |
| P20 | browser-http.mjs:149 | 20 bản ghi, đi tới/quay lại, limit/offset, dòng và nút | N=20; cả ba filter FINAL; sửa draft khi paging | So từng trang/mã/nút/query; ghép ID đi tới/quay lại không mất/trùng; nút disabled không GET; offset đúng. | PASS ghi nhận; HTTP mô phỏng. |
| P21 | browser-http.mjs:149 | 21 bản ghi, đi tới/quay lại, limit/offset, dòng và nút | N=21; cả ba filter FINAL; sửa draft khi paging | So từng trang/mã/nút/query; ghép ID đi tới/quay lại không mất/trùng; nút disabled không GET; offset đúng. | PASS ghi nhận; HTTP mô phỏng. |
| V0 | browser-http.mjs:192 | Nội dung ô giá trị giữ nguyên "0" | Một dòng value_num='0' | So ô thứ tư đúng nguyên văn, ID đúng, query mặc định, không alert. | PASS ghi nhận; HTTP mô phỏng. |
| VNEG | browser-http.mjs:192 | Nội dung ô giá trị giữ nguyên "-2.50" | Một dòng value_num='-2.50' | Cùng phép kiểm tra ô số nguyên văn. | PASS ghi nhận; HTTP mô phỏng. |
| VLONG | browser-http.mjs:192 | Nội dung ô giá trị giữ nguyên số dài | 12345678901234567890.123456789012345678901234567890 | Cùng phép kiểm tra ô số nguyên văn. | PASS ghi nhận; HTTP mô phỏng. |
| E503 | browser-http.mjs:211 | Lỗi HTTP 503, ẩn dữ liệu cũ, phục hồi đúng bộ lọc/trang | Dữ liệu cũ → trang 2 lỗi503 → sửa draft → retry200 | Loading/error 0 dòng, nút trang khóa, đúng HTTP; retry giữ bộ lọc áp dụng/trang 2; trang 3/quay lại đúng. | PASS ghi nhận; HTTP mô phỏng. |
| E400 | browser-http.mjs:211 | Lỗi HTTP 400, ẩn dữ liệu cũ, phục hồi đúng bộ lọc/trang | Search lỗi400 → sửa ba filter thành bộ FIX/READY | Loading/error 0 dòng; có retry; tìm mới sau sửa dùng bộ filter đúng, đi trang 2 được. Ca này không click retry cùng bộ sai. | PASS ghi nhận; HTTP mô phỏng. |
| E502 | browser-http.mjs:211 | Lỗi HTTP 502 HTML, ẩn dữ liệu cũ, phục hồi đúng bộ lọc/trang | Trang2 lỗi HTML → sửa draft → retry200 | Không lộ HTML/upstream; retry trang 2 giữ bộ áp dụng, trang 3/quay lại đúng. | PASS ghi nhận; HTTP mô phỏng. |


Có **24 ca/nhóm browser** (R3 + M6 + L5 + P/V/E10), không phải 24 unit test và không cộng hai loại thành một bộ đồng nhất. Toàn bộ JSON browser có exceptions/browserErrors rỗng; ba bộ dùng helper cũng có interceptionErrors rỗng.

### 3.3. Các ca đặc biệt được yêu cầu xác minh

| Ca | Bằng chứng cụ thể | Đánh giá |
|---|---|---|
| Trang3 → detail → F5 → Quay lại | M03 dòng187–202; JSON M requests #12 list offset20 → #13 R-20 → #14 R-20 → #15 list offset20 (đếm từ1) | Đạt bằng HTTP mô phỏng, filter test_code=T1 |
| F5 + Back/Forward giữ ngữ cảnh | R02 và M03; R requests #1/#4/#5/#7 đều offset10/test50912; #2/#3/#6 cùng MIMIC-LAB-107261; M #12–18 giữ offset20/R-20 | Đạt với filter và trang đã ghi; chưa bao phủ một luồng browser dùng cả ba filter |
| % + / # Unicode/khoảng trắng | U13/U16 và M01; path /%20R%2FAbC%2B%25%3F%23%26%20ti%E1%BA%BFng%20Vi%E1%BB%87t%20 | Đạt mock; request không có query, response ID nguyên văn |
| 0, -2.50, số dài | M02/V0/VNEG/VLONG và U18/U24 | Đạt, so chuỗi trực tiếp, không làm tròn |
| Cận null độc lập | M02 VALUE-0 low=null/high=0; VALUE-1 low=-0.000000001/high=null | Đạt ở Chrome mô phỏng; U24 bổ sung cả hai cùng null |
| Response cũ sau đổi kết quả | M06 OLD-false bị giữ; NEW hiện xong; signal cũ aborted; thả OLD rồi vẫn NEW | Đạt logic UI; HTTP old đã trả tới wrapper, được trì hoãn trước khi app nhận |
| 503 → Retry →200 | M04 GET /503 status503 rồi GET /503 status200; M06 /RETRY cũng503→200 | Đạt mock; assert giữ đúng ID và không mang query danh sách |
| Hồi quy đầy đủ bộ 2.1 đã có | 12 U01–U12, L01–L05 và P10/P11/P20/P21/V0/VNEG/VLONG/E503/E400/E502 | Đạt theo đúng bộ cũ, không xóa ca để đạt |


## 4. Những chức năng có bằng chứng API thật

Đây là bằng chứng **đã lưu của lượt triển khai**, được kiểm tra lại tính nhất quán và SHA-256 trong đợt này; không có GET backend mới trong đợt rà soát.

[detail-real-browser.json](../phase-2.2-2026-11-03/detail-real-browser.json) có completed=true, 3 PASS, 9 request Chrome đều GET và 3 GET trực tiếp HTTP200. Phiên Chrome 156.0.8078.80; lượt từ 14:32:24.918Z đến 14:32:43.275Z ngày 03/11/2026 (21:32 giờ Asia/Bangkok).

- Mở danh sách `test_code=50912&page=2`, gõ bản nháp patient chưa áp dụng, click dòng thật và đối chiếu đủ 12 field với GET chi tiết.
- Giữ filter/trang qua reload chi tiết, Quay lại, reload list và history.back/forward.
- Mở trực tiếp detail không context, về list mặc định.
- Hai cột ở 1280px, một cột ở 375px, không tràn ngang toàn trang.
- Chuỗi số/đơn vị, cận, UTC hiển thị đến giây; ISO gốc `.000000Z` có datetime/title.
- Không có ngoại lệ JS trong các lượt ghi nhận.

Mẫu đã so cả object qua assert:

| Field | Giá trị API thật |
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


[list-regression/real-browser.json](../phase-2.2-2026-11-03/list-regression/real-browser.json) có completed=true, 5 PASS, 19 URL request danh sách và 5 lần gọi backend lưu body/status. Chứng minh lọc/Enter/phân trang/reset/rỗng trên dữ liệu thật. Nhóm offline và response muộn dùng dữ liệu thật nhưng **can thiệp điều kiện trình duyệt** bằng CDP/wrapper; không coi đó là lỗi thật tự xuất hiện ở backend. Nhật ký cũ này chỉ lưu URL, không có trường method riêng cho từng request; code gọi fetch mặc định GET. Bộ detail mới có lưu method.

## 5. Những chức năng chỉ được kiểm chứng bằng mock/mô phỏng

- ID có ký tự đặc biệt nêu trên, READY, thời gian null và phần lẻ giây khác0, fluid/category null; không có mẫu detail thật tương ứng.
- Giá trị chính xác `-2.50` và chuỗi thập phân dài; detail `0`; cận thiếu một phía. Danh sách API thật có sẵn 0/−5 và cận null trong body đã lưu, nhưng không đồng nghĩa đã mở và so detail các bản ghi đó.
- Chuỗi **trang 3** → detail → F5 → quay lại và Back/Forward; bản API thật mới chứng minh từ trang 2.
- HTTP400/404/503/502 HTML,200 HTML, cấu trúc thiếu/sai kiểu hoặc ID lệch. Lỗi mạng detail được phát sinh bằng Fetch.failRequest.
- Retry cùng ID sau503 và các lỗi phục hồi; quay lại khi detail bị giữ; response cũ sau đổi ID/rời trang.
- Kiểm tra đủ mọi trường bị thiếu/sai kiểu dùng unit fetch mock; so toàn bộ số/nullable ở UI dùng SSR và Chrome mô phỏng.

Các giới hạn này được đặc tả cho phép dùng mô phỏng cho dữ liệu biên; không tự chuyển kết quả mô phỏng thành kết quả API thật.

## 6. Tính nhất quán tài liệu, lỗi/rủi ro và khoảng trống bằng chứng

### 6.1. Đối chiếu bằng chứng và tài liệu

| Hạng mục | Nhận xét |
|---|---|
| BAO_CAO.md bàn giao | Số lượng unit 24, nhóm detailmock6/detailreal3/listreal5/listmock10 khớp script, text và JSON. |
| Manifest | 16 source +25 evidence +5 build hiện có đều khớp SHA-256; git-state tự loại hash chính nó và nêu rõ điều đó, không coi là lỗi. |
| Log TypeScript/lint | Có lệnh tsc -b/eslint, không có error trong log; đợt rà soát không chạy lại. Log text không có exitCode cấu trúc, nên mức bằng chứng hẹp hơn kết quả unit chạy mới. |
| Log build | Có tsc -b && vite build, 27 module, dòng built in 1.13s, asset names/sizes;5 file build khớp manifest. Không build lại. |
| 11 ảnh đã xem | 4 ảnh detail và7 ảnh list; thật/mô phỏng phân biệt đúng tên; số/ID/cận/status trên ảnh rộng khớp JSON. Ảnh lỗi400/503/502 và phục hồi khớp snapshot steps. Draft-OTHER ở ảnh retry và row NEW là đúng thiết kế tách draft/applied. |
| Ảnh hẹp | Ảnh375px chỉ là viewport đầu trang. Không nhìn thấy toàn bộ12 field trong ảnh; DOM compareFields và CSS/grid assertions bổ trợ, không nói ảnh một mình chứng minh đủ 12 field. |
| README LIS | Đã cập nhật limit11, filter, route/page, nullable, UTC, retry và điều hướng; nêu rõ dot IDs và chưa có Publish. |
| README frontend | Mục hiện tại 2.2 đúng, limit11 đúng; phần lịch sử được gắn nhãn. Câu mở đầu vẫn chỉ nói 2.1, có thể cập nhật đồng bộ ở đợt sửa được phép sau. |
| Tái chạy | README ví dụ ghi trực tiếp vào thư mục bằng chứng bàn giao. Nếu tái kiểm thử, chọn LIS_EVIDENCE_DIR mới; không chạy snapshot-acceptance.mjs mặc định vì đó là script 2.1 có ghi file. |


### 6.2. Phát hiện và mức ảnh hưởng

**F01 – Ngoại lệ ID `.`/`..` chưa có căn cứ hợp đồng thống nhất (điều kiện nghiệm thu).**
Vị trí: `src/state/routes.ts:49`, `src/api/lis.ts:71`; backend `controller.ts:31`, `openapi.ts:5`. Backend kiểm tra không rỗng/control và schema minLength1; không nêu cấm hai ID này. Frontend từ chối trước GET; U15/U23 cố định cùng hành vi. README/báo cáo đã công khai giới hạn, nhưng không phải bằng chứng người dùng đã chấp thuận thay miền định danh. Có lý do kỹ thuật về dot-segment của URL, vì vậy không đề nghị đơn giản bỏ chặn rồi gửi sai path. Cần chốt miền ID/ngoại lệ hoặc yêu cầu xử lý tiếp trong phạm vi được cho phép trước khi commit. Không kết luận cần sửa backend trong đợt rà soát; không sửa gì.

**F02 – Chưa có một ca Chrome kết hợp cả ba filter với toàn bộ detail/F5/history (khoảng trống bằng chứng tổ hợp).**
U14 chứng minh serialize/parse đủ ba; L02 chứng minh lọc ba trên list; R02/M03 chứng minh navigation với test_code. Chưa có phép chạy end-to-end cho ba filter đồng thời qua detail/reload/history. Code dùng chung ResultsQuery cho cả ba nên không thấy nhánh làm mất filter, nhưng đó là đọc mã. Nên bổ sung ca trong đợt kiểm thử tiếp theo nếu muốn nghiệm thu tích hợp tổ hợp này, không báo “đã chạy đạt” lúc này.

**F03 – Một số wait/assert có thể yếu hơn tên ca (cải thiện bộ test, chưa thấy sai hành vi app).**
`browser-detail.mjs:39`, `:44` chỉ chờ DOM đúng ID/trang, không đợi loader/new request sau từng Page.reload hoặc history; `:257` chờ chung text alert có thể gặp alert của URL sai trước đó. Chuỗi GET lặp trong JSON và U15 đang bổ trợ đáng kể, nên không phủ nhận kết quả đã ghi. Để kết quả tái chạy chắc hơn, nên gắn mỗi thao tác với request/load mới và snapshot hash/query sau mỗi bước. M02 ánh xạ effective_at null bằng thiếu phần tử time; nếu muốn kiểm tra ký tự — chính xác từng field thì assert trực tiếp textContent từng dd, thay vì chỉ số lượng — trong SSR.

**F04 – Phân biệt abort logic với transport.**
M06 bỏ signal ở fetch thực tế của browser kiểm thử để ép response cũ đến; nó có assert signal ứng dụng đã abort và UI không bị ghi đè. U08/U23 abort trước gọi. Chưa có phép đo Network.loadingFailed/canceled khi abort một GET đang bay bằng native fetch. Không báo thiếu logic abort: code truyền đúng signal và cleanup controller; chỉ giới hạn phạm vi chứng minh của test.

**F05 – Giới hạn log/thiết bị và tài liệu nhỏ.**
Không có Firefox/Safari, không có ảnh full-page mobile; TypeScript/lint/build không được chạy lại trong lượt rà soát. ISO formatter chỉ slice chuỗi UTC mà backend cam kết; không kiểm tra ngữ nghĩa timestamp/numeric string ngoài kiểu API và cũng không được yêu cầu tự chẩn đoán dữ liệu. Các lưu ý này không phải lỗi mới ở luồng đã kiểm thử. README frontend nên đồng bộ câu mở đầu 2.2; không sửa ở đợt review.

Không phát hiện POST nghiệp vụ, Publish, sửa dependency, sửa backend/database/Compose hoặc ghi đè nội dung 2.1. Không suy luận việc “các ca đã chạy PASS” thành “không thể tồn tại lỗi ngoài các ca đó”.

## 7. Kết luận nghiệm thu

**Đạt có điều kiện.**

- Đạt các luồng trọng tâm trong phạm vi bằng chứng:12 trường, GET đúng ID, số/đơn vị/UTC/null, route/F5/history, giữ trang 2/3 và filter đã thử, retry 503, chống response muộn, responsive và hồi quy 2.1.
- Unit 24/24 được chạy mới và đạt; browser kết luận dựa trên bằng chứng đã lưu, đã kiểm tra đúng mã/assert và hash.
- Điều kiện để chuyển sang nghiệm thu vô điều kiện: giải quyết rõ F01 về miền ID; không tự coi dot IDs là đã được chấp thuận loại bỏ. F02 là khoảng trống tích hợp cần giữ rõ trong hồ sơ, có thể bổ sung kiểm thử trước commit.
- Các điểm F03–F05 là khuyến nghị tăng độ chắc của bằng chứng/tài liệu; chưa chứng minh một lỗi vận hành trong luồng chính.

## 8. Công việc trước khi commit Giai đoạn 2.2

1. Chốt bằng văn bản phạm vi hỗ trợ hai ID `.`/`..`; nếu cần thay hành vi thì giao một đợt sửa riêng có phạm vi rõ, không sửa backend ngoài thẩm quyền.
2. Bổ sung ca browser áp dụng đồng thời patient_id/test_code/result_status ở trang 3, vào detail, F5, Quay lại, F5 list, Back/Forward; so cả hash, query GET và ID dòng. Ghi nhận là công việc bổ sung, chưa thực hiện trong review này.
3. Khi được phép chỉnh test, tăng điều kiện chờ cho reload/history/invalidURL và lưu snapshot từng bước; có thể thêm kiểm tra native transport abort và text — từng field.
4. Đồng bộ câu giới thiệu README frontend với 2.2; giữ nhãn lịch sử và ghi rõ thư mục evidence mới cho lần chạy sau.
5. Sau mọi thay đổi được chấp thuận, chạy lại check/lint/build/unit và các browser liên quan với LIS_EVIDENCE_DIR mới; lưu cả exitCode; đối chiếu SHA nguồn/build và diff/index lần cuối.
6. Xem đầy đủ các file untracked trước khi stage ở một yêu cầu sau; không chỉ dựa git diff --stat. Không đưa dữ liệu/Publish/2.3 vào commit 2.2.

Đợt này dừng ở báo cáo. Chưa stage/commit/push/merge, chưa triển khai hoặc gọi Publish, chưa bắt đầu Giai đoạn 2.3.
