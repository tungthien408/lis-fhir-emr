# Báo cáo xử lý điều kiện nghiệm thu cuối Giai đoạn 2.2 – resultId . và ..

Ngày 03/11/2026, múi giờ Asia/Bangkok.

**Kết luận: Đạt điều kiện xử lý dot ID trong môi trường frontend đã kiểm chứng: Vite development và Vite preview chạy bản build.** Frontend không còn tự từ chối `.`/`..`; đường đi đến HTTP upstream giữ đúng định danh và không xung đột với literal ID `%2E`/`%2E%2E`.

Phân biệt phạm vi: detail HTTP 200 cho dot ID được chứng minh bằng **upstream HTTP mô phỏng phía sau proxy thật**, còn backend/database thật hiện trả 404 vì không có các bản ghi đó. Chưa chứng minh truy xuất một dot record thật và chưa nghiệm thu máy chủ triển khai khác Vite. Thư mục dist tự nó không có proxy; mục 6 nêu rõ điều kiện triển khai.

## 1. Nguyên nhân gốc

Đã đọc [phương án trước khi sửa](../phase-2.2-conditions-2026-11-03/PHUONG_AN_DOT_ID.md), đối chiếu controller/OpenAPI backend và hành vi thực:

1. Backend `backend/src/lis/controller.ts:31` chỉ cấm mã rỗng/control; `openapi.ts:5` không cấm `.`/`..`. Frontend trước đó bổ sung hard reject tại parser và API client, khác miền ID hợp lệ của backend.
2. Hash `#/results/.` và `#/results/..` vẫn giữ đúng dấu chấm. Lỗi định danh không nằm ở việc trình duyệt rút gọn fragment.
3. URL dùng cho fetch có dot segment bị chuẩn hóa: `.`/`%2E` thành endpoint danh sách, `..`/`%2E%2E` thành đường dẫn cha. Double encoding đơn thuần lại khiến backend tra literal ID `%2E` thay vì `.`.
4. Phép thử trước khi sửa còn phát hiện **proxy Vite cũng phân tích lại URL**. Chỉ đổi escape trong bypass không đủ: upstream nhận mất dot. Đọc mã proxy đang cài cho thấy `toProxy: true` bỏ qua lớp phân tích lại request path; đã xác minh bằng raw HTTP đến upstream trước khi nối vào ứng dụng.
5. Hai ID khác nhau có thể dùng cùng URL vận chuyển nhưng khác marker header, nên phải bảo vệ biến thể cache bằng Vary cho **cả request có và không có marker**.

Không sửa hợp đồng hoặc dữ liệu backend để hợp thức hóa lỗi frontend.

## 2. Phương án sửa đã chọn và lý do

### 2.1. Biểu diễn hash và vận chuyển HTTP

Hash vẫn theo quy ước cũ, giải mã đúng một lần:

- Dot ID: `#/results/.`, `#/results/..`; dạng `#/results/%2E` cũng biểu diễn ID `.`.
- Literal ID `%2E`: hash `#/results/%252E`, khác với dot ID.
- Query trong hash chỉ lưu filter/trang; không gửi vào GET chi tiết.

Client dùng path an toàn và marker `X-LIS-Dot-Segment: 1` chỉ cho đúng hai ID dot:

| ID gốc | Path browser sau /api/lis/results/ | Marker | Raw path upstream sau /api/results/ | ID sau một lần decode |
|---|---|---|---|---|
| . | %252E | 1 | %2E | . |
| .. | %252E%252E | 1 | %2E%2E | .. |
| %2E | %252E | Không | %252E | %2E |
| %2E%2E | %252E%252E | Không | %252E%252E | %2E%2E |


Mã client tại `src/api/resultRequest.ts:3` và `src/api/lis.ts:71`. Chỉ hai ID dot có marker; mọi ID khác giữ encodeURIComponent như cũ. Các ký tự %, /, +, #, ?, Unicode và khoảng trắng của định danh không bị trim, đổi hoa/thường hoặc decode thêm. Client tiếp tục kiểm tra response.result_id khớp nguyên văn với ID yêu cầu và truyền AbortSignal như trước.

### 2.2. Proxy chỉ dành cho LIS

`proxy/lis.ts:5` mở rộng cấu hình LIS hiện có:

- Chỉ đổi escape cho GET với marker chính xác và wire path đúng một trong hai mẫu. Không chọn sentinel có thể trùng ID khác.
- Bỏ marker trước khi gửi lên backend.
- Dùng `toProxy: true` giữ raw path, tránh bước normalize lại của thư viện proxy.
- Thêm `Vary: X-LIS-Dot-Segment` cho hai wire path có thể mang dot hoặc literal ID, kể cả request không marker; bảo toàn Vary đã có và không làm trùng header.
- Không đổi target, prefix rewrite hoặc endpoint backend. Không thêm endpoint mới.
- `vite.config.ts:11` gắn helper cho cả server và preview riêng LIS; cấu hình dùng chung và proxy Monitor/EMR giữ nguyên.

Chọn phương án này vì có thể giữ backend/API/database nguyên trạng, sửa ít mã thực thi và đã chứng minh truyền đúng raw path. HTTP 200 phía upstream vẫn là cùng hợp đồng 12 trường; marker chỉ là quy ước của lớp proxy frontend, không trở thành tham số API backend.

### 2.3. Xác minh trước và sau triển khai

- Lượt preflight đầu thất bại khi chỉ dùng bypass: nhận ID rỗng thay vì `.`. Giữ [log thất bại](preflight.txt), [prototype ban đầu](candidate.mjs) và JSON tương ứng để không che mất bước xác minh.
- Prototype có `toProxy: true` đạt **42/42 kiểm tra HTTP** trên dev+preview **trước khi áp dụng vào ứng dụng**: [JSON](preflight-verified.json), [log](preflight-verified.txt), [prototype đã kiểm chứng](candidate-verified.mjs).
- Sau triển khai, cùng bộ 42 ca chạy lại với **module thực của ứng dụng**, đạt: [proxy-http.json](proxy-http.json), [proxy-http.txt](proxy-http.txt).
- Gồm 16 ID phân biệt và 5 đường dẫn đối chứng cho mỗi mode. Các đường dẫn danh sách có query, ready, Monitor, EMR và đường dẫn mock có hậu tố publish giữ nguyên. Đường dẫn publish chỉ được GET đến upstream mô phỏng để so raw path; không gọi POST/Publish thật.

## 3. Danh sách file thay đổi trong lượt sửa này

Đường dẫn dưới đây tính từ `frontend/apps/lis/`. Có 7 file đã tồn tại được sửa và 5 file mã/kiểm thử mới; các thay đổi của lượt 2.2 trước đó vẫn được giữ.

| File | Loại trong lượt này | Nội dung |
|---|---|---|
| src/state/routes.ts | Sửa tệp đã có | Bỏ hai hard reject dot; giữ kiểm tra rỗng/control và decode một lần. |
| src/api/lis.ts | Sửa tệp đã có | Dùng wire request helper, thêm headers tùy chọn, giữ ID response check/signal/lỗi cũ. |
| src/api/resultRequest.ts | Mới | Một nơi tạo wire path và marker cho đúng dot ID. |
| proxy/lis.ts | Mới | Raw-path proxy/Vary có phân biệt marker; không tác động cấu hình shared. |
| vite.config.ts | Sửa tệp đã có | Lắp proxy helper riêng LIS cho development và preview. |
| tests/detail.test.mjs | Sửa tệp đã có | Đổi dot từ ca bị cấm sang hợp lệ; vẫn giữ mọi ca URL sai khác. |
| tests/dot.test.mjs | Mới | 6 ca cấp hàm: hash/client/header/signal/mismatch, proxy gating/Vary, cấu hình khác giữ nguyên. |
| tests/helpers/http-browser.mjs | Sửa tệp đã có | Cho phép dev/preview, target upstream test, quan sát CDP; cache riêng và cleanup dev server. |
| tests/browser-dot.mjs | Mới | Chrome qua proxy thật, HTTP upstream thật/mô phỏng, cache/native abort/late response. |
| tests/probe-dot-transport.mjs | Mới | 42 kiểm tra native HTTP với proxy helper đang dùng. |
| tests/browser-conditions.mjs | Sửa tệp đã có | Cập nhật probe dot từ kỳ vọng invalid sang lookup 404 hợp lệ; giữ luồng ba filter/F5/history. |
| README.md | Sửa tệp đã có | Mô tả protocol, proxy, cache, lệnh chạy và giới hạn bản build. |


Trạng thái Git `??` không đồng nghĩa file mới trong lượt này: routes.ts, detail.test.mjs và browser-conditions.mjs đã untracked từ trước. Baseline ghi rõ toàn bộ 308 file đã có trước lượt sửa. Các file bằng chứng mới đều ở `tests/evidence/phase-2.2-dot-fix-2026-11-03/`; không sửa các hồ sơ cũ.

## 4. Kết quả kiểm thử . và ..

### 4.1. Chrome và HTTP thực qua upstream mô phỏng sau proxy

Đây là HTTP đến một Node upstream độc lập, đi qua cấu hình proxy LIS thật; **không CDP fulfill trước proxy**. Upstream ghi rawPath, ID sau decode một lần, marker đã bỏ, method/status/body. Browser so đủ 12 trường và datetime/title với từng fixture riêng biệt.

| Mode | Ca/nhóm | Cache hit Chrome | Native abort | Kết quả |
|---|---|---|---|---|
| Vite development | 22/22 | 12 lượt fromDiskCache, 24 phép đọc cache | Upstream nhận canceled=true | Đạt |
| Vite preview, bản build | 22/22 | 14 lượt fromDiskCache, 24 phép đọc cache | Upstream nhận canceled=true | Đạt |


Trong mỗi mode:

- 16 ca ID: `.`, `..`, `%2E`, `%2E%2E`, các dạng lowercase, `%252E`, `%`, `%25`, ID thường, slash, literal %2F, +, #, ?, Unicode/emoji/khoảng trắng. Mỗi fixture có giá trị khác nhau để phát hiện lẫn dữ liệu.
- 2 nhóm đầy đủ dot/dotdot: mở từ dòng bảng → F5 detail → Quay lại giữ ba filter → F5 list → Back → Forward → mở hash escape trực tiếp. Đối chiếu hash, HTTP mới, ID và 12 trường; F5 phải có document UUID mới.
- 1 nhóm cache bật cache Chrome/force-cache, 24 lượt luân phiên marker và không marker; các body và giá trị giữ đúng ID, có cache hit thực tế.
- 1 nhóm 503 → Thử tải lại cùng dot ID →200.
- 1 nhóm native abort: giữ GET dot đang bay tại upstream, đổi sang dotdot; CDP ghi canceled và upstream nhận hủy trước khi kết thúc response.
- 1 nhóm response muộn: harness cố tình bỏ signal mạng để dot response vẫn về, nhưng controller ứng dụng đã abort; thả response cũ sau dotdot và xác nhận không ghi đè. Phần này là can thiệp kiểm thử, không thay mã ứng dụng.

Bốn cặp raw path/response ghi nhận giống nhau ở cả dev/preview:

| ID frontend | Raw upstream path | Marker tới backend | HTTP/response.result_id |
|---|---|---|---|
| . | /api/results/%2E | Không có | 200 / . |
| .. | /api/results/%2E%2E | Không có | 200 / .. |
| %2E | /api/results/%252E | Không có | 200 / %2E |
| %2E%2E | /api/results/%252E%252E | Không có | 200 / %2E%2E |


Bằng chứng chính: [dev JSON](dev-mock-verified/browser-dot.json), [dev log](dev-mock-verified/console.txt), [preview JSON](preview-mock-verified/browser-dot.json), [preview log](preview-mock-verified/console.txt). Đã xem ảnh bản build: [dot](preview-mock-verified/dot-detail.png), [dotdot](preview-mock-verified/dotdot-detail.png); đúng ID, số 0/−2.50, cận/null và bố cục. Ảnh chỉ bổ trợ; kết luận luồng dựa trên assert/HTTP/snapshot.

### 4.2. Chrome và backend/database thật

| Mode | Kiểm tra | Kết quả |
|---|---|---|
| Development | 4 ID . / .. / %2E / %2E%2E và bản ghi thường | 5/5 nhóm đạt; cả 4 ID đặc biệt trả 404 lookup, bản ghi thường trả200. |
| Preview bản build | Cùng bộ 5 nhóm | 5/5 đạt; không có lỗi URL frontend hoặc route cha/danh sách thay vì detail. |


Đã so GET raw trực tiếp đến backend với response mà Chrome nhận qua proxy:

- `/api/results/%2E` và `/api/results/%2E%2E`:404 NOT_FOUND, message **Laboratory result not found**; không phải VALIDATION_ERROR hoặc “API route not found”.
- `/api/results/%252E` và `/api/results/%252E%252E`:404 lookup của literal ID tương ứng.
- Ở UI, dot ID được parse thành detail, phát GET wire đúng marker, hiện thông báo không tìm thấy và vẫn quay lại được; không còn “URL không hợp lệ”.
- `MIMIC-LAB-100142`: HTTP 200, so đủ 12 trường, ba filter MIMIC-P-10007928/50912/FINAL, F5 detail/Quay lại/Back/Forward giữ đúng ngữ cảnh.

Bằng chứng: [dev thật](dev-real-confirmed/browser-dot.json), [log](dev-real-confirmed/console.txt), [preview thật](preview-real/browser-dot.json), [log](preview-real/console.txt).

**Giới hạn:** realRecordFound=false cho cả bốn ID đặc biệt ở hai mode. Không tạo dot record trong database. Không coi lượt mock200 là bằng chứng truy xuất dot record thật. Raw upstream ID/path được ghi trực tiếp ở upstream mô phỏng; ở backend thật không thêm instrumentation server, dùng response lookup và đối chiếu raw GET trực tiếp, cùng proxy đã xác minh đường đi.

### 4.3. Chứng minh cấp hàm

6 ca mới ở dot.test.mjs đều đạt, bổ trợ cho browser/HTTP:

- Hash round-trip dot/literal/special ID không normalize hoặc decode lần hai.
- Wire path có/không marker phân biệt dot và literal percent.
- API client giữ path/header/signal, kiểm tra đúng result_id và từ chối response literal nếu yêu cầu dot.
- Proxy chỉ đổi đúng GET/marker/path; không đổi ID thường, query list, hậu tố khác hoặc method khác (method khác chỉ gọi hàm, không gửi POST).
- Vary bảo toàn header hiện có, hỗ trợ wildcard và tránh thêm trùng.
- Chỉ proxy LIS được mở rộng ở dev/preview; base/Monitor/EMR không bị sửa.

Đây là ca cấp hàm, không tự nó chứng minh transport; các phần 4.1/4.2 mới là kiểm chứng browser/HTTP.

## 5. Kiểm thử hồi quy, TypeScript, lint và build

Các kết quả bên dưới đã chạy trong lượt sửa này, không suy luận từ log cũ:

| Nhóm/lệnh | Kết quả | Bằng chứng |
|---|---|---|
| npm.cmd run check --workspace apps/lis | Đạt | [typecheck-final.txt](typecheck-final.txt) |
| npm.cmd run lint (toàn frontend) | Đạt | [lint-final.txt](lint-final.txt) |
| npm.cmd run build:lis (tsc -b và Vite) | Đạt; 28 module, JS index-DRIxqvZ8.js | [build.txt](build.txt) |
| Unit 2.1/2.2 + dot | 30/30 PASS, 0 fail/skipped; 24 ca cũ + 6 ca mới | [unit.txt](unit.txt) |
| Native HTTP/proxy code hiện tại | 42/42, dev+preview | [JSON](proxy-http.json), [log](proxy-http.txt) |
| Chrome 2.1 danh sách API thật | 5/5 nhóm | [JSON](regression/list-real/real-browser.json), [log](regression/list-real/console.txt) |
| Chrome 2.1 danh sách HTTP mô phỏng | 10/10: P10/P11/P20/P21/V0/VNEG/VLONG/E503/E400/E502 | [JSON](regression/list-mock/http-browser.json), [log](regression/list-mock/console.txt) |
| Chrome 2.2 chi tiết API thật | 3/3 nhóm | [JSON](regression/detail-real/detail-real-browser.json), [log](regression/detail-real/console.txt) |
| Chrome 2.2 chi tiết HTTP mô phỏng | 6/6 nhóm | [JSON](regression/detail-mock/detail-http-browser.json), [log](regression/detail-mock/console.txt) |
| Ba filter với MIMIC-LAB-100142 thật | 8/8 bước; thêm probe dot lookup 404 hợp lệ | [JSON](regression/three-filters-real/conditions-real.json), [log](regression/three-filters-real/console.txt) |
| Ba filter + trang 3 HTTP mô phỏng | 10/10 bước | [JSON](regression/three-filters-mock/conditions-mock.json), [log](regression/three-filters-mock/console.txt) |
| git diff --check | Đạt | verification.json |


Không xóa ca cũ để làm bộ mới đạt. Kỳ vọng cấm dot trong detail.test và browser-conditions được đổi thành kỳ vọng hợp lệ, kèm ca dương tính/transport bổ sung. Tất cả 10 bộ Chrome bàn giao cuối có exceptions/browserErrors và interceptionErrors rỗng. Native abort có Network.loadingFailed(canceled) dự kiến, không phải ngoại lệ JS chưa xử lý.

Các lượt thử chưa được chấp nhận vẫn giữ riêng:

- Preflight đầu chứng minh cần `toProxy:true`, không áp dụng phương án bypass đơn thuần.
- TypeScript đầu bắt lỗi kiểu optional/string ProxyOptions của config kế thừa; đã thêm type guard, lượt cuối đạt.
- Một số lượt harness mới timeout do cờ lỗi/hold trùng null của endpoint list, điều hướng cùng hash không phát request mới, và lỗi 503 một lần bị Strict Mode tiêu thụ bởi request bị hủy. Đã sửa script mô phỏng/điều kiện chờ; giữ các thư mục dev-mock, dev-mock-final, dev-mock-accepted, dev-real… làm lịch sử, không tính là kết quả đạt.
- Các thư mục có hậu tố verified ở bảng/đường dẫn trên là bằng chứng mock cuối; dev-real-confirmed và preview-real là bằng chứng backend thật cuối. Không ghi đè hồ sơ nghiệm thu trước đợt này.

## 6. Giới hạn giữa Vite development, preview và triển khai bản build

| Môi trường | Trạng thái xác minh | Điều kiện |
|---|---|---|
| Vite development | Đã kiểm thử browser/HTTP, đạt | Dùng vite.config.ts và proxy/lis.ts hiện tại. |
| Vite preview phục vụ dist mới build | Đã kiểm thử browser/HTTP, đạt | preview.proxy có cùng protocol và giữ raw path. |
| Chỉ sao chép dist lên máy chủ tĩnh | Không đủ để tự hỗ trợ dot ID | dist chỉ có HTML/JS/CSS/tài nguyên; không có proxy Node/Vite. |
| Reverse proxy triển khai khác Vite | Chưa có môi trường để kiểm thử/triển khai | Phải giữ marker tới lớp mapping, phân biệt literal ID, forward raw escaped path không normalize lại, bỏ marker trước backend và trả Vary cho cả hai biến thể. |


Không tự suy luận dev đạt thì mọi máy chủ triển khai đều đạt. README LIS đã ghi rõ yêu cầu proxy cho bản build; không sửa backend/Compose để triển khai ngoài phạm vi. Máy chủ chỉ rewrite tiền tố theo cấu hình cũ sẽ chưa đáp ứng dot ID.

Lượt backend thật chưa có dot record 200; đó là giới hạn dataset, không phải lý do tiếp tục cấm ID. Sau này nếu có dot record hợp lệ từ nguồn thật, nên chạy lại bộ --real; không thêm dữ liệu kiểm thử vào database hiện tại.

## 7. Kết luận điều kiện cuối

**Đạt trong phạm vi ứng dụng hiện tại dùng proxy frontend LIS trên Vite development và preview bản build.**

- Không còn coi `.`/`..` là mã không hợp lệ.
- Browser URL → HTTP proxy → raw upstream → ID/response/display khớp nhau, không lẫn dot với literal percent.
- HTTP mô phỏng phía sau proxy chứng minh 200 và đủ 12 field; backend thật chứng minh lookup 404 đúng, cùng bản ghi thường 200 không hồi quy.
- Đã chạy lại 30 unit, toàn bộ hồi quy 2.1/2.2, TypeScript/lint/build.
- Chưa chứng minh dot record 200 từ database thật; chưa nghiệm thu một reverse proxy production khác Vite. Các giới hạn này không được ghi thành đã kiểm thử.

Không triển khai Publish/Giai đoạn 2.3. Không thêm dependency hay thay hợp đồng API.

## 8. Trạng thái Git và bàn giao

- Nhánh `feature/frontend/lis-emr-ui`; HEAD `e47af51a1fca10092e22297aadbdcc5e75297f6d`, không đổi.
- Mã vẫn ở working tree; không stage/commit/push/merge.
- So với HEAD có 11 file tracked sửa (bao gồm thay đổi 2.2 đã có trước). `git diff --stat` không tính untracked; danh sách đầy đủ, mã băm nguồn/test/build và phạm vi thay đổi nằm trong [verification.json](verification.json).
- So baseline của **lượt này**, chỉ 7 file đã có được sửa và 5 file source/test mới như mục 3; còn lại là bằng chứng mới trong thư mục này.
- Các thư mục bằng chứng 2.1, 2.2,review và conditions trước đó giữ nguyên byte; backend/database/SQL/Compose/dependency và nguồn Monitor/EMR không đổi. Kiểm tra băm cuối xác nhận điều đó.
- Lệnh tái hiện trong [README LIS](../../../README.md). Chọn LIS_EVIDENCE_DIR mới khi chạy lại để giữ nguyên hồ sơ.

Dừng tại bàn giao này. Chưa commit và chưa triển khai giai đoạn tiếp theo.
