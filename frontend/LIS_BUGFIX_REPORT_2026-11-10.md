Đã sửa trực tiếp bốn lỗi trên Flow Console dùng chung cho các entry point LIS, Middleware Monitor và EMR. Kiểm thử ngày 10/11/2026.

| Lỗi | Nguyên nhân xác nhận từ source | Thay đổi | Kết quả |
| --- | --- | --- | --- |
| BUG-01 | `FlowSelection key={selected}` chứa cả danh sách. Đổi item làm React remount toàn bộ vùng cuộn. | Giữ component danh sách ổn định; reset trạng thái thao tác theo result ID, hủy request cũ khi đổi item; chỉ reset tab bằng chứng bằng key riêng. | **PASS** — Chrome kiểm tra cùng DOM node, giữ scrollTop ở giữa/cuối, không fetch lại danh sách hoặc POST khi chọn. |
| BUG-02 | Danh sách hiển thị mã bỏ tiền tố `MIMIC-`, nhưng search gọi endpoint chi tiết chỉ chấp nhận ID đầy đủ, khớp chính xác. Chuẩn hóa hoa/thường trước đây chỉ áp dụng cho mẫu MIMIC có hậu tố số. | Thêm lọc `result_id` trên API danh sách: substring theo nghĩa đen, không phân biệt hoa/thường, trim hai đầu; AND với các điều kiện khác trước limit/offset. | **PASS** — browser, unit, HTTP và PostgreSQL; tìm mã đầy đủ/rút gọn ở ngoài trang hiện tại; giữ FINAL, từ khóa và phân trang; rỗng khác lỗi API. |
| BUG-03 | Nút “Đã gửi” vẫn gọi `send()` và bật `sending`; refresh cũng làm `useFlow` tạm trả data=null. Đây là nút thao tác, không phải bộ lọc “Đã gửi”. | Nút của sự kiện đã tồn tại chỉ đọc trạng thái bằng GET. Tách busy kiểm tra với sending; giữ bằng chứng cùng result ID trong lúc refresh, không dùng dữ liệu của item khác. | **PASS** — MutationObserver theo dõi nhãn DELIVERED và nút trong lúc kiểm tra/refresh; không xuất hiện “Đang gửi”, không POST. |
| BUG-04 | Thông báo thành công/lặp dùng `sr-only`, không nhìn thấy; HTTP 200 chỉ được diễn giải bằng một câu chung, không đọc lại trạng thái giao dịch. | Hiện thông báo trực tiếp; phân biệt 202 mới, 200 idempotency và trạng thái đọc lại, 409 CONTENT_CONFLICT, lỗi server/mạng. | **PASS** — browser thử đủ delivered/pending/conflict/server/network; PostgreSQL end-to-end xác nhận gửi lặp giữ một kết quả EMR. |

Mã kết quả là `result_id`; mã bệnh nhân là `patient_id`; mã loại xét nghiệm là `test_code`. Danh sách hiện tại vẫn chỉ hiển thị FINAL theo thiết kế. Không có bộ lọc trạng thái trao đổi “Đã gửi” riêng trong source hiện tại. Kiểm thử kết hợp tìm kiếm/trạng thái dùng bộ lọc FINAL thật và kiểm thử API thêm READY.

Backend chỉ bổ sung tham số tùy chọn `GET /api/results?result_id=...` và mô tả OpenAPI. Query dùng tham số SQL, `%`/`_` không thành wildcard. Endpoint chi tiết và Publish vẫn giữ định danh chính xác. Không đổi schema, outbox, dispatcher, worker, retry hoặc cơ chế idempotency. Không thay điều kiện chứng minh DELIVERED; ACK và 202 không được coi là giao thành công. Phản hồi Publish hiện có đủ để phân biệt mới/lặp/xung đột; trạng thái hoàn tất tiếp tục đọc qua API bằng chứng sẵn có.

Các file thay đổi/thêm mới:

| File (tính từ gốc repository) | Mục đích |
| --- | --- |
| `backend/src/lis/controller.ts` | Nhận và kiểm tra bộ lọc mã kết quả. |
| `backend/src/lis/repository.ts` | Lọc mã trên PostgreSQL trước phân trang. |
| `backend/src/lis/openapi.ts` | Mô tả tham số mới. |
| `backend/tests/lis/controller.http.test.ts` | Query hợp lệ, trim, tham số trùng/rỗng/sai kiểu. |
| `backend/tests/lis/repository.integration.test.ts` | Search thực trên PostgreSQL, AND trạng thái, phân trang, ký tự literal. |
| `frontend/apps/lis/src/api/lis.ts` | Gửi result_id trong query danh sách. |
| `frontend/apps/lis/src/api/searchResults.ts` | Search qua danh sách server thay vì GET chi tiết exact. |
| `frontend/apps/lis/src/api/publish.ts` | Thông báo xung đột rõ ràng. |
| `frontend/apps/lis/src/flow/FlowConsole.tsx` | Giữ danh sách, tách kiểm tra/gửi, hiển thị thông báo, reset thao tác theo item. |
| `frontend/apps/lis/src/flow/useFlow.ts` | Giữ bằng chứng cũ cùng ID trong lúc refresh. |
| `frontend/apps/lis/src/flow/publishFeedback.ts` | Diễn giải phản hồi mới/lặp và bằng chứng backend. |
| `frontend/apps/lis/package.json` | Thêm script test:regressions. |
| `frontend/apps/lis/tests/search.test.mjs` | Cập nhật kiểm thử theo search qua API danh sách. |
| `frontend/apps/lis/tests/publish-feedback.test.mjs` | Thông báo theo bằng chứng; timeout đọc lại không làm mất xác nhận idempotency. |
| `frontend/apps/lis/tests/flow-fixtures.mjs` | Fixture có result ID riêng cho từng ca. |
| `frontend/apps/lis/tests/browser-flow.mjs` | Cập nhật kỳ vọng: nút của kết quả đang xử lý cho phép xem trạng thái. |
| `frontend/apps/lis/tests/browser-regressions.mjs` | Hồi quy bốn lỗi và đổi item khi request còn chờ. |
| `frontend/LIS_BUGFIX_REPORT_2026-11-10.md` | Báo cáo này. |

Kiểm thử đã thực hiện:

- Frontend: **90/90 PASS**, gồm LIS 46, EMR 20, Monitor 24; lint và build các workspace PASS.
- Browser hiện có: **PASS**, gồm gửi mới single-flight, polling, DELIVERED, REJECTED, 503, tab bàn phím, mobile 390px và định tuyến.
- Browser hồi quy mới: **PASS**, bao gồm giữ vị trí cuộn, tìm kiếm, quan sát chuyển trạng thái, không POST khi xem, thông báo nhìn thấy được, double-click chỉ một POST và đổi item trong khi request còn chờ.
- Backend: TypeScript check, suite LIS, Middleware, EMR **PASS** trong container với source hiện tại được mount chỉ đọc.
- Integration Middleware → EMR thật: **16/16 PASS**, không skip. C4-02 trả ALREADY_EXISTS và giữ cùng bản ghi/UUID; C4-04 trả 409 và giữ mọi cột cũ.
- End-to-end LIS → Middleware → EMR thật: **15/15 PASS**, không skip. D3-02 Publish lặp trước/sau DELIVERED giữ cùng event và **EMR rows = 1**; có kiểm tra dispatcher cạnh tranh, mất ACK và đối soát đọc lại.
- Backend build: **PASS**.

Kiểm thử backend dùng image `lis-fhir-emr-backend:local` sẵn có, source/tests hiện tại, PostgreSQL 17 trong container tạm với tmpfs và dữ liệu tổng hợp riêng. Container tạm đã được dọn. Không reset, seed lại hoặc sửa dữ liệu thực nghiệm trong Compose. Log integration/E2E tại `backend/node_modules/.cache/lis-fixes-backend.log` (artifact local, Git ignore).

Các lần chạy đầu gặp giới hạn môi trường đã được xử lý để chạy kiểm thử: Chrome cần chạy ngoài sandbox; backend host thiếu dependency và npm gặp EPERM nên test được thực hiện bằng Docker; môi trường container test cần mount thêm thư mục scripts để chạy readiness check. Bài browser mới cũng đã được sửa để chờ đúng result ID và nút sẵn sàng sau đổi hash, tránh nhấn khi màn trước còn đang chuyển.

Áp dụng backend từ gốc repository:

```powershell
docker compose build lis
docker compose up -d --no-deps lis
```

`compose.yaml` không có service frontend. Giao diện chạy bằng Vite như cấu hình hiện tại:

```powershell
cd frontend
npm.cmd run build
npm.cmd run dev:lis
```

Nếu dùng preview, chạy `npm.cmd run preview:lis` sau build; nếu dev server đã chạy thì tải lại trang. Backend LIS cần được cập nhật cùng frontend để nhận tham số search mới.

Chạy lại kiểm thử giao diện trong thư mục frontend:

```powershell
npm.cmd run test --workspaces
npm.cmd run lint
npm.cmd run build
npm.cmd run test:browser --workspace apps/lis
npm.cmd run test:regressions --workspace apps/lis
```

Giới hạn: chưa triển khai source mới vào các container Compose đang chạy; **CHƯA KIỂM CHỨNG sau triển khai trên dữ liệu thực nghiệm hiện có**. Kết quả PASS ở trên là browser với HTTP fixture và backend thật với PostgreSQL tách biệt. Search substring chưa có benchmark trên tập dữ liệu rất lớn; không thêm index hay đổi schema. Khi thiếu bằng chứng Middleware/đọc lại, giao diện thông báo chưa xác minh thay vì suy ra thành công từ ACK.
