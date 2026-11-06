# Exchange Monitor – Triển khai và nghiệm thu kỹ thuật

Khởi tạo ngày 04/11/2026; tiếp tục kiểm chứng ngày 05/11/2026, Asia/Bangkok. Nhánh `feature/frontend/lis-emr-ui`, baseline `9b7024a`.
Thực hiện từ kết quả khảo sát đã thống nhất. Không stage/commit/push/merge.

## 0. Chốt lượt tiếp tục ngày 05/11/2026

**Trạng thái khôi phục:** HEAD vẫn `9b7024a`, đúng nhánh `feature/frontend/lis-emr-ui`.
Trước lượt này đã có hai màn hình Monitor, hash routing, bộ lọc/phân trang, polling/abort,
API attempts an toàn, contract, unit/browser/integration tests và bằng chứng ngày 04/11.
Không viết lại UI/API. Đã đối chiếu SHA-256 với acceptance cũ: các file source/test đã ghi nhận
đều giữ nguyên, trừ hai runner, README và báo cáo được cập nhật có chủ đích trong lượt này.
Bằng chứng cũ và các file đang làm dở được giữ nguyên.

**Phần hoàn tất trong lượt tiếp tục:**

- Bổ sung `MONITOR_EVIDENCE_DIR` cho runner backend và Monitor browser để ghi lượt mới riêng,
  không ghi đè nghiệm thu cũ; README giải thích đường dẫn theo root/workspace tương ứng.
- Khắc phục điểm yếu của ca C4 chạy Worker qua tiến trình con: thay ngân sách 1.000 vòng chờ 10ms
  bằng deadline 60 giây, dừng sớm nếu tiến trình thoát, ghi thời gian khởi động/chờ và output khi thất bại.
  Giữ nguyên mọi assertion về HTTP, dữ liệu EMR, attempts, timeline, DELIVERED và thoát sạch.
- Chạy mới toàn bộ các nhóm dưới đây; kiểm tra GET thực tế, ảnh desktop/mobile và dữ liệu/container
  trước/sau. Không rebuild/recreate service trong lượt này vì container đã có endpoint mới.
- Chốt bằng chứng chọn lọc và cập nhật chính báo cáo này.

| Kiểm thử thực sự chạy trong lượt tiếp tục | Kết quả cuối |
|---|---|
| Monitor unit / TypeScript / lint / build | **26/26**, ba checks PASS |
| Monitor Chrome HTTP mô phỏng, preview | **29/29** |
| Monitor Chrome API thật, dev 5174 / preview 4174 | **4/4 + 4/4**, chỉ GET |
| LIS backend / Middleware backend / EMR backend | **177/177 + 197/197 + 101/101** |
| C4 / D3, PostgreSQL tmpfs riêng | **16/16 + 15/15** |
| Backend TypeScript / build | **PASS**, kiểm tra TypeScript lại sau chỉnh harness |
| LIS unit / TypeScript / lint / build | **43/43**, ba checks PASS |
| LIS 2.1/2.2 browser | **12/12 suite** |
| LIS 2.3 Publish browser HTTP mô phỏng | **18/18** |

**Lỗi ban đầu và bằng chứng chạy lại:** run-hxJxnd đạt LIS/Middleware/EMR nhưng C4 chỉ đạt 14/16
(hai fail gồm ca tiến trình và assertion tổng hợp cha), nên runner dừng trước D3; không coi lượt này
là toàn bộ backend đạt. Ca tiến trình còn RECEIVED khi hết vòng chờ. Test cũ không đưa stdout của
Worker vào lỗi nên chưa đủ bằng chứng xác định chính xác nguyên nhân tiến trình chậm lúc đó;
không kết luận là lỗi nghiệp vụ Worker. Sau chỉnh harness nêu trên, run-dctMm5 đạt C4 16/16 và D3 15/15;
Worker khởi động 2.382ms, đối soát xong trong 2.671ms. Không đổi code Worker, Dispatcher hoặc EMR.
Tổng backend được chấp nhận **506 ca đạt**, từ các suite đạt trong hai run mới này; tổng lượt thực thi
TAP là **522**, gồm C4 thất bại ban đầu và lần chạy lại. Số TAP có tính cả ca cha; không gộp 12 suite
browser LIS thành 12 ca đơn lẻ hay cộng với unit để tạo tổng không cùng đơn vị.

**API và môi trường hiện tại:**

- `GET /api/exchanges`, `GET /api/exchanges/:exchangeId` và `GET /api/exchanges/:exchangeId/attempts`
  hoạt động qua dev/preview. GET attempts thật 200 với `Cache-Control: no-store`;
  UUID sai 400; UUID không tồn tại 404 `Exchange not found`; query không hỗ trợ 400; `/ready` 200.
  Lỗi 503/mất mạng được kiểm tra qua HTTP mock và DB kiểm thử riêng, không ngắt dịch vụ thật.
- Middleware container vẫn `52179f339968…`, image `4fbb8c2e094f…`, có route attempts trong dist.
  ID/image/thời điểm khởi động của cả sáu container Compose giống nhau trước/sau lượt này.
- SELECT trong transaction READ ONLY: **3 transactions, 6 attempts, 24 events** trước/sau;
  fingerprint toàn bộ rows của ba bảng giống nhau. Container DB thử nghiệm đã dừng và tự xóa,
  không gắn/xóa volume Compose, không POST Publish lên MIMIC.
- Mở nghiệm thu: **http://127.0.0.1:5174/#/exchanges**; tìm `MIMIC-LAB-100142`, xem chi tiết,
  SEND/VERIFY, receipt, F5, Làm mới, Quay lại/Back/Forward. Preview đã kiểm tra tại 4174;
  server preview do test tạo đã đóng, muốn mở lại dùng lệnh tại mục 7.

**File sửa thêm trong lượt tiếp tục:** `scripts/verify-monitor-backend.mjs`,
`frontend/apps/middleware-monitor/tests/browser.mjs`, README Monitor,
`backend/tests/integration/middleware-emr.integration.test.ts` và báo cáo này.
Bằng chứng mới nằm riêng dưới `tests/evidence/2026-11-05/` và
`tests/evidence/acceptance/2026-11-05/` của Monitor; LIS dùng
`tests/evidence/monitor-regression-2026-11-05/`. Danh sách toàn bộ phần triển khai vẫn ở mục 4.
Không chỉnh lại ứng dụng LIS/EMR, .env, schema, Compose hoặc dữ liệu thật.

Bằng chứng chốt lượt này: [verification.json](../frontend/apps/middleware-monitor/tests/evidence/acceptance/2026-11-05/verification.json),
[danh sách desktop](../frontend/apps/middleware-monitor/tests/evidence/acceptance/2026-11-05/list-desktop.png),
[chi tiết mobile](../frontend/apps/middleware-monitor/tests/evidence/acceptance/2026-11-05/detail-mobile.png).
JSON ghi log nguồn/SHA-256, các ca browser, lần C4 fail ban đầu và dấu dữ liệu/container trước/sau.
Các số liệu ở mục 5 bên dưới là lịch sử ngày 04/11, không thay thế kết quả mới trong mục này.

**Giới hạn và Git cuối:** giữ các giới hạn ở mục 8 (Chrome, dữ liệu thật ít và đã kết thúc,
API chỉ đọc, không có retry thủ công). Không còn ca fail trong các suite cuối được chấp nhận;
không tuyên bố đã kiểm thử mọi trình duyệt/tải lớn. `git diff --check` đạt, index trống,
HEAD không đổi; các thay đổi source/tests/docs và bằng chứng untracked vẫn để nguyên cho nhóm review.
Không stage/commit/push/merge, không reset/clean/restore/chuyển nhánh.

## 1. Chức năng đã triển khai

Ứng dụng `frontend/apps/middleware-monitor/`, React/TypeScript/Vite, tiếng Việt,
không thêm dependency và không phụ thuộc component nội bộ LIS.

- Danh sách lọc AND chính xác theo `source_result_id` và `status`; Tìm kiếm/Enter, Xóa bộ lọc, Làm mới.
- Từ bản sửa tìm kiếm ngày 05/11: bỏ khoảng trắng đầu/cuối của bộ lọc; chỉ mã `MIMIC-LAB-` hậu tố số
  được chuẩn hóa viết hoa. Mã khác giữ nguyên hoa/thường/Unicode/ký tự đặc biệt/khoảng trắng bên trong;
  từ chối chuỗi chỉ trắng/control. Định danh nhận từ API giữ nguyên. Không thêm filter backend.
- Mở trực tiếp Exchange ID sau kiểm tra UUID. Bảng mười cột đủ định danh, nguồn, trạng thái,
  pha retry, số SEND/VERIFY, thời gian và Xem chi tiết. Cuộn ngang trong vùng riêng trên màn hình hẹp.
- 20 dòng/trang, GET limit=21 và offset=(page-1)*20; không tạo tổng số trang/giao dịch giả.
- Rỗng chỉ nói không có exchange Middleware khớp, không kết luận LIS chưa Publish.
- Hash `#/exchanges` và `#/exchanges/:exchangeId`; query lưu bộ lọc đã áp dụng và trang,
  giữ qua F5/URL trực tiếp/Quay lại/Back/Forward. Bản nháp chưa tìm kiếm không lưu qua rời trang.
- Chi tiết có định danh/hash/mapping version, trạng thái/counters/retry, snapshot lúc Publish,
  timeline, bảng attempts, chẩn đoán an toàn, receipt và các mốc EMR.
- Source/FHIR JSON thu gọn mặc định, vùng xem giới hạn chiều cao. Snapshot ghi rõ không phải nguồn LIS hiện tại.
- GET chi tiết khoảng 5 giây khi chưa kết thúc; không chồng, tab ẩn tạm dừng, hiện lại đọc mới,
  dừng ở DELIVERED/REJECTED/FAILED. Lỗi attempts vẫn có GET phục hồi. Có Làm mới thủ công.
- Abort và định danh request chặn phản hồi muộn cho cả danh sách và chi tiết.
- Lỗi 400, 404 bản ghi, 404 route/container cũ, 503, mạng, JSON/schema sai có hướng xử lý tiếng Việt.
  Lỗi attempts không che mất định danh/timeline hợp lệ; lỗi detail không giữ xác nhận EMR cũ.

Không có nút Retry thủ công, không có POST trong Monitor.

## 2. API tái sử dụng và API mới

| API backend | Sử dụng |
|---|---|
| GET `/api/exchanges?status=...&source_result_id=...&limit=21&offset=...` | Danh sách, thứ tự received_at DESC/exchange_id ASC |
| GET `/api/exchanges/:exchangeId` | Định danh, trạng thái, snapshot/FHIR, mốc xử lý và events |
| **GET `/api/exchanges/:exchangeId/attempts`** | **Mới:** lịch sử SEND/VERIFY, receipt tối thiểu và mã chẩn đoán đã lọc |

Frontend đi qua `/api/middleware` → `3102/api`, dùng cấu hình dev/preview sẵn có.
Không thay proxy chung, schema, migration, repository, Worker hoặc quy tắc retry.
[Hợp đồng API đầy đủ](api-contract.md).

API mới kiểm tra UUID, từ chối query, GET chỉ đọc, `Cache-Control: no-store`.
200 với exchange tồn tại (items có thể rỗng); 400 VALIDATION_ERROR; 404 NOT_FOUND/Exchange not found;
503 DEPENDENCY_UNAVAILABLE. Route thiếu khác bản ghi thiếu.

Response: `{exchange_id,event_id,source_system,source_result_id,items,diagnostics}`.
Mỗi item trả đúng dữ liệu `attempt_id,exchange_id,phase,attempt_no,started_at,sent_at,response_at,ended_at,
http_status,error_code,error_message,receipt`. Giữ thứ tự repository started_at ASC/attempt_id ASC,
không dựng lượt từ timeline. Trường chưa có nullable theo contract.

Receipt chỉ gồm `result,external_system,external_id,target_id,patient_key`, chỉ công khai cho SEND đã
kết thúc, không lỗi, 201/STORED hoặc 200/ALREADY_EXISTS, UUID hợp lệ và namespace/result khớp FHIR dự án.
Không trả response_body thô. Error message do server dựng; mã lỗi theo allowlist Worker,
unknown đổi DIAGNOSTIC_ERROR. Diagnostics trích code an toàn từ events.detail để bao phủ lỗi trước HTTP;
chỉ trả log_event_id/attempt_id/event_type/occurred_at/error_code, không trả detail, SQL, stack,
token, dữ liệu mismatch hoặc body lỗi từ xa.

## 3. Ngữ nghĩa trạng thái

READY/FINAL là nguồn LIS; ACK là Dispatcher LIS đã xác nhận Middleware tiếp nhận;
các badge trong Monitor là trạng thái Middleware. Snapshot FINAL là tại lúc Publish.

Danh sách dùng nhãn **MW báo DELIVERED**. Chi tiết chỉ xác nhận Middleware đã đối soát EMR khi:
MW DELIVERED; có target_stored_at/verified_at/completed_at; envelope khớp event/source/result/hash;
receipt SEND khớp định danh FHIR và status; có VERIFY kết thúc HTTP 200 không lỗi.
Thiếu dữ liệu/receipt/API attempts/identity nhất quán thì hiện chưa đủ bằng chứng.
Không coi POST 200/201, target_stored_at, ACK hoặc một event timeline riêng là DELIVERED.

Mã lỗi được giải thích tiếng Việt cùng hướng kiểm tra. Retry vẫn do Worker; Monitor không reset
FAILED/REJECTED hoặc gửi lại kết quả. Không tạo thời điểm/status/counter chưa được API hỗ trợ.
Timestamp hiển thị UTC, giữ ISO gốc ở datetime/title; thời gian snapshot giữ nguyên, cả microsecond.
Timestamp cột Middleware vẫn theo độ chính xác millisecond của hợp đồng hiện có.

## 4. File thay đổi

| Nhóm | File |
|---|---|
| Backend | `backend/src/middleware/controller.ts`; mới `monitor-diagnostics.ts` |
| Backend tests | `backend/tests/middleware/controller.http.test.ts`, `controller.integration.test.ts`; mới `monitor-diagnostics.test.ts` |
| Frontend khung | `frontend/apps/middleware-monitor/src/App.tsx`, `src/index.css`, `index.html`, `package.json` |
| API/types mới | `src/api/exchanges.ts`, `src/types/exchange.ts` trong workspace Monitor |
| State/hooks mới | `src/state/routes.ts`, `src/state/presentation.ts`, `src/hooks/useExchanges.ts` |
| Components mới | `src/components/ExchangeList.tsx`, `ExchangeDetail.tsx`, `Common.tsx` |
| Frontend tests mới | `tests/exchange.test.mjs`, `fixtures.mjs`, `browser.mjs`, `helpers/browser.mjs` |
| Runner mới | `scripts/verify-monitor-backend.mjs` |
| Tài liệu/bằng chứng | `docs/api-contract.md`, báo cáo này, README Monitor, `tests/evidence/.gitignore`, README và acceptance |
| Hồi quy LIS, chỉ instrumentation tests | `frontend/apps/lis/tests/browser-conditions.mjs`, `browser-dot.mjs`, `browser-uiux.mjs`, `helpers/http-browser.mjs` |

**Lý do sửa bốn test LIS:** dữ liệu thực hiện nay đã có Publish/DELIVERED. Khi mở chi tiết, panel LIS
hợp lệ gửi GET Middleware. Oracle cũ dùng request cuối làm GET chi tiết LIS, dẫn đến nhận nhầm URL MW
và báo fail ở conditions-real. Đã tách request phụ Publish/MW khỏi oracle danh sách/chi tiết cũ;
fetch thật vẫn đi nguyên arguments/signal, không thay response và không nới assertion dữ liệu.
Bộ Publish vẫn kiểm tra các request này riêng. Không sửa `frontend/apps/lis/src`, proxy LIS,
UI EMR hoặc backend LIS/EMR.

## 5. Kết quả kiểm thử ngày 04/11/2026 — lịch sử

| Bộ | Kết quả |
|---|---|
| Monitor frontend unit | **26/26** |
| Monitor TypeScript/lint/build | **PASS**; build cuối dùng --emptyOutDir false do Windows khóa xóa assets |
| Chrome Monitor HTTP mô phỏng | **29/29** (đã có verification hoàn tất) |
| Chrome Monitor API thật qua development 5174 | **4/4** |
| Chrome Monitor API thật qua preview 4174 | **4/4** |
| LIS backend | **177/177** |
| Middleware backend, gồm API attempts và sanitization mới | **197/197** |
| EMR backend | **101/101** |
| C4 Middleware → EMR thật, DB riêng | **16/16** |
| D3 toàn luồng backend thật, DB riêng | **15/15** |
| Backend tổng năm suite | **506/506**, không skipped ở các log được chấp nhận |
| Backend TypeScript/build | **PASS**, gồm check lại image cuối trong container network=none |
| LIS frontend unit | **43/43** |
| LIS 2.1/2.2 Chrome hồi quy | **12/12 suite** |
| LIS Publish Chrome HTTP mô phỏng | **18/18** |

Các số liệu trong mục 5 thuộc lượt chạy ngày 04/11; bằng chứng lịch sử được giữ lại.
Kết quả chạy mới ngày 05/11 nằm riêng ở mục 0. Tổng backend được gộp
các suite đã đạt trong các lượt mới: run-tG8Ew0 (LIS/check/build), run-K4akRY (EMR/C4/D3),
run-H37sme (Middleware cuối). Không coi một verification=false của lượt dừng sớm là toàn bộ đạt.

Phân loại:

- **Mock:** 20/21 dòng, AND/rỗng, Unicode/%/slash, UUID sai, bảy trạng thái MW, nhiều SEND/VERIFY,
  missing verification/receipt/identity, 400/404/503/mạng/JSON/schema, lỗi attempts route, phục hồi,
  polling/tab ẩn/terminal, abort và phản hồi muộn. Lỗi không được tạo trên DB thật.
- **GET thật:** browser Monitor so sánh dòng/attempts với API đang chạy, chi tiết/F5/direct URL,
  bộ lọc/Back/Forward, desktop/mobile qua dev và preview. Có 3 exchange đã tồn tại, không seed thêm.
- **Tích hợp ghi riêng:** backend runner tạo PostgreSQL17 tmpfs mới, roles/mật khẩu ngẫu nhiên,
  marker isolation, source/tests/scripts/DDL chỉ đọc; không gắn Compose volume. HTTP/integration API mới
  kiểm tra thứ tự, null, receipt/code allowlist, input sai, DB lỗi, dữ liệu trước/sau GET bằng nhau.
  C4/D3 chạy controller/service/repository/Worker/Dispatcher thật trên dữ liệu tổng hợp riêng.

Các lỗi trung gian đã sửa: wiring dependency API; kiểu SQL tham số fixture; ba lint rules của frontend;
Windows khóa thư mục assets. Lượt LIS đầu fail do oracle nhầm GET MW như mục 4, đã chạy lại đủ 12 suite đạt.
Điều kiện chờ Chrome được siết theo đúng route/DOM mới để tránh đọc trạng thái trang trước khi điều hướng xong.
Không chỉnh dữ liệu thật để tạo ảnh/trạng thái lỗi.

Bằng chứng chọn lọc: [acceptance/verification.json](../frontend/apps/middleware-monitor/tests/evidence/acceptance/verification.json),
[Danh sách desktop – API thật](../frontend/apps/middleware-monitor/tests/evidence/acceptance/list-desktop.png),
[Chi tiết mobile – API thật](../frontend/apps/middleware-monitor/tests/evidence/acceptance/detail-mobile.png).
Raw runs/log giữ cục bộ, được ignore tại Monitor tests/evidence; không cần đưa hàng trăm ảnh/log trung gian vào Git.
Các ảnh đã xem trực tiếp; bảng cuộn trong vùng riêng, trang không tràn ngang ở 375px.

## 6. Môi trường đang chạy

Preflight GET attempts trên container Middleware cũ trả 404 `API route not found`, dù source đã có.
Đã build image bằng Dockerfile hiện có rồi **chỉ recreate service middleware**:

```powershell
docker build -t lis-fhir-emr-backend:local ./backend
docker compose up -d --no-deps --force-recreate middleware
```

Middleware trong Compose dùng image chung, không có build block riêng. Lệnh build không restart LIS.
Container Middleware mới `52179f33996818415d602486b07aeb58ab282b3a10bf1e6bc928b60be44baaff`,
image `sha256:4fbb8c2e094f794a15625cad752631f9311652e453b2469a5387742f636e502d`.
Đã kiểm tra GET attempts 200, invalid UUID 400, unknown UUID 404, query không hỗ trợ 400, readiness 200.
Proxy dev/preview đã được Chrome kiểm tra với dữ liệu thật, gồm endpoint mới.

SELECT trong transaction READ ONLY xác nhận trước/sau **3 transactions, 6 attempts, 24 events**;
fingerprint toàn bộ rows của cả ba bảng giống nhau. ID/image/thời điểm khởi động các container
DB, LIS, Dispatcher, Worker, EMR không thay đổi. Container kiểm thử được cleanup, không xóa volume/reset DB.
Không POST lên dữ liệu MIMIC; không sửa .env, database, schema, Compose hoặc retry rules.

## 7. Mở và thử giao diện

Dev server hiện có: **http://127.0.0.1:5174/#/exchanges**. F5 nếu tab cũ còn trang khung.
Có thể tìm `MIMIC-LAB-100142`, chọn DELIVERED, Xem chi tiết, xem attempts/receipt và F5/Quay lại.
Không có thao tác ghi/gửi lại trong Monitor.

Nếu chưa chạy server, tại frontend:

```powershell
npm.cmd run dev:monitor
npm.cmd run build:monitor
npm.cmd run preview:monitor
# Preview: http://127.0.0.1:4174/#/exchanges
```

Không mở dev server thứ hai nếu 5174 đang dùng. Preview server do test tạo đã đóng;
chạy preview:monitor nếu muốn tự xem bản build. Xem [README](../frontend/apps/middleware-monitor/README.md) cho
lệnh unit/check/lint/build/Chrome và runner backend. Trên Windows có thể build với --emptyOutDir false.

## 8. Giới hạn còn lại

- Chưa kiểm thử Firefox/Safari, tải lớn hoặc mọi kích thước; đã kiểm tra Chrome desktop và mobile 375px.
- Bảy trạng thái/nhiều retries/lỗi được tạo bằng mock hoặc fixture riêng; DB thật hiện có các exchange
  đã kết thúc, không sửa dataset để ép trạng thái. Không lấy mock làm bằng chứng EMR thật.
- Monitor chỉ thấy exchange đã được MW tiếp nhận; không phải danh sách toàn bộ LIS outbox/chưa Publish.
  Không có filter event_id, source_system, thời gian, tổng số hay retry thủ công vì backend chưa hỗ trợ.
- GET detail và attempts là các lần đọc riêng, có thể lệch thời điểm khi Worker cập nhật. UI không suy ra
  DELIVERED từ timeline mới hơn status; dữ liệu chưa đủ nhất quán sẽ chờ lần GET tiếp theo/Làm mới.
- Không hiển thị raw diagnostics/remote error body/mismatch values. Unknown code được làm an toàn,
  có thể cần nhóm vận hành chẩn đoán thêm. Không có auth mới; giữ prototype trong môi trường cục bộ.
- Không deploy Internet, không thay luồng LIS/EMR hoặc thực hiện Publish MIMIC chính thức.

## 9. Git đề xuất – chưa thực hiện

1. Review `git diff --check`, `git diff` và danh sách file mới; kiểm tra các file giữ nguyên.
2. Chỉ stage source/tests/docs thuộc Monitor, API mới, sửa harness C4 và bốn sửa instrumentation test LIS đã giải thích.
   Chọn `tests/evidence/acceptance/`; bỏ raw runs, logs, cache và các bằng chứng cũ ngoài nhiệm vụ.
   Không dùng `git add .` vì repository có bằng chứng untracked cũ.
3. Sau khi nhóm duyệt, có thể commit với message `feat(monitor): implement exchange list, detail and safe attempts API`.
4. Chỉ push/merge theo quy trình nhóm sau đó. Hiện index không có file staged và HEAD vẫn 9b7024a.

Kết luận: đã triển khai chức năng Monitor trong source và cập nhật API cần thiết trên môi trường cục bộ;
đủ bằng chứng kỹ thuật trong phạm vi đã kiểm tra. Các giới hạn phía trên không được diễn giải thành
nghiệm thu production hoặc đánh giá toàn bộ bộ dữ liệu nghiên cứu.


## 10. Sửa tìm kiếm MIMIC không phân biệt hoa/thường — 05/11/2026

**Nguyên nhân đã kiểm chứng:** Chrome trước sửa gửi nguyên `source_result_id=mimic-lab-100145`,
hash và ô nhập cũng viết thường; GET qua dev proxy trả 200 nhưng rỗng. GET trực tiếp backend và proxy
với mã viết hoa trả một exchange, mã thường/xen kẽ trả rỗng. Controller giữ nguyên query string;
repository dùng `eq(exchangeTransactions.sourceResultId, options.sourceResultId)` cùng AND trạng thái.
Đây là bộ lọc chính xác, không phải lỗi HTTP/proxy hay thiếu dữ liệu.

**Sửa tối thiểu trong frontend Monitor:**

- `src/state/routes.ts`: hàm `normalizeSourceResultId()` trim đầu/cuối, chỉ chuyển viết hoa khi toàn bộ
  mã khớp `^MIMIC-LAB-[0-9]+$` không phân biệt hoa/thường. Giữ hậu tố số, kể cả số 0 đầu; không parse số.
  Áp dụng khi tạo hash và đọc URL để F5/URL cũ/Back/Forward dùng cùng query chuẩn.
- `src/api/exchanges.ts`: chuẩn hóa cùng hàm ngay trước dựng query GET, giữ kiểm tra input/signal/cache,
  status, limit=21 và offset. Không sửa dữ liệu response, Exchange/Event/Result ID hoặc snapshot.
- `tests/exchange.test.mjs`, `tests/browser.mjs`: bổ sung hoa/thường/xen kẽ/trim, không tồn tại,
  near-MIMIC không hợp lệ, mã tùy ý/Unicode, AND status, F5/Back/Forward/refresh/clear và phân trang MIMIC 20/21.
  Fixture định danh có khoảng trắng ở đầu/cuối được điều chỉnh theo yêu cầu trim mới; khoảng trắng bên trong giữ nguyên.
- README Monitor và báo cáo này: cập nhật quy tắc mới. Không import component/module nội bộ LIS;
  chỉ dùng cùng nguyên tắc nhận diện MIMIC-LAB hậu tố số đã có trong LIS 2.2.

Ví dụ `MIMIC-LAB-100145`, `mimic-lab-100145`, `Mimic-Lab-100145`, `  mimic-lab-100145  `
đều gửi `MIMIC-LAB-100145`. ` Local-Result/AbC+%🧪 ` gửi `Local-Result/AbC+%🧪`;
`mimic-lab-AbC` giữ nguyên, không viết hoa. Backend vẫn lọc chính xác và phân biệt hoa/thường cho
các định danh ngoài chuẩn hóa; GET trực tiếp API bằng mã thường vẫn có thể rỗng theo contract hiện có.
Input chỉ trắng/control vẫn bị từ chối theo kiểm tra cũ, không tự mở rộng truy vấn.

**Kiểm thử mới riêng cho bản sửa này:** Monitor unit **33/33**; TypeScript/lint/build **PASS**;
Chrome HTTP mô phỏng preview **32/32** (gồm các ca hồi quy Monitor cũ); Chrome API thật development
**6/6** và preview **6/6**; unit hồi quy LIS **43/43**. Các browser run không có JS/interception errors,
request đều GET. Không dùng số kiểm thử backend hay browser LIS của lượt trước để nhận là đã chạy lại
trong bản sửa này; không chạy lại backend vì API/source backend không đổi.

Trên `http://127.0.0.1:5174/#/exchanges`, nhập **`mimic-lab-100145`** và tìm:
Network gửi `source_result_id=MIMIC-LAB-100145` (kèm status DELIVERED trong ca nghiệm thu), trả đúng:

- Exchange ID `83f1998d-1600-43a7-8391-2ade7649e55c`.
- Event ID `11548e2d-df26-4967-854a-bb6ad238547a`.
- Mã nguồn gốc `MIMIC-LAB-100145`, trạng thái Middleware `DELIVERED`.

Các biến thể viết hoa/thường/xen kẽ/trim trả cùng ID; READY/FINAL/ACK không được dùng thay trạng thái MW.
Preview 4174 được kiểm tra cùng kết quả; server preview do test tạo đã đóng sau kiểm thử.
Không cần rebuild/recreate backend. Dev server đang chạy nhận thay đổi frontend qua Vite.

[Bằng chứng bản sửa, gồm Network/DOM trước và sau](../frontend/apps/middleware-monitor/tests/evidence/acceptance/mimic-search-2026-11-05/verification.json).
Raw logs được ghi thư mục mới `tests/evidence/mimic-search-2026-11-05/`, không ghi đè bằng chứng cũ.
Đối chiếu SHA-256 với acceptance trước bản sửa: chỉ sáu file nêu trên thay đổi;
backend/LIS/EMR/Worker và phần triển khai khác giữ nguyên. Mọi thao tác trên dịch vụ thật chỉ GET;
không sửa database, schema, repository, Compose hoặc volume.
Git vẫn ở `feature/frontend/lis-emr-ui`, HEAD `9b7024a`, index trống; `git diff --check` đạt.
Giữ nguyên các thay đổi đang dở; không stage/commit/push/merge.
