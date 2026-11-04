# Báo cáo hoàn thiện hai điều kiện nghiệm thu Giai đoạn 2.2

Ngày 03/11/2026, Asia/Bangkok. Đối chiếu [báo cáo rà soát trước](../phase-2.2-review-2026-11-03/BAO_CAO_NGHIEM_THU.md).

| Điều kiện | Kết luận hiện tại |
|---|---|
| 1. resultId . và .. | **Chưa đạt.** Đã tái hiện lỗi frontend tự từ chối ID hợp lệ; đã xác minh nguyên nhân hash/URL/fetch/backend và lập phương án. Chưa sửa ứng dụng, chưa có bằng chứng mở thành công detail cho hai ID. |
| 2. Chrome API thật, đủ ba bộ lọc và bản ghi chỉ định | **Đạt.** 8/8 bước với API thật, đúng MIMIC-LAB-100142; thêm 10/10 bước HTTP mô phỏng cho trang 3 vì bộ lọc thật chỉ có 2 dòng. |


**Chưa thể kết luận cả hai điều kiện đã hoàn tất.** Điều kiện 2 được đóng bằng bằng chứng mới; điều kiện 1 còn lỗi cần sửa. Không tự đổi hợp đồng để tuyên bố `.`/`..` không hợp lệ.

## 1. Phạm vi, Git và bảo toàn bằng chứng

- Nhánh: `feature/frontend/lis-emr-ui`; HEAD vẫn `e47af51a1fca10092e22297aadbdcc5e75297f6d`.
- Trước lượt này đã có 10 tracked sửa và 35 untracked từ triển khai/rà soát trước; không ghi đè chúng.
- Chỉ thêm `frontend/apps/lis/tests/browser-conditions.mjs` và bằng chứng/tài liệu trong thư mục hiện tại. Không sửa mã ứng dụng, proxy, test cũ hoặc README cũ.
- `baseline.json` băm 271 file đã có trước. `verification.json` xác minh lại cuối lượt, gồm nguồn và các thư mục bằng chứng 2.1/2.2/review.
- Không sửa backend, database, SQL, Compose, dependency. Tất cả thao tác nghiệp vụ là GET; không Publish, không stage/commit/push/merge.
- Browser dùng bản production hiện có. Source/build vẫn đối chiếu với manifest bàn giao; không build lại vì không đổi mã ứng dụng.

## 2. Điều kiện 1 – Hợp đồng và dot ID

### 2.1. Hợp đồng backend

Đọc `backend/src/lis/openapi.ts:5` (string/minLength1), `backend/src/lis/controller.ts:31` (nonempty/no control, không chuẩn hóa), và route GET tại `:108`. Không có quy tắc cấm `.`/`..`.

Đã gửi **raw HTTP GET** bằng Node http.get với thuộc tính path, để không bị URL parser chuẩn hóa trước khi đến server:

| Raw path đến backend thật | HTTP/body | Kết luận được phép rút ra |
|---|---|---|
| /api/results/. | 404; NOT_FOUND; Laboratory result not found | Route nhận ID và đi vào lookup; không có bản ghi, không phải VALIDATION_ERROR. |
| /api/results/.. | 404; NOT_FOUND; Laboratory result not found | Tương tự; ID không bị validator backend cấm. |
| /api/results/%2E | 404; NOT_FOUND; Laboratory result not found | Escape một lần có thể đến đúng route khi transport giữ raw path. |
| /api/results/%2E%2E | 404; NOT_FOUND; Laboratory result not found | Tương tự với ..; chưa có response 200 cho ID này. |


Không tạo dữ liệu mới để có response 200. Không diễn giải404 thành bằng chứng mã không hợp lệ.

### 2.2. Hash routing và fetch thực tế trong Chrome

- `resultsHash` tạo được `#/results/.` và `#/results/..`; Chrome giữ nguyên fragment.
- `parseResultsHash` hiện trả invalid do điều kiện hard reject tại `src/state/routes.ts:49`.
- Khi mở hai hash đó, app hiện “URL không hợp lệ”, **không phát GET chi tiết**. API client cũng có hard reject tại `src/api/lis.ts:71`.
- Sau đó script kiểm thử chủ động gọi fetch để phân biệt lỗi URL transport với lỗi router; đây là probe riêng, không phải app đã hỗ trợ dot ID.

| Input fetch qua proxy | URL Chrome thực gửi | Kết quả quan sát |
|---|---|---|
| /api/lis/results/. | /api/lis/results/ | HTTP 200, object danh sách limit 20/offset 0, không phải detail. |
| /api/lis/results/%2E | /api/lis/results/ | Cũng HTTP 200 danh sách 20 dòng; encode %2E không tránh dot-segment. |
| /api/lis/results/.. | /api/lis/ | HTTP 404, API route not found. |
| /api/lis/results/%2E%2E | /api/lis/ | Cũng HTTP 404 route. |
| /api/lis/results/%252E | Giữ %252E trong path | HTTP 404 Laboratory result not found; decode một lần thành ID %2E, không phải . |
| /api/lis/results/%252E%252E | Giữ %252E%252E trong path | HTTP 404 Laboratory result not found; ID sau decode là %2E%2E, không phải .. |


Vì vậy **chỉ bỏ hard reject sẽ không sửa đúng**: dot đơn còn khiến request đến API danh sách rộng hơn. Client hiện kiểm tra object/ID nên sẽ không coi envelope danh sách là detail hợp lệ, nhưng đường đi API vẫn sai. Double encoding đơn thuần cũng không giữ đúng định danh.

Bằng chứng: trường `dotCondition` trong [conditions-real.json](real-confirmed/conditions-real.json), có rawBackend, encodedRawBackend, browserHash/alert, noApplicationGET, normalization và doubleDecodedId cho từng ID. Mã script: `tests/browser-conditions.mjs:201`.

### 2.3. Nguyên nhân và phương án trước khi sửa

Nguyên nhân gồm hai lớp: frontend bổ sung quy tắc cấm ngoài hợp đồng, và fetch chuẩn hóa dot segment trước khi proxy nhận request. Hash tự nó không làm mất ID.

[PHUONG_AN_DOT_ID.md](PHUONG_AN_DOT_ID.md) mô tả phương án frontend + proxy LIS: cho phép hash/client nhận dot ID, dùng transport có marker riêng và mapping raw path tại proxy, phân biệt `.` với literal `%2E` và `..` với literal `%2E%2E`. Backend/endpoint/database giữ nguyên. Phương án mới là đề xuất, chưa thực thi hoặc được tính là đã kiểm thử thành công.

Theo yêu cầu trình bày nguyên nhân/phương án trước khi đổi mã ứng dụng, lượt này dừng phần sửa tại đề xuất cụ thể. **Chưa sửa hard reject hoặc proxy**, không tuyên bố điều kiện 1 đạt. Công việc còn lại là chốt/triển khai phương án vận chuyển rồi kiểm thử qua proxy thật với upstream mô phỏng riêng.

## 3. Điều kiện 2 – Chrome + API thật với bản ghi chỉ định

Dữ liệu dùng đúng yêu cầu:

```text
patient_id = MIMIC-P-10007928
test_code = 50912
result_status = FINAL
result_id = MIMIC-LAB-100142
```

GET trực tiếp HTTP 200 xác nhận cả ba bộ lọc trả đúng 2 bản ghi: MIMIC-LAB-100142 và MIMIC-LAB-100214. GET offset 10 trả mảng rỗng; không có trang 2 cho tổ hợp này.

### 3.1. URL và yêu cầu HTTP

```text
Danh sách:
#/results?patient_id=MIMIC-P-10007928&test_code=50912&result_status=FINAL

Chi tiết:
#/results/MIMIC-LAB-100142?patient_id=MIMIC-P-10007928&test_code=50912&result_status=FINAL

GET danh sách:
 /api/lis/results?limit=11&offset=0&patient_id=MIMIC-P-10007928&test_code=50912&result_status=FINAL

GET chi tiết:
 /api/lis/results/MIMIC-LAB-100142
```

Query trong hash detail chỉ lưu ngữ cảnh danh sách; **GET chi tiết không có query**. Đường dẫn qua Vite được rewrite đến `http://127.0.0.1:3101/api/results...` như cấu hình hiện có.

### 3.2. Các bước đã chạy

Ký hiệu L = hash danh sách đủ ba filter ở trên; D = hash chi tiết đủ ba filter ở trên.

| Bước | Thao tác | URL/request/dữ liệu đã assert | Kết quả |
|---|---|---|---|
| 1 | Mở danh sách mặc định | Hash rỗng mặc định; GET limit11/offset 0, có bảng | Đạt |
| 2 | Tìm kiếm đồng thời ba bộ lọc | L; GET đủ ba filter, offset 0; HTTP 200; hai ID đúng; ba ô lọc đúng; Trang 1 | Đạt |
| 3 | Mở đúng chi tiết từ dòng MIMIC-LAB-100142 | D; GET đúng /MIMIC-LAB-100142, không query; HTTP 200; đủ 12 field khớp GET trực tiếp | Đạt |
| 4 | F5 chi tiết: tài liệu mới, đúng ID và ngữ cảnh | D; GET đúng /MIMIC-LAB-100142, không query; HTTP 200; đủ 12 field khớp GET trực tiếp | Đạt |
| 5 | Quay lại giữ đủ ba bộ lọc và trang | L; GET đủ ba filter, offset 0; HTTP 200; hai ID đúng; ba ô lọc đúng; Trang 1 | Đạt |
| 6 | F5 danh sách: tài liệu mới, đúng ba bộ lọc và trang | L; GET đủ ba filter, offset 0; HTTP 200; hai ID đúng; ba ô lọc đúng; Trang 1 | Đạt |
| 7 | Back về chi tiết đúng ID/context | D; GET đúng /MIMIC-LAB-100142, không query; HTTP 200; đủ 12 field khớp GET trực tiếp | Đạt |
| 8 | Forward về danh sách đúng ba bộ lọc/trang | L; GET đủ ba filter, offset 0; HTTP 200; hai ID đúng; ba ô lọc đúng; Trang 1 | Đạt |


Script chờ số request mới tăng và response clone đọc xong; F5 còn kiểm tra documentId UUID mới, tránh nhận DOM của tài liệu trước. Khi gõ bộ lọc chưa Search, số request không tăng. Ở mỗi bước list, so body với GET trực tiếp và các cột hiển thị với từng row; ở detail, so đủ 12 field, text UTC và datetime/title.

Giám sát fetch trong Chrome chỉ gọi fetch gốc với arguments/signal nguyên vẹn rồi đọc **clone** response; không chặn/thay response, không dùng fixture trong lượt thật. CDP Network đồng thời ghi URL/method. Có 8 request luồng nghiệp vụ và 6 request probe chuẩn hóa dot ID; tổng 14 request Chrome đều GET. Raw HTTP probe đến backend được lưu riêng trong dotCondition. Không có ngoại lệ JS hoặc interceptionErrors.

### 3.3. 12 trường của MIMIC-LAB-100142 đã so với giao diện

| Trường | Giá trị API thật |
|---|---|
| `result_id` | `MIMIC-LAB-100142` |
| `patient_id` | `MIMIC-P-10007928` |
| `test_code` | `50912` |
| `test_name` | `Creatinine` |
| `fluid` | `Blood` |
| `category` | `Chemistry` |
| `value_num` | `0.9` |
| `unit` | `mg/dL` |
| `reference_low` | `0.4` |
| `reference_high` | `1.1` |
| `effective_at` | `2129-04-05T21:30:00.000000Z` |
| `result_status` | `FINAL` |


Bằng chứng: [JSON](real-confirmed/conditions-real.json), [console](real-confirmed/console.txt), [ảnh chi tiết](real-confirmed/three-filters-real-detail.png), [ảnh danh sách sau Forward](real-confirmed/three-filters-real-list.png). Đã xem trực tiếp ảnh; chúng khớp các giá trị và bộ lọc. Các bước F5/history được chứng minh bằng assert/snapshot HTTP và documentId, không chỉ ảnh tĩnh.

## 4. Kiểm thử nhiều trang – HTTP mô phỏng tách riêng

Dataset thật với tổ hợp ba filter chỉ có 2 dòng; vì vậy dùng Chrome CDP HTTP mô phỏng có nhãn rõ. Gồm 31 bản ghi phù hợp (`MOCK-TRIPLE-01...31`) và 3 dòng đối chứng lần lượt sai patient/test/status. Không ghi database, không giả làm API thật.

Các filter vẫn chính xác MIMIC-P-10007928/50912/FINAL; bản ghi chi tiết mô phỏng là `MOCK-TRIPLE-21`, không dùng tên bản ghi thật để ngụy trang dữ liệu.

| Bước | Thao tác | Đối chiếu | Kết quả |
|---|---|---|---|
| 1 | Mở danh sách mặc định | Danh sách mặc định | Đạt |
| 2 | Tìm kiếm đồng thời ba bộ lọc | Ba filter; offset 0; MOCK-TRIPLE-01...10 | Đạt |
| 3 | Ba bộ lọc sang trang 2 | Hash đủ ba filter +page2; GET offset 10; hiển thị MOCK-TRIPLE-11...20 | Đạt |
| 4 | Ba bộ lọc sang trang 3 | Hash đủ ba filter +page3; GET offset 20, limit11; hiển thị MOCK-TRIPLE-21...30, có dòng31 làm lookahead | Đạt |
| 5 | Mở đúng chi tiết từ dòng MOCK-TRIPLE-21 | Hash có đủ ba filter và page3; GET /MOCK-TRIPLE-21 không query; đủ 12 field đúng fixture | Đạt |
| 6 | F5 chi tiết: tài liệu mới, đúng ID và ngữ cảnh | Hash có đủ ba filter và page3; GET /MOCK-TRIPLE-21 không query; đủ 12 field đúng fixture | Đạt |
| 7 | Quay lại giữ đủ ba bộ lọc và trang | Hash đủ ba filter +page3; GET offset 20, limit11; hiển thị MOCK-TRIPLE-21...30, có dòng31 làm lookahead | Đạt |
| 8 | F5 danh sách: tài liệu mới, đúng ba bộ lọc và trang | Hash đủ ba filter +page3; GET offset 20, limit11; hiển thị MOCK-TRIPLE-21...30, có dòng31 làm lookahead | Đạt |
| 9 | Back về chi tiết đúng ID/context | Hash có đủ ba filter và page3; GET /MOCK-TRIPLE-21 không query; đủ 12 field đúng fixture | Đạt |
| 10 | Forward về danh sách đúng ba bộ lọc/trang | Hash đủ ba filter +page3; GET offset 20, limit11; hiển thị MOCK-TRIPLE-21...30, có dòng31 làm lookahead | Đạt |


Kết quả10/10 bước đạt; không có ngoại lệ JS. Bao phủ rõ chuỗi **tìm cả ba filter → Trang 2 → Trang 3 → Chi tiết → F5 → Quay lại → F5 list → Back → Forward**.

Bằng chứng: [JSON mô phỏng](mock-confirmed/conditions-mock.json), [console](mock-confirmed/console.txt), [ảnh trang 3](mock-confirmed/three-filters-mock-page3.png), [ảnh chi tiết mô phỏng](mock-confirmed/three-filters-mock-detail.png). Mã script dùng lọc đồng thời cả ba field, không chỉ test_code.

## 5. Hồi quy 2.1 và 2.2 đã chạy lại

Chỉ bổ sung script kiểm thử mới; mã ứng dụng/test cũ giữ nguyên. Vẫn chạy lại toàn bộ bộ kiểm thử đã có, lưu mới riêng:

| Bộ | Kết quả lượt này | Bằng chứng |
|---|---|---|
| Unit 2.1+2.2 | 24/24 PASS, 0 fail/skipped | [unit.txt](unit.txt) |
| Chrome danh sách API thật 2.1 | 5/5 nhóm PASS | [JSON](regression/list-real/real-browser.json), [log](regression/list-real/console.txt) |
| Chrome danh sách HTTP mô phỏng 2.1 | 10/10 PASS: P10/P11/P20/P21/V0/VNEG/VLONG/E503/E400/E502 | [JSON](regression/list-mock/http-browser.json), [log](regression/list-mock/console.txt) |
| Chrome chi tiết API thật 2.2 | 3/3 nhóm PASS | [JSON](regression/detail-real/detail-real-browser.json), [log](regression/detail-real/console.txt) |
| Chrome chi tiết HTTP mô phỏng 2.2 | 6/6 nhóm PASS | [JSON](regression/detail-mock/detail-http-browser.json), [log](regression/detail-mock/console.txt) |


Các PASS hồi quy **không có nghĩa dot ID đã được sửa**: unit cũ U15/U23 vẫn kỳ vọng từ chối dot ID. Script mới đánh dấu rõ `dotCondition.status=NOT_MET` và `BUG_REPRODUCED`; exit0 nghĩa probe/ca kiểm thử chạy hoàn tất đúng dự kiến, không đồng nghĩa điều kiện 1 đạt.

Không chạy lại TypeScript/lint/build vì không đổi mã ứng dụng hoặc cấu hình; không dùng log cũ để nói đó là lượt chạy mới.

## 6. Lượt thử đầu và khả năng tái hiện

Lượt đầu `conditions-real.json`/`conditions-real.txt` ở gốc thư mục này đã hoàn tất8 bước thật nhưng timeout ở bước probe dot: script chờ tài liệu mới trong khi Page.navigate chỉ thay hash, nên Chrome dùng cùng document. Đây là lỗi điều kiện chờ của **script mới**, không phải bằng chứng app mất ngữ cảnh.

Đã sửa riêng script mới để chờ đúng hash và alert, rồi chạy lượt mới ở `real-confirmed/`. Lượt đầu/ảnh/log được giữ nguyên; báo cáo dùng lượt completed=true tại real-confirmed làm bằng chứng chính.

Tái hiện tại `frontend/apps/lis/`, chọn thư mục mới không trùng bằng chứng:

```powershell
$env:LIS_EVIDENCE_DIR = 'tests/evidence/<thu-muc-moi>/real'
node tests/browser-conditions.mjs --real
$env:LIS_EVIDENCE_DIR = 'tests/evidence/<thu-muc-moi>/mock'
node tests/browser-conditions.mjs
```

Cần Chrome, bản build LIS hiện có và backend thật 3101 cho chế độ --real. Script giữ nguyên dữ liệu; chế độ mock không cần ghi backend/database. Chạy tuần tự hai mode vì cùng preview 5183. Chrome trong môi trường này chạy ngoài sandbox sau khi được cấp quyền.

## 7. Kết luận và việc còn lại

- **Điều kiện 2: Đạt**, có bằng chứng Chrome/API thật đúng bốn định danh người dùng yêu cầu và bằng chứng mô phỏng riêng cho trang 3.
- **Điều kiện 1: Chưa đạt**, đã xác định là lỗi frontend/transport chứ không phải mã không hợp lệ. Không có quyền suy ra ngoại lệ hợp đồng từ việc dataset hiện không có dot ID. Chưa thay mã ứng dụng trước khi trình bày phương án.
- Giai đoạn 2.2 **chưa đạt nghiệm thu đầy đủ cả hai điều kiện**. Công việc còn lại là xử lý dot ID theo [phương án đã trình bày](PHUONG_AN_DOT_ID.md), kiểm thử transport qua proxy với bốn ID phân biệt và chạy lại hồi quy sau sửa.
- Bằng chứng cũ 2.1/2.2/review không bị ghi đè; xem verification.json về mã băm và phạm vi. Chưa commit/push/merge, chưa Publish hoặc Giai đoạn 2.3.

Dừng tại báo cáo này, không tự áp dụng phương án sửa ứng dụng.
