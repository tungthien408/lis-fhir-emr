# Tiến độ thực nghiệm sau sửa lỗi – 2026-11-12

| Giờ (UTC+7) | Bước | Kết quả |
|---|---|---|
| Trước đo | Sửa và kiểm thử | Hồi quy âm trên code cũ xác nhận lỗi; backend check, frontend check/build/test, SPP82, ops và test khóa file/parser đạt |
| 16:18 | 00 | Đạt; ghi fingerprint mã nguồn, cấu hình, namespace/catalog/oracle. Stack demo không chạy trước đợt đo |
| 16:19 | E1 thử | 20/20 hoàn tất; dựng lại lisexp sạch trước lượt chính |
| 16:37 | E1 | 1000/1000 khớp oracle v3; 24000/24000 phép so sánh trường đạt |
| 16:37 | E3 | 15/15 phép đạt; không mất dữ liệu hoặc tạo trùng |
| 16:37 | E2 | 21/21 phép đạt; dữ liệu sai DELIVERED=0, bản ghi sai EMR=0 |
| 16:38 | Chrome | Cả ba entrypoint đạt; tìm bệnh nhân, đọc EMR, 9 trường khớp và receipt STORED; chỉ GET |
| 16:40 | E1A | 40/40 hoàn tất ngay lần gửi đầu |
| 16:42 | E4 | 12/12 phép đạt; requeue hoàn tất 10/10, không trùng |
| 16:42 | 01 và 07 | Bắt đầu cùng giây; không tranh file kết quả |
| 16:43 | FHIR | 1000/1000 file không có error/fatal; giữ nguyên 4000 warning |
| 16:43 | Test | 522/522 test PostgreSQL đạt, bỏ qua 0; TC06 6 test, TC07 23 test đạt |
| 16:43 | 08 | Tổng 70/70 đạt; tạo chi-so.json, bảng tổng hợp và 4 biểu đồ |

## Ghi nhận

- Không sửa code sản phẩm trong thời gian đo; 170 file nguồn trong manifest không đổi.
- 1136 file của đợt 11/11 và oracle v2 giữ nguyên; kết quả kiểm tra trong kiem-thu-ban-sua/integrity.json.
- SPP82: 114/114; ops: 13/13; frontend: 92/92. Có log, probe trước–sau và ảnh Chrome trong thư mục đợt này.
- Không đổi cấu hình hiệu năng hay tối ưu dispatcher. E4c dùng ngân sách đưa lại tạm như protocol cũ, rồi trả mặc định.
- Không di trú DB demo cũ, không tự commit/push. Đóng gói bằng PACK_GIT=0.

## Hoàn tất

- 16:46: bước 09 xong với PACK_GIT=0; đã dọn riêng project lisexp. Không có stack demo đang chạy trước đợt đo nên không cần bật lại container nào.
- Đã xác minh đủ 1155 checksum của minh chứng (33,28 MiB sau nén).
- Kiểm tra cuối: 70/70 đạt; 1136 file bằng chứng cũ/oracle v2 không đổi; 170 file nguồn trong manifest không đổi; git index không có thay đổi.
- Báo cáo bàn giao: BAO_CAO_KET_QUA_THUC_NGHIEM.md và THAY_DOI_VA_KIEM_THU.md. Không còn bước thực nghiệm đang chờ.
