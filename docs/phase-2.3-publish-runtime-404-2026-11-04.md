# LIS 2.3 – Khắc phục HTTP 404 Publish trên môi trường đang chạy

Ngày 04/11/2026. URL kiểm tra: `http://127.0.0.1:5173/#/results/MIMIC-LAB-100142`.

## 1. Nguyên nhân chính xác

**Container LIS chạy image cũ, thiếu route lookup Publish.** Source trong workspace đã có route; frontend đang dùng source mới nhưng backend trong container chạy `dist` đóng gói từ image ngày 31/10/2026. Container không bind-mount source. Vì vậy sửa file hoặc chỉ restart container cũ không cập nhật được endpoint.

Đã đối chiếu Chrome Network ở đúng cổng **5173**, gọi trực tiếp API, source/dist trong container và log khởi động. Không suy luận 404 từ tên file:

| GET thực tế trước sửa | HTTP | Body |
|---|---|---|
| `http://127.0.0.1:5173/api/lis/results/MIMIC-LAB-100142` | 200 | Đủ 12 trường, patient `MIMIC-P-10007928`, trạng thái FINAL |
| `http://127.0.0.1:5173/api/lis/results/MIMIC-LAB-100142/publish-event` | 404 | `{"error":{"code":"NOT_FOUND","message":"API route not found"}}` |
| `http://127.0.0.1:3101/api/results/MIMIC-LAB-100142/publish-event` | 404 | Cùng body `API route not found` |

Request xuất phát từ frontend `getResultPublishState` khi mount panel. Vite chuyển `/api/lis` sang `/api` và chuyển tiếp tới 3101. **Backend LIS tạo response 404** tại catch-all `/api`; proxy chuyển nguyên response. GET chi tiết 200 chứng minh bản ghi vẫn tồn tại; 404 này không có nghĩa chưa có event.

Trong `src/lis/controller.ts` và `dist/lis/controller.js` của container cũ đều không có `/api/results/:resultId/publish-event`. Log ghi `npm run start:lis` → `dist/lis/main.js`. SHA-256 source controller cũ: `6b3efcf72714cb68c57844891d4ad6e9dbf344a4fbe46ff6e8b7a689324ec93c`. Không có căn cứ để gán chính xác một Git commit cho image này; trạng thái source chưa commit trong workspace và image runtime là hai đối tượng khác nhau.

Bằng chứng Chrome trước sửa: [before-XyRzLK/runtime-browser.json](../frontend/apps/lis/tests/evidence/phase-2.3-runtime-404-2026-11-04/before-XyRzLK/runtime-browser.json), gồm Network URL/method/status/body và DOM ở mở trang, F5, Làm mới. Nút bị khóa đúng khi lookup thất bại.

## 2. Endpoint và container liên quan

- Compose service: **`lis`**; container: **`lis-fhir-emr-lis-1`**; port host/container `3101`.
- Image tag chung: `lis-fhir-emr-backend:local`. Image cũ: `sha256:ced91025485a3278b6eb312450ad74391eacfe94a1d220131764d9e91e9a67f4`, tạo `2026-10-31T13:24:23.651112657Z`.
- Endpoint đúng: `GET /api/results/:resultId/publish-event`; frontend đi qua `GET /api/lis/results/:resultId/publish-event`.
- Source route nằm trong `backend/src/lis/controller.ts`, SELECT chỉ đọc trong `repository.ts`. Không cần sửa endpoint, proxy hoặc schema.
- OpenAPI đúng tại **`/docs/api/openapi.json`**, đã xác minh sau cập nhật có route lookup và tổng cộng bảy path LIS.

## 3. Khắc phục đã thực hiện

Đã thực hiện tại root repository bằng Compose hiện có, không sửa Compose:

```powershell
docker compose build lis
docker compose up -d --no-deps --force-recreate lis
```

Build TypeScript backend đạt. Chỉ recreate service LIS, không recreate dependency. Container LIS mới: `5610d46c3fcd449494cad637bdb850f325aee856e7723069a42dc6f017e53449`, tạo `2026-11-04T08:06:45.396957132Z`; image mới `sha256:c04c9b87d9c48a6e855f56b2b17adf62563c99d1dcaaab0c0f45cbb17d01a66e`.

Source controller mới trong container có SHA-256 `4115f2ff8e7a16083c5754ecbb36791f2f03a9875658506a6c11099a1eb272df`, **trùng byte với workspace**. Dist mới có route; `/ready` trả ready. Container của Dispatcher, Middleware, Worker và EMR giữ image ID cũ và thời điểm khởi động cũ; chỉ tag image chung được build lại, không cập nhật process các service đó.

Database container vẫn có ID `42282cc1db5e5e2f8f88b08b4d28b3e92e29349e06245e800be19dfa19898e0f` và volume `lis-fhir-emr_postgres_data`. SELECT trong transaction **READ ONLY**, trước/sau đều: **1.000 results, 0 publish_events, 0 dispatch_attempts**; kết quả đang xét vẫn FINAL, không có event. Không xóa/reset DB, không xóa volume, không sửa MIMIC, không POST Publish vào backend nhóm. [Metadata và SELECT sau sửa](../frontend/apps/lis/tests/evidence/phase-2.3-runtime-404-2026-11-04/container-after.json).

Bổ sung thông báo frontend cho đúng lỗi hợp đồng:

- 404 + `NOT_FOUND` + `API route not found`: backend đang chạy chưa hỗ trợ đường dẫn, hướng kiểm tra phiên bản dịch vụ/proxy.
- 404 + `NOT_FOUND` + `Laboratory result not found`: không tìm thấy kết quả xét nghiệm.
- 404 không nhận diện/HTML: tiếp tục là lỗi; không suy luận chưa Publish.
- Chỉ response **200 đã qua validation**, `published:false,event:null`, mới hiện **Chưa Publish**.
- Lỗi/chưa xác minh vẫn khóa nút. Không thay điều kiện mở nút hoặc tự POST lại.

## 4. Trạng thái giao diện và API sau sửa

Cả gọi trực tiếp 3101 và proxy 5173 đều trả **200**:

```json
{"result_id":"MIMIC-LAB-100142","result_status":"FINAL","published":false,"event":null}
```

Trên đúng URL 5173 của người dùng:

- GET chi tiết 200, đủ 12 trường và dữ liệu gốc.
- **Yêu cầu Publish: Chưa Publish**.
- **Nút Publish khả dụng** do nguồn FINAL và trạng thái đã xác minh, vẫn cần dialog xác nhận nếu người dùng chủ động thực hiện.
- Event ID/Exchange ID chưa có; middleware **Chưa xác minh**, không báo DELIVERED.
- F5 và Làm mới gửi GET, giữ cùng trạng thái; không phát sinh POST.

Người dùng chỉ cần F5 trang đang mở hoặc bấm Làm mới trạng thái; backend đang chạy đã được cập nhật. Hai lệnh Compose phía trên dùng để tái áp dụng khi image lại lệch source, không cần chạy lại cho sự cố vừa xử lý.

## 5. File thay đổi trong nhiệm vụ sửa 404

Các thay đổi backend/proxy 2.3 từ lượt trước được giữ nguyên, đưa vào image mới; không sửa lại backend/proxy trong lượt này.

| File | Thay đổi của lượt sửa lỗi |
|---|---|
| `frontend/apps/lis/src/api/publish.ts` | Phân biệt 404 route và bản ghi theo message hợp đồng, vẫn throw lỗi |
| `frontend/apps/lis/src/components/PublishPanel.tsx` | Ghi rõ Chưa Publish khi đã xác minh 200/event=null |
| `frontend/apps/lis/tests/publish.test.mjs` | Thêm unit test route thiếu/bản ghi thiếu/404 HTML đều không trở thành unpublished |
| `frontend/apps/lis/tests/browser-publish.mjs` | Thêm ca lookup 404 route/result/HTML/mất mạng: khóa nút, không POST/DELIVERED giả, GET phục hồi |
| `frontend/apps/lis/tests/browser-publish-runtime.mjs` mới | Chrome vào đúng 5173, chỉ GET, lưu Network body + DOM + ảnh trước/sau/F5/Làm mới |
| `frontend/apps/lis/README.md` | Hướng dẫn chẩn đoán và rebuild/recreate chỉ service LIS, giữ volume |
| Báo cáo này và bằng chứng mới | Giữ nguyên hồ sơ nghiệm thu cũ |

Không sửa `.env`, dependency, SQL/schema, Compose, frontend Monitor/EMR; không stage, commit, push, merge. Không ghi đè báo cáo/bằng chứng 2.1/2.2/2.3 trước đó.

## 6. Kiểm thử

| Nhóm | Kết quả / phạm vi | Bằng chứng |
|---|---|---|
| Chrome trước sửa, runtime thật 5173 | PASS tái hiện chính xác lỗi; mở trang/F5/Làm mới, không POST | `before-XyRzLK/runtime-browser.json` |
| Chrome sau sửa, runtime thật 5173 | PASS mở trang/F5/Làm mới; FINAL chưa Publish và nút mở sau GET xác minh | `after-xO3gC8/runtime-browser.json` |
| HTTP thật trực tiếp/proxy | 12 GET đạt: chi tiết, lookup, missing result 404, missing route 404, ID trống 400, readiness và OpenAPI | [http-after.json](../frontend/apps/lis/tests/evidence/phase-2.3-runtime-404-2026-11-04/http-after.json) |
| Frontend unit | **43/43** | `checks-d9f8aaea/test.log` |
| TypeScript/lint/build frontend | PASS, bundle `index-7CT0lXRl.js` | `checks-d9f8aaea/{check,lint,build}.log` |
| Backend build trong image | PASS `npm run build`/tsc | Docker build output và route/dist mới |
| Chrome HTTP mô phỏng Publish | **18/18** | [run-PIuLEm](../frontend/apps/lis/tests/evidence/phase-2.3-2026-11-04/run-PIuLEm/chrome-mock/browser-publish.json) completed=true |
| Chrome API/Dispatcher/Worker/EMR thật, PostgreSQL tmpfs riêng | **16/16** | [run-pI5VlE](../frontend/apps/lis/tests/evidence/phase-2.3-2026-11-04/run-pI5VlE/chrome-real/browser-publish.json) completed=true |
| Hồi quy 2.1/2.2 | ĐANG CHỐT | `regression/verification-uOp5oG/verification.json` |

Ảnh trang thật sau sửa: [toàn trang](../frontend/apps/lis/tests/evidence/phase-2.3-runtime-404-2026-11-04/after-xO3gC8/initial.png). Bằng chứng Network/DOM cuối: [runtime-browser.json](../frontend/apps/lis/tests/evidence/phase-2.3-runtime-404-2026-11-04/after-xO3gC8/runtime-browser.json). Lint cuối sau thay đổi script kiểm thử cũng đạt (`lint-final.log`).

Các đường dẫn ngắn trong bảng thuộc [phase-2.3-runtime-404-2026-11-04](../frontend/apps/lis/tests/evidence/phase-2.3-runtime-404-2026-11-04/), trừ hai lượt Publish có liên kết riêng.

Phân biệt dữ liệu thật và mô phỏng:

- Runtime 5173/3101 trên MIMIC **chỉ GET**. Database thật không có READY hoặc event cũ tại thời điểm kiểm tra, nên không tạo thêm dữ liệu để có các ca đó.
- READY bị chặn và event đã có khôi phục sau F5 được xác minh bằng API thật trên DB tạm tổng hợp riêng; các POST đều nằm trong container riêng do runner tạo. Có kiểm tra DELIVERED bằng Worker đọc lại EMR thật trong môi trường đó, không dùng mock để khẳng định EMR thật.
- Lỗi lookup 404 route/result/HTML, 503 và mất mạng được mô phỏng có chủ đích; không stop database/backend nhóm để tạo outage. Mọi ca lỗi giữ trạng thái Chưa xác minh và khóa nút, không báo DELIVERED, không tự POST. Phục hồi GET 200 thì mới hiện Chưa Publish.
- Hồi quy giữ nguyên assertion. Lượt đầu `verification-DnJeNQ` dừng do CDP `Invalid InterceptionId` trong uiux-mock; bằng chứng lỗi được giữ lại. Không sửa helper hoặc nới assertion để bỏ lỗi; chạy lại toàn bộ. Ca HTTP mới ban đầu dùng cùng ID nên không tạo yêu cầu mới cho mỗi tình huống; đã đổi ID fixture riêng cho từng tình huống, chạy lại 18/18 đạt.

## 7. Giới hạn còn lại

Lỗi 404 tại URL đã nêu đã được xử lý trên môi trường đang chạy, không phải chỉ sửa source. Không có event MIMIC nào được tạo để nghiệm thu POST. Không xác nhận READY/event có sẵn trên dataset thật vì không có dữ liệu đó tại thời điểm kiểm tra; đã kiểm thử bằng dữ liệu tổng hợp riêng như bảng.

Không triển khai Monitor/EMR hoặc các process backend khác. Khi dùng máy chủ static thay Vite, reverse proxy vẫn phải đáp ứng quy ước LIS đã mô tả. Việc Publish dữ liệu MIMIC chính thức và nghiệm thu toàn hệ thống không nằm trong nhiệm vụ sửa runtime này.
