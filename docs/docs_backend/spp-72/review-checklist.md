# SPP-72 — Checklist kiểm chéo

Người chủ trì: Nguyễn Thị Ngọc Tú — Người kiểm chéo: Dương Tùng Thiện.
Các ô dưới đây **để trống**; chỉ người kiểm chéo được đánh dấu. AI không ký thay.

| # | Mục kiểm | Cách kiểm | Xác nhận (Thiện) | Ghi chú |
|---|---|---|---|---|
| 1 | `cd backend && npm run check` exit 0 | chạy lại | ☐ | |
| 2 | `npm run test:spp82` = 111 pass, 0 fail | chạy lại | ☐ | |
| 3 | 8 nhóm ca thử có đủ mã/mục tiêu/đầu vào/bước/expected/xác minh | đọc `test-cases.md` | ☐ | |
| 4 | Ca chưa chạy ghi NOT_RUN, không có PASS giả | đọc `test-cases.md` | ☐ | |
| 5 | Dữ liệu đột biến tách khỏi 1.000, nhãn `synthetic_mutation`; xác nhận hiện **chưa tạo** | đọc `test-data-and-mutations.md` | ☐ | |
| 6 | `datasets/`, seed, `reference/spp65-v2/` không bị sửa | `git status`/`git diff` | ☐ | |
| 7 | Expected không sinh từ Mapper/đầu ra (`verification/` không import production) | `grep import` | ☐ | |
| 8 | Ba mốc M1/M2/M3 được tách | `independent-verification.md` | ☐ | |
| 9 | Giao thức tải: c=1 và c=5, 3 lượt, reset, timeout, p50/p95 | `load-test-protocol.md` | ☐ | |
| 10 | Có file bằng chứng 1.000? Nếu chưa: giữ USER_REPORTED_UNVERIFIED | `evidence/README.md` | ☐ | |
| 11 | Không có số đo/hiệu năng tự bịa | đọc toàn bộ | ☐ | |
| 12 | Quyết định cuối (Review/Done hay yêu cầu bổ sung) | — | ☐ | |

Chữ ký/ngày kiểm chéo: ______________________

## Ghi nhận chấp nhận (03/11/2026)
Người kiểm thử đã chấp nhận SPP-72 hoàn thành trong phiên làm việc, dựa trên lần chạy 1.000 kết quả của chính họ (không lưu log). Các ô ☐ ở trên **không được AI đánh dấu**; người kiểm thử tự ký nếu muốn.
