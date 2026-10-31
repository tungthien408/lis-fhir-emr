# Dữ liệu khởi tạo demo LIS

Docker Compose tự nạp các file sau sau khi tạo schema và role, chỉ khi volume PostgreSQL chưa có database:

| File | Nội dung |
|---|---|
| `01_reference_data.sql` | 100 bệnh nhân LIS, 5 xét nghiệm, 100 bệnh nhân EMR và 100 liên kết định danh |
| `02_lis_results.sql` | 1.000 kết quả LIS, gồm đủ 40 ca chức năng, 100 bệnh nhân và 5 xét nghiệm |

Không cần nạp riêng bộ 40. Các kết quả có `result_status = 'FINAL'` và `provenance.seed_tag = 'DACN-MIMIC22-SOURCE-ALIGNED-V2'`. FINAL là trạng thái kết quả xét nghiệm, không có nghĩa đã Publish. Các script không tạo Publish event, giao dịch middleware hoặc kết quả EMR.

## Nguồn và phiên bản

Dữ liệu được chọn từ **MIMIC-IV Clinical Database Demo v2.2** và chuyển thành SQL phù hợp mô hình của đồ án. Đây là một tập con đã sàng lọc, không phải toàn bộ dataset nguồn. Tài liệu nguồn và giấy phép được lưu tại [`datasets/README.txt`](../../datasets/README.txt) và [`datasets/LICENSE.txt`](../../datasets/LICENSE.txt).

Hai file được sao chép nguyên nội dung từ gói bàn giao `DACN_Nap_LIS_pgAdmin`:

- `01_NAP_DANH_MUC_BENH_NHAN.sql` → `01_reference_data.sql`.
- `06_NAP_DU_1000_KET_QUA.sql` → `02_lis_results.sql`.

SHA-256 của các bản SQL được bàn giao:

```text
b66613cf2e1ed1f8d46ce6f0a0efc2efa976532e4e487bf6058ec43e835023e5  01_reference_data.sql
28b21b4e19f1df9b79d8ee10944e33e1f1fe20c0045abfd5b5d3fbcd89644fe7  02_lis_results.sql
```

Kết quả chức năng và tải dùng chung mã, không tạo 1.040 bản ghi. Phân bố: `50802`, `50912`, `50971`, `51222` mỗi loại 210; `51492` có 160.

## Database đã tồn tại

Restart container không chạy lại thư mục `/docker-entrypoint-initdb.d`. Máy đã có đủ bộ dữ liệu này không cần làm gì thêm.

Nếu muốn bổ sung vào một database thử nghiệm đã có cấu trúc phù hợp, sao lưu trước và chạy từ thư mục gốc dự án:

```bash
docker compose exec -T db psql -X -U postgres -d dacn_db -v ON_ERROR_STOP=1 < database/seed/01_reference_data.sql
docker compose exec -T db psql -X -U postgres -d dacn_db -v ON_ERROR_STOP=1 < database/seed/02_lis_results.sql
```

Các INSERT dùng `ON CONFLICT DO NOTHING`: chạy lại không nhân đôi mã nhưng cũng không sửa nội dung khác đã có cùng mã. Vì vậy cần kiểm tra dữ liệu sau khi nạp; không dùng việc chạy lệnh thành công làm bằng chứng toàn bộ nội dung đã khớp.

Kiểm tra số lượng riêng bộ MIMIC bằng lệnh trong [README chính](../../README.md). Mật khẩu các role ứng dụng vẫn được đặt theo hướng dẫn khởi chạy trong README chính.

## Kiểm chứng cấu hình Docker (31/10/2026)

Đã khởi tạo service `db` bằng Compose trên project kiểm thử riêng, volume mới và không mở cổng host. Kết quả: 100 bệnh nhân LIS, 5 xét nghiệm, 1.000 kết quả (40 ca chức năng), 100 bệnh nhân EMR và 100 liên kết; 0 Publish event, 0 giao dịch và 0 kết quả EMR.

Các truy vấn `03`, `05`, `07` từ gói bàn giao xác nhận đủ liên kết, kiểm tra bộ seed đạt và 0 dòng sai lệch với expected. Sau restart database, các kiểm tra vẫn đạt và số kết quả vẫn là 1.000. Hai SQL nạp khớp byte với file bàn giao. Việc này chưa kiểm ngược expected về CSV nguồn và chưa kiểm luồng Publish/FHIR/EMR.
