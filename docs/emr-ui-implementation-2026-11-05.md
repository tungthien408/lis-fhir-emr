# EMR — Triển khai giao diện và tra cứu hồ sơ chỉ đọc

Ngày 05/11/2026, Asia/Bangkok. Nhánh `feature/frontend/lis-emr-ui`, baseline `387a139`.
Triển khai từ khảo sát EMR đã chốt; không khảo sát lại toàn bộ dự án, không stage/commit/push/merge.

## 1. Chức năng đã triển khai

Frontend `frontend/apps/emr/`, React19/TypeScript/Vite; không thêm dependency.

- Tra cứu bệnh nhân theo mã nguồn LIS hoặc UUID EMR; Tìm kiếm/Enter, Xóa tìm kiếm, Làm mới.
  Gõ chưa gọi API; màn hình ban đầu không phát truy vấn danh sách toàn bộ.
- Namespace bệnh nhân xác nhận từ service/schema/seed và GET thật: `https://example.org/lis/patient`.
  Input trim đầu/cuối; chỉ MIMIC-P/MIMIC-LAB hậu tố số được chuẩn hóa viết hoa, giữ số 0 đầu.
  Không biến đổi mã tùy ý hoặc định danh nhận từ API. Control/UUID/query sai được từ chối.
- Hồ sơ hiển thị display_label mô phỏng, patient_key, định danh nguồn và namespace thực có.
  Không thêm tuổi/giới tính/chẩn đoán hoặc liên kết bằng tên.
- Danh sách đúng patient_key, giữ thứ tự `effective_at DESC, target_id ASC` của backend;
  20 dòng hiển thị/GET limit21, offset theo trang; không total hoặc tổng trang giả.
  Có trạng thái hồ sơ tồn tại nhưng không có kết quả trên trang đang xem.
- Chi tiết có xét nghiệm, mã, giá trị, đơn vị, cận, final, định danh nguồn/target/patient,
  hồ sơ liên quan, ba mốc thời gian và FHIR thu gọn mặc định (vùng xem tối đa 320px).
- Mở trực tiếp mã kết quả nguồn LIS; chi tiết dùng đúng external_system + external_id,
  không trộn patient_key/limit/offset vào request đó.
- GET chi tiết phải có đúng một item; 0 báo không tìm thấy, >1 báo không nhất quán.
  Kết quả phải khớp cặp nguồn và patient_key ngữ cảnh; FHIR subject phải khớp liên kết hồ sơ.
  Sai identity/khác hồ sơ/JSON/schema sai không được hiển thị như dữ liệu hợp lệ.
- Hash `/search`, `/patients/<uuid>`, `/result?external_system=...&external_id=...` lưu tiêu chí,
  patient_key ngữ cảnh và page; F5/URL trực tiếp/Back/Forward tự GET đúng dữ liệu.
  Mã nguồn đặc biệt dùng query encoding, không phụ thuộc React state tạm thời.
- Loading/empty/error/retry GET, AbortController và request identity chặn phản hồi muộn.
  Không polling tự động, không có POST/chỉnh sửa hay retry nghiệp vụ.
- Quantity/low/high hiển thị nguyên chuỗi; không Number/parseFloat/toFixed cho giá trị xét nghiệm.
  Cận thiếu hiện “Không có”; 0, âm và thập phân dài được giữ. Timestamp hiển thị nguyên ISO UTC,
  đầy đủ microsecond và datetime/title nguyên gốc. Không đổi đơn vị hoặc nhận định y khoa.
- Nhãn “Đã lưu tại EMR” không thay thế Middleware VERIFY/DELIVERED. Không dựng event_id/exchange_id.

Giao diện navy/teal, tiếng Việt, stylesheet độc lập; Chrome 1440px/375px không tràn trang,
chỉ bảng có vùng cuộn riêng. Đã xem trực tiếp ảnh desktop và mobile API thật.

## 2. API mới và tái sử dụng

| API | Hợp đồng |
|---|---|
| **GET `/api/patients` mới** | Cặp identifier_system/value hoặc patient_key UUID; không trộn, không pagination/tham số lạ/lặp |
| GET `/api/lab-results?patient_key=...&limit=21&offset=...` | Danh sách hồ sơ, giữ nguyên contract |
| GET `/api/lab-results?external_system=...&external_id=...` | Chi tiết đủ trường, không cần endpoint target_id mới |
| POST `/api/observations` | Giữ nguyên cho luồng Middleware; UI không gọi |

API bệnh nhân trả `200 {"patient":{"patient_key":"UUID","display_label":null,"identifiers":[]}}`
(trong dữ liệu thật có label/links). 404 NOT_FOUND **Patient not found** khi không tìm được hồ sơ
cho tiêu chí; khác 404 **API route not found**. 400 VALIDATION_ERROR cho input sai;
503 DEPENDENCY_UNAVAILABLE cho lỗi DB, không lộ SQL/stack/token. 200 có Cache-Control no-store.

Repository thêm một SELECT duy nhất theo UUID hoặc subquery đúng cặp namespace/mã; aggregate các
liên kết của đúng `emr.patients.patient_key` theo thứ tự ổn định. Service xác thực hai chế độ;
controller giữ quy tắc query parser chặn trùng/mã hóa hỏng. Không tạo/sửa hồ sơ hoặc liên kết,
không schema/migration/DDL/Worker mới. Hồ sơ có thật nhưng chưa có xét nghiệm vẫn lookup200;
GET lab-results rỗng riêng lẻ không chứng minh hồ sơ tồn tại.

[API contract](api-contract.md) và [README EMR](../frontend/apps/emr/README.md) có request/response chi tiết.

## 3. File thay đổi

| Nhóm | File |
|---|---|
| Backend | `backend/src/emr/controller.ts`, `service.ts`, `repository.ts` |
| Backend tests | `backend/tests/emr/controller.http.test.ts`, `controller.integration.test.ts`, `repository.unit.test.ts`; mới `patients.unit.test.ts` |
| Frontend khung | `frontend/apps/emr/src/App.tsx`, `src/index.css`, `package.json` |
| Frontend mới | `src/api/emr.ts`, `src/types/emr.ts`, `src/state/routes.ts`, `src/hooks/useRead.ts`, `src/components/Views.tsx` |
| Frontend tests mới | `tests/emr.test.mjs`, `fixtures.mjs`, `browser.mjs`, `helpers/browser.mjs` |
| Runner mới | `scripts/verify-emr-backend.mjs` |
| Tài liệu/bằng chứng | `docs/api-contract.md`, báo cáo này, README EMR, `tests/evidence/.gitignore`, README và acceptance chọn lọc |

Không sửa mã LIS, Monitor, Middleware Worker, các test C4/D3, schema, .env hoặc Compose.
Browser helper/CSS có bản độc lập trong EMR; không import component nội bộ LIS/Monitor.
Kết quả chạy hồi quy được ghi thư mục mới, không ghi đè nghiệm thu các mốc trước.

## 4. Kiểm thử mới trong đợt này

| Bộ đã thực sự chạy | Kết quả được chấp nhận cuối |
|---|---|
| EMR frontend unit | **27/27** |
| EMR TypeScript/lint/build | **PASS**; check/lint cuối bao gồm tests browser mới; build --emptyOutDir false |
| EMR Chrome HTTP mô phỏng, preview | **25/25** |
| EMR Chrome GET thật dev5175 / preview4175 | **7/7 + 7/7** |
| LIS / Middleware / EMR backend | **177/177 + 197/197 + 106/106** |
| C4 Worker → EMR thật, PostgreSQL riêng | **16/16** |
| D3 toàn luồng backend thật, PostgreSQL riêng | **15/15** |
| Backend check/build | **PASS**, check cuối trong container network=none; image cuối compile thành công |
| LIS / Monitor frontend unit | **43/43 + 33/33** |
| LIS 2.1/2.2 browser hồi quy | **12/12 suite** |
| LIS Publish browser HTTP mô phỏng | **18/18** |
| Monitor Chrome mock / GET thật dev / preview | **32/32 + 6/6 + 6/6** |

Backend tổng **511 ca cuối đạt** (TAP tính cả ca cha). Từ run-Aq1Pcl lấy LIS/Middleware/check/build;
run-vgCmq0 lấy EMR/C4/D3. Không coi run-Aq1Pcl completed=false là toàn bộ backend đã đạt.
Tổng lượt thực thi backend **617**, gồm lần EMR đầu 104/106 và lần chạy lại; hai fail đầu là ca
namespace/link và ca cha tổng hợp. Không cộng suite browser vào ca unit để tạo tổng không cùng đơn vị.
Không dùng kết quả lịch sử trước nhiệm vụ thay cho tests mới.

Các lỗi phát hiện và xử lý:

- Tích hợp mới phát hiện tham chiếu Drizzle ở subquery aggregate bị thành cột không có tên bảng,
  khiến lấy nhầm liên kết của hồ sơ khác. Đã dùng tham chiếu đầy đủ `emr.patients.patient_key`.
  Ca cùng mã/hai namespace/hai bệnh nhân cùng label sau sửa đạt, chỉ trả links của đúng hồ sơ.
  Lỗi được phát hiện trên DB tạm trước khi cập nhật container thật.
- Hai lint rules (cause cho lỗi mạng, regex control) đã sửa, lint cuối đạt.
- Browser mock lần đầu đọc DOM cũ khi reload cùng URL; thử reload ngay khi navigate lại gặp CDP
  chưa có trang active. Hàm chờ cuối dùng request của đúng trang và chỉ reload khi đang ở cùng hash.
  Lượt mock cuối 25/25; giữ các lượt lỗi cục bộ, không sửa assertion dữ liệu để đạt.
- PowerShell coi tiến độ Docker trên stderr là exception ở lệnh build đầu. Đã chạy lại với xử lý
  exit code thực; image cuối build thành công rồi mới recreate EMR. Thử chạy dev server mới gặp
  cổng 5175 đã có nên dùng lại server có sẵn, không dừng/đổi cấu hình server đó.

Phân loại bằng chứng:

- **GET dữ liệu thật:** source/UUID, hồ sơ ba kết quả, chi tiết đúng target/patient/value/unit/time,
  F5/direct/back/forward/refresh, dev/preview, desktop/mobile.
- **HTTP mock:** 20/21 dòng, empty/missing, nhiều bản ghi, sai patient/FHIR subject, chuỗi đặc biệt,
  số 0/âm/dài/null, 400/404/503/mạng/JSON/schema, phục hồi và response muộn. Không ép lỗi trên DB thật.
- **PostgreSQL tmpfs riêng:** namespace collision, hồ sơ rỗng, sai input, database đóng, các API
  tiếp nhận/đọc lại cũ, C4/D3. Runner có roles/password/marker riêng, mount source/tests/DDL chỉ đọc,
  không gắn Compose volume; chỉ làm sạch fixture trong container duy nhất do runner sở hữu.

[Bằng chứng tổng hợp](../frontend/apps/emr/tests/evidence/acceptance/verification.json),
[hồ sơ desktop](../frontend/apps/emr/tests/evidence/acceptance/profile-desktop.png),
[chi tiết mobile](../frontend/apps/emr/tests/evidence/acceptance/result-mobile.png).
Chỉ chọn JSON và hai ảnh để review; raw logs/ảnh trung gian EMR được ignore.
Raw hồi quy LIS/Monitor giữ cục bộ ở thư mục emr-regression-2026-11-05, không đưa hàng trăm file vào commit.

## 5. Nghiệm thu GET thật và môi trường

Trước cập nhật: source có API mới nhưng GET container trả 404 API route not found, dist không có
`/api/patients`. Sau tests riêng đạt đã dùng cấu hình hiện có:

```powershell
docker build -t lis-fhir-emr-backend:local ./backend
docker compose up -d --no-deps --force-recreate emr
```

Chỉ service EMR thay container/image. Container mới `58b2de0e7da7…`, image `sha256:72e861265081…`.
DB/LIS/Dispatcher/Middleware/Worker giữ nguyên ID/image/thời điểm khởi động trước/sau.
SELECT trong transaction READ ONLY xác nhận **100 patients, 100 patient_links, 3 lab_results**;
fingerprint toàn bộ rows cả ba bảng giống nhau trước/sau. Container tmpfs thử nghiệm đã cleanup;
không reset DB hiện tại, không xóa volume, không seed hoặc POST lên MIMIC.

GET source bệnh nhân và UUID cùng trả:

- Mã bệnh nhân nguồn `MIMIC-P-10007928`.
- Patient key `6eac20d5-c71c-50a6-8adb-17bd7b5677de`.
- Nhãn từ API `Demo patient 10007928`, liên kết namespace LIS chính xác.
- Danh sách ba kết quả `MIMIC-LAB-100218`, `MIMIC-LAB-100145`, `MIMIC-LAB-100142`, đúng thứ tự API.

Chi tiết `MIMIC-LAB-100145`:

| Trường | Giá trị đã đối chiếu |
|---|---|
| target_id | `47a2ffdd-b7b1-490b-bc7e-703c0ecf6e92` |
| patient_key | `6eac20d5-c71c-50a6-8adb-17bd7b5677de` |
| analyte_code / display | `50971` / `Potassium` |
| quantity / unit | `3.6` / `mEq/L` |
| low / high | `3.3` / `5.1` |
| effective_at | `2129-04-05T21:30:00.000000Z` |
| received_at / stored_at | `2026-11-04T13:12:13.009037Z` |
| clinical_status | `final` |

Chín GET HTTP kiểm chứng riêng ghi 200/400/404 và readiness200, gồm proxy dev. Browser kiểm tra
cả dev và preview; không đồng nhất “đã lưu” với trạng thái trao đổi của Middleware.

## 6. Giới hạn còn lại

- Phạm vi hồ sơ mô phỏng chỉ có nhãn/UUID/định danh nguồn và xét nghiệm; không phải bệnh án lâm sàng đầy đủ.
- Không danh sách tất cả bệnh nhân, fuzzy search, bộ lọc thời gian/trạng thái xét nghiệm hoặc API detail
  target_id mới. Không total giả, sửa hồ sơ, retry nghiệp vụ hoặc gửi Observation từ UI.
- Hồ sơ và lab-results được đọc bằng các GET riêng; UI kiểm tra identity và cho phép làm mới,
  không tuyên bố là snapshot transaction chung giữa các request.
- API bệnh nhân thể hiện liên kết hiện tại; nếu liên kết bị vận hành thay đổi khác FHIR subject đã lưu,
  UI báo không nhất quán thay vì tự gán hoặc sửa dữ liệu.
- Đã kiểm thử Chrome desktop/mobile375px; chưa Firefox/Safari, tải lớn hoặc mọi kích thước.
  Không lấy mock làm bằng chứng luồng MIMIC chính thức hoặc đối soát y khoa/evaluator toàn bộ dataset.
- Giữ prototype cục bộ; không thêm auth hoặc deploy Internet trong nhiệm vụ này.

## 7. Cách mở nghiệm thu

Mở **http://127.0.0.1:5175/#/search** trên dev server sẵn có, F5 nếu tab cũ còn trang khung.
Nhập `mimic-p-10007928` → Tìm kiếm → Xem hồ sơ bệnh nhân → Xem chi tiết `MIMIC-LAB-100145`.
Thử F5, Làm mới, Quay lại hồ sơ, Back/Forward. Có thể chọn Patient key hoặc mở mã kết quả LIS trực tiếp.

Nếu server chưa chạy, tại frontend: `npm.cmd run dev:emr`.
Preview: `npm.cmd run build:emr`, `npm.cmd run preview:emr`, mở `http://127.0.0.1:4175/#/search`.
Preview do test tạo đã đóng; không mở thêm dev server nếu 5175 đang dùng. Xem README cho build Windows.

## 8. Git và file nên review/commit — chưa thực hiện

HEAD vẫn `387a139` trên `feature/frontend/lis-emr-ui`; index trống, không commit/push/merge.
`git diff --check` đạt; protected paths LIS/Monitor/Worker/database/Compose/.env không có diff source.

Nhóm nên review và chọn riêng source/tests/docs trong mục 3 cùng acceptance JSON/hai ảnh.
Bỏ raw evidence LIS/Monitor, cache, dist và log trung gian; không dùng `git add .` vì workspace còn
bằng chứng untracked từ các đợt trước. Chỉ stage/commit sau quy trình duyệt của nhóm.


## 9. Cải thiện UI/UX sau nghiệm thu thực tế — 05/11/2026

Đợt này chỉ cải thiện frontend trên phần đã triển khai. API/backend, service/repository, schema,
logic liên kết bệnh nhân, API client, hash routing và hook đọc dữ liệu đều giữ nguyên so với baseline
đầu lượt. Không rebuild/recreate container, sửa database hoặc thực hiện POST. Các kết quả kiểm thử
ở mục 4 thuộc đợt triển khai trước; bảng bên dưới là các lần chạy mới của đợt UI/UX này.

### Cải tiến giao diện

- Chỉ dẫn ba bước xuyên suốt: **Tra cứu bệnh nhân → Xem hồ sơ → Xem kết quả xét nghiệm**,
  đánh dấu bước hiện tại. Tiêu đề và mô tả dùng tiếng Việt cho người mới.
- Hai cách tìm được giải thích: mã bệnh nhân từ LIS hoặc khóa hồ sơ tại EMR đã được cung cấp.
  Hồ sơ tìm thấy làm nổi bật tên, mã bệnh nhân LIS và nút **Xem hồ sơ bệnh nhân** trong cùng khối.
  Khóa nội bộ và namespace đưa vào mục **Thông tin kỹ thuật của hồ sơ**, đóng mặc định.
- **Tra cứu nhanh kết quả** là khu vực riêng, giải thích chỉ dùng khi đã biết mã xét nghiệm LIS;
  ô nhập nằm trong mục mở rộng. Không trình bày như bước bắt buộc sau khi tìm bệnh nhân.
- Tiêu đề hồ sơ: **Hồ sơ bệnh nhân – Demo patient ...**. Danh sách bên dưới có tên
  **Các kết quả xét nghiệm đã lưu**, tên xét nghiệm đứng trước mã kỹ thuật; giá trị/đơn vị,
  cận thấp/cao, trạng thái và thời gian được ưu tiên.
- Số dòng ghi **Đang hiển thị N kết quả**, không coi là total. Trang đầu không có trang tiếp
  thì ẩn điều khiển phân trang; trang sau vẫn có nút trở lại dù không còn trang tiếp.
  Giữ đúng limit21/20 dòng, offset, thứ tự API và ngữ cảnh trang trong URL.
- Đầu chi tiết là khối tóm tắt tên nguồn, giá trị/đơn vị, cận, trạng thái, mã kết quả LIS,
  bệnh nhân liên quan và nhãn **Đã lưu tại EMR**. Không tự dịch tên xét nghiệm.
- Các khối tiếp theo theo thứ tự: thông tin xét nghiệm → hồ sơ liên quan → các thời điểm
  ghi nhận → thông tin kỹ thuật và FHIR. Không bổ sung phân loại bình thường/bất thường.
- Nhãn kỹ thuật đổi thành **Khóa hồ sơ bệnh nhân tại EMR**, **Mã bản ghi kết quả tại EMR**,
  **Hệ thống định danh nguồn**, **Mã kết quả nguồn LIS**. Namespace/UUID và FHIR đóng mặc định;
  khi mở vẫn đầy đủ, chọn văn bản và sao chép được, JSON không bị sửa hoặc rút gọn dữ liệu.
- Thời gian dạng `05/04/2129 · 21:30:00 UTC` được dựng từ chuỗi, không qua Date hay đổi múi giờ.
  datetime/title giữ ISO gốc; chi tiết hiển thị thêm UTC gốc đầy đủ microsecond ngay dưới dạng dễ đọc.
  Năm/ngày MIMIC không đổi. Chỉ ghi chú dữ liệu mô phỏng, không khẳng định nguyên nhân dịch chuyển ngày.
- “Đã hoàn tất (final)” chỉ là nhãn dễ hiểu cho trạng thái kết quả. Giải thích Middleware đối soát
  nằm trong phần kỹ thuật; không đánh đồng kết quả có trong EMR với VERIFY/DELIVERED.

### File sửa trong đợt UI/UX

- `frontend/apps/emr/src/App.tsx`: chỉ dẫn luồng và ngôn ngữ giao diện.
- `src/components/Views.tsx`: bố cục, nhãn, tóm tắt, dữ liệu kỹ thuật thu gọn và phân trang hiển thị.
- `src/index.css`: thứ bậc thông tin, responsive, vùng kỹ thuật và thời gian gốc.
- Mới `src/state/presentation.ts`: định dạng hiển thị UTC bằng tách chuỗi; không sửa giá trị API.
- `tests/emr.test.mjs`, `tests/browser.mjs`: bổ sung kiểm tra UI/UX và dùng selector theo dữ liệu,
  thay cho vị trí cột cũ sau khi đổi thứ tự ưu tiên của bảng.
- README EMR và báo cáo này. Bằng chứng mới nằm riêng trong `tests/evidence/ux-2026-11-05/`
  và `tests/evidence/acceptance/ux-2026-11-05/`; bằng chứng triển khai trước vẫn giữ nguyên.

### Kiểm thử thực sự chạy trong đợt UI/UX

| Bộ | Kết quả mới |
|---|---|
| EMR unit | **29/29** |
| EMR TypeScript / lint / build | **PASS**, lint cuối sau chỉnh browser; build --emptyOutDir false |
| EMR browser HTTP mock preview | **28/28** |
| EMR browser GET thật dev5175 / preview4175 | **9/9 + 9/9** |
| LIS unit / Monitor unit | **43/43 + 33/33** |
| LIS browser UI/UX GET thật | **20/20 checks**, gồm tìm kiếm, chi tiết kết quả, điều hướng và responsive |
| Monitor browser GET thật development | **6/6** |

Đã kiểm tra luồng chính, tra cứu nhanh riêng, khóa hồ sơ/namespace không nổi ở giao diện chính,
UUID/FHIR mở và chọn sao chép được, so JSON bằng dữ liệu API, UTC gốc/microsecond, số 0/âm/dài/null,
phân trang 20/21, danh sách ba dòng không gợi ý có trang khác, F5/direct/Back/Forward/quay lại,
làm mới, lỗi/khôi phục, patient mismatch, abort và response muộn. Desktop 1440px/mobile375px
không tràn trang; bảng có vùng cuộn riêng. Đã xem trực tiếp ảnh thực tế.

Lượt mock đầu có một assertion hiển thị sai: getClientRects vẫn có thể có hình chữ nhật cho nội dung
trong details đã đóng. Ảnh cho thấy UUID đã được thu gọn đúng; đã đổi test sang checkVisibility,
kiểm tra cả trạng thái đóng/mở và chọn đầy đủ nội dung sau khi mở. Lượt cuối đạt 28/28,
không bỏ assertion bảo toàn dữ liệu. Không chạy lại backend/C4/D3 hoặc các bộ Publish trong đợt
chỉ sửa trình bày này; không dùng số kiểm thử cũ để tuyên bố đã chạy lại.

[Bằng chứng mới](../frontend/apps/emr/tests/evidence/acceptance/ux-2026-11-05/verification.json),
[hồ sơ desktop sau cải tiến](../frontend/apps/emr/tests/evidence/acceptance/ux-2026-11-05/profile-desktop.png),
[chi tiết mobile sau cải tiến](../frontend/apps/emr/tests/evidence/acceptance/ux-2026-11-05/result-mobile.png).
JSON ghi từng nhóm test, đường dẫn log và SHA-256; so baseline chứng minh backend/API client/routes/hooks
không bị thay đổi. Các lần browser trên dữ liệu thật chỉ GET; không chỉnh dữ liệu hoặc Docker.

### Hướng dẫn nghiệm thu giao diện mới

1. Mở **http://127.0.0.1:5175/#/search**, F5 để tải lại giao diện.
2. Giữ cách tìm mã LIS, nhập `mimic-p-10007928`, chọn **Tìm kiếm**.
3. Chọn **Xem hồ sơ bệnh nhân** cạnh tên; xem ba kết quả trong hồ sơ, không có nút phân trang thừa.
4. Chọn **Xem chi tiết** ở `MIMIC-LAB-100145`: kiểm tra `3.6 mEq/L`, cận `3.3 / 5.1`,
   bệnh nhân và nhãn đã lưu. Ngày dễ đọc là **05/04/2129**, chuỗi gốc vẫn `2129-04-05T21:30:00.000000Z`.
5. Mở mục kỹ thuật để xem/sao chép UUID/namespace/FHIR; F5, Back/Forward, Quay lại hồ sơ vẫn đúng.
6. Trở về tra cứu, mở **Tra cứu bằng mã kết quả** để thử đường tắt mở trực tiếp theo mã LIS.

Giới hạn vẫn là Chrome desktop/mobile trong phạm vi đã kiểm tra; không thêm nội dung lâm sàng hoặc
nghiệp vụ mới. Git vẫn HEAD `387a139`, index trống, không stage/commit/push/merge; các thay đổi backend
có sẵn từ đợt triển khai trước được giữ nguyên, không phải thay đổi của đợt UI/UX.
