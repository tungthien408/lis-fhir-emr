# SPP-70 — Báo cáo kiểm chứng dữ liệu, FHIR và chống trùng

## 1. Mục tiêu

Kiểm chứng hệ thống LIS → Middleware → EMR đáp ứng các yêu cầu về dữ liệu hợp lệ, liên kết bệnh nhân, cấu trúc HL7 FHIR R4 Observation và khả năng nhận diện kết quả gửi trùng.

## 2. Kiểm tra FHIR R4 độc lập

**Lệnh thực thi:**

`python scripts/verify-mapper-fhir.py /tmp/fhir.schema.json`

**Kết quả:**
- Số Observation đạt kiểm tra: 1.
- Schema root: `#/definitions/Observation`.
- SHA-256 của schema: `2230406893b4cf002a4ee1e5e2bbeca22ac5d2d4931b3e9ef7b9594bbc376a01`.
- Phạm vi: Kiểm tra cấu trúc JSON Schema.

**Giới hạn:** Kết quả này chưa chứng minh toàn bộ quy tắc FHIRPath, terminology và tính chính xác lâm sàng.

## 3. Kiểm thử EMR và chống trùng

**Lệnh thực thi:**

`npm run test:emr:postgres`

**Kết quả:**
- Tổng số test: 101.
- PASS: 101.
- FAIL: 0.
- SKIP: 0.

| Kịch bản | Kết quả mong đợi | Kết quả |
|---|---|---|
| Thiếu hoặc sai liên kết bệnh nhân | Không lưu nhầm hồ sơ | PASS |
| Observation không hợp lệ | Từ chối, không ghi dữ liệu | PASS |
| Gửi lại kết quả giống hệt | Không tạo bản ghi trùng | PASS |
| Cùng mã kết quả nhưng nội dung khác | Phát hiện xung đột | PASS |
| Hai mã kết quả khác nhau, cùng giá trị xét nghiệm | Lưu hai kết quả riêng biệt | PASS |
| Nhiều request đồng thời | Không tạo kết quả trùng ngoài ý muốn | PASS |

**Bằng chứng:** `evidence/spp-70-distinct-ids-test-output.txt`

## 4. Nhận xét

Các bài kiểm thử đã thực thi cung cấp bằng chứng rằng hệ thống xử lý các trường hợp liên kết bệnh nhân, xác thực dữ liệu và chống trùng theo phạm vi kiểm thử.

Kiểm tra JSON Schema độc lập xác nhận một Observation hợp lệ về cấu trúc FHIR R4 theo schema sử dụng.

Các kết quả này chưa chứng minh tính đúng đắn lâm sàng của toàn bộ dữ liệu hoặc tính phù hợp với mọi ràng buộc của chuẩn FHIR.

## 5. Trạng thái nghiệm thu

**Kết luận kỹ thuật:** Có cơ sở đề xuất chuyển SPP-70 sang Review sau khi kiểm tra đầy đủ file bằng chứng và link source.

**Kiểm chéo:** Chờ Nguyễn Thị Ngọc Tú xác nhận.

**Jira Done:** Chưa xác nhận; chỉ chuyển sau khi hoàn thành kiểm chéo và xử lý các vấn đề phát hiện.