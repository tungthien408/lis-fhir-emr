# SPP-82-C — Kiểm chứng độc lập

Run: "UNAVAILABLE". Kết luận: **NOT_VERIFIED**.

Mẫu số: **1000**; quan sát được trong tập expected: chưa xác minh; khớp đầy đủ và thuộc run hiện tại: 0.

Thiếu: 0; trùng: 0; sai liên kết bệnh nhân: 0; sai trường: 0; dữ liệu cũ: 0; chưa xác minh: 1000. Các nhóm có thể giao nhau.

PASS cần cả dữ liệu đúng và bằng chứng thuộc run. FAIL là sai lệch trong bằng chứng đã đọc. NOT_VERIFIED là thiếu/bất khả truy cập bằng chứng; không tính thành công. DELIVERED không thay thế đáp án độc lập.

Số thập phân so hệ số/số mũ chính xác; FHIR numeric giữ token JSON. Timestamp so instant Gregorian và toàn bộ phần lẻ giây. Chỉ kiểm subset FHIR của dự án.

## Giới hạn

- Original manifest_1000.csv and upstream lock checksum were not found in available handoff.
- This is a local reference freeze, not SPP-65 owner sign-off.
- Raw charttime has no timezone: UTC and FINAL are declared project assumptions.
- NO_APPROVED_CURRENT_RUN_OR_DATABASE_SNAPSHOTS_CAPTURED
- No successful verification is claimed; expected denominator remains 1000.
