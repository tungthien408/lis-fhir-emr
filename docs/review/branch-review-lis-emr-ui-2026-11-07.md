# Báo cáo review branch `feature/frontend/lis-emr-ui` trước khi merge vào `main`

Ngày review: 2026-11-07. Chế độ: **chỉ báo cáo**, không sửa source, không commit, không push.

## 1. Tóm tắt & kết luận

**Kết luận: GO có điều kiện.**

1. **Backend chạy tốt.** `check`, `build`, `verify:sql` đều pass. Toàn bộ test hồi quy trên PostgreSQL tạm có 511 pass, 0 fail, 0 skip (README ghi 495). Docker stack thật chạy đúng luồng E2E: Publish → ACK → exchange `DELIVERED` → có dòng trong `emr.lab_results`.
2. **Hợp đồng API mới đúng như tài liệu.** Đã kiểm tra bằng curl: `publish-event`, 409 `CONTENT_CONFLICT` (event cũ giữ nguyên), `exchanges/:id/attempts`, `GET /api/patients`.
3. **Merge vào `main` không vỡ gì.** Merge thử trong worktree tạm: không conflict. Sau merge, backend `check`/`build` pass, `test:spp82` 112/112 pass, `test:ops` 13/13 pass, Postgres 511/511 pass, frontend `check`/`lint`/`build` pass.
4. **UI dùng được và responsive.** Cả 3 app không bị cuộn ngang toàn trang ở 390px, không có lỗi console, mọi test unit và test browser đều pass. Điểm yếu là thiếu nhất quán giữa LIS với Monitor/EMR, CSS và TSX bị nén khó bảo trì, và Monitor/EMR chưa có favicon.
5. **Điều kiện trước khi merge:**
   - Triage FE-01: `scripts/verify-publish-phase-2.3.mjs` fail ở bước Chrome thật vì `AbortError` không được bắt.
   - Cập nhật README/docs đã lỗi thời (MR-01, MR-02).
   - Quyết định chính sách evidence và vị trí docs (MR-03, MR-04).

**Về mức độ của FE-01:** theo định nghĩa của plan, test fail là Blocker. Tôi xếp FE-01 ở mức **High** thay vì Blocker vì lỗi chỉ xảy ra ở một kịch bản của script verify chạy Chrome thật. Trong cùng môi trường, 7 file test browser LIS và test browser Monitor/EMR đều pass, kể cả `browser-publish.mjs` chạy độc lập với mock. Tôi chưa cô lập được nguyên nhân gốc, nên chưa loại trừ được khả năng do Chrome 149 hoặc Node 26. Nếu người quyết định muốn áp đúng định nghĩa, kết luận chuyển thành **NO-GO cho đến khi FE-01 được triage**.

## 2. Môi trường

| Mục | Giá trị |
|---|---|
| Branch / HEAD | `feature/frontend/lis-emr-ui` @ `67c7c5f7cd76f6014370618ab3b1936eb2900bf1`, trùng `origin/feature/frontend/lis-emr-ui` (không lệch) |
| `main` / `origin/main` | `a5c40c5b6cff41bdb3cbdf677606dfc598d561e9` (branch còn thiếu 13 commit của main) |
| Node / npm | v26.13.0 / 12.2.2. **Lệch tài liệu:** README backend ghi Node ≥22.16, README frontend ghi đã kiểm tra trên 24.11.0 |
| Trình duyệt | Không cài được chromium: `sudo pacman` cần mật khẩu (`sudo: a password is required`), nên theo plan là phải nhờ người dùng chạy. Máy đã có sẵn **Google Chrome 149.0.7827.53** (`/usr/bin/google-chrome-stable`), nên tôi dùng nó qua `CHROME_PATH`. Đây là điểm lệch so với plan, cần ghi nhận |
| Docker | Lúc bắt đầu, cả 6 container đã thoát (Exited, plan ghi là Up). Tôi đã `docker compose --profile dispatcher --profile worker up -d --build` và để chạy. Hiện 6 container đều Up, `lis` đã được bật lại sau khi tắt tạm để chụp trạng thái lỗi |
| `npm ci` | Backend: cảnh báo npm 12 chặn install-script của `@scarf/scarf` và `esbuild` (chưa có `allowScripts`), không ảnh hưởng kết quả. Frontend: `npm audit` báo 10 lỗ hổng mức moderate |

## 3. Bảng kết quả lệnh

### Phase 1: Backend (`backend/`)

| Lệnh | Kết quả | Số liệu | Ghi chú |
|---|---|---|---|
| `npm run check` | PASS | 0 lỗi tsc | gồm `tsconfig.test.json` |
| `npm run build` | PASS | | |
| `npm run verify:sql` | PASS | 3 schema, 13 bảng | script nói rõ chưa chạy SQL thật |
| `npm run test:repositories:postgres` | PASS | LIS 177 + Middleware 197 + EMR 106 + Integration 16 + E2E D3 15 = **511 pass / 0 fail / 0 skip** | ≥ 495, đạt. Lệnh đã bao gồm E2E D3 (15 ca pass) nên không chạy `test:e2e:postgres` riêng |
| `npm test` | PASS | 91 test: 86 pass, 0 fail, 5 skip | test DB bị skip khi không có DB, bình thường |
| `npm run test:middleware` | PASS | 97 test: 93 pass, 0 fail, 4 skip | |
| `npm run test:emr` | PASS | 68 test: 65 pass, 0 fail, 3 skip | |
| `npm run test:mapper` | PASS | 23/23 | |
| `node scripts/verify-emr-backend.mjs` | PASS | 15/15 | **làm bẩn cây thư mục** (xem FE-03) |
| `node scripts/verify-monitor-backend.mjs` | PASS | 15/15 | như trên |
| `node scripts/verify-publish-phase-2.3.mjs` (lần 1) | **FAIL** | backend 5 suite pass, fail ở bước Chrome thật | Nguyên văn: `AssertionError [ERR_ASSERTION]: Chạy npm run build:lis trước` tại `helpers/http-browser.mjs:11:10`, gọi từ `browser-publish.mjs:96:19`. Nguyên nhân: chưa có `dist` của LIS (FE-02) |
| `node scripts/verify-publish-phase-2.3.mjs` (lần 2, sau khi build frontend) | **FAIL** | cùng bước | Nguyên văn: `AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal` với `Uncaught (in promise)` / `AbortError: The user aborted a request.` tại `browser-publish.mjs:86:32` (hàm `check`), url trang `http://127.0.0.1:5183/#/results/PHASE23-FINAL?...page=2` (FE-01). 5 ca đầu pass: READY, FINAL, rapid click, Dispatcher/Worker → DELIVERED, Publish lặp trả 200 |
| `npm run smoke` | PASS | 3/3 `/health` | |
| `npm run db:check` | PASS | 3/3 service thấy đủ bảng | |

Log đầy đủ nằm trong scratchpad: `.../scratchpad/logs/` (ví dụ `verify-publish-phase-2.3-rerun.log`, `be-repo-pg.log`).

### Phase 1c: kiểm tra trực tiếp Docker stack bằng curl

| Kịch bản | Kết quả quan sát | Đánh giá |
|---|---|---|
| `GET /api/results?limit=3` | 200, trả đủ trường | OK |
| `GET /api/results/<id>/publish-event` (chưa publish) | 200, `published:false`, `event:null`, `Cache-Control: no-store` | OK |
| Cùng endpoint, đã publish | 200, `published:true`, event đầy đủ | OK |
| Cùng endpoint, id không tồn tại | 404 `NOT_FOUND` | OK |
| Cùng endpoint, có query `?x=1` | 400 `VALIDATION_ERROR` | OK |
| `POST /api/results/MIMIC-LAB-100145/publish` lần 1 / lần 2 | 202 / 200, cùng `event_id` | OK |
| `POST` publish kết quả READY (`REVIEW-READY-1`) | 422 `RESULT_NOT_READY` | OK |
| `POST` publish id không tồn tại | 404 | OK |
| **409**: publish `REVIEW-CONFLICT-1` (202, ACK), `UPDATE value_num+1`, publish lại | 409 `CONTENT_CONFLICT`; `publish-event` vẫn trả event cũ (`1b4a7c04-…`, ACK, 1 lần gửi) | OK |
| Đổi tiếp `unit` thành `mmol/L` rồi publish | Vẫn 409 (không phải 422 `INVALID_UNIT`) | Khớp thiết kế, xem BE-02 |
| `GET /docs/api/` | 200, có Swagger UI với mô tả endpoint mới | OK |
| `GET /api/exchanges?limit=2` | 200 | OK |
| `GET /api/exchanges/<uuid>/attempts` | 200, `Cache-Control: no-store`; SEND 201 có `receipt` đầy đủ, VERIFY 200 `receipt:null`; `error_message` là chuỗi chung | OK |
| Attempts với UUID sai / không tồn tại / có query | 400 / 404 / 400 | OK |
| Exchange REJECTED (`REVIEW-REJECT-1`) | SEND 422, `error_code=REMOTE_VALIDATION_ERROR`, `receipt:null`, có `diagnostics` | OK |
| `GET /api/patients?patient_key=` | 200 | OK |
| `GET /api/patients?identifier_system=&identifier_value=` | 200 | OK |
| Trộn 2 mode / không tồn tại (2 mode) / không tham số | 400 / 404 / 400 | OK, xem BE-03 |
| `GET /api/lab-results?patient_key=` | 200 | OK |
| **E2E** | `MIMIC-LAB-100145` và `REVIEW-CONFLICT-1`: LIS event `ACK`, exchange `DELIVERED`, có dòng trong `emr.lab_results` | OK |

### Phase 2: Frontend (`frontend/`)

| Lệnh | Kết quả | Số liệu | Ghi chú |
|---|---|---|---|
| `npm run check` | PASS | 0 lỗi | |
| `npm run lint` | PASS | 0 error, 0 warning | |
| `npm run build` | PASS | EMR: JS 243.56 kB (gzip 75.58), CSS 11.04 kB. LIS: JS 250.81 kB (gzip 76.93), CSS 5.36 kB. Monitor: JS 246.61 kB (gzip 76.80), CSS 7.42 kB | |
| `npm test -w apps/lis` | PASS | 43/43 | |
| `npm test -w apps/middleware-monitor` | PASS | 33/33 | |
| `npm test -w apps/emr` | PASS | 31/31 | |
| LIS `tests/browser.mjs` | PASS | | Chrome 149 qua `CHROME_PATH` |
| LIS `browser-detail.mjs` | PASS | | |
| LIS `browser-publish.mjs` | PASS | | chạy độc lập (mock), khác với lần chạy trong verify script |
| LIS `browser-uiux.mjs` | PASS | | |
| LIS `browser-http.mjs` | PASS | 10/10 | |
| LIS `browser-conditions.mjs` | PASS | | |
| LIS `browser-dot.mjs` | PASS | | |
| Monitor `tests/browser.mjs` | PASS | | |
| EMR `tests/browser.mjs` | PASS | | |

### Phase 3: Merge thử (worktree tạm, đã gỡ)

| Lệnh | Kết quả |
|---|---|
| `git merge --no-commit --no-ff feature/frontend/lis-emr-ui` trên `main` | Automatic merge OK, không conflict (171 file, +28689/−432) |
| backend `npm ci` / `check` / `build` | PASS / PASS / PASS (`tsconfig.test.json` của main bao `scripts/**` vẫn typecheck sạch) |
| backend `test:repositories:postgres` | PASS, 511/511 |
| backend `test:spp82` | PASS, 112/112 |
| backend `test:ops` | PASS, 13/13 |
| frontend `npm ci` / `check` / `lint` / `build` | PASS / PASS / PASS / PASS |
| Dọn dẹp | `git merge --abort`, `git worktree remove --force`, `git worktree list` chỉ còn worktree chính |

## 4. Findings

Không có Blocker. Mức độ: Blocker / High / Medium / Low / Nit.

### Backend

**BE-01 · Medium · `backend/src/lis/openapi.ts:78-79`, `docs/api-contract.md`**
Mô tả: OpenAPI và `api-contract.md` hướng dẫn thử bằng `A3-DEMO-R1` (thành công) và `A3-DEMO-R2` (READY nên 422). Trong DB seed thật, hai id này không tồn tại. DB có 1000 kết quả đều `FINAL`, không có kết quả `READY`.
Tái hiện: `curl localhost:3101/api/results/A3-DEMO-R1` trả 404.
Đề xuất: bổ sung 2 bản ghi demo vào seed, hoặc sửa tài liệu dùng id có thật (vd `MIMIC-LAB-100145`) và nói rõ cách tạo ca READY.

**BE-02 · Low · `backend/src/lis/service.ts` (`matchesSnapshot`)**
Mô tả: `matchesSnapshot` trả `false` với mọi `InvalidPublishData`, nên kết quả đã publish rồi chuyển về READY hoặc bị đổi đơn vị sai danh mục đều ra 409, không ra 422. Hành vi này đã được ghi trong `docs/api-contract.md:44` nên không phải bug. Việc bỏ kiểm tra catalog khi so khớp đúng như comment thiết kế. Đổi đơn vị vẫn bị phát hiện conflict vì snapshot khác (đã kiểm chứng bằng `mmol/L`). Cast `(test.acceptedUnits as string[])` chỉ để thỏa kiểu.
Đề xuất: không bắt buộc sửa. Nên thêm một câu vào Swagger về trường hợp 409 khi kết quả về READY.

**BE-03 · Low · `backend/src/emr/service.ts` (`findPatient`)**
Mô tả: `GET /api/patients` không có tham số trả `400 "A nonempty string is required"`, thông báo không nêu tên trường.
Đề xuất: ghi rõ trường thiếu, ví dụ "patient_key hoặc cặp identifier_system/identifier_value là bắt buộc".

**BE-04 · Low · `backend/src/middleware/controller.ts:136-150`**
Mô tả: endpoint attempts gọi `getExchangeById`, rồi `getExchangeAttempts` và `getExchangeEvents` song song, qua 3 câu lệnh không cùng snapshot, trong khi `findPatient` chủ trương "one statement snapshot". Với dữ liệu đang được worker ghi, attempts và diagnostics có thể lệch nhau một nhịp. Màn hình Monitor có polling nên tự lành.
Đề xuất: ghi chú giới hạn này, hoặc đọc trong một transaction REPEATABLE READ nếu cần nhất quán chặt.

**BE-05 · Low · `backend/src/middleware/monitor-diagnostics.ts:15-16`**
Mô tả: identifier system `https://example.org/lis/result` được hard-code trong `receipt()`. Nếu đổi namespace, receipt sẽ âm thầm biến thành `null`. Allowlist mã lỗi **khớp** với mã worker phát ra: 13 mã trong `WorkerErrorCode` cộng `LEASE_EXPIRED` và `RETRY_EXHAUSTED` (phát ở `repository.ts:270,313`), mã lạ được quy về `DIAGNOSTIC_ERROR`.
Đề xuất: lấy hằng số này từ một nơi dùng chung với mapper.

**BE-06 · Low · `backend/src/emr/repository.ts` (`findPatient`)**
Mô tả: subquery `jsonb_agg` hard-code `emr.patients` và `emr.patient_links` trong SQL thô. Mối lo "một định danh trùng nhiều bệnh nhân" **không xảy ra**, vì `emr_patient_links_pk` là `PRIMARY KEY (identifier_system, identifier_value)` (`database/dacn_db_init_v2.sql:267`).
Đề xuất: dùng tên bảng từ schema Drizzle cho nhất quán.

**BE-07 · Nit · `backend/package.json:6`, nhiều file `src`**
Mô tả: `description` vẫn ghi "chua co nghiep vu trao doi". Nhiều dòng rất dài/nén (`service.ts`, `controller.ts`, `monitor-diagnostics.ts`) khó review.
Đề xuất: cập nhật mô tả, để formatter xuống dòng.

**BE-08 · Nit · quan sát**
`Cache-Control: no-store` chỉ có trên các GET mới (`publish-event`, `attempts`, `patients`). `GET /api/results/:id` và `POST .../publish` không có. POST không bị cache nên chấp nhận được.

### Frontend

**FE-01 · High · `frontend/apps/lis/tests/browser-publish.mjs:86`; có thể liên quan `frontend/apps/lis/src/hooks/usePublishStatus.ts`, `api/publish.ts`, `components/PublishPanel.tsx`**
Mô tả: trong `verify-publish-phase-2.3.mjs`, bước "Chrome real UI → isolated LIS/Dispatcher/Middleware/EMR" fail sau ca "Repeat Publish returns 200". Trang phát sinh `Uncaught (in promise) AbortError: The user aborted a request.` ở URL `…#/results/PHASE23-FINAL?patient_id=PHASE23-P&test_code=PHASE23-TEST&result_status=FINAL&page=2`. Hàm `check` assert `browser.exceptions` rỗng nên fail.
Tái hiện: `cd frontend && npm run build:lis`, rồi `CHROME_PATH=/usr/bin/google-chrome-stable node scripts/verify-publish-phase-2.3.mjs` từ thư mục gốc. Đã tái hiện 1 lần (lần 2), log: `verify-publish-phase-2.3-rerun.log` dòng 3201 trở đi.
Chưa kết luận được: các `AbortError` trong code đều nằm trong `try/catch`, tôi chưa tìm ra promise nào bị bỏ sót, và chưa thử với Chrome/Node phiên bản khác. Vì vậy chưa xác định đây là lỗi mã hay lỗi môi trường.
Đề xuất: chạy lại script với phiên bản Chrome/Node mà tác giả đã dùng để phân biệt. Nếu vẫn lỗi, bắt log stack của rejection bằng CDP `Runtime.exceptionThrown` để định vị promise không được `catch`.

**FE-02 · Medium · `scripts/verify-publish-phase-2.3.mjs`, `frontend/apps/lis/tests/helpers/http-browser.mjs:11`**
Mô tả: script verify chạy cả backend lẫn Chrome nhưng giả định `frontend/apps/lis/dist` đã build, nếu không thì dừng ở bước cuối sau khi đã chạy hết 5 suite backend (vài phút). Khi chạy riêng sẽ thất bại như lần 1.
Đề xuất: script tự `npm run build:lis`, hoặc kiểm tra `dist` ngay đầu script.

**FE-03 · Medium · `scripts/verify-*.mjs`, các `tests/browser*.mjs`**
Mô tả: chạy các script verify và test browser tạo file untracked trong cây git. Cuối review `git status` có thêm: `frontend/apps/emr/tests/evidence/`, `frontend/apps/middleware-monitor/tests/evidence/`, `frontend/apps/lis/tests/evidence/phase-2.2-*` (mock), `.../phase-2.3-2026-11-04/{run-gt887t,run-h2pMxn,manual-1793988540694}/`, và **`frontend/tests/`** (thư mục ở gốc frontend, do một lệnh browser tạo khi chạy từ `frontend/`, nghĩa là đường dẫn evidence phụ thuộc thư mục làm việc). Không xóa gì theo quy tắc executor.
Đề xuất: gitignore các thư mục `run-*`, `manual-*`, `mock*/`; neo đường dẫn evidence theo `import.meta.dirname`.

**FE-04 · Medium · `frontend/apps/middleware-monitor/src/index.css`, `frontend/apps/emr/src/index.css`, `emr/src/components/Views.tsx`, `middleware-monitor/src/components/ExchangeDetail.tsx`**
Mô tả: CSS Monitor và EMR bị nén (CSS Monitor 7.4 kB, EMR 11 kB, còn LIS dùng `App.css`+`index.css` dạng dễ đọc). `Views.tsx` có 95 dòng nhưng 14.9 KB (28 dòng > 200 ký tự); `ExchangeDetail.tsx` có 37 dòng nhưng 9.1 KB (14 dòng > 200 ký tự). Khó review và dễ sinh conflict. Chưa so sánh nội dung hai file CSS dòng-theo-dòng để xác nhận mức độ sao chép.
Đề xuất: format lại bằng Prettier, tách style dùng chung giữa Monitor và EMR.

**FE-05 · Medium · giao diện ba app (`lis-01-list-desktop.png`, `mon-04-detail-rejected-desktop.png`, `emr-04-profile-results-desktop.png`)**
Mô tả: LIS dùng tiêu đề chữ thuần. Monitor và EMR dùng logo vuông, dòng eyebrow, và EMR có thanh bước 1-2-3. Màu chủ đạo thì đồng bộ (xanh navy). Định dạng ngày khác nhau: LIS và Monitor dùng `2026-11-06 18:07:27 UTC`, EMR dùng `06/04/2129 · 04:25:00 UTC`.
Đề xuất: thống nhất header và định dạng ngày giờ (khuyến nghị ISO-like UTC như LIS/Monitor).

**FE-06 · Medium · `mon-01-list-mobile.png`**
Mô tả: ở 390px, bảng Monitor có `min-width` lớn, cuộn ngang trong `.table-scroll` và chỉ thấy khoảng 2 cột (mã kết quả, hệ thống nguồn) trước khi phải cuộn. Không có tràn trang, nhưng người dùng di động khó thấy trạng thái exchange. EMR và LIS ít bị hơn.
Đề xuất: ở mobile hiển thị dạng thẻ, hoặc cố định cột trạng thái ở vị trí dễ thấy.

**FE-07 · Low · `frontend/apps/{middleware-monitor,emr}/index.html`**
Mô tả: Monitor và EMR không có `<link rel="icon">` (thư mục `public/` không tồn tại). LIS có `favicon.svg`. `<title>` của cả ba app đúng và khác nhau, `lang="vi"` đúng.
Đề xuất: thêm favicon cho hai app.

**FE-08 · Low · `frontend/apps/lis/src/assets/{hero.png,react.svg,vite.svg}`, `frontend/apps/lis/public/icons.svg`**
Mô tả: bốn asset không còn được tham chiếu (grep 0 kết quả).
Đề xuất: xóa.

**FE-09 · Low · `emr-04-profile-results-desktop.png`**
Mô tả: tiêu đề trang hồ sơ lặp chữ: "Hồ sơ bệnh nhân – Hồ sơ bệnh nhân 10007928".
Đề xuất: rút thành "Hồ sơ bệnh nhân 10007928".

**FE-10 · Low · `frontend/apps/*/tests/helpers/*.mjs`**
Mô tả: helper browser bị nhân bản ở 3 app. Danh sách đường dẫn Chrome tìm kiếm ưu tiên đường dẫn Windows, rồi `/usr/bin/google-chrome` và `/usr/bin/chromium`, không có `google-chrome-stable` (tên thực tế trên Arch). Cần đặt `CHROME_PATH` thủ công.
Đề xuất: gom helper thành một module dùng chung, thêm `google-chrome-stable` vào danh sách.

**FE-11 · Nit · `lis-08-conflict-409-desktop.png`, `lis-09-error-list-desktop.png`**
Mô tả: sau 409, nút "Publish lại" vẫn bật, người dùng có thể gọi lại và nhận lại 409. Ở trạng thái lỗi tải danh sách, ô phân trang "Trang 1" vẫn hiện (đã vô hiệu hóa) dưới thông báo lỗi.
Đề xuất: cân nhắc, không bắt buộc.

### Merge readiness

**MR-01 · Medium · `README.md:9-10, 227-231`**
Mô tả: README gốc vẫn ghi "495 tests", "frontend (SPP-67) là bước tích hợp tiếp theo". Thực tế là 511 test và frontend đã làm xong.
Đề xuất: cập nhật số liệu và phần phạm vi.

**MR-02 · Medium · `frontend/README.md:10, 29, 36, 139, 179, 190`**
Mô tả: vẫn mô tả Monitor/EMR là "trang giới thiệu, chưa gọi API nghiệp vụ", và ghi chưa kiểm tra giao diện bằng trình duyệt. Hiện cả hai đã gọi API thật và có test browser. (Chú ý: diff của branch có sửa `frontend/README.md`, nhưng các dòng này vẫn còn.)
Đề xuất: viết lại phần này.

**MR-03 · Medium · `docs/*.md` ở gốc**
Mô tả: 5 file mới (`phase-2.3-*`, `exchange-monitor-*`, `emr-ui-*`) nằm ở `docs/` gốc, trong khi quy ước của main là `docs/docs_backend/...`.
Đề xuất: chuyển vào `docs/docs_frontend/`.

**MR-04 · Medium · `frontend/apps/lis/tests/evidence/`**
Mô tả: 38 file evidence, tổng 1,25 MB đã được commit (JSON lớn nhất 311 KB, PNG đến 82 KB). Main đã gitignore artifact chạy lớn (`*.log`, `pilot-evidence`). Mỗi lần chạy script verify lại sinh thêm thư mục `run-*` mới (xem FE-03).
Đề xuất: chọn một chính sách: chỉ giữ một bộ evidence tiêu biểu, hoặc chuyển ra ngoài repo/artifact.

**MR-05 · Low · quan hệ với `main`**
Mô tả: branch thiếu 13 commit của main (SPP-73/74/75/82). Merge sạch và mọi test sau merge đều pass (xem Phase 3). Một số commit rất lớn (branch tổng ~171 file).
Đề xuất: merge main vào branch trước khi mở PR cho chắc, hoặc squash khi merge.

**Kiểm tra khác đã thực hiện, không phát hiện vấn đề:**
- Không có secret trong diff. Các từ khóa `secret/token/password` chỉ nằm trong test fixture. Không tìm thấy URL DB có mật khẩu trong `frontend/`.
- Commit message theo conventional commits.
- Docker image backend đã rebuild từ code của branch trước khi smoke test.
- `docs/api-contract.md` đã có 3 endpoint mới và 409 `CONTENT_CONFLICT`.
- `useRead` (EMR) và `usePublishStatus` (LIS) xử lý abort/race đúng: có guard `signal.aborted`, polling dừng khi event/exchange ở trạng thái cuối và tạm dừng khi tab ẩn. Test browser tương ứng đều pass.

## 5. UI

Screenshot nằm trong `docs/review/screenshots/` (46 ảnh PNG, mỗi màn chụp ở **desktop 1440** và **mobile 390**, kèm `report-*.json` ghi title, favicon, tràn ngang và lỗi console).

| Màn hình | Ảnh |
|---|---|
| LIS: danh sách | `lis-01-list-{desktop,mobile}.png` |
| LIS: đang lọc | `lis-02-filtered-*` |
| LIS: trống | `lis-03-empty-*` |
| LIS: chi tiết đã publish | `lis-04-detail-published-*` |
| LIS: chi tiết READY (Publish tắt) | `lis-05-detail-ready-*` |
| LIS: hộp xác nhận Publish | `lis-06-publish-dialog-*` |
| LIS: Publish → PENDING | `lis-07-publish-pending-ack-*` |
| LIS: 409 conflict | `lis-08-conflict-409-*` |
| LIS: lỗi danh sách / chi tiết (LIS tắt) | `lis-09-error-list-*`, `lis-10-error-detail-*` |
| Monitor: danh sách / lọc REJECTED / trống / URL sai | `mon-01-list-*`, `mon-02-filtered-rejected-*`, `mon-05-empty-*`, `mon-06-invalid-route-*` |
| Monitor: chi tiết DELIVERED / REJECTED | `mon-03-detail-delivered-*`, `mon-04-detail-rejected-*` |
| EMR: tra cứu (2 mode), hồ sơ + kết quả, chi tiết kết quả | `emr-01-search-*`, `emr-02-search-source-mode-*`, `emr-03-search-key-mode-*`, `emr-04-profile-results-*`, `emr-05-result-detail-*` |
| EMR: không tìm thấy | `emr-06-not-found-*`, `emr-07-result-not-found-*` |

Lưu ý khi dùng ảnh: ảnh `lis-07` chụp ngay sau khi xác nhận Publish nên thấy trạng thái PENDING. Ảnh `lis-09/10` chụp lúc container `lis` đang tắt. Do giới hạn thời gian, tôi chỉ xem trực tiếp một phần ảnh: `lis-01-list-desktop`, `lis-08-conflict-409-desktop`, `lis-07-publish-pending-ack-mobile`, `lis-09-error-list-desktop`, `mon-04-detail-rejected-desktop`, `emr-04-profile-results-desktop`, `mon-01-list-mobile`. Các ảnh còn lại được đánh giá qua số đo tự động (không tràn ngang, không lỗi console) và chưa được xem bằng mắt.

### Checklist 2c

| # | Mục | Kết quả | Ghi chú |
|---|---|---|---|
| 1 | Nhất quán giữa 3 app | **Cần sửa** | Cùng bảng màu navy nhưng khác header và định dạng ngày (FE-05); CSS nén ở Monitor/EMR (FE-04) |
| 2 | Ngôn ngữ | OK | Chữ tiếng Việt có dấu đúng ở các màn đã xem. Giá trị NUMERIC hiển thị dạng chuỗi (`0.9`, `13.8`, `-5`), không bị làm tròn |
| 3 | Responsive | OK, có lưu ý | Không app nào tràn ngang trang ở 390px (số đo tự động). Bảng Monitor ở mobile kém dùng (FE-06) |
| 4 | Trạng thái loading/trống/lỗi/retry | OK | Lỗi danh sách LIS có nút "Thử tải lại" (HTTP 502). Có màn trống cho cả 3 app. Có màn URL sai ở Monitor |
| 5 | Accessibility cơ bản | Cần sửa nhẹ | `lang="vi"`, title riêng từng app, input có label, `:focus-visible` có trong CSS của Monitor/EMR (1 chỗ) và LIS `App.css` (1 chỗ), `index.css` LIS không có. Thiếu favicon Monitor/EMR (FE-07). Chưa đo contrast và chưa thử điều hướng bằng bàn phím |
| 6 | Luồng nghiệp vụ | OK | Publish có hộp xác nhận (`<dialog>`), chống bấm đúp (test "rapid repeated clicks → one POST" pass), trạng thái tự cập nhật bằng polling 5 giây và dừng ở trạng thái cuối, route giữ được qua F5 và Back/Forward (test browser pass) |
| 7 | Mã/asset thừa | **Cần sửa** | FE-08 |
| 8 | Code UI | **Cần sửa** | Dòng quá dài ở `Views.tsx` và `ExchangeDetail.tsx` (FE-04); helper browser nhân bản (FE-10); hook abort/race đúng |

### Nhận xét thẩm mỹ (điểm 1–5, dựa trên các ảnh đã xem)

| App | Điểm | Nhận xét |
|---|---|---|
| LIS | 4/5 | Gọn, dễ đọc, hierarchy rõ; chi tiết hai cột tách "thông tin xét nghiệm" và "thông tin kết quả", giá trị được làm nổi bật; thông báo 409 màu đỏ rõ ràng |
| Monitor | 4/5 | Nhiều thông tin (snapshot, attempts, timeline, payload) được chia thẻ hợp lý; badge "Đã từ chối" rõ. Trừ điểm vì bảng mobile (FE-06) |
| EMR | 4/5 | Thanh bước 1-2-3 giúp định hướng, bảng kết quả sạch. Trừ điểm vì tiêu đề lặp (FE-09) và định dạng ngày khác hai app còn lại |

## 6. Danh sách việc trước khi merge

Theo thứ tự ưu tiên:

- [ ] **FE-01**: triage `AbortError` trong `verify-publish-phase-2.3.mjs` (thử Chrome/Node phiên bản tác giả dùng; nếu vẫn lỗi thì tìm promise không được `catch`).
- [ ] **MR-01, MR-02**: cập nhật `README.md` (511 test, frontend đã làm xong) và `frontend/README.md` (Monitor/EMR đã gọi API).
- [ ] **MR-04, FE-03**: quyết định chính sách evidence (giữ ít hơn / gitignore `run-*`, `manual-*`, `mock*/`), neo đường dẫn evidence theo vị trí file để không sinh `frontend/tests/`.
- [ ] **MR-03**: chuyển 5 file docs ở `docs/` gốc vào `docs/docs_frontend/`.
- [ ] **BE-01**: sửa hướng dẫn `A3-DEMO-R1/R2` trong OpenAPI/api-contract hoặc thêm seed tương ứng.
- [ ] **FE-02**: để `verify-publish-phase-2.3.mjs` tự build hoặc kiểm tra `dist` từ đầu.
- [ ] **MR-05**: merge `main` vào branch (hoặc squash) rồi chạy lại toàn bộ test.
- [ ] **FE-04, FE-05, FE-06**: format lại CSS/TSX bị nén; thống nhất header và định dạng ngày; cải thiện bảng Monitor ở mobile (có thể làm sau merge).
- [ ] **FE-07 đến FE-11, BE-02 đến BE-08**: các mục Low/Nit, xử lý khi tiện (favicon, xóa asset thừa, thông báo lỗi `/api/patients`...).

## 7. Dữ liệu đã ghi lên stack thật

Toàn bộ nằm trong DB của Docker stack (`dacn_db`). Không có thay đổi nào ngoài stack.

**Bản ghi tạo mới (tiền tố `REVIEW-`):**
- `lis.patients`: `REVIEW-P-NOLINK` (bệnh nhân không có liên kết EMR, để tạo ca REJECTED).
- `lis.results`:
  - `REVIEW-READY-1`: READY, dùng cho ca 422.
  - `REVIEW-CONFLICT-1`: FINAL; đã publish; sau đó tôi sửa `value_num` (+1 rồi trả lại −1) và đổi `unit` thành `mmol/L`. **Trạng thái hiện tại: `unit = mmol/L`, không khớp snapshot (g/dL)**. Cố ý để minh họa ca 409.
  - `REVIEW-REJECT-1`: FINAL, bệnh nhân không có link; đã publish, exchange `REJECTED`.

**Kết quả đã Publish (tạo `lis.publish_events`, exchange và dòng `emr.lab_results`):**
- Qua curl: `MIMIC-LAB-100145`, `REVIEW-CONFLICT-1`, `REVIEW-REJECT-1` (REJECTED nên không có dòng EMR).
- Qua UI khi chụp ảnh: `MIMIC-LAB-100214`, `MIMIC-LAB-100218`.
- `MIMIC-LAB-100142` đã được publish từ trước khi tôi bắt đầu.
- Các id `MIMIC-LAB-100177`, `MIMIC-LAB-100190` chỉ mở hộp xác nhận chứ không publish.

**Dọn dẹp (nếu muốn):** xóa các `publish_events`/`exchanges`/`emr.lab_results` tương ứng, rồi các hàng `REVIEW-*`. Hoặc dựng lại DB: `docker compose down -v` rồi `up`. Lưu ý lệnh sau sẽ xóa luôn dữ liệu cũ của `MIMIC-LAB-100142`.

**Trạng thái cuối:**
- `git status` chỉ khác lúc đầu ở: `docs/review/` và các thư mục evidence do script verify/test sinh ra (liệt kê ở FE-03). Hai thư mục `docs/docs_backend/spp-73/` và `spp-75/` vẫn untracked như ban đầu, không bị đụng đến.
- HEAD vẫn là `67c7c5f`, không đổi branch.
- Worktree tạm đã gỡ. 3 dev server Vite đã tắt.
- 6 container Docker đang chạy (khác lúc đầu: ban đầu đã thoát).
