Đã hoàn thiện BUG-02: tìm mã bệnh nhân/mã kết quả và khôi phục danh sách trực tiếp trên giao diện. Báo cáo này bổ sung phần tìm kiếm cho đợt sửa ghi trong `LIS_BUGFIX_REPORT_2026-11-10.md`.

Nguyên nhân xác nhận:

- Backend đang chạy tại cổng 3101 trả **400 VALIDATION_ERROR / Unsupported result query parameter** với `GET /api/results?result_id=MIMIC-LAB-100142&result_status=FINAL&limit=11&offset=0`. Source đã hỗ trợ result_id từ đợt sửa trước, nhưng container hiện tại chưa được cập nhật tương ứng.
- Cùng môi trường đó, query patient_id trả 200. GET chi tiết `MIMIC-LAB-100142` trả 200, xác nhận kết quả tồn tại, thuộc `MIMIC-P-10007928` và có trạng thái FINAL. Vì vậy HTTP 400 không xuất phát từ mã không tồn tại hoặc bị bộ lọc FINAL loại bỏ.
- Frontend phân loại từ khóa theo tiền tố `MIMIC-P-`; trường hợp còn lại được coi là result_id. Cách này không tìm được một phần mã bệnh nhân không có đủ tiền tố. Bộ lọc patient_id cũ ở database khớp chính xác.
- Ô nhập chỉ đổi state search; query chỉ cập nhật khi submit. Xóa hết nội dung không tải lại danh sách và chưa có nút X.

Thay đổi đã thực hiện:

- Placeholder chính xác: **Tìm mã bệnh nhân/mã kết quả**.
- Dùng tham số tùy chọn `search` trên API danh sách. PostgreSQL tìm theo `patient_id OR result_id`, theo chuỗi con, không phân biệt hoa/thường, trim hai đầu. Điều kiện này kết hợp AND với FINAL/các bộ lọc còn lại trước limit/offset; ký tự `%` và `_` được tìm theo nghĩa đen. Các tham số lọc cũ được giữ để tương thích.
- Khi nhập: debounce 250 ms; Enter/nút tìm áp dụng ngay và hủy debounce còn chờ.
- Nút X xuất hiện khi ô nhập có nội dung. Nhấn X hoặc Backspace xóa hết thì lập tức bỏ từ khóa, tải lại trang đầu, giữ bộ lọc trạng thái hiện tại. Sau nhấn X, focus trở lại ô nhập.
- Query/loading/error tiếp tục dùng `useLisResults`: mỗi request có AbortController riêng; kết quả gắn với đúng đối tượng query; request đã hủy không cập nhật state. Xóa từ khóa tạo query mới nên lỗi cũ cũng được thay bằng loading rồi danh sách mới.
- Giữ item đã chọn và DOM của vùng danh sách. Lựa chọn mặc định ban đầu được lưu để tải/tìm lại danh sách không làm mất chi tiết đang xem. Các thao tác search/clear không gọi Publish và không reload document.

Các file thay đổi trong đợt hoàn thiện này (đường dẫn từ gốc repository):

| File | Nội dung |
| --- | --- |
| `frontend/apps/lis/src/flow/FlowConsole.tsx` | Search chung, placeholder, debounce, X/Backspace, giữ lựa chọn và trạng thái lọc. |
| `frontend/apps/lis/src/flow/stitch.css` | Vị trí nút X cuối ô nhập và khoảng trống cho nút. |
| `frontend/apps/lis/src/state/results.ts` | Kiểu và chuẩn hóa bộ lọc search tùy chọn. |
| `frontend/apps/lis/src/api/lis.ts` | Gửi search khi có nội dung; bỏ tham số khi xóa. |
| `frontend/apps/lis/src/api/searchResults.ts` | Chuyển search và bộ lọc/phân trang đến API. |
| `backend/src/lis/controller.ts` | Validation search, cho phép chuỗi rỗng khôi phục danh sách, từ chối tham số trùng/sai kiểu. |
| `backend/src/lis/repository.ts` | Tìm patient OR result trên toàn bộ dữ liệu phù hợp trước phân trang. |
| `backend/src/lis/openapi.ts` | Mô tả search và cách kết hợp bộ lọc. |
| `backend/tests/lis/controller.http.test.ts` | Kiểm thử search hợp lệ/rỗng/sai kiểu và không tìm thấy trả 200. |
| `backend/tests/lis/repository.integration.test.ts` | Search thực trên PostgreSQL, hoa/thường, partial, FINAL, phân trang và ký tự literal. |
| `frontend/apps/lis/tests/search.test.mjs` | Query search và khôi phục khi từ khóa rỗng. |
| `frontend/apps/lis/tests/browser-search.mjs` | Bộ kiểm thử Chrome cho 10 tình huống bắt buộc. |
| `frontend/apps/lis/tests/browser-regressions.mjs` | Cập nhật HTTP fixture và kỳ vọng theo tham số search chung. |
| `frontend/apps/lis/package.json` | Thêm script test:search. |
| `frontend/LIS_SEARCH_REPORT_2026-11-10.md` | Báo cáo này. |

Kết quả kiểm thử:

| Trường hợp bắt buộc | Kết quả và bằng chứng |
| --- | --- |
| 1. MIMIC-P-10007928 | **PASS** — Chrome HTTP fixture trả đúng hai kết quả; có kết quả nằm ngoài trang đầu. |
| 2. MIMIC-LAB-100142 | **PASS** — Chrome tìm đúng một kết quả với mã đầy đủ. |
| 3. Mã viết thường | **PASS** — cả patient/result; PostgreSQL cũng kiểm thử không phân biệt hoa/thường. |
| 4. Một phần mã | **PASS** — `P-10007928`, `10007928`, `LAB-100142`, `100142`; lọc trên server. |
| 5. Nhấn X | **PASS** — xóa input, nút tự ẩn, trở về trang đầu FINAL, query không còn search. |
| 6. Backspace | **PASS** — dùng sự kiện phím Chrome thực để xóa nội dung; tự khôi phục, không submit. |
| 7. Mã không tồn tại | **PASS** — HTTP 200/items rỗng và thông báo không có kết quả; không hiển thị lỗi 400. |
| 8. Đổi nhanh/xóa, response cũ trả trễ | **PASS** — giữ request cũ đến sau khi khôi phục; không ghi đè danh sách. Debounce chưa chạy cũng bị hủy khi nhấn X. |
| 9. Chọn item không reset scroll | **PASS** — cùng DOM node, giữ scrollTop; xóa search giữ result_id đã chọn. |
| 10. Không F5 | **PASS** — theo dõi document và frame navigation; document không reload trong toàn bộ ca search/clear. Tổng số Publish POST của bộ test search: **0**. |
| Khôi phục sau lỗi HTTP 400 | **PASS** — giả lập backend cũ trả 400, nhấn X xóa lỗi và tải lại danh sách thành công. |

Các bước xác minh khác:

- Frontend unit test: **92/92 PASS** (LIS 48, EMR 20, Monitor 24).
- Frontend lint và build cả ba workspace: **PASS**.
- `test:search`: **PASS** trên Chrome headless với HTTP fixture, có hai mã đúng như yêu cầu.
- `test:regressions`: **PASS** cho BUG-01/03/04 và đổi lựa chọn khi request còn chờ.
- `test:browser`: **PASS** cho luồng gửi mới, polling, DELIVERED, REJECTED, lỗi API, mobile và định tuyến.
- Backend TypeScript check, **180/180 test LIS PASS**, bao gồm HTTP thật và repository PostgreSQL thật; không skip.
- Backend **15/15 end-to-end PASS**, không skip. Publish lặp trước/sau DELIVERED vẫn giữ một kết quả EMR; kiểm thử cạnh tranh, retry và đối soát đọc lại vẫn qua.
- Backend build: **PASS**.

Backend được kiểm thử bằng image sẵn có `lis-fhir-emr-backend:local`, mount source/tests hiện tại chỉ đọc, cùng PostgreSQL 17 tạm sử dụng tmpfs và dữ liệu tổng hợp riêng. Container PostgreSQL test đã được dọn. Log backend local tại `backend/node_modules/.cache/lis-fixes-backend.log` (Git ignore). Schema, dữ liệu thực nghiệm, Publish, outbox, retry, idempotency và điều kiện DELIVERED không bị thay đổi.

Áp dụng lên Docker hiện tại, từ gốc repository:

```powershell
docker compose build lis
docker compose up -d --no-deps lis
```

Cần cập nhật backend cùng frontend: cả tham số result_id từ đợt sửa trước và search của đợt này đều cần backend mới. Lỗi 400 của container cũ sẽ còn cho đến khi rebuild/tạo lại container LIS. Các lệnh trên không reset database hoặc xóa volumes.

Frontend hiện không có service trong Compose. Khi dùng Vite dev, mã mới được cập nhật từ source; nếu dùng preview thì build lại trước:

```powershell
cd frontend
npm.cmd run build
npm.cmd run dev:lis
# Hoặc npm.cmd run preview:lis nếu dùng bản build.
```

Chạy lại kiểm thử giao diện trong frontend:

```powershell
npm.cmd run test --workspaces
npm.cmd run lint
npm.cmd run build
npm.cmd run test:search --workspace apps/lis
npm.cmd run test:regressions --workspace apps/lis
npm.cmd run test:browser --workspace apps/lis
```

Phân biệt môi trường: **PASS** ở trên là browser với HTTP fixture và backend với PostgreSQL tách biệt. Với Compose đang chạy, đã kiểm chứng bằng GET nguyên nhân 400 và sự tồn tại/trạng thái FINAL của mã đã nêu; chưa triển khai bản mới. **CHƯA KIỂM CHỨNG sau triển khai** việc tìm kiếm và xóa tìm kiếm trên dữ liệu thực nghiệm trong Compose.
