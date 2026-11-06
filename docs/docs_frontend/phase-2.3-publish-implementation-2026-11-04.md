# Giai đoạn 2.3 – Triển khai Publish LIS và kết quả kiểm thử

Ngày 04/11/2026. Nhánh `feature/frontend/lis-emr-ui`, HEAD giữ nguyên `1fcd46af6582921db6ac2b477f8014d649dfb0c3`. Tiếp tục các thay đổi đang dang dở; không triển khai lại từ đầu. [Khảo sát trước triển khai](phase-2.3-publish-survey-2026-11-04.md) được giữ nguyên như tài liệu lịch sử.

**Kết quả:** đã triển khai và xác minh phạm vi Publish LIS 2.3 trên môi trường thử nghiệm biệt lập. Backend đạt **500/500** kiểm thử theo tổng TAP của năm bộ, frontend **42/42** unit test; **12/12** bộ hồi quy 2.1/2.2; Publish Chrome **17/17** ca mô phỏng, **16/16** ca tích hợp thật qua development và **16/16** qua preview. Không có kiểm thử backend bị bỏ qua trong các log được chấp nhận. TypeScript, lint và build đạt. Các số liệu backend được tổng hợp từ các lượt chạy có chọn lọc nêu dưới đây, không coi lượt runner bị lỗi hạ tầng là đạt toàn bộ.

Không POST vào database dùng chung, không sửa MIMIC-IV, schema/SQL/Compose, Dispatcher/Worker/middleware production, frontend Monitor/EMR hoặc dependency. Không stage/commit/push/merge. Chưa cập nhật các container dịch vụ đang dùng chung của nhóm.

## 1. Chức năng và kiến trúc đã triển khai

```text
Chi tiết kết quả → GET lookup theo result_id
               → dialog xác nhận → POST Publish → GET đối soát
LIS transaction → publish_events: snapshot + canonical hash + event bền vững
Dispatcher riêng → POST Middleware → ACK tại LIS
Worker/Mapper riêng → POST EMR → GET đọc lại → DELIVERED tại Middleware
UI → GET Middleware theo exchange_id, kiểm tra identity và dấu mốc xác minh
```

Khu vực **Trao đổi kết quả xét nghiệm** nằm dưới hai card cũ. Giữ đủ 12 trường và cách hiển thị số/thời gian cũ, bốn bộ lọc, hash routing, phân trang và ngữ cảnh quay lại. Không thêm nút Publish vào bảng danh sách.

READY bị khóa. FINAL mở nút sau khi GET lookup thành công; backend tiếp tục kiểm tra danh mục, đơn vị, số và thời gian khi Publish lần đầu. Hộp thoại hiển thị mã kết quả, bệnh nhân, xét nghiệm và giá trị; mặc định focus Hủy. Hủy/Escape không POST. Ref khóa đồng bộ chặn cả nhiều click trong cùng lượt xử lý; nút và trạng thái loading được đồng bộ trong lúc gửi.

Phân biệt 202 mới, 200 lặp, 409 xung đột và lỗi. Khi mạng lỗi, 503 hoặc phản hồi không rõ, UI thông báo chưa xác định kết quả và GET đối soát, **không tự POST lại**. Publish lại chỉ kiểm tra tính trùng nội dung; không retry/requeue/reset Dispatcher.

GET lookup chạy khi mở chi tiết/F5/URL trực tiếp. Khi còn cần theo dõi, GET cách nhau 5 giây, không chồng yêu cầu; tạm ngừng khi tab ẩn, đọc lại khi hiện tab. Dừng theo dõi tự động khi trạng thái đã kết thúc; có nút Làm mới trạng thái. Abort và định danh yêu cầu chặn phản hồi cũ ghi đè bản ghi mới. Nếu lookup phát hiện READY/FINAL đã đổi, tải lại chi tiết. Sau khi đã dừng theo dõi ở trạng thái kết thúc, cần Làm mới/F5/hiện lại tab để đọc thay đổi nguồn tiếp theo.

Hiển thị riêng nguồn LIS, yêu cầu đã lưu, trạng thái Dispatcher, event/exchange ID và trạng thái MW. `published_at` lấy từ event, hiển thị UTC; không tự dựng thời gian cập nhật trạng thái. ACK không có nghĩa EMR đã nhận. Chỉ hiển thị DELIVERED khi GET MW khớp đủ exchange/event/result/source, có `verified_at` và `completed_at` hợp lệ. Đọc thất bại/không khớp → Chưa xác minh; không dùng một DELIVERED cũ để che lỗi đọc mới. Lỗi lookup có dữ liệu cũ được đánh dấu chưa cập nhật.

## 2. Backend và tương thích dữ liệu

- Bổ sung so sánh nguồn hiện tại với snapshot đã lưu trước khi trả duplicate. Dựng snapshot theo đúng định dạng cũ: JSON number, UTC đủ microsecond, canonical JSON và SHA-256. Kiểm tra **cả hash lẫn nội dung**.
- `3.4000` và `3.4` không xung đột. Không dùng so sánh chuỗi NUMERIC hoặc epsilon làm thay đổi nghiệp vụ. Vẫn từ chối số mất chính xác khi chuyển sang JSON number ở lần đầu.
- Chính sách `accepted_units` không nằm trong snapshot; thay riêng chính sách này không biến sự kiện cùng nội dung thành xung đột. Lần đầu vẫn kiểm tra chính sách đầy đủ.
- Nguồn khác snapshot, kể cả FINAL đã chuyển về READY, trả `409 CONTENT_CONFLICT`; giữ nguyên event, snapshot, hash, thời điểm Publish và lịch sử chuyển giao.
- Transaction giữ SHARE lock trên nguồn qua so sánh/commit; đọc event sau khi chờ khóa. Unique constraint và INSERT hiện có bảo vệ đồng thời. Nhánh thua INSERT cũng đối chiếu event thực tế, không trả duplicate cho nội dung khác.
- Lookup chỉ dùng một SELECT results LEFT JOIN publish_events, phân biệt nguồn không tồn tại và nguồn chưa có event. Không tạo/reset event; không trả snapshot/hash nội bộ ra UI.
- GET theo event UUID giữ nguyên bảy trường response. POST giữ nguyên bốn trường response. Không đổi payload liên dịch vụ hoặc định dạng dữ liệu đã lưu, không migration. Dispatcher vẫn gửi snapshot cũ đã lưu, độc lập với trang web.

## 3. Hợp đồng API thực tế

Đường dẫn dưới đây là **backend**; trình duyệt thêm tiền tố proxy LIS `/api/lis` thay `/api`, MW `/api/middleware` thay `/api`.

| Method / endpoint | Path, body, query thực tế | Thành công / gọi lặp | Lỗi thực tế |
|---|---|---|---|
| POST `/api/results/:resultId/publish` | ID chuỗi hợp lệ, encode một lần. Không cần body; JSON hợp lệ gửi thêm không thay ID/nội dung nguồn. Query không được dùng, controller hiện không kiểm tra query của POST. | 202 tạo mới; 200 cùng nội dung trả event cũ; không reset trạng thái/số lần gửi. | 400 VALIDATION_ERROR (ID/JSON); 404 NOT_FOUND; 409 CONTENT_CONFLICT; 422 RESULT_NOT_READY / INVALID_TEST_CODE / INVALID_UNIT / VALIDATION_ERROR; 413 VALIDATION_ERROR (JSON >1mb); 415 VALIDATION_ERROR (encoding/charset); 503 DEPENDENCY_UNAVAILABLE. |
| GET `/api/results/:resultId/publish-event` **mới** | ID cùng quy tắc GET chi tiết. Không cần body. Mọi query bị từ chối 400. | 200 nguồn có event hoặc 200 `published=false,event=null`. GET lặp chỉ đọc trạng thái hiện tại, `Cache-Control: no-store`. | 400 VALIDATION_ERROR; 404 NOT_FOUND nếu không có result; 503 DEPENDENCY_UNAVAILABLE. |
| GET `/api/publish-events/:eventId` | UUID 8-4-4-4-12; không cần body. Controller cũ không dùng/không kiểm tra query. | 200 event đã lưu, bảy trường cũ; `no-store`. GET lặp không ghi dữ liệu. | 400 VALIDATION_ERROR; 404 NOT_FOUND; 503 DEPENDENCY_UNAVAILABLE. |
| GET `/api/exchanges/:exchangeId` **MW sẵn có** | UUID; không cần body; query bị từ chối. | 200 chi tiết giao dịch và lịch sử, payload, mốc xử lý. UI dùng identity/status/retry_phase/verified_at/completed_at. GET lặp chỉ đọc. | 400 VALIDATION_ERROR; 404 NOT_FOUND; 503 DEPENDENCY_UNAVAILABLE. |

POST thành công chỉ có:

```json
{"event_id":"00000000-0000-4000-8000-000000000001","result_id":"R1","dispatch_status":"PENDING","exchange_id":null}
```

Lookup đã Publish:

```json
{
  "result_id":"R1","result_status":"FINAL","published":true,
  "event":{
    "event_id":"00000000-0000-4000-8000-000000000001","result_id":"R1",
    "dispatch_status":"PENDING","exchange_id":null,"dispatch_attempt_count":0,
    "last_error_code":null,"last_error_message":null,
    "published_at":"2026-11-04T05:00:00.000Z","acked_at":null,"next_retry_at":null
  }
}
```

Chưa Publish: `{"result_id":"R1","result_status":"FINAL","published":false,"event":null}`. `result_status` là nguồn hiện tại, có thể khác FINAL trong snapshot cũ. GET theo event UUID trả đúng bảy trường event phía trên, bỏ ba trường thời gian. Lỗi dùng `{"error":{"code":"CONTENT_CONFLICT","message":"..."}}`. Message lỗi chuyển giao là thông báo đã làm an toàn, không lộ SQL/kết nối. Xem [hợp đồng API](api-contract.md), [controller LIS](../backend/src/lis/controller.ts) và [OpenAPI](../backend/src/lis/openapi.ts).

Proxy giữ quy ước dot marker/header/Vary đã nghiệm thu, mở rộng có giới hạn cho GET lookup và POST Publish. Xác minh cả ID dấu chấm và literal percent, slash, plus, Unicode qua Vite dev/preview. Không thay cách rewrite các app khác.

## 4. Đối chiếu nghiệp vụ

Đã đối chiếu tài liệu Implementation v1.1 ngày 12/10/2026 và kế hoạch thực nghiệm v1.0 trong khảo sát. Các thiếu hụt bắt buộc của khảo sát được xử lý ở đợt này.

| Quy tắc | Trạng thái sau triển khai | Bằng chứng |
|---|---|---|
| Chỉ FINAL hợp lệ Publish lần đầu | Đã triển khai và xác minh | Service validation, HTTP 422; READY UI khóa; POST trực tiếp trên DB tạm 422 |
| Lần đầu tạo event/snapshot bền vững | Đã triển khai và xác minh | PostgreSQL integration, D3 và UI thật 202 → GET/F5 |
| Cùng nội dung không tạo event mới | Đã triển khai và xác minh | Service/HTTP/D3/UI 200 cùng ID; decimal scale không conflict |
| Nguồn khác không ghi đè cũ | Đã triển khai và xác minh, khắc phục thiếu hụt cũ | 409 và deep equality event trước/sau; EMR vẫn nhận snapshot gốc 3.6 khi nguồn riêng đã đổi 9.1 |
| Trạng thái nguồn/Dispatcher/MW tách biệt | Đã triển khai và xác minh | DOM mô phỏng từng pha, UI thật ACK + DELIVERED |
| ACK không đồng nghĩa DELIVERED | Đã triển khai và xác minh | MW chưa nhận/đang xử lý/VERIFYING, identity sai/mốc thiếu không báo delivered; D3 giữ VERIFYING đến khi GET về |
| F5/URL trực tiếp truy xuất trạng thái | Đã triển khai và xác minh | GET lookup, giữ event qua tài liệu mới, không thêm POST |
| Dispatcher độc lập UI | Đã triển khai và xác minh | D3 process riêng, SIGKILL/lease recovery và fixture UI chạy entry point riêng |

## 5. Kết quả kiểm thử và bằng chứng

Tổng hợp máy đọc được: [acceptance-final.json](../frontend/apps/lis/tests/evidence/phase-2.3-2026-11-04/acceptance-final.json).

Gốc bằng chứng: [phase-2.3-2026-11-04](../frontend/apps/lis/tests/evidence/phase-2.3-2026-11-04/). Các thư mục mỗi lượt có tên riêng; lỗi các lượt đầu được giữ lại, không sửa để biến thành PASS.

| Nhóm | Kết quả | Bằng chứng được chấp nhận |
|---|---|---|
| Backend TypeScript + build | PASS | `run-iXSkQU/backend-typescript.log`, `backend-build.log` |
| LIS | 177/177, skipped 0 | [test.log](../frontend/apps/lis/tests/evidence/phase-2.3-2026-11-04/run-iXSkQU/test.log) |
| Middleware (gồm mapper/worker và ca HTTP EMR mô phỏng cũ) | 191/191, skipped 0 | `run-iXSkQU/test-middleware.log` |
| EMR | 101/101, skipped 0 | `run-iXSkQU/test-emr.log` |
| C4 Middleware → EMR thật | 16/16, skipped 0 | `run-iXSkQU/test-integration.log`, `c4.json` completed=true |
| D3 toàn luồng backend thật | 15/15, skipped 0 | [D3](../frontend/apps/lis/tests/evidence/phase-2.3-2026-11-04/run-GNG2gj/d3.json), `test-e2e.log` |
| Frontend unit, gồm 36 ca cũ + 6 ca Publish mới | 42/42 | `final-checks-4b0b7a9d/test.log` |
| Frontend TypeScript + lint | PASS | `final-checks-4b0b7a9d/check.log`, `lint.log` |
| Build frontend cuối | PASS, tsc + Vite | `build-final-43583da6.log`; bundle `index-Cs9UL5Oh.js` |
| Hồi quy 2.1/2.2 Chrome | 12/12 suite | [verification-Xmi465](../frontend/apps/lis/tests/evidence/phase-2.3-2026-11-04/regression/verification-Xmi465/verification.json) completed=true |
| Publish Chrome HTTP mô phỏng, bản cuối | 17/17 | [run-O5FjJz](../frontend/apps/lis/tests/evidence/phase-2.3-2026-11-04/run-O5FjJz/chrome-mock/browser-publish.json) completed=true |
| Publish Chrome qua Vite development + backend thật biệt lập | 16/16 | [run-dkkG15](../frontend/apps/lis/tests/evidence/phase-2.3-2026-11-04/run-dkkG15/chrome-real/browser-publish.json), verification completed=true |
| Publish Chrome qua Vite preview bản build cuối + backend thật biệt lập | 16/16 | [run-PGSAOF](../frontend/apps/lis/tests/evidence/phase-2.3-2026-11-04/run-PGSAOF/chrome-real/browser-publish.json), verification completed=true |

Phân loại bằng chứng:

1. **Unit/HTTP với dependency mô phỏng:** lỗi 400/404/409/422/503, JSON/network, abort và kiểm tra schema/identity; controller mô phỏng lỗi truy cập DB để xác minh 503. Không khẳng định đã gây mất kết nối trên DB nhóm.
2. **Chrome HTTP mô phỏng:** xác nhận/Hủy, 8 click chỉ một POST, lookup lỗi là chưa xác minh, từng pha MW, nội dung/identity sai không báo DELIVERED, POST mất response sau khi lưu được GET đối soát/F5, READY đổi khi xem và response muộn A không ghi đè B. DELIVERED ở bộ này chỉ là dữ liệu mô phỏng.
3. **HTTP backend dùng chung, chỉ đọc:** các suite `*-real` của hồi quy 2.1/2.2 đọc backend 3101 và dữ liệu đang có; không Publish. Dot record có thể 404 đúng hợp đồng. Backend nhóm chưa có API lookup mới thì panel báo Chưa xác minh và khóa Publish, không coi 404 là chưa Publish. Bằng chứng này chỉ xác minh hồi quy đọc.
4. **Tích hợp thật có ghi, môi trường riêng:** runner tạo PostgreSQL 17 tmpfs mới, mật khẩu ngẫu nhiên, roles LIS/MW/EMR riêng, token + marker guard và cổng động loopback, không gắn Compose volume. Source/tests/scripts/DDL gắn chỉ đọc; các suite được làm sạch dữ liệu giữa bộ. Fixture từ chối DB không rỗng hoặc marker sai. Dispatcher và Worker chạy entry point thật trong process riêng. Chrome đi qua proxy Vite thật; không CDP mock API ở chế độ real. Dữ liệu hoàn toàn tổng hợp.

Trong mỗi lượt UI thật: READY POST 422; FINAL POST 202; 8 click chỉ một POST; MW/EMR thật đạt DELIVERED; GET độc lập EMR đúng một bản ghi, đúng patient_key kỳ vọng, quantity 3.6, mg/dL. Repeat 200 cùng event; conflict 409 bảo toàn event; tất cả tám ID đặc biệt Publish/lookup/F5 thành công. Dump cuối có 10 event ACK, 10 giao dịch DELIVERED và 10 bản ghi EMR, không có event READY. Snapshot của ca conflict vẫn chuyển 3.6, không lấy nguồn đã đổi 9.1. Xem `isolated-database-final.log`, `browser-api-http.jsonl`, `browser-fixture.json` tại mỗi lượt real.

D3 bổ sung mất ACK sau commit, listener MW chưa sẵn sàng và hồi phục, patient link thiếu, dispatcher cạnh tranh/khởi động lại, giữ VERIFYING khi GET đọc lại chưa về. Không sửa Dispatcher/Worker để đạt các ca này.

Các lỗi đã xử lý trong quá trình xác minh: runner chờ PostgreSQL qua TCP thay vì socket khởi tạo tạm; sửa kiểu TypeScript của snapshot và lookup optional; cập nhật phép đếm Swagger 6 → 7; gắn scripts và DDL chỉ đọc cần cho C4/D3 trong image cache. Full runner `run-iXSkQU` có bốn suite đạt nhưng dừng tại D3 do thiếu file DDL trong container; **không** coi verification=false của lượt đó là toàn bộ đạt. Sau khi sửa mount, D3 và UI thật chạy lại đạt trong `run-GNG2gj`; các lượt UI cuối được chạy riêng như bảng. Hồi quy đầu có fixture lookup luôn FINAL gây tải lại với nguồn READY; fixture được đồng bộ, không nới điều kiện PASS và cả 12 suite đã chạy lại đạt. Windows khóa xóa `dist/assets`, nên build cuối dùng `--emptyOutDir false`, giữ assets cũ và cập nhật index đến bundle mới. Không xóa cache/tiến trình của người dùng.

## 6. Ảnh giao diện

Ảnh dưới đây lấy từ **Chrome với API thật và dữ liệu tổng hợp biệt lập**, không phải ảnh dựng:

- [READY – nút bị khóa](../frontend/apps/lis/tests/evidence/phase-2.3-2026-11-04/run-PGSAOF/chrome-real/publish-ready-desktop.png)
- [Dialog xác nhận desktop](../frontend/apps/lis/tests/evidence/phase-2.3-2026-11-04/run-PGSAOF/chrome-real/publish-confirm-desktop.png)
- [Sau Publish và xác minh DELIVERED](../frontend/apps/lis/tests/evidence/phase-2.3-2026-11-04/run-PGSAOF/chrome-real/publish-delivered-desktop.png)
- [CONTENT_CONFLICT](../frontend/apps/lis/tests/evidence/phase-2.3-2026-11-04/run-PGSAOF/chrome-real/publish-content-conflict.png)
- [Mobile 375px](../frontend/apps/lis/tests/evidence/phase-2.3-2026-11-04/run-PGSAOF/chrome-real/publish-final-mobile.png)
- [Dialog mobile](../frontend/apps/lis/tests/evidence/phase-2.3-2026-11-04/run-PGSAOF/chrome-real/publish-confirm-mobile.png)

## 7. Danh sách file thay đổi

| Nhóm | File | Nội dung |
|---|---|---|
| Backend production | `backend/src/lis/service.ts` | So sánh canonical snapshot/hash, nhánh conflict và concurrency |
| Backend production | `backend/src/lis/repository.ts` | SELECT trạng thái Publish theo result_id |
| Backend production | `backend/src/lis/controller.ts` | GET lookup, 409 và response an toàn/no-store |
| Backend production | `backend/src/lis/openapi.ts` | Endpoint/schema mới, 409 |
| Backend tests | `backend/tests/lis/api-docs.http.test.ts`, `controller.http.test.ts`, `controller.integration.test.ts`, `service.integration.test.ts`, `dispatcher.integration.test.ts` | Hợp đồng lookup/conflict/canonical và hồi quy snapshot bất biến |
| Fixture mới | `backend/tests/e2e/publish-browser-server.ts` | Guard DB và host API thật, background process, trace |
| Frontend mới | `frontend/apps/lis/src/api/publish.ts`, `types/publish.ts` | API client/validation, lỗi và kiểm tra MW identity |
| Frontend mới | `frontend/apps/lis/src/hooks/usePublishStatus.ts`, `components/PublishPanel.tsx` | Poll GET/abort/đối soát và UI/dialog/khóa POST |
| Frontend tích hợp | `frontend/apps/lis/src/components/ResultDetail.tsx`, `src/App.css` | Gắn panel và CSS riêng, giữ hai card cũ |
| Proxy | `frontend/apps/lis/src/api/resultRequest.ts`, `proxy/lis.ts` | Suffix lookup/Publish và dot transport giới hạn method/route |
| Test mới | `frontend/apps/lis/tests/publish.test.mjs`, `browser-publish.mjs` | Unit và Chrome mock/real |
| Helper hồi quy | `frontend/apps/lis/tests/helpers/http-browser.mjs`, `browser-conditions.mjs`, `browser-dot.mjs` | Lookup phụ tách oracle cũ; fixture đồng bộ nguồn; không nới assert cũ |
| Runner mới | `scripts/verify-publish-phase-2.3.mjs` | DB tmpfs riêng, chọn suite/mode, bằng chứng và cleanup |
| Tài liệu | `docs/api-contract.md`, `frontend/apps/lis/README.md`, báo cáo này | API, vận hành kiểm thử, kết quả và giới hạn |
| Bằng chứng mới | `frontend/apps/lis/tests/evidence/phase-2.3-2026-11-04/` | Log/JSON/PNG riêng; không ghi đè 2.1/2.2 |

## 8. Cách chạy lại

Cần Docker, Chrome và các dependency/image đã có; không cài dependency mới:

```powershell
# tại root repository
node scripts/verify-publish-phase-2.3.mjs --mock-only
node scripts/verify-publish-phase-2.3.mjs
node scripts/verify-publish-phase-2.3.mjs --browser-only --dev
# chỉ chạy lại một suite backend, vẫn tạo DB biệt lập:
node scripts/verify-publish-phase-2.3.mjs --backend-only --suites=test:e2e
```

Runner tạo thư mục run mới mỗi lần và dừng container do chính nó tạo trong finally. `--backend-only` không chạy Chrome; `--browser-only` vẫn tạo database/seed riêng. Không dùng `browser-publish --real` với backend nhóm. Các container nhóm không được restart để kiểm thử này.

## 9. Giới hạn và điều kiện nghiệm thu

- Đủ bằng chứng kỹ thuật cho phạm vi LIS 2.3 đã yêu cầu, cùng hồi quy 2.1/2.2. Không còn blocker chức năng bắt buộc được phát hiện trong phạm vi kiểm thử này. Có thể đưa phần source LIS hiện tại ra nghiệm thu kỹ thuật trên môi trường biệt lập.
- **Chưa xác nhận bản đang chạy dùng chung đã có chức năng mới.** Chưa rebuild/restart/deploy dịch vụ nhóm. Cần áp dụng cả backend và frontend cùng phiên bản trong đợt triển khai được nhóm cho phép; frontend chỉ mở nút sau khi lookup backend mới hoạt động.
- Chưa Publish bộ MIMIC/SPP-65 chính thức, chưa làm evaluator/D4 hoặc kết luận nghiệp vụ trên bộ dữ liệu nghiên cứu. Các ca có ghi dùng dữ liệu tổng hợp; không đại diện mọi tổ hợp danh mục/số liệu thật.
- Chrome desktop và mobile 375px đã kiểm tra; không tuyên bố Firefox/Safari hay mọi thiết bị đều đạt. Không kiểm thử tải lớn, bảo mật/ủy quyền mới hoặc deploy production.
- Static hosting ngoài Vite cần reverse proxy giữ raw dot path/header/Vary tương đương. `dist` tĩnh không tự cung cấp proxy.
- Monitor hiện chưa có deep link được hỗ trợ; không tạo liên kết giả. Không có retry thủ công; BLOCKED/FAILED cần nhóm vận hành chẩn đoán theo mã lỗi, không dùng Publish lại để reset lịch sử.
- Một số lỗi mạng, DB và trạng thái MW được chủ động mô phỏng như phân loại trên; không gây lỗi trên môi trường nhóm. Các lỗi chuyển giao/mất ACK/đọc lại đã có kiểm thử D3/C4 thật biệt lập.

Vì vậy, **đủ điều kiện nghiệm thu kỹ thuật chức năng LIS 2.1–2.3 ở phạm vi source và môi trường thử nghiệm đã nêu; chưa đủ căn cứ tuyên bố nghiệm thu toàn hệ thống hoặc bản triển khai dùng chung/MIMIC chính thức**. Bước áp dụng lên môi trường nhóm và nghiệm thu chính thức vẫn thuộc đợt triển khai được nhóm chấp thuận.
