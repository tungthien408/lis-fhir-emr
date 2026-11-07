# SPP-75 – Ca chức năng
| Ca | Trạng thái | Nguồn |
|---|---|---|
| F8-R (Middleware tắt ~30 s, retry khóa 7 phần tử) | **PASS, chạy lại trên bản chính thức** (6 lần thử, DELIVERED, 1 event/1 exchange/1 EMR, 0,9 mg/dL) | official-evidence/functional/F8R-F10R/ |
| F10-R (EMR tắt ~60 s) | **PASS, chạy lại trên bản chính thức** (DELIVERED, 1 hàng EMR, 0,9 mg/dL) | như trên |
| F1–F7, F9 (thiếu đơn vị, đơn vị lạ, chưa FINAL, không liên kết, gửi lặp, đổi giá trị, gián đoạn ngắn) | **KẾ THỪA (REPORTED)**: PASS ở SPP-73; **chưa chạy lại** trên SPP-75. Căn cứ kế thừa: source_tree_sha256 giống bản khóa | spp-73/05-pilot-results.md |
| TC-06 liên kết sai bệnh nhân | **KẾ THỪA (REPORTED)**: PASS ở SPP-73 (bộ đối chiếu phát hiện) | spp-73/pilot-evidence/tc06-swapped-patient |
| Tập 1.000 (đối chiếu độc lập) | PASS 7/7 lượt (xem 03) | official-evidence/ |
Sau thử nghiệm đã dọn MUT-* (mut=0), số seed vẫn 1.000, ba dịch vụ ready 200. MUT-* không lẫn vào tập 1.000.
**Lưu ý:** các ca kế thừa chưa chạy lại trên phiên bản chính thức; nếu nhóm yêu cầu chạy lại thì đánh dấu NOT_RUN cho tới khi chạy. Không tuyên bố toàn bộ SPP-75 PASS cho tới khi nhóm chấp nhận việc kế thừa này.
