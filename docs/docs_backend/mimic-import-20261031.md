# Kết quả nạp bộ MIMIC vào database thử nghiệm

- Ngày chạy: 31/10/2026, khoảng 21:05 (Asia/Ho_Chi_Minh).
- Database: `dacn_db`, PostgreSQL trong service Compose `db`.
- Git HEAD tại thời điểm chạy: `e399e4ef36db6ca8399713d5655c3d612fbacfc8`; working tree sạch trước khi tạo báo cáo này.
- Script đầu vào nằm ngoài repository: `/home/thien408/Projects/2026-2027/dacn/dataset/DACN_Nap_LIS_pgAdmin/`. HEAD trên chỉ xác định phiên bản dự án, không chứng minh các script bên ngoài đã được lưu trong Git.

## Trước khi nạp

File `00` xác nhận đủ 13 bảng và 18 cột được kiểm tra. Database đã có một ca demo: bệnh nhân `DEMO-P1`, xét nghiệm `GLU-01`, kết quả `DEMO-R1`, một Publish event, một giao dịch tích hợp và một kết quả EMR. Các mã này khác bộ MIMIC.

Đã sao lưu bằng `pg_dump -Fc` trước khi ghi. Không reset database và không xóa dữ liệu demo.

## Thực hiện và kết quả

| Bước | Kết quả |
|---|---|
| `01` | Thêm 100 bệnh nhân LIS, 5 xét nghiệm, 100 bệnh nhân EMR, 100 liên kết; COMMIT |
| `02` | 7 dòng FAIL do kiểm tổng toàn database theo giả định database trống; số liệu thực tế có thêm dữ liệu demo đã tồn tại |
| `03` | 0 liên kết MIMIC sai lệch so với danh sách UUID trong script |
| `04`, `05` | Thêm 40 kết quả; PASS: 40 mã duy nhất, 6 bệnh nhân, 5 xét nghiệm; mỗi xét nghiệm 8 kết quả |
| `06`, `05` | Thêm 960 kết quả; PASS: tổng bộ MIMIC 1.000, gồm đủ 40 ca chức năng, 100 bệnh nhân, 5 xét nghiệm |
| `07` | 0 dòng sai lệch giữa expected trong script và LIS đối với các trường được so sánh |

Phân bố cuối: `50802`, `50912`, `50971`, `51222` mỗi loại 210 kết quả; `51492` có 160.

Kiểm tra bộ MIMIC: không thiếu bệnh nhân/danh mục/liên kết EMR; 0 lỗi ở các kiểm tra provenance, checksum khai báo, khoảng tham chiếu đảo, thời điểm thiếu và trạng thái khác FINAL. Chưa có kết quả MIMIC trong EMR và chưa có Publish event cho các kết quả MIMIC.

## Tổng database sau nạp

| Bảng | Số dòng |
|---|---:|
| `lis.patients` | 101 |
| `lis.test_catalog` | 6 |
| `lis.results` | 1.001 |
| `lis.publish_events` | 1 |
| `integration.exchange_transactions` | 1 |
| `emr.patients` | 101 |
| `emr.patient_links` | 101 |
| `emr.lab_results` | 1 |

Số liệu bao gồm ca demo cũ. Khi thử bộ MIMIC, lọc `lis.results.provenance->>'seed_tag' = 'DACN-MIMIC22-SOURCE-ALIGNED-V2'` thay vì lấy toàn bộ bảng.

## Bằng chứng và giới hạn

Log thực thi, SHA-256 các file đầu vào và bản sao lưu trước nạp nằm tại `/tmp/lis-mimic-import-20261031/`. Đây là thư mục tạm, cần sao chép nếu muốn lưu lâu dài.

Đã hoàn thành kiểm tra cấu trúc, nạp và đối chiếu dữ liệu với expected được gửi kèm. Chưa đối chiếu expected ngược về CSV MIMIC gốc; kiểm checksum khai báo trong provenance không thay thế việc băm CSV nguồn. Chưa xác nhận toàn bộ checklist bàn giao hay đánh dấu Done. Chưa chạy Publish/FHIR/EMR với bộ MIMIC và chưa thử tải.
