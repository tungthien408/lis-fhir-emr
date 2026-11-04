# SPP-75 – Sai lệch protocol và bất thường
| # | Mô tả | Ảnh hưởng | Xử lý |
|---|---|---|---|
| D1 | Máy suspend 04:12Z–06:34Z trong B1 gốc (dù có systemd-inhibit) | Thời gian B1 gốc INVALID | Giữ nguyên artifact; chặn thêm lid-switch/suspend; chạy lại B1R (run ID mới) sau chuỗi |
| D2 | B1R chạy sau B3, lệch thứ tự A1→B1→A2→B2→A3→B3 | Thứ tự xen kẽ không hoàn toàn cho nhóm B | Người phụ trách chọn cách này; ghi nhận |
| D3 | Baseline `events=1 exch=1 emr=1` thay vì events=0 (DEMO-R1 sẵn có, không xóa) | Giống pilot SPP-73; không thuộc 1.000 | Ghi nhận |
| D4 | Runner mới `spp75-runner-v3` (sửa mã thoát) thay vì tag SPP-74 | Chỉ công cụ điều phối; application không đổi | Ghi nhận trong 02 |
| D5 | Preflight trước B1R báo "git còn thay đổi" (chỉ file bằng chứng chưa commit); vẫn chạy | Không ảnh hưởng code (hash khớp) | Ghi nhận |
| D6 | Xác nhận cô lập DB và cho phép SPP-74 là xác nhận bằng lời trong phiên (04/11/2026), chưa có chữ ký trong checklist | Cần người kiểm chéo xác nhận | Xem 08 |
| D7 | Ca F1–F7, F9, TC-06 kế thừa, không chạy lại | Xem 05 | Chờ quyết định |
| D8 | Dispatcher/Worker khởi động lại thủ công trước khi chạy (đã tắt từ SPP-74) | Retry khóa được preflight xác nhận | Ghi nhận |
Không có lỗi hệ thống: 0 retry/timeout/reject/lỗi ở mọi lượt.
