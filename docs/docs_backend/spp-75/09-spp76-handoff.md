# Bàn giao SPP-76
- Dữ liệu dùng được cho Chương 3: bảng 03, thống kê 04, giới hạn trong 04 và 06.
- Thông điệp có bằng chứng: dữ liệu đúng 1.000/1.000 ở 7 lượt; ổn định <1%; concurrency=5 không cho thông lượng khác biệt (≈0,94 kq/s) vì 1 Dispatcher + 1 Worker.
- Không được viết: B nhanh hơn A; hiệu năng bệnh viện thật; tối ưu hơn kiến trúc khác.
- Cần trước khi viết: kiểm chéo (08), quyết định kế thừa ca (05), sao lưu bằng chứng (07).
- Việc mở: tách thời gian từng chặng; thử nhiều Dispatcher/Worker nếu cần kết luận về mở rộng.
