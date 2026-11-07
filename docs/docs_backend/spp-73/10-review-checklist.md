# SPP-73 — Checklist kiểm chéo nghiệm thu

Written for: người chủ trì (Nguyễn Thị Ngọc Tú) và người kiểm chéo (Dương Tùng Thiện).

Tài liệu này chỉ ghi kết quả kiểm tra của AI, và trạng thái theo từng mục. **Không có chữ ký nào được điền thay người.** Người kiểm chéo tự đối chiếu với bằng chứng gốc rồi đánh dấu.

Kết luận của AI (03/11/2026): **NOT_READY**. Lý do: 2 blocker tái lập ở `07-pilot-summary.md`, mục 6.

## A. Ca bắt buộc

| # | Mục | Kết quả AI | Bằng chứng | Người kiểm |
|---|---|---|---|---|
| A1 | Tuần tự 1.000 kết quả (3 lượt) | PASS 3/3 | `pilot-evidence/final/A1–A3/verification/` | ☐ |
| A2 | Đồng thời 1.000 kết quả (3 lượt) | PASS 3/3 (B2 có suspend, số thời gian không dùng) | `pilot-evidence/final/B1–B3/verification/` | ☐ |
| A3 | Đối chiếu đúng hồ sơ bệnh nhân | PASS (6/6 lượt, 0 sai bệnh nhân) | `final/*/verification/comparison-report.json` | ☐ |
| A4 | Không mất, không trùng ngoài ý muốn | PASS (0 thiếu, 0 trùng) | như trên | ☐ |
| A5 | Ca lỗi bắt buộc F1–F10 | PASS sau xử lý (F8/F10 lượt đầu FAIL, đã sửa và kiểm lại) | `pilot-evidence/faults/`, `faults-retry-config/` | ☐ |
| A6 | Ca liên kết sai bệnh nhân (TC-06) | PASS | `pilot-evidence/tc06-swapped-patient/` | ☐ |
| A7 | Ghi log và đọc lại tại EMR | PASS (đếm và đối chiếu từng hàng) | `final/*/after.json`, `verification/` | ☐ |

## B. Lỗi đã ghi và kiểm lại

| # | Mục | Kết quả AI | Ghi chú | Người kiểm |
|---|---|---|---|---|
| B1 | DEF-01 reset | Đã sửa, kiểm lại | `06-defect-log.md` | ☐ |
| B2 | DEF-02 journal lớn | Đã sửa, có test hồi quy | `test:spp82` 112/112 | ☐ |
| B3 | DEF-03 bộ đọc file lớn | Đã sửa, verify lại được | | ☐ |
| B4 | DEF-04/05 gián đoạn dài | Xử lý mức MVP. Cấu hình hiện tại chịu ~190 s (đã kiểm thực tế với cửa sổ ~126 s, gián đoạn 30 s và 60 s đều PASS). Gián đoạn dài hơn vẫn cần gửi lại thủ công | Giới hạn cần chấp nhận | ☐ |
| B5 | DEF-06 thiếu đường gửi lại | Đã thêm `ops:requeue-failed` | `test:ops` 13/13 | ☐ |
| B6 | OPS-02 2+2 tiến trình | Đã khắc phục | | ☐ |
| B7 | OPS-03 B2 bị suspend | **Mở** | Cần chấp nhận hoặc chạy lại B2 | ☐ |

## C. Cấu hình và quy trình

| # | Mục | Kết quả AI | Ghi chú | Người kiểm |
|---|---|---|---|---|
| C1 | Cấu hình được ghi và xác minh | PASS | `08-locked-protocol.md` | ☐ |
| C2 | Quy trình reset và kiểm reset | PASS (có guard, baseline) | Guard do người chạy kiểm | ☐ |
| C3 | Cách đo rõ ràng, mẫu số xác định | PASS | `07-pilot-summary.md` | ☐ |
| C4 | Lệnh tái lập đã xác minh | PASS phần lớn; `npm install` và `docker compose` chưa ghi chính xác | `09-reproduction-guide.md` | ☐ |
| C5 | Mã nguồn tái lập được | **FAIL** — chưa commit | Blocker 1 | ☐ |
| C6 | Nơi lưu bằng chứng đã quyết định | **FAIL** — chưa quyết định | Blocker 2 | ☐ |

## D. Kết luận nghiệm thu (để người kiểm điền)

- Trạng thái đề xuất của AI: **NOT_READY** (C5, C6).
- Khi C5 và C6 xong, AI đề xuất chuyển sang **READY_FOR_REVIEW**.
- **DONE** chỉ khi người chủ trì và người kiểm chéo đã đối chiếu và xác nhận. AI không đánh dấu DONE.

Người chủ trì: ____________________  Ngày: __________
Người kiểm chéo: ____________________  Ngày: __________
