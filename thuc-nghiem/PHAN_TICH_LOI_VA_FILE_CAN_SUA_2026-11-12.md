# Các lỗi thực nghiệm và danh sách file cần sửa

Ngày phân tích: 12/11/2026. Dùng làm đầu vào giao AI sửa code, sau đó chạy lại thực nghiệm.

## 1. Phạm vi và kết luận

Đối chiếu đợt `ket-qua/2026-11-11/` với mã nguồn tại commit `4220045`. Đợt thực nghiệm ghi nhận commit sản phẩm `9924105`; `git diff 9924105 HEAD -- backend/src database backend/scripts` hiện không có khác biệt. Vì vậy các nguyên nhân bên dưới vẫn hiện diện trong code đang có.

Nguồn chính:

- [67 phép kiểm tra kỳ vọng/thực tế](ket-qua/2026-11-11/kiem-tra.jsonl): **61 đạt, 6 không đạt**.
- [Kết quả dữ liệu sai vào middleware](ket-qua/2026-11-11/E2-sai-benh-nhan-du-lieu-sai/7b-ket-qua.txt), [gửi thẳng EMR](ket-qua/2026-11-11/E2-sai-benh-nhan-du-lieu-sai/7c-ket-qua.txt), [3 bản ghi sai đã lưu](ket-qua/2026-11-11/E2-sai-benh-nhan-du-lieu-sai/ban-ghi-loi-lot-vao-EMR.txt).
- [Tóm tắt HL7 validator](ket-qua/2026-11-11/kiem-tra-fhir/tom-tat.txt) và `kiem-tra-fhir/ket-qua-validator.json.gz`.
- [Nhật ký xử lý sự cố khi chạy](ket-qua/2026-11-11/TIEN_DO.md).

**6 phép kiểm tra không đạt không tương ứng với 6 lỗi độc lập.** Có 3 vấn đề sản phẩm cần xử lý: thiếu kiểm tra mã xét nghiệm, thiếu kiểm tra đơn vị theo mã xét nghiệm, và URI FHIR dùng `example.org`. Ngoài ra có lỗi tranh file kết quả trong công cụ thực nghiệm cần sửa trước khi chạy song song.

| Mã kiểm tra không đạt | Thực tế đã ghi nhận | Nhóm nguyên nhân |
|---|---|---|
| `TC03-MW-1` | Mã `99999` → HTTP 202, middleware `DELIVERED`, EMR lưu 1 hàng | Thiếu kiểm tra danh mục mã |
| `TC03-MW-2` | Creatinine `50912` dùng `kg` → HTTP 202, `DELIVERED`, EMR lưu 1 hàng | Thiếu kiểm tra đơn vị theo mã |
| `TC03-EMR-7` | Gửi thẳng Observation mã `99999` → HTTP 201, EMR lưu 1 hàng | Thiếu kiểm tra danh mục mã ở EMR |
| `E2-TONG-1` | Có 2 ca dữ liệu sai bị báo `DELIVERED`, kỳ vọng 0 | Tổng hợp hai ca qua middleware, không phải lỗi mới |
| `E2-TONG-2` | Có 3 bản ghi sai ở EMR, kỳ vọng 0 | Tổng hợp ba ca trên, không phải lỗi mới |
| `FHIR-M8` | 0/1000 Observation đạt tiêu chí không có error/fatal | Ba URI `example.org` trên mỗi Observation |

Lần phân tích này chỉ bổ sung tài liệu; chưa sửa sản phẩm, chưa chạy lại toàn bộ thực nghiệm hay thay đổi dữ liệu Docker.

## 2. Ưu tiên 1 — Chặn mã xét nghiệm và đơn vị ngoài danh mục

### Nguyên nhân và vị trí sửa

LIS đã có danh mục và kiểm tra đơn vị tại `backend/src/lis/service.ts:98` và `:110`. Tuy nhiên, ca E2 gọi trực tiếp API middleware hoặc EMR nên không đi qua lớp kiểm tra này.

| File | Điều đã thấy trong code | Thay đổi cần thực hiện |
|---|---|---|
| `backend/src/middleware/service.ts:135` | `test_code` và `unit` chỉ được kiểm tra không rỗng | Trong `parseEnvelope`/`validateExchangeEnvelope`, kiểm tra mã tồn tại và đơn vị thuộc danh sách của mã đó; trả `invalid`, mã lỗi `INVALID_TEST_CODE` hoặc `INVALID_UNIT`, HTTP 422 theo luồng hiện có |
| `backend/src/emr/service.ts:132` | `coding.code` chỉ được kiểm tra chuỗi/định dạng khoảng trắng | Trong `validateObservation`, kiểm tra mã thuộc hệ mã được hỗ trợ và đơn vị tương ứng trước khi lưu; lỗi trả 422 |
| `backend/src/emr/service.ts:144` | Quantity kiểm tra số hữu hạn và đơn vị không rỗng; cận tham chiếu chỉ cần cùng đơn vị với giá trị | Kiểm tra cặp mã–đơn vị cả khi không có `referenceRange`; giữ nguyên kiểm tra nhất quán đơn vị đang có |
| **File mới đề xuất:** `backend/src/common/test-catalog.ts` và/hoặc một file dữ liệu danh mục có phiên bản | Chưa có policy danh mục dùng cho middleware và EMR | Đặt danh mục được hỗ trợ ở một nơi rõ ràng để hai dịch vụ cùng kiểm tra; API thuần, có thể kiểm thử mà không cần DB |

Danh mục hiện tại nằm tại `database/seed/01_reference_data.sql:106`:

| Mã | Xét nghiệm | Đơn vị được chấp nhận trong bộ thực nghiệm |
|---|---|---|
| `50971` | Potassium | `mEq/L` |
| `50912` | Creatinine | `mg/dL` |
| `51222` | Hemoglobin | `g/dL` |
| `50802` | Base Excess | `mEq/L` |
| `51492` | Protein | `mg/dL` |

Đây là policy của bộ dữ liệu thực nghiệm, không phải danh mục y khoa đầy đủ. Nên dùng artifact danh mục có phiên bản và kiểm tra đồng bộ với seed. Không tự chuyển đơn vị, sửa mã, làm tròn giá trị hoặc sửa snapshot để hợp lệ hóa đầu vào.

**Lưu ý kiến trúc:** `integration_app` và `emr_app` hiện không được cấp quyền đọc schema LIS trong `database/access_roles.sql`. Không thêm truy vấn trực tiếp `lis.test_catalog` từ hai dịch vụ mà bỏ qua giới hạn này. Nếu chọn danh mục riêng trong DB thay vì artifact cấu hình, phải thiết kế bảng, repository, schema và quyền tương ứng; đó là phương án thay thế, chưa phải các file bắt buộc sửa của phương án tối thiểu ở trên.

`backend/src/middleware/worker.ts:118` đã gọi lại `validateExchangeEnvelope` khi xử lý dữ liệu lưu; kiểm tra đặt trong hàm này sẽ bao phủ đường worker. Nếu đổi sang kiểm tra bất đồng bộ/tra DB thì phải cập nhật cả call site ở worker. `mapper.ts` không cần trở thành nơi truy vấn danh mục.

### Bổ sung test để chứng minh đã sửa đúng

| File test | Ca cần thêm |
|---|---|
| `backend/tests/middleware/service.unit.test.ts` | Mã `99999` bị từ chối; `50912` + `kg` bị từ chối; mã/đơn vị đúng vẫn nhận; đầu vào sai không gọi ghi repository |
| `backend/tests/middleware/controller.http.test.ts` | Hai trường hợp trên trả HTTP 422, có field/mã lỗi phù hợp |
| `backend/tests/emr/service.unit.test.ts` | Mã lạ bị từ chối; `kg` bị từ chối kể cả khi mọi cận đều `kg`, hoặc không có cận; không ghi dữ liệu |
| `backend/tests/emr/controller.http.test.ts` | Gọi thẳng EMR bằng Observation sai → HTTP 422 |
| `backend/tests/integration/middleware-emr.integration.test.ts` | Dữ liệu sai không sinh hàng EMR, không bao giờ `DELIVERED`; dữ liệu đúng vẫn hoàn tất |

Nếu danh mục mới làm các fixture có mã tổng hợp không còn hợp lệ, khai báo danh mục test rõ ràng hoặc cập nhật fixture sang mã được hỗ trợ. Không mở ngoại lệ chấp nhận mọi mã khi chạy sản phẩm.

### Ca đang PASS nhưng chưa kiểm tra đúng mục tiêu

`TC03-EMR-8` đang PASS vì script chỉ đổi `valueQuantity.unit` thành `kg`, trong khi cận tham chiếu vẫn `mg/dL`. EMR trả 422 vì **hai đơn vị không khớp nhau**, chưa chứng minh có kiểm tra danh mục.

Sửa/bổ sung `thuc-nghiem/04-E2-sai-benh-nhan-du-lieu-sai.sh:91`: giữ ca không khớp đơn vị làm một ca riêng; thêm ca đổi đồng thời giá trị và các cận sang `kg`, cùng ca `kg` không có `referenceRange`. Các ca mới phải bị từ chối vì cặp mã–đơn vị không được chấp nhận.

## 3. Ưu tiên 1 — Sửa URI FHIR, cập nhật đồng bộ hợp đồng và bộ đối chiếu

Đọc lại trực tiếp JSON nén của validator xác nhận: 1000 OperationOutcome, tổng cộng 3000 error/fatal, đúng ba loại sau, mỗi loại xuất hiện 1000 lần:

- `Observation.identifier[0].system`: `https://example.org/lis/result`.
- `Observation.code.coding[0].system`: `https://example.org/lis/test-code`.
- `Observation.subject.identifier.system`: `https://example.org/lis/patient`.

Thông báo lỗi đều là `Example URLs are not allowed in this context`. Các warning về CodeSystem cục bộ, năm 21xx, narrative và performer không nằm trong tiêu chí error/fatal của M8 hiện tại.

### Các file phải cập nhật cùng nhau

| File | Việc cần làm |
|---|---|
| `backend/src/middleware/mapper.ts:21` và `:127` | Thay ba namespace trong cả type lẫn JSON đầu ra bằng URI ổn định do dự án định danh; cân nhắc tăng `OBSERVATION_MAPPING_VERSION` vì nội dung ánh xạ thay đổi |
| **File mới đề xuất:** `backend/src/common/fhir-namespaces.ts` | Khai báo các namespace sản phẩm dùng chung; chọn URI do dự án quản lý hoặc định danh được cấp phù hợp, không tự nhận một tên miền bất kỳ |
| `backend/src/emr/service.ts:7` | EMR đang so sánh chính xác với namespace cũ; đồng bộ với mapper để Observation mới không bị 422 |
| `database/seed/01_reference_data.sql:216` | Đổi `emr.patient_links.identifier_system`; nếu không, mã bệnh nhân đúng vẫn bị báo không liên kết |
| `backend/src/middleware/monitor-diagnostics.ts:15` | Đồng bộ điều kiện namespace khi đọc receipt; nếu bỏ sót, monitor có thể không hiển thị receipt hợp lệ |
| `frontend/apps/emr/src/types/emr.ts:1` | Đồng bộ `PATIENT_SYSTEM` và `RESULT_SYSTEM`; API tìm bệnh nhân đang dùng `PATIENT_SYSTEM` |
| `docs/api-contract.md` | Cập nhật hợp đồng namespace được hai dịch vụ chấp nhận |

`backend/src/middleware/worker-verification.ts` đã so namespace với Observation dự kiến, không hardcode ba URI cũ. Chưa có bằng chứng cần sửa logic ở file này chỉ để đổi namespace; vẫn phải chạy test xác minh lại.

Không ghi đè payload/hash của các giao dịch cũ. `backend/src/middleware/worker.ts:128` kiểm tra mapping version, hash và JSON đã lưu; đổi mapper rồi tiếp tục hàng đợi cũ có thể bị `PAYLOAD_INTEGRITY`. Với đợt thực nghiệm mới, dùng môi trường sạch. Nếu cần tương thích dữ liệu demo cũ, phải có phương án di trú/đọc dữ liệu cũ riêng, giữ đúng liên kết và tính chống trùng.

### Bộ đáp án độc lập cũng đang cố định URI cũ

Nếu chỉ đổi mapper, M8 có thể cải thiện nhưng E1 sẽ fail đối chiếu namespace. Các file công cụ cần xử lý:

- `backend/scripts/spp82/verification/freeze-reference.py:15`: đang pin SHA-256 seed và khai báo URI cũ trong `RULES`. Đổi seed sẽ làm kiểm tra `Pinned source checksum mismatch` nếu không lập lại phiên bản tham chiếu có provenance mới.
- `backend/scripts/spp82/verification/expected-loader.ts:32`: đang chỉ nhận đúng phiên bản rules và ba URI `example.org`; cần hỗ trợ hợp đồng tham chiếu mới một cách tường minh.
- `thuc-nghiem/lib.sh:36`: đang trỏ cứng đến `reference/spp65-v2`; phải cho chọn/trỏ đến bộ tham chiếu mới.
- Tạo **thư mục tham chiếu mới**, ví dụ `backend/scripts/spp82/reference/spp65-v3/`, gồm `rules.json`, `patient-links.json`, `upstream-answers.csv`, `expected.jsonl`, `manifest.json`, `manifest.sha256` được sinh/kiểm tra lại. Một số nội dung lâm sàng có thể không đổi, nhưng manifest phải phản ánh chính xác đầu vào mới.

Giữ nguyên `spp65-v2` để còn đối chiếu đợt cũ. Việc đổi namespace trong đáp án phải xuất phát từ hợp đồng mới được khai báo, được kiểm tra độc lập với mapper; không lấy JSON đầu ra sản phẩm làm đáp án và không sửa số đo cũ để thành PASS. Không cần đổi mã MIMIC thành LOINC hay đơn vị thành UCUM để xử lý ba lỗi URI đã quan sát; nếu mở rộng sang các chuẩn đó thì cần một đợt thay đổi hợp đồng và kiểm chứng riêng.

### Fixture và test phụ thuộc URI cần rà soát/cập nhật

Các đường dẫn dưới đây đang chứa URI cũ trong mã/fixture. Chỉ đổi giá trị có vai trò namespace hợp đồng; các ca cố ý dùng namespace sai phải tiếp tục là ca sai.

```text
backend/tests/middleware/fixtures/observation-r4-golden.json
backend/tests/middleware/mapper.test.ts
backend/tests/middleware/monitor-diagnostics.test.ts
backend/tests/middleware/controller.http.test.ts
backend/tests/middleware/controller.integration.test.ts
backend/tests/emr/fixtures.ts
backend/tests/emr/service.unit.test.ts
backend/tests/emr/service.integration.test.ts
backend/tests/emr/controller.http.test.ts
backend/tests/emr/controller.integration.test.ts
backend/tests/emr/repository.integration.test.ts
backend/tests/integration/c4-harness.ts
backend/tests/integration/fixtures/c4-synthetic.json
backend/tests/e2e/d3-harness.ts
backend/tests/e2e/publish-browser-server.ts
backend/tests/e2e/lis-emr.e2e.test.ts
backend/tests/e2e/fixtures/d3-synthetic.json
backend/scripts/spp82/verification/synthetic-fixtures.ts
backend/scripts/spp82/measurement.test.ts
frontend/apps/emr/tests/fixtures.mjs
frontend/apps/lis/tests/flow-fixtures.mjs
frontend/apps/middleware-monitor/tests/fixtures.mjs
```

`database/dacn_db_init_v2.sql` cũng có URI cũ ở phần tự kiểm tra ràng buộc DB (khoảng dòng 360 trở đi). Rà soát và đồng bộ ví dụ có liên quan; đây không phải nơi tạo Observation của luồng thực nghiệm.

## 4. Ưu tiên 2 — Tránh lỗi khi script thực nghiệm chạy song song

Nhật ký ngày 12/11 lúc 00:14:55 ghi lỗi tại `lib.sh:142`, khi bước 01 và 07 bắt đầu cùng lúc. Tiến độ xác nhận hai bước tranh nhau `kiem-tra.jsonl.tmp`. Code hiện tại vẫn dùng tên tạm chung.

| File | Việc cần làm |
|---|---|
| `thuc-nghiem/lib.sh:136` | Sửa `step_begin` để lọc kết quả cũ và thay file an toàn khi nhiều tiến trình cùng chạy |
| `thuc-nghiem/lib.sh:126` | Cơ chế khóa cũng phải bao phủ `check()` ghi thêm kết quả, tránh bước khác thay file làm mất dòng vừa append |
| `thuc-nghiem/HUONG_DAN_CHO_CLAUDE_CODE.md` | Đồng bộ hướng dẫn chạy 01/07 với cơ chế mới; nếu chưa sửa đồng thời thì hướng dẫn chạy tuần tự |

Hai phương án hợp lý: dùng cùng một lock cho thao tác đọc–lọc–thay và append; hoặc mỗi bước ghi file riêng rồi tổng hợp. **Chỉ thêm PID vào tên file tạm chưa đủ:** hai tiến trình vẫn có thể cùng đọc bản cũ rồi thay file làm mất cập nhật của nhau.

Kiểm chứng trên file kết quả giả trong `/tmp`: hai bước bắt đầu cùng lúc, ghi kiểm tra, rồi chạy lại một bước. JSONL phải đọc được, giữ đủ kết quả của bước còn lại và không nhân đôi kết quả bước chạy lại. Không cần dựng lại Docker để kiểm chứng lỗi file này.

Hai lỗi vận hành khác đã được sửa trong đợt cũ: parser test ở `01-test-tu-dong.sh` được sửa để đọc reporter spec của Node; parser validator ở `07-kiem-tra-fhir.sh` được sửa để đếm OperationOutcome từ JSON. Không coi chúng là lỗi sản phẩm còn mở. Khi chạy lại vẫn xác nhận số test thực chạy, mã thoát và đủ 1000 kết quả validator.

## 5. Tối ưu tùy chọn — Hàng đợi LIS chậm khi dồn 1000 kết quả

E1 vẫn PASS 1000/1000; kế hoạch không đặt ngưỡng thời gian nên đây **không phải case fail**. Đã đo: tổng thời gian trung vị 525,21 giây, p95 998,95 giây; chặng LIS → middleware chiếm gần hết.

Code giải thích nút thắt: `backend/src/lis/repository.ts:326` claim 1 việc mỗi lần; `backend/src/lis/dispatcher.ts:134` luôn nghỉ `pollMs` sau mỗi lần xử lý; `dispatcher-config.ts:50` và `compose.yaml:51` mặc định 1000 ms. Trong khi đó middleware worker đã tiếp tục ngay sau kết quả `processed` (`worker.ts:149`).

Nếu muốn cải thiện trong một thay đổi riêng, ưu tiên `backend/src/lis/dispatcher.ts`: xử lý tiếp khi vừa hoàn thành công việc, chỉ nghỉ khi rỗng/lỗi hoặc trường hợp cần tránh vòng lặp nóng. Giữ lease, ngân sách retry và shutdown. Bổ sung kiểm tra vòng lặp tại `backend/tests/lis/dispatcher.unit.test.ts`, chạy lại test tích hợp dispatcher và đo E1/E1A. Chỉ sửa `dispatcher-config.ts`, `repository.ts` hoặc `compose.yaml` nếu thực sự đổi cấu hình hay cách claim; chưa có bằng chứng cần viết lại truy vấn/batch để sửa các case fail.

## 6. Những kết quả không nên hiểu nhầm là lỗi cần sửa

- E4b: 10/10 `FAILED` khi EMR tắt lâu là kết quả đúng thiết kế sau khi hết số lần thử. E4c đã requeue thành công 10/10, mỗi kết quả một bản ghi. Không đổi `FAILED` thành `DELIVERED` hoặc cho publish lặp tạo sự kiện mới để ép PASS.
- LIS `ACK` xác nhận middleware đã nhận, không xác nhận EMR đã lưu. E4b có ACK nhưng EMR chưa lưu không phải ACK giả.
- `E1-1000-ket-qua/doi-chieu-40-ket-qua-loi.jsonl` có tên chứa “loi” nhưng **40/40 dòng đều PASS**, không phải 40 ca lỗi.
- 514/514 test tự động của đợt cũ đều đạt. Chúng chưa bắt được thiếu kiểm tra danh mục; cần thêm test hồi quy ở mục 2.
- Những lỗi pilot như journal 19 GB, loader đọc cả file lớn và thiếu lệnh requeue đã được ghi nhận xử lý trong `docs/docs_backend/spp-73/06-defect-log.md`; không gán lại là lỗi đang mở nếu không có bằng chứng tái diễn.

## 7. Điều kiện hoàn tất và trình tự chạy lại

1. Sửa kiểm tra mã/đơn vị, URI và các phụ thuộc; bổ sung test hồi quy. Sửa tranh file nếu muốn tiếp tục chạy 01/07 song song. Tối ưu dispatcher có thể làm riêng để phân biệt cải thiện chức năng và hiệu năng.
2. Chạy `npm run check` tại `backend/`, các test đã thay đổi, bộ test PostgreSQL `npm run test:repositories:postgres` và `npm run test:spp82`. Nếu đổi frontend, chạy kiểm tra/build/test tương ứng trong workspace frontend.
3. Lập bộ tham chiếu phiên bản mới độc lập, kiểm tra checksum/provenance. Chạy mới toàn bộ thực nghiệm vì thay namespace tác động cả E1, E3, E4 và FHIR.
4. Dùng cùng một `RUN_TAG` mới cho mọi bước, ví dụ `2026-11-12-sau-sua`; không tái sử dụng thư mục `2026-11-11`. Chạy 00 → 02 → 03 → 04 → 05 → 06 → 01/07 → 08 → báo cáo → 09 theo điều kiện phụ thuộc của script.
5. Điều kiện mong đợi: ba ca E2 cũ đều bị chặn; hai tổng E2 bằng 0; ca `kg` nhất quán/không cận mới thêm cũng bị chặn; M8 đạt 1000/1000 theo tiêu chí error/fatal; E1 vẫn 1000/1000 và 24000/24000 phép đối chiếu; E3/E4/TC06/TC07 vẫn đạt. Đây là tiêu chí cho lần tới, chưa phải kết quả đã đo.
6. Giữ nguyên bằng chứng/báo cáo cũ và checksum cũ; so sánh trước–sau bằng hai đợt có commit, cấu hình, phiên bản validator và bộ tham chiếu rõ ràng. Nếu thêm ca kiểm tra, tổng số mới sẽ thay đổi so với 67, cần báo mẫu số mới.

### Nội dung có thể giao cho AI sửa

> Đọc `thuc-nghiem/PHAN_TICH_LOI_VA_FILE_CAN_SUA_2026-11-12.md`. Sửa các lỗi sản phẩm ở mục 2–3 và lỗi tranh file ở mục 4, bổ sung các ca hồi quy được nêu. Đồng bộ namespace giữa mapper, EMR, patient links, monitor, frontend và hợp đồng; lập bộ tham chiếu mới có provenance, giữ độc lập với code mapper và giữ nguyên v2. Bổ sung ca EMR dùng đơn vị sai nhưng nhất quán và ca không có cận tham chiếu. Giữ nguyên dữ liệu thực nghiệm đợt 2026-11-11. Chạy kiểm tra/test phù hợp, báo các file đã đổi và kết quả thật. Tối ưu dispatcher ở mục 5 là tùy chọn và cần tách kết quả đo. Chưa tự chạy lại toàn bộ thực nghiệm cho đến khi hoàn tất sửa và test.

## 8. Kiểm chứng đã làm trong lần phân tích này

Ngoài đọc log và code, đã gọi trực tiếp các hàm kiểm tra hiện tại bằng `node --import tsx` với gói tin E2 đã lưu, không gọi HTTP hay ghi DB:

| Đầu vào | Kết quả hiện tại |
|---|---|
| Gói tin middleware mã `99999` | `validateExchangeEnvelope = valid`, `mapObservation = mapped`, `validateObservation = valid` |
| Gói tin middleware `50912` + `kg` | `valid` → `mapped` → `valid` |
| Observation gửi thẳng EMR mã `99999` | `validateObservation = valid` |
| Observation EMR chỉ đổi đơn vị giá trị thành `kg` | `invalid`, field `referenceRange`, thông báo đơn vị cận không khớp |
| Bản sao trong bộ nhớ của ca trên, đổi các cận sang `kg` | `validateObservation = valid` |

Các kết quả này tái xác nhận thiếu kiểm tra ở code hiện tại. Trạng thái HTTP, `DELIVERED` và số bản ghi lưu được lấy từ minh chứng đợt cũ; lần phân tích này không tạo thêm số đo đầu–cuối mới.
