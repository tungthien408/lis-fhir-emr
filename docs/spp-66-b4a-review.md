# SPP-66 B4A — FHIR Observation Mapper

Đã có `mapObservation(snapshot)` để đổi một snapshot LIS đã được kiểm tra thành
một FHIR R4 Observation. Hàm chỉ nhận dữ liệu và trả kết quả: không đọc/ghi DB,
không gửi HTTP, không dùng giờ hiện tại/UUID và không sửa input.
B1–B3, LIS, EMR và SQL được giữ nguyên.

## File của B4A

| File | Nội dung |
|---|---|
| `backend/src/middleware/mapper.ts` | Kiểu đầu vào/đầu ra, MR01–MR09, kết quả lỗi có kiểu và mapping version |
| `backend/tests/middleware/mapper.test.ts` | 23 test về ánh xạ, cận thiếu, lỗi nguồn, tính ổn định và không sửa input |
| `backend/tests/middleware/fixtures/mapper-source-golden.json` | Snapshot giả làm đầu vào mẫu |
| `backend/tests/middleware/fixtures/observation-r4-golden.json` | Observation JSON mẫu để đối chiếu kết quả |
| `backend/package.json` | Thêm `test:mapper`; giữ các lệnh test/regression cũ |
| `scripts/verify-mapper-fhir.py` | Kiểm tra cấu trúc offline với schema HL7 do người chạy cung cấp; công cụ tùy chọn |
| `docs/api-contract.md`, `docs/architecture.md` | Ghi đúng Mapper đã có nhưng Worker/luồng gửi EMR chưa có |

## Observation là gì?

FHIR Observation biểu diễn một phép đo hoặc một nhận xét đơn giản. Trong đề
tài này, mỗi Observation biểu diễn **một kết quả xét nghiệm**: xét nghiệm gì,
của người nào, giá trị bao nhiêu, đơn vị nào và đo lúc nào.
Không gộp thành DiagnosticReport hoặc tự thêm kết luận bệnh.
[Đặc tả HL7 FHIR R4 Observation](https://hl7.org/fhir/R4/observation.html).

## Bảng ánh xạ MR01–MR09

| Quy tắc | Trường LIS | Trường Observation | Cách xử lý |
|---|---|---|---|
| MR01 | `result_id` | `identifier[0].value` | Giữ nguyên mã; system là `https://example.org/lis/result` |
| MR02 | `patient_id` | `subject.identifier.value` | Giữ mã LIS; system là `https://example.org/lis/patient`, type `Patient` |
| MR03 | `test_code`, `test_name` | `code.coding[0].code`, `.display` | Giữ mã/tên; system mã cục bộ `https://example.org/lis/test-code` |
| MR04 | `value_num` | `valueQuantity.value` | Giữ nguyên number, không làm tròn |
| MR05 | `unit` | `valueQuantity.unit` | Giữ đúng chuỗi đơn vị; không tự thêm UCUM/system/code |
| MR06 | `reference_low`, `reference_high` | `referenceRange[0].low`, `.high` | Mỗi cận có value và đơn vị nguồn; thiếu cận nào bỏ cận đó |
| MR07 | `effective_at` | `effectiveDateTime` | Giữ nguyên chuỗi nếu hợp lệ, kể cả múi giờ và phần giây lẻ |
| MR08 | `result_status: FINAL` | `status: final` | Chỉ hỗ trợ nguồn FINAL |
| MR09 | `test_name`, `fluid`, `category` | `code.text` | Ghép theo `tên / fluid / nhóm`, bỏ phần tùy chọn null/undefined/trống |

`Observation.category` luôn có coding `laboratory` trong system
`http://terminology.hl7.org/CodeSystem/observation-category`. Nhóm nguồn như
`Chemistry` được giữ trong `code.text`, không dùng thay mã `laboratory`.

Nếu thiếu cả hai cận thì **không có trường `referenceRange`**. Không tạo cận 0
hoặc `referenceRange: [{}]`; R4 yêu cầu mỗi phần tử range có low, high hoặc text
([quy tắc obs-3](https://hl7.org/fhir/R4/observation.html#constraints)). Cận thật
bằng 0 vẫn được giữ. Không tự ghi nhận kết quả cao/thấp chỉ vì so với cận.

## Các mã và đơn vị cần phân biệt

`identifier.system` xác định **mã này thuộc phạm vi nào**. Ví dụ mã `R1` trong
`https://example.org/lis/result` là mã kết quả nguồn; system không phải địa chỉ
bắt buộc phải gọi HTTP. `source_system` như `lis-demo` vẫn là tên hệ thống gửi,
khác namespace này.

`patient_id` là mã bệnh nhân LIS. `patient_key` là khóa bệnh nhân EMR. Mapper
chỉ đưa mã LIS vào `subject.identifier`; EMR sau này tra `patient_links` để tìm
đúng `patient_key`. Không thể tự dùng mã LIS làm khóa EMR hoặc dựng `Patient/id`.

Mã như `50971` hiện thuộc catalog cục bộ. Chưa có bảng đối chiếu mã chuẩn thì
không được khẳng định đó là LOINC. Tương tự, có chuỗi đơn vị không có nghĩa là
đã xác minh được mã UCUM. Đổi `mg/dL` sang `mmol/L` còn cần biết chất xét nghiệm
và quy tắc chuyển đổi; Mapper giữ đơn vị/giá trị nguồn để tránh đổi nghĩa.

## Kiểu hàm và phiên bản mapping

```typescript
const result = mapObservation(validatedSnapshot);
if (result.kind === "mapped") {
  const observation = result.observation;
  const mappingVersion = result.mappingVersion;
}
```

`ObservationSourceSnapshot` dùng các kiểu trường của B1, chỉ nhận snapshot.
`fluid`, `category`, hai cận có thể null hoặc bỏ hẳn; B2 hiện phát đủ các trường
nullable. Mapper có kiểm tra phòng vệ nhưng không thay việc xác thực request
và hash của B2. `FhirR4LabObservation` mô tả phần cấu trúc mà dự án tạo ra,
không phải thư viện kiểu đầy đủ cho mọi resource/profile FHIR.

| `kind` | Ý nghĩa |
|---|---|
| `mapped` | Có `observation` và `mappingVersion` |
| `invalid` | Nguồn thiếu/sai kiểu, số không hữu hạn, ngày sai hoặc cận đảo; mã nội bộ `INVALID_SOURCE_VALUE` |
| `unsupported` | Trạng thái khác FINAL hoặc không thể biểu diễn nguyên trạng theo mapping; mã `UNSUPPORTED_SOURCE_VALUE` |

Lỗi có `field` và thông báo chung, không có Observation dở dang. Đây là kết quả
nội bộ cho Worker tương lai; chưa thêm mã lỗi HTTP hay đổi API nhận của B3.

`OBSERVATION_MAPPING_VERSION = "lis-observation-v1"` là **phiên bản quy tắc của
dự án**, không phải phiên bản chính thức của FHIR. Output theo **FHIR R4 4.0.1**.
Không ghi mapping version vào `meta.versionId`. Worker tương lai có thể lưu nó
vào `integration.exchange_transactions.mapping_version`.

## Một JSON output đầy đủ

Ví dụ dưới là golden fixture với dữ liệu giả, có cả hai cận:

```json
{
  "resourceType": "Observation",
  "identifier": [
    { "system": "https://example.org/lis/result", "value": "B4A-SYNTHETIC-R1" }
  ],
  "status": "final",
  "category": [
    {
      "coding": [
        { "system": "http://terminology.hl7.org/CodeSystem/observation-category", "code": "laboratory" }
      ]
    }
  ],
  "code": {
    "coding": [
      { "system": "https://example.org/lis/test-code", "code": "50971", "display": "Potassium" }
    ],
    "text": "Potassium / Blood / Chemistry"
  },
  "subject": {
    "type": "Patient",
    "identifier": { "system": "https://example.org/lis/patient", "value": "B4A-SYNTHETIC-P1" }
  },
  "effectiveDateTime": "2180-06-03T12:00:00.123456Z",
  "valueQuantity": { "value": 3.4, "unit": "mEq/L" },
  "referenceRange": [
    { "low": { "value": 3.3, "unit": "mEq/L" }, "high": { "value": 5.1, "unit": "mEq/L" } }
  ]
}
```

## Worker sau này sẽ gọi thế nào?

Worker sẽ lấy **`source_payload.source_snapshot`** đã được kiểm tra và gọi
`mapObservation`. Nếu `mapped`, nó có Observation và mapping version để lưu
vào các cột tương ứng, rồi các giai đoạn sau mới gửi/đọc lại EMR. Nếu lỗi, nó
phải xử lý lỗi rõ ràng theo chính sách sẽ được thiết kế sau, không tự sửa nguồn.

B4A **chưa viết hoặc bật Worker**, chưa lưu `fhir_payload`, chưa gọi EMR và
không đổi trạng thái giao dịch. POST nhận vẫn chỉ lưu `RECEIVED`; GET sẽ chưa
có FHIR nếu chưa có tiến trình khác lưu nó. ACK và DELIVERED không đổi nghĩa.

## Giới hạn đã xác định

- R4 `dateTime` chỉ nhận offset đến ±14:00. B2 hiện cho phép offset rộng hơn
  theo PostgreSQL (đến 15:59). Mapper trả `unsupported` với các offset ngoài
  R4 thay vì tự đổi chuỗi. LIS hiện phát UTC nên không gặp trường hợp này.
- FHIR `Coding.code` không nhận khoảng trắng đầu/cuối hoặc khoảng trắng dư.
  Mã nguồn như `" 50971"` hay `"A  B"` trả `unsupported`, không tự trim hoặc
  gộp khoảng trắng. Quy tắc primitive tham chiếu [FHIR R4 datatypes](https://hl7.org/fhir/R4/datatypes.html).
- Chuỗi không biểu diễn được như NUL/surrogate đơn lẻ hoặc vượt giới hạn string
  bị từ chối. Mapper hỗ trợ ngày đầy đủ có timezone theo contract LIS, không mở
  rộng sang partial date hay leap second mà B2 hiện chưa chấp nhận.
- Số được giữ theo JSON number đã qua B2. Không khôi phục được scale như
  `3.4000` hoặc độ chính xác đã mất trước đó; LIS A2 đã kiểm tra khả năng biểu
  diễn trước Publish. Không thêm độ chính xác hoặc suy ra dữ liệu mới.
- Giữ nguyên phần context có nội dung, kể cả khoảng trắng gốc; chỉ bỏ phần tùy
  chọn trống/null/undefined. Không chuyển trường JSON mở rộng thành facts FHIR.

## Kiểm thử và kiểm tra cấu trúc

```bash
cd backend
npm run check
npm run build
npm run test:mapper
npm run test:repositories:postgres
```

| Kiểm tra thực tế | Kết quả |
|---|---|
| TypeScript source + tests | Thành công |
| Build | Thành công |
| Lệnh `test:mapper` | Thành công |
| Mapper trong bộ regression | 23 pass, 0 fail, 0 skip |
| Toàn bộ Middleware, gồm 23 test Mapper | 125 pass, 0 fail, 0 skip |
| LIS regression | 79 pass, 0 fail, 0 skip |

Test Mapper không cần DB hoặc mạng. Regression PostgreSQL chạy trên container
PostgreSQL 17 riêng, không dùng volume dự án và được dọn sau khi xong.
Node 26.12.0 có cảnh báo loader `DEP0205` hiện có; không gây thất bại test.

Đã kiểm tra thêm **13 output Mapper giả** bằng `fastjsonschema 2.21.2` tạm trong
`/tmp`, với [JSON Schema HL7 R4 chính thức](https://hl7.org/fhir/R4/fhir.schema.json),
draft-06, chọn root `#/definitions/Observation` và giữ nguyên các definitions.
Cả 13 qua; negative control đổi `valueQuantity.value` thành chuỗi bị từ chối.
Bao gồm golden, cận một phía/không có cận, context thiếu, số âm/0/cực trị,
múi giờ, microsecond và Unicode. SHA-256 file schema đã dùng:

```text
2230406893b4cf002a4ee1e5e2bbeca22ac5d2d4931b3e9ef7b9594bbc376a01
```

Để lặp kiểm tra cấu trúc khi đã có công cụ `fastjsonschema` riêng và schema ở
máy, từ thư mục gốc chạy (mặc định kiểm tra golden fixture):

```bash
python3 scripts/verify-mapper-fhir.py /path/to/fhir.schema.json
```

Có thể thêm `--resources /path/to/observations.json` để kiểm tra một mảng output.
Script không tải mạng hoặc thêm dependency cho backend. Báo cáo lần chạy B4A
ở `/tmp/spp66-b4a-schema-validation-report.json`; không dùng dữ liệu bệnh nhân thật.

**Qua schema** chỉ cho biết JSON phù hợp phần cấu trúc schema kiểm tra được.
Đây không phải chạy HL7 Validator CLI đầy đủ, terminology hoặc toàn bộ FHIRPath.
Test riêng kiểm tra MR01–MR09 và obs-3, nhưng vẫn không chứng minh kết quả đúng
bệnh nhân hay đúng xét nghiệm trong thực tế. Điều đó cần dữ liệu đáp án độc lập
và đối chiếu sau khi EMR lưu; nằm ngoài B4A.

Đã dừng ở Mapper và test; chưa gửi dữ liệu, khởi động Worker, commit hoặc push.
