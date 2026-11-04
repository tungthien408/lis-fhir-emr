# SPP-74 — Checklist kiểm chéo nghiệm thu

Written for: người chủ trì nghiệm thu Nguyễn Thị Ngọc Tú; người kiểm chéo Dương Tùng Thiện (nếu nhóm chọn).

Cột "Kết quả AI" là kết quả kiểm tra của AI ngày 04/11/2026, kèm chỗ để kiểm lại. Cột cuối để người kiểm tự đánh dấu sau khi đối chiếu. **Không có chữ ký hay xác nhận nào được điền thay con người.**

Ký hiệu: VERIFIED (đã kiểm thật), NOT_VERIFIED (chưa kiểm, có nguyên nhân), BLOCKED (cần quyết định/hành động của người).

## A. Tiêu chí nghiệm thu của SPP-74

| # | Tiêu chí | Kết quả AI | Kiểm lại bằng | Người kiểm |
|---|---|---|---|---|
| 1 | Có commit/tag lấy lại được đúng phiên bản | **VERIFIED** — commit `e0c9717` (mã pilot), `fdb9738` (script), tag `spp74-experiment-v1` ở commit cuối. Đã clone sạch + checkout + hash khớp | `git rev-parse spp74-experiment-v1^{commit}`; `01-source-freeze.md` mục 3 | ☐ |
| 2 | Có SHA-256 đầy đủ của dữ liệu, oracle, thành phần quan trọng | **VERIFIED** — seed, schema, oracle (6 file), MIMIC (2 file), lockfile, Dockerfile, compose | `02-data-manifest.md`; `scripts/pilot/preflight.sh` | ☐ |
| 3 | Có bản ghi máy, phần mềm, PostgreSQL, dịch vụ, thử tải | **VERIFIED** — đọc từ máy thật | `03-environment-manifest.md`, `04-experiment-config.md` | ☐ |
| 4 | Có hướng dẫn khởi tạo và chạy lại bằng lệnh đã xác minh | **VERIFIED** từng bước đã làm; một số bước **NOT_VERIFIED** (xem mục B) | `05-reproduction-check.md` | ☐ |
| 5 | Có phương án lưu bằng chứng 3,9 GB, vị trí và cách kiểm tra rõ ràng | Cách kiểm tra: **VERIFIED** (manifest 151 file + lệnh). Vị trí lưu bền vững: **BLOCKED** (chưa có) | `06-evidence-index.md` mục 1, 5, 6 | ☐ |
| 6 | Không đổi ngầm code, seed, oracle, cấu hình giữa các lượt | **VERIFIED** — `source_tree_sha256` trùng 4/4 nguồn; thay đổi SPP-74 chỉ ở `scripts/pilot/` và tài liệu, đã ghi trong commit | `01-source-freeze.md`; `git diff e0c9717..fdb9738 --stat` | ☐ |
| 7 | Có hồ sơ bàn giao cho SPP-75 | **VERIFIED** (đã viết) | `08-spp75-handoff.md` | ☐ |
| 8 | Có checklist kiểm chéo của Nguyễn Thị Ngọc Tú | Tài liệu này | — | ☐ |

## B. Điểm cần người kiểm chú ý

| # | Điểm | Trạng thái | Ghi chú |
|---|---|---|---|
| B1 | Bằng chứng pilot chỉ tồn tại trên một máy | **BLOCKED** | Rủi ro mất bằng chứng. Cần chọn nơi lưu |
| B2 | Cấu hình khóa (7 phần tử retry) chưa được đo trực tiếp với gián đoạn 30 s/60 s | **NOT_VERIFIED** | Đã đo với 6 phần tử. Đề xuất chạy lại F8-R/F10-R trước SPP-75 |
| B3 | Dựng lại image Docker từ `Dockerfile` | **NOT_VERIFIED** | Dockerfile dùng tag trôi `node:22`. Cách giữ nguyên: dùng lại image ID đã ghi |
| B4 | Chạy `docker compose` từ đầu | **NOT_VERIFIED** | Cổng 3101–3103, 5433 đang bị stack pilot chiếm; không dừng stack pilot để thử |
| B5 | Lượt tái lập chỉ chạy chế độ A (tuần tự), không chạy B | Ghi nhận | Chế độ B dùng cùng script, chỉ đổi tham số |
| B6 | Baseline DB pilot (có `DEMO-R1`) khác DB dựng sạch từ repo | Đã xử lý | Đổi baseline mặc định; xem `02-data-manifest.md` mục 5 |
| B7 | Oracle là "bản đóng băng cục bộ, chưa có xác nhận của chủ SPP-65" | Ghi nhận | Chính `manifest.json` ghi giới hạn này |
| B8 | Hash `source_tree_sha256` phụ thuộc locale `sort` | Ghi nhận | Chỉ so sánh cùng môi trường; từng file đã so sánh khớp |
| B9 | B2 (SPP-73) có số thời gian không tin cậy | Mở từ SPP-73 | Chưa chạy lại |
| B10 | Tag chưa push | Ghi nhận | Người phụ trách tự quyết định push |
| B11 | Token cô lập phải là UUID; lượt tái lập đầu hỏng vì điều này | Đã xử lý | Script nay kiểm trước; xem `05-reproduction-check.md` mục 3 |
| B12 | HTTP timeout SPP-73 ghi chung 10.000 ms, thực tế Dispatcher/Worker là 3.000 ms | Đã đính chính | `04-experiment-config.md` mục 2–3 |

## C. Kết luận (người kiểm điền)

- Đề xuất của AI: SPP-74 **đủ điều kiện chuyển Review**; **chưa nên Done** cho tới khi B1 được giải quyết (hoặc nhóm chấp nhận rủi ro bằng văn bản).
- Trạng thái Jira do người phụ trách quyết định. AI không chuyển trạng thái.

Người chủ trì (Nguyễn Thị Ngọc Tú): ____________________  Ngày: __________

Người kiểm chéo: ____________________  Ngày: __________
