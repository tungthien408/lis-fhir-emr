# Tổng hợp số liệu thực nghiệm – đợt 2026-11-12-sau-sua-01

> File này do `08-tong-hop.py` tự sinh từ dữ liệu thô. **Không sửa tay** – muốn sửa thì sửa dữ liệu/script rồi chạy lại.

## 0. Môi trường chạy

```
Thời điểm ghi: 2026-11-12T16:18:40.036+07:00
Commit đang chạy: 4220045e0b7f4f61a925033ff1196536e46597c4 (nhánh thuc-nghiem/so-lieu-2026-11-11)
Code có sửa chưa commit?: 39 file
Hệ điều hành: Linux 7.2.14-arch1-1 x86_64
CPU: 13th Gen Intel(R) Core(TM) i5-13420H, 12 luồng
RAM: 15Gi
Node: v26.13.0 | npm: 12.2.2
Docker: Docker version 29.9.3, build 5457199aa5 | Docker Compose version 5.7.0
PostgreSQL (image): postgres:17
Java: openjdk version "27.0.1.0.3" 2026-10-24
Cấu hình hệ thống khi đo (mặc định trong compose.yaml): chờ HTTP 3 s; thử lại sau 2 s, 4 s, 8 s (tối đa 4 lần);
  giữ việc (lease) 15 s; quét hàng đợi mỗi 1 s; LIS và middleware mỗi bên 1 tiến trình xử lý nền.
```

## 1. Các chỉ số đánh giá M1–M13

| Chỉ số | Ý nghĩa | Kết quả | Lấy từ file |
|---|---|---|---|
| M1 | Tỷ lệ hoàn tất đầu–cuối (lưu đúng, đúng bệnh nhân, đọc lại được) | 1.000 kết quả: 1000/1000 (100.0%)<br>40 kết quả lõi: 40/40 (100.0%) | E1-1000-ket-qua/doi-chieu/comparison-report.json |
| M2 | Độ chính xác theo trường (MR01–MR09) | 1.000 kết quả: 24000/24000 (100.0%)<br>40 kết quả lõi: 960/960 (100.0%) | E1-1000-ket-qua/doi-chieu/field-comparisons.jsonl |
| M3 | Tính đầy đủ (trường phải có thì có mặt ở EMR) | 1.000 kết quả: 18302/18302 (100.0%)<br>40 kết quả lõi: 730/730 (100.0%) | E1-1000-ket-qua/doi-chieu/field-comparisons.jsonl |
| M4 | Số kết quả gắn sai bệnh nhân | 1.000 kết quả: 0<br>Thêm: E2: 3/3 ca bệnh nhân không liên kết bị từ chối, không lưu | comparison-report.json; E2-sai-benh-nhan-du-lieu-sai/7a-ket-qua.txt |
| M5 | Số bản ghi trùng ở EMR | 1.000 kết quả: 0<br>Thêm: E3 sau mọi lần gửi trùng: 0 mã bị trùng | comparison-report.json; E3-gui-trung/dem-sau.txt |
| M6 | Số lần báo hoàn tất nhưng thực tế sai | 1.000 kết quả: 0<br>Thêm: E4b (EMR tắt lâu): 0 ca báo hoàn tất sai | E1-1000-ket-qua/ket-qua-khong-dat-doi-chieu.txt; E4-gian-doan/E4b-ket-qua.csv |
| M7 | Tỷ lệ ca ngoại lệ xử lý đúng | Tổng: 48/48 (100.0%)<br>Bệnh nhân không có liên kết (TC02): 3/3 (100.0%)<br>Dữ liệu sai gửi vào middleware (TC03): 6/6 (100.0%)<br>Dữ liệu sai gửi thẳng vào EMR (TC03): 10/10 (100.0%)<br>Gửi trùng (TC04): 15/15 (100.0%)<br>Thành phần tạm ngừng (TC05): 12/12 (100.0%)<br>Mất phản hồi sau khi lưu (TC06, test tự động): 1/1 (100.0%)<br>Đọc lại thấy sai (TC07, test tự động): 1/1 (100.0%) | kiem-tra.jsonl (kịch bản E2, E3, E4, AUTO) |
| M8 | Bản FHIR đạt kiểm tra cấu trúc (HL7 validator, R4 4.0.1) | 1.000 kết quả: 1000/1000 | kiem-tra-fhir/tom-tat.txt, kiem-tra-fhir/log-validator.txt |
| M9 | Độ trễ đầu–cuối (Publish → hoàn tất) | Gửi từng kết quả một (40 lõi): trung vị 901.7 ms, p95 1.91 s, lớn nhất 2.07 s<br>Dồn 1.000 kết quả cùng lúc: trung vị 521.25 s, p95 987.60 s, lớn nhất 1041.30 s; tốc độ ~0.95 kết quả/giây<br>Theo công cụ đo (1.000): p50 521.92 s, p95 987.79 s (đo từ phía công cụ, có cộng thời gian hỏi lại mỗi 1 s) | E1A-do-tre-tung-ket-qua/thoi-gian-tung-chang.csv |
| M10 | Thời gian ánh xạ sang FHIR | Gửi từng kết quả một (40 lõi): trung vị 0.424 ms, lớn nhất 0.837 ms<br>Dồn 1.000 kết quả cùng lúc: trung vị 0.329 ms, lớn nhất 4.9 ms | E1A-do-tre-tung-ket-qua/thoi-gian-tung-chang.csv |
| M11 | Thời gian phục hồi (từ lúc thành phần chạy lại → kết quả hoàn tất) | EMR tắt ngắn (E4a): trung vị 3.00 s, lớn nhất 5.41 s (n=10)<br>Middleware tắt ngắn (E4d): trung vị 6.48 s, lớn nhất 10.79 s (n=10) | E4-gian-doan/E4a-ket-qua.csv |
| M12 | Tỷ lệ phục hồi thành công | Tự phục hồi, EMR tắt ngắn (E4a): 10/10 (100.0%)<br>Tự phục hồi, middleware tắt ngắn (E4d): 10/10 (100.0%)<br>EMR tắt lâu (E4b), tự phục hồi: 0 (đúng thiết kế: hết lượt thử lại thì dừng ở FAILED)<br>Sau khi người vận hành đưa lại (E4c): 10/10 (100.0%) | E4-gian-doan/E4a-ket-qua.csv, E4c-ket-qua.csv, E4d-ket-qua.csv |
| M13 | Mức độ bao phủ bằng chứng (yêu cầu cốt lõi có bằng chứng đạt / 12) | Giá trị: 12/12 (100.0%) | kiem-tra.jsonl |

## 2. Yêu cầu cốt lõi và bằng chứng (dùng cho M13)

| Yêu cầu | Nội dung | Kết luận | Số phép kiểm tra đạt |
|---|---|---|---|
| REQ-FLOW-01 | Kết quả hợp lệ đi trọn LIS → middleware → EMR, đọc lại đúng | ĐẠT | 3/3 |
| REQ-ID-01 | Đúng bệnh nhân; thiếu liên kết thì từ chối | ĐẠT | 4/4 |
| REQ-DATA-01 | Giữ đúng mã, tên, ngữ cảnh, giá trị, đơn vị (MR03–05, MR09) | ĐẠT | 1/1 |
| REQ-DATA-02 | Giữ đúng cận tham chiếu, thời điểm, trạng thái (MR06–08) | ĐẠT | 1/1 |
| REQ-FHIR-01 | Observation đúng cấu trúc FHIR R4 | ĐẠT | 2/2 |
| REQ-ERR-01 | Dữ liệu sai bị từ chối có lý do, không lưu, không báo hoàn tất | ĐẠT | 18/18 |
| REQ-DUP-01 | Gửi trùng không tạo bản ghi mới; khác nội dung thì báo xung đột | ĐẠT | 15/15 |
| REQ-RETRY-01 | Lỗi tạm thời được thử lại có giới hạn, không báo hoàn tất sai | ĐẠT | 9/9 |
| REQ-OUTBOX-01 | LIS giữ yêu cầu đến khi middleware xác nhận đã nhận | ĐẠT | 3/3 |
| REQ-WORKER-01 | Việc dở dang được nhận lại an toàn (test tự động) | ĐẠT | 1/1 |
| REQ-MEASURE-01 | Có mốc thời gian để đo từng chặng | ĐẠT | 1/1 |
| REQ-EVIDENCE-01 | Dữ liệu nguồn, FHIR, đích, nhật ký được liên kết để kiểm tra lại | ĐẠT | 2/2 |

## 3. Thời gian từng chặng

**Gửi từng kết quả một (40 kết quả lõi, bước 05)** – số kết quả: 40

| Chặng | Nhỏ nhất | Trung vị | p95 | Lớn nhất |
|---|---|---|---|---|
| LIS → middleware nhận | 56.8 ms | 459.3 ms | 928.5 ms | 991.9 ms |
| Chờ bộ xử lý nền nhận việc | 7.6 ms | 445.2 ms | 926.4 ms | 983.3 ms |
| Chuyển sang FHIR (ánh xạ) | 0.280 ms | 0.424 ms | 0.747 ms | 0.837 ms |
| Gửi sang EMR → EMR lưu | 10.2 ms | 14.4 ms | 72.6 ms | 109.3 ms |
| Đọc lại & xác minh | 14.5 ms | 21.3 ms | 29.6 ms | 30.8 ms |
| TỔNG (Publish → hoàn tất) | 641.7 ms | 901.7 ms | 1.91 s | 2.07 s |

**Dồn 1.000 kết quả cùng lúc (bước 02)** – số kết quả: 1000

| Chặng | Nhỏ nhất | Trung vị | p95 | Lớn nhất |
|---|---|---|---|---|
| LIS → middleware nhận | 1.05 s | 520.36 s | 987.50 s | 1040.28 s |
| Chờ bộ xử lý nền nhận việc | 7.1 ms | 441.2 ms | 967.5 ms | 1.01 s |
| Chuyển sang FHIR (ánh xạ) | 0.141 ms | 0.329 ms | 0.563 ms | 4.9 ms |
| Gửi sang EMR → EMR lưu | 7.6 ms | 12.2 ms | 25.4 ms | 146.3 ms |
| Đọc lại & xác minh | 10.5 ms | 18.1 ms | 34.5 ms | 152.0 ms |
| TỔNG (Publish → hoàn tất) | 1.76 s | 521.25 s | 987.60 s | 1041.30 s |

Ghi chú: p95 = 95% kết quả nhanh hơn mức này. Thời gian lấy từ mốc hệ thống tự ghi; bộ xử lý nền hỏi hàng đợi mỗi 1 giây nên 'chờ bộ xử lý nền nhận việc' dao động 0–1 s.

## 4. Đối chiếu theo từng trường (1.000 kết quả, bước 02)

| Quy tắc : trường | Đúng | Sai | Chưa xác minh |
|---|---|---|---|
| MR01:external_system | 1000 | 0 | 0 |
| MR01:result_id | 1000 | 0 | 0 |
| MR01:seed_tag | 1000 | 0 | 0 |
| MR01:source_labevent_id | 1000 | 0 | 0 |
| MR02:emr_patient.exists | 1000 | 0 | 0 |
| MR02:patient.identifier.system | 1000 | 0 | 0 |
| MR02:patient.identifier.value | 1000 | 0 | 0 |
| MR02:patient.subject_type | 1000 | 0 | 0 |
| MR02:patient_key | 1000 | 0 | 0 |
| MR02:patient_link.count | 1000 | 0 | 0 |
| MR03:test.code | 1000 | 0 | 0 |
| MR03:test.display | 1000 | 0 | 0 |
| MR03:test.system | 1000 | 0 | 0 |
| MR04:quantity | 1000 | 0 | 0 |
| MR05:unit | 1000 | 0 | 0 |
| MR06:reference.high | 1000 | 0 | 0 |
| MR06:reference.low | 1000 | 0 | 0 |
| MR07:effective_at | 1000 | 0 | 0 |
| MR08:clinical_status | 1000 | 0 | 0 |
| MR08:source_status | 1000 | 0 | 0 |
| MR09:context | 1000 | 0 | 0 |
| MR09:laboratory.category | 1000 | 0 | 0 |
| MR09:source.category | 1000 | 0 | 0 |
| MR09:source.fluid | 1000 | 0 | 0 |

## 5. Kết quả từng phép kiểm tra (kỳ vọng ↔ thực tế)

### Kiểm tra trước khi chạy – đạt 1/1

| Mã | Kiểm tra gì | Kỳ vọng | Thực tế | Kết quả |
|---|---|---|---|---|
| PRE-OK | Kiểm tra trước khi chạy | đạt | đạt | ✅ Đạt |

### Bộ test tự động (TC06, TC07) – đạt 4/4

| Mã | Kiểm tra gì | Kỳ vọng | Thực tế | Kết quả |
|---|---|---|---|---|
| AUTO-TONG | Bộ test tự động: mã thoát 0 và không có test không đạt | mã thoát 0, không đạt 0 | mã thoát 0, không đạt 0 | ✅ Đạt |
| AUTO-SO-TEST | Bộ test tự động: có chạy test (tổng số > 0) | có | có | ✅ Đạt |
| AUTO-TC06 | TC06 được chứng minh bằng test tự động (số test liên quan đạt / không đạt) | ≥1 đạt, 0 không đạt | 6 đạt, 0 không đạt | ✅ Đạt |
| AUTO-TC07 | TC07 được chứng minh bằng test tự động (số test liên quan đạt / không đạt) | ≥1 đạt, 0 không đạt | 23 đạt, 0 không đạt | ✅ Đạt |

### E1 – 1.000 kết quả hợp lệ (TC01) – đạt 13/13

| Mã | Kiểm tra gì | Kỳ vọng | Thực tế | Kết quả |
|---|---|---|---|---|
| E1-THU | Chạy thử: 20/20 kết quả đi trọn luồng | 20 | 20 | ✅ Đạt |
| E1-TRUOC | Trước khi chạy: EMR chưa có kết quả nào | 0 | 0 | ✅ Đạt |
| E1-M1-CONGCU | Số kết quả công cụ đo thấy đi trọn luồng (LIS→EMR, đọc lại đúng) | 1000 | 1000 | ✅ Đạt |
| E1-DELIVERED | Số giao dịch middleware ở trạng thái hoàn tất (DELIVERED) | 1000 | 1000 | ✅ Đạt |
| E1-DOICHIEU | Kết luận của bộ đối chiếu độc lập | PASS | PASS | ✅ Đạt |
| E1-KHOP | Số kết quả khớp hoàn toàn với đáp án | 1000 | 1000 | ✅ Đạt |
| E1-M4 | Số kết quả gắn sai bệnh nhân | 0 | 0 | ✅ Đạt |
| E1-M5 | Số kết quả bị lưu trùng | 0 | 0 | ✅ Đạt |
| E1-SAI-TRUONG | Số kết quả có ít nhất 1 trường sai | 0 | 0 | ✅ Đạt |
| E1-THIEU | Số kết quả không tìm thấy ở EMR | 0 | 0 | ✅ Đạt |
| E1-M6 | Số giao dịch báo hoàn tất nhưng đối chiếu độc lập thấy sai | 0 | 0 | ✅ Đạt |
| E1-40-LOI | Tập 40 kết quả lõi: số kết quả đạt đối chiếu | 40 | 40 | ✅ Đạt |
| E1-FHIR-XUAT | Số bản FHIR Observation đã xuất để kiểm tra cấu trúc | 1000 | 1000 | ✅ Đạt |

### E1A – gửi từng kết quả một (TC01, thời gian) – đạt 2/2

| Mã | Kiểm tra gì | Kỳ vọng | Thực tế | Kết quả |
|---|---|---|---|---|
| E1A-HOANTAT | Gửi lần lượt 40 kết quả lõi: số kết quả hoàn tất | 40 | 40 | ✅ Đạt |
| E1A-1LAN | Tất cả đều xong ngay lần gửi đầu, không phải thử lại | 40 | 40 | ✅ Đạt |

### E2 – sai bệnh nhân, dữ liệu sai (TC02, TC03) – đạt 21/21

| Mã | Kiểm tra gì | Kỳ vọng | Thực tế | Kết quả |
|---|---|---|---|---|
| TC02-1 | Bệnh nhân không có liên kết (MUT-LAB-NOLINK-1): middleware từ chối, EMR không lưu | REJECTED, EMR=0 | REJECTED, EMR=0 | ✅ Đạt |
| TC02-2 | Bệnh nhân không có liên kết (MUT-LAB-NOLINK-2): middleware từ chối, EMR không lưu | REJECTED, EMR=0 | REJECTED, EMR=0 | ✅ Đạt |
| TC02-3 | Bệnh nhân không có liên kết (MUT-LAB-NOLINK-3): middleware từ chối, EMR không lưu | REJECTED, EMR=0 | REJECTED, EMR=0 | ✅ Đạt |
| TC03-MW-1 | Mã xét nghiệm không có trong danh mục (gói tin gửi vào middleware) | bị chặn, EMR không lưu | bị chặn ngay ở middleware (HTTP 422), EMR lưu 0 bản ghi | ✅ Đạt |
| TC03-MW-2 | Đơn vị đo không thuộc danh sách được chấp nhận (gói tin gửi vào middleware) | bị chặn, EMR không lưu | bị chặn ngay ở middleware (HTTP 422), EMR lưu 0 bản ghi | ✅ Đạt |
| TC03-MW-3 | Mã bệnh nhân không tồn tại (gói tin gửi vào middleware) | bị chặn, EMR không lưu | bị chặn sau khi tiếp nhận (REJECTED, REMOTE_VALIDATION_ERROR), EMR lưu 0 bản ghi | ✅ Đạt |
| TC03-MW-4 | Thiếu giá trị xét nghiệm (gói tin gửi vào middleware) | bị chặn, EMR không lưu | bị chặn ngay ở middleware (HTTP 400), EMR lưu 0 bản ghi | ✅ Đạt |
| TC03-MW-5 | Cận dưới lớn hơn cận trên (gói tin gửi vào middleware) | bị chặn, EMR không lưu | bị chặn ngay ở middleware (HTTP 422), EMR lưu 0 bản ghi | ✅ Đạt |
| TC03-MW-6 | Kết quả chưa ở trạng thái FINAL (gói tin gửi vào middleware) | bị chặn, EMR không lưu | bị chặn ngay ở middleware (HTTP 422), EMR lưu 0 bản ghi | ✅ Đạt |
| TC03-EMR-1 | Thiếu thông tin bệnh nhân (gửi thẳng vào EMR) | EMR từ chối (4xx), không lưu | HTTP 422, EMR lưu 0 bản ghi | ✅ Đạt |
| TC03-EMR-2 | Bệnh nhân không có liên kết ở EMR (gửi thẳng vào EMR) | EMR từ chối (4xx), không lưu | HTTP 422, EMR lưu 0 bản ghi | ✅ Đạt |
| TC03-EMR-3 | Giá trị không phải là số (gửi thẳng vào EMR) | EMR từ chối (4xx), không lưu | HTTP 422, EMR lưu 0 bản ghi | ✅ Đạt |
| TC03-EMR-4 | Cận dưới lớn hơn cận trên (gửi thẳng vào EMR) | EMR từ chối (4xx), không lưu | HTTP 422, EMR lưu 0 bản ghi | ✅ Đạt |
| TC03-EMR-5 | Thiếu thời điểm xét nghiệm (gửi thẳng vào EMR) | EMR từ chối (4xx), không lưu | HTTP 422, EMR lưu 0 bản ghi | ✅ Đạt |
| TC03-EMR-6 | Không phải tài nguyên Observation (gửi thẳng vào EMR) | EMR từ chối (4xx), không lưu | HTTP 422, EMR lưu 0 bản ghi | ✅ Đạt |
| TC03-EMR-7 | Mã xét nghiệm không có trong danh mục (gửi thẳng vào EMR) | EMR từ chối (4xx), không lưu | HTTP 422, EMR lưu 0 bản ghi | ✅ Đạt |
| TC03-EMR-8 | Đơn vị đo không thuộc danh sách được chấp nhận (gửi thẳng vào EMR) | EMR từ chối (4xx), không lưu | HTTP 422, EMR lưu 0 bản ghi | ✅ Đạt |
| TC03-EMR-9 | Đơn vị sai nhưng giá trị và các cận đều nhất quán (gửi thẳng vào EMR) | EMR từ chối (4xx), không lưu | HTTP 422, EMR lưu 0 bản ghi | ✅ Đạt |
| TC03-EMR-10 | Đơn vị sai khi không có cận tham chiếu (gửi thẳng vào EMR) | EMR từ chối (4xx), không lưu | HTTP 422, EMR lưu 0 bản ghi | ✅ Đạt |
| E2-TONG-1 | Số ca lỗi bị báo hoàn tất (DELIVERED) sai | 0 | 0 | ✅ Đạt |
| E2-TONG-2 | Số ca lỗi có bản ghi lọt vào EMR | 0 | 0 | ✅ Đạt |

### E3 – gửi trùng (TC04) – đạt 15/15

| Mã | Kiểm tra gì | Kỳ vọng | Thực tế | Kết quả |
|---|---|---|---|---|
| E3-LIS-MIMIC-LAB-102 | Publish lại MIMIC-LAB-102: LIS trả 200 (đã có), không tạo sự kiện mới | 200 | 200 | ✅ Đạt |
| E3-LIS-EV-MIMIC-LAB-102 | Publish lại MIMIC-LAB-102: vẫn giữ đúng mã sự kiện cũ | cf6dceff-e11a-41ab-87c0-d19c43469d16 | cf6dceff-e11a-41ab-87c0-d19c43469d16 | ✅ Đạt |
| E3-LIS-MIMIC-LAB-106 | Publish lại MIMIC-LAB-106: LIS trả 200 (đã có), không tạo sự kiện mới | 200 | 200 | ✅ Đạt |
| E3-LIS-EV-MIMIC-LAB-106 | Publish lại MIMIC-LAB-106: vẫn giữ đúng mã sự kiện cũ | 9a19bffd-3e98-4b04-a766-1d93c8ee7fa6 | 9a19bffd-3e98-4b04-a766-1d93c8ee7fa6 | ✅ Đạt |
| E3-LIS-MIMIC-LAB-118 | Publish lại MIMIC-LAB-118: LIS trả 200 (đã có), không tạo sự kiện mới | 200 | 200 | ✅ Đạt |
| E3-LIS-EV-MIMIC-LAB-118 | Publish lại MIMIC-LAB-118: vẫn giữ đúng mã sự kiện cũ | c35e271a-8942-4b01-82bd-996ce3ff3259 | c35e271a-8942-4b01-82bd-996ce3ff3259 | ✅ Đạt |
| E3-MW-1 | Gửi lại y nguyên gói tin sang middleware: được nhận (202) | HTTP 202 | HTTP 202 | ✅ Đạt |
| E3-MW-2 | …và trả lại ĐÚNG mã giao dịch cũ (không tạo giao dịch mới) | 4c1c56d0-0cbf-42cf-9c6e-90188b868c77 | 4c1c56d0-0cbf-42cf-9c6e-90188b868c77 | ✅ Đạt |
| E3-MW-3 | Cùng mã sự kiện nhưng nội dung khác: middleware từ chối (4xx) | 4xx | 4xx | ✅ Đạt |
| E3-EMR-1 | Gửi lại y nguyên Observation vào EMR: trả 200 (đã có) | HTTP 200 | HTTP 200 | ✅ Đạt |
| E3-EMR-2 | …và trả lại ĐÚNG mã bản ghi cũ | af213c15-8347-440c-a0da-07e54e5a0f70 | af213c15-8347-440c-a0da-07e54e5a0f70 | ✅ Đạt |
| E3-EMR-3 | Cùng mã kết quả nhưng giá trị khác: EMR báo xung đột (409) | HTTP 409 | HTTP 409 | ✅ Đạt |
| E3-EMR-4 | …giá trị đã lưu KHÔNG bị ghi đè | 0.3 | 0.3 | ✅ Đạt |
| E3-DEM-1 | Tổng số sự kiện / giao dịch / bản ghi EMR không đổi sau mọi lần gửi trùng | 1000 1000 1000 | 1000 1000 1000 | ✅ Đạt |
| E3-DEM-2 | Không có mã kết quả nào bị lưu 2 lần ở EMR | 0 | 0 | ✅ Đạt |

### E4 – thành phần tạm ngừng (TC05) – đạt 12/12

| Mã | Kiểm tra gì | Kỳ vọng | Thực tế | Kết quả |
|---|---|---|---|---|
| E4a-1 | EMR tắt ngắn: số kết quả tự hoàn tất sau khi EMR chạy lại | 10 | 10 | ✅ Đạt |
| E4a-2 | EMR tắt ngắn: có tự thử lại (số kết quả phải gửi > 1 lần) | > 0 | 4 | ✅ Đạt |
| E4a-3 | EMR tắt ngắn: mỗi kết quả đúng 1 bản ghi ở EMR (không mất, không trùng) | 10 | 10/10 | ✅ Đạt |
| E4b-1 | EMR tắt lâu: không ca nào bị báo hoàn tất khi EMR đang tắt | 0 | 0 | ✅ Đạt |
| E4b-2 | EMR tắt lâu: hết số lần thử lại thì dừng ở FAILED (không thử mãi) | 10 | 10 | ✅ Đạt |
| E4b-3 | EMR tắt lâu: không có bản ghi nào lọt vào EMR | 0 | 0 | ✅ Đạt |
| E4b-4 | EMR tắt lâu: LIS vẫn ghi nhận middleware đã nhận (ACK), dữ liệu gốc còn nguyên ở middleware | 10 | 10 | ✅ Đạt |
| E4c-1 | Sau khi người vận hành đưa lại: số ca hoàn tất | 10 | 10 | ✅ Đạt |
| E4c-2 | Sau khi đưa lại: mỗi kết quả đúng 1 bản ghi ở EMR | 10 | 10 | ✅ Đạt |
| E4d-1 | Middleware tắt: LIS KHÔNG báo 'đã nhận' (ACK) giả trong lúc middleware tắt | 0 | 0 | ✅ Đạt |
| E4d-2 | Middleware chạy lại: số kết quả LIS tự gửi lại và hoàn tất | 10 | 10 | ✅ Đạt |
| E4d-3 | Middleware chạy lại: không sinh giao dịch trùng | 10 | 10 | ✅ Đạt |

### Kiểm tra cấu trúc FHIR (M8) – đạt 2/2

| Mã | Kiểm tra gì | Kỳ vọng | Thực tế | Kết quả |
|---|---|---|---|---|
| FHIR-THU | Một Observation namespace mới qua validator trước khi kiểm tra toàn bộ | 0 lỗi | 0 lỗi | ✅ Đạt |
| FHIR-M8 | Số bản FHIR Observation không có lỗi cấu trúc (theo HL7 validator) | 1000 | 1000 | ✅ Đạt |

## 6. Các ca KHÔNG như kỳ vọng

Không có.

## 7. Biểu đồ

![1-thoi-gian-tung-chang.png](bieu-do/1-thoi-gian-tung-chang.png)

![2-do-tre-tung-ket-qua.png](bieu-do/2-do-tre-tung-ket-qua.png)

![3-do-tre-khi-don-1000.png](bieu-do/3-do-tre-khi-don-1000.png)

![4-phuc-hoi-E4a.png](bieu-do/4-phuc-hoi-E4a.png)


## 8. Trạng thái các bước

- 00-kiem-tra-truoc.xong: 2026-11-12T16:18:40.506+07:00
- 01-test-tu-dong.xong: 2026-11-12T16:43:34.846+07:00
- 02-E1-1000-ket-qua.xong: 2026-11-12T16:37:24.887+07:00
- 03-E3-gui-trung.xong: 2026-11-12T16:37:32.350+07:00
- 04-E2-sai-benh-nhan-du-lieu-sai.xong: 2026-11-12T16:37:55.665+07:00
- 05-E1A-do-tre-tung-ket-qua.xong: 2026-11-12T16:40:08.558+07:00
- 06-E4-gian-doan.xong: 2026-11-12T16:42:25.166+07:00
- 07-kiem-tra-fhir.xong: 2026-11-12T16:43:24.676+07:00
