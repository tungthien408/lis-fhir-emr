# SPP-73 — Nội dung bình luận Jira đề xuất

Written for: người phụ trách SPP-73 dán vào Jira.

**Trạng thái bình luận: BẢN NHÁP, chưa đăng.** AI không cập nhật Jira và không đổi trạng thái công việc. Nội dung dưới đây nên đăng khi trạng thái là NOT_READY (hoặc sau khi xử lý 2 blocker, đổi thành READY_FOR_REVIEW).

---

SPP-73 — Kết quả pilot và trạng thái giai đoạn 3 (03/11/2026)

**Trạng thái đề xuất: NOT_READY** (chưa đủ điều kiện chuyển READY_FOR_REVIEW).

Đã xác minh bằng chạy thật:
- Tuần tự 1.000 kết quả: 3 lượt, mỗi lượt PASS đối chiếu độc lập 1.000/1.000, 0 thiếu/trùng/sai bệnh nhân.
- Đồng thời 1.000 kết quả: 3 lượt, mỗi lượt PASS 1.000/1.000. Lượt B2 bị máy tạm ngủ, số thời gian không dùng.
- TC-06 (liên kết sai bệnh nhân): PASS, bộ đối chiếu phát hiện lỗi.
- Ca lỗi F1–F10 trên stack pilot: F8/F10 lượt đầu FAIL, đã xử lý bằng cấu hình thử lại dài hơn và kiểm lại PASS. Gián đoạn vượt cửa sổ (~140 s) cần công cụ gửi lại thủ công (`ops:requeue-failed`), đã thử thật.
- Chưa kết luận B nhanh hơn A (chênh ~0,4%, nhỏ hơn dao động giữa các lượt A ~1,1%).

Blocker trước khi READY_FOR_REVIEW:
1. Mã pilot chưa commit (hash `source_tree_sha256=49e9ebcb…14e2e`), chưa tái lập được từ Git.
2. Chưa quyết định nơi lưu bằng chứng (~3,9 GB, không đưa vào Git).

Còn mở (không chặn nếu được chấp nhận): OPS-03 (B2 cần chạy lại nếu cần số thời gian sạch); giới hạn gián đoạn dài; chưa thử nhiều Dispatcher/Worker.

Tài liệu: `docs/docs_backend/spp-73/07-pilot-summary.md` đến `11-spp74-handoff.md`. Bằng chứng: `docs/docs_backend/spp-73/pilot-evidence/`.

Chữ ký nghiệm thu: chưa có. Chủ trì và người kiểm chéo sẽ xác nhận sau khi đối chiếu.
