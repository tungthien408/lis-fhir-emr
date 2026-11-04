# SPP-82-C — Kiểm chứng độc lập

Run: "c65e8484-cc54-4da4-bdd8-d6244f4b15b4". Kết luận: **PASS**.

Mẫu số: **1000**; quan sát được trong tập expected: 1000; khớp đầy đủ và thuộc run hiện tại: 1000.

Thiếu: 0; trùng: 0; sai liên kết bệnh nhân: 0; sai trường: 0; dữ liệu cũ: 0; chưa xác minh: 0. Các nhóm có thể giao nhau.

PASS cần cả dữ liệu đúng và bằng chứng thuộc run. FAIL là sai lệch trong bằng chứng đã đọc. NOT_VERIFIED là thiếu/bất khả truy cập bằng chứng; không tính thành công. DELIVERED không thay thế đáp án độc lập.

Số thập phân so hệ số/số mũ chính xác; FHIR numeric giữ token JSON. Timestamp so instant Gregorian và toàn bộ phần lẻ giây. Chỉ kiểm subset FHIR của dự án.

## Giới hạn

- Original manifest_1000.csv and upstream lock checksum were not found in available handoff.
- This is a local reference freeze, not SPP-65 owner sign-off.
- Raw charttime has no timezone: UTC and FINAL are declared project assumptions.
- Snapshots are repeatable-read per service, not one simultaneous cross-service snapshot.
- Current-run proof assumes an approved isolated harness with no competing writer for selected identities.
