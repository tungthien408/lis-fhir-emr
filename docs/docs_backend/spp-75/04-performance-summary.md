# SPP-75 – Tổng hợp hiệu năng
Chỉ dùng lượt hợp lệ: A = A1, A2, A3; B = B1R, B2, B3 (n=3 mỗi nhóm). Tính từ metrics.json (xem 04-stats.json).

| Nhóm | Chỉ số | Trung bình | Min | Max | Dao động (max−min)/mean |
|---|---|---|---|---|---|
| A | Thời gian (s) | 1059.5 | 1056.1 | 1064.9 | 0.83% |
| A | Thông lượng (kq/s) | 0.9439 | 0.9390 | 0.9468 | 0.83% |
| A | p50 (s) | 524.8 | 523.8 | 526.1 | 0.43% |
| A | p95 (s) | 998.2 | 995.5 | 1001.5 | 0.61% |
| B | Thời gian (s) | 1062.0 | 1061.0 | 1063.0 | 0.18% |
| B | Thông lượng (kq/s) | 0.9416 | 0.9408 | 0.9425 | 0.18% |
| B | p50 (s) | 529.7 | 528.2 | 530.7 | 0.48% |
| B | p95 (s) | 1006.3 | 1005.4 | 1007.5 | 0.20% |

## Nhận xét trong phạm vi bằng chứng
- Độ ổn định: mỗi nhóm dao động <1% giữa 3 lượt; không có retry, timeout hay lỗi nào.
- Tác động của concurrency=5: thời gian A ≈ 1.059 s, B ≈ 1.062 s (chênh ~0,2%, nhỏ hơn dao động nội bộ của A). **Không có bằng chứng concurrency=5 nhanh hơn**; không kết luận B nhanh hơn.
- Lý do khả dĩ (chưa đo tách chặng, REPORTED/giả thuyết): concurrency chỉ giới hạn số HTTP Publish đồng thời, mà Publish trả 202 gần như ngay; phía sau chỉ có 1 Dispatcher và 1 Worker xử lý nối tiếp (~0,94 kết quả/s). Concurrency Publish ≠ 5 Worker song song.
- p50/p95 tính từ lúc bắt đầu Publish nên chủ yếu là thời gian chờ trong hàng đợi, không phải thời gian xử lý một giao dịch.
- Giới hạn: một máy cục bộ, một cấu hình, n=3; không suy rộng sang hệ thống bệnh viện thật, không so sánh với kiến trúc khác. Đây là MVP nghiên cứu thực nghiệm.
