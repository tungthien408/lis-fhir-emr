# SPP-74 — Nội dung bình luận Jira đề xuất

Written for: người phụ trách SPP-74 dán vào Jira.

**Bản nháp, chưa đăng.** AI không cập nhật Jira và không chuyển trạng thái. Đề xuất trạng thái: chuyển **Review**, chưa Done (xem mục "Còn mở").

---

SPP-74 / P5-01 — Chốt phiên bản và môi trường thực nghiệm (04/11/2026)

**Đã chốt**
- Phiên bản: nhánh `testing/spp-74`, tag cục bộ `spp74-experiment-v1` (chưa push). Mã pilot nằm ở commit `e0c9717`; `source_tree_sha256=49e9ebcb66b099760e2b8a6431a01bff66a5e1bbc774cb8ca02213f89cd14e2e` **trùng** với giá trị ghi ở cả 6 lượt SPP-73 (đã tính lại trên working tree, trên bản giải nén sạch và trên bản clone).
- Dữ liệu: SHA-256 đầy đủ của 2 file seed, schema, role, 6 file oracle `spp65-v2`, 2 file MIMIC nguồn, lockfile, Dockerfile, compose (`docs/docs_backend/spp-74/02-data-manifest.md`).
- Môi trường: Arch Linux, i5-13420H (8 nhân/12 luồng), 15 GiB RAM, Docker 29.9.2, PostgreSQL 17.11, Node v26.13.0 (host) và v22.23.4 (container), TypeScript 5.9.3 (`03-environment-manifest.md`).
- Cấu hình khóa: 1.000 kết quả; tuần tự c=1 và đồng thời c=5; 3 lượt mỗi chế độ; 1 Dispatcher + 1 Worker; retry `2000,4000,8000,16000,32000,64000,64000` cho cả hai (`04-experiment-config.md`). Script `scripts/pilot/preflight.sh` kiểm lại trước mỗi lượt.

**Đã kiểm chứng**
- Checkout sạch + `npm ci`: `check` exit 0, `test:spp82` 112/112, `test:ops` 13/13.
- Dựng DB sạch từ repo và chạy lượt A1 (1.000 kết quả) bằng đúng script: đối chiếu độc lập **PASS 1.000/1.000**, 0 thiếu/trùng/sai; thông lượng 0,9435 kết quả/giây, nằm trong khoảng pilot. Đây là lượt kiểm chứng tái lập, không phải số liệu chính thức.
- Toàn vẹn bằng chứng SPP-73: 151/151 file khớp SHA-256.

**Phát hiện khi tái lập (đã xử lý)**
- Baseline DB pilot (`events=1 exch=1 emr=1`) có sót `DEMO-R1`, không dựng lại được từ repo; DB sạch là `events=0 exch=0 emr=0`. Script đã đổi mặc định.
- `SPP82_VERIFICATION_ISOLATION_TOKEN` phải là UUID; lượt thử đầu publish xong nhưng capture/verify báo `NOT_VERIFIED`. Script nay kiểm trước khi chạy.
- `HTTP timeout` đúng là 10.000 ms cho client Publish của runner và 3.000 ms cho Dispatcher/Worker (tài liệu SPP-73 ghi chung 10.000 ms); đã đính chính.

**Còn mở**
1. **BLOCKED:** `pilot-evidence/` (≈3,9 GB) chỉ có một bản trên máy pilot, chưa có nơi lưu bền vững. Đã có bản kê SHA-256 và quy trình kiểm; cần người phụ trách chọn nơi lưu và sao chép.
2. Chưa đo trực tiếp F8-R/F10-R với cấu hình retry khóa (7 phần tử; pilot đo với 6). Khuyến nghị chạy lại trước SPP-75.
3. Chưa kiểm: `docker compose up` từ đầu, dựng lại image từ Dockerfile (tag trôi `node:22`), chế độ B trên checkout sạch.
4. Tag và nhánh chưa push; người phụ trách tự quyết định.

Chủ trì nghiệm thu: Nguyễn Thị Ngọc Tú — checklist `07-review-checklist.md`, chưa có chữ ký.

Bàn giao SPP-75: `docs/docs_backend/spp-74/08-spp75-handoff.md`.
