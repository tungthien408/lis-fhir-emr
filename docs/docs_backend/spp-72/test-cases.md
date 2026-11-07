# SPP-72 — Bộ ca thử

Trạng thái: **DONE (tester chấp nhận 03/11/2026)**. Cột "Chạy trong SPP-72" là `NOT_RUN` cho mọi ca cần
dịch vụ/PostgreSQL thật, vì chưa có môi trường cô lập được phê duyệt trong phiên này.
"Bằng chứng trước đó" chỉ là kết quả đã lưu của SPP-66 (C4/D3, môi trường cô lập
Postgres 17 + fixture tự soạn) — không phải kết quả chạy lại của SPP-72 và không dùng dữ liệu MIMIC.

Cách xác minh chung: đáp án đọc từ `backend/scripts/spp82/reference/spp65-v2/` (đã khóa,
không lấy từ Mapper); đối chiếu bằng `npm run spp82:verify` (xem `independent-verification.md`).
Ba mốc luôn tách riêng: M1 = LIS chấp nhận Publish (HTTP 202/200); M2 = Middleware `DELIVERED`;
M3 = EMR lưu và client đọc lại đúng. Chỉ M3 + đối chiếu độc lập mới là hoàn tất.

| Mã | Nhóm / mục tiêu | Đầu vào | Bước thực hiện | Kết quả mong đợi | Cách xác minh | Bằng chứng trước đó | Chạy trong SPP-72 |
|---|---|---|---|---|---|---|---|
| TC-01 | Hợp lệ, đúng bệnh nhân (1 ca) | 1 result FINAL của 40 ca chức năng (`provenance.in_functional_40=true`), nguồn gốc MIMIC | Publish → Dispatcher → Worker → EMR | M1 202; M2 DELIVERED; M3 1 hàng EMR, MR01–MR09 khớp, patient_key = UUID đã khóa | `spp82:verify` PASS cho result đó; before/after | C4-01, D3-01, D3-09 (fixture tự soạn) | NOT_RUN |
| TC-02 | Hợp lệ, toàn bộ 40 ca chức năng | 40 result | Như TC-01, concurrency 1 | 40/40 PASS, 0 thiếu/trùng | comparison-report: matched=40 trên tập chọn | — | NOT_RUN |
| TC-03 | Thiếu dữ liệu bắt buộc | Bản sao `synthetic_mutation`: bỏ `unit` / `value_num` / `effective_at` | Publish | LIS từ chối, không tạo event/exchange/EMR | HTTP 4xx; before = after cho ID đó | Unit: `service.integration.test` (đơn vị, NUMERIC, timestamp) | NOT_RUN (cần dữ liệu đột biến, chưa tạo) |
| TC-04 | Sai dữ liệu bắt buộc | `synthetic_mutation`: đơn vị ngoài danh mục, status READY, value không hữu hạn | Publish | Bị từ chối, không có hàng EMR | như TC-03 | `service.integration.test` | NOT_RUN |
| TC-05 | Liên kết bệnh nhân không tồn tại | `synthetic_mutation`: patient_id không có trong `patient_links` | Publish → Worker | EMR 422, exchange không DELIVERED, không có hàng EMR, không dùng bệnh nhân "mồi" | EMR không có hàng; link không bị tạo ngầm | C4-03, D3-06 | NOT_RUN |
| TC-06 | Liên kết sai bệnh nhân | `synthetic_mutation`: hoán đổi 2 patient_key | Chạy comparator trên evidence | Comparator FAIL `wrong-patient`, kể cả khi Worker báo DELIVERED | `source-target-comparator.test` ("swapped patient keys") | Unit comparator PASS (111/111) | Unit: VERIFIED; luồng thật: NOT_RUN |
| TC-07 | Gửi lặp cùng kết quả | Cùng result_id, nội dung giống nhau, 2+ lần (trước & sau DELIVERED) | Publish lặp | Lần sau HTTP 200 EXISTING; 1 event, 1 exchange, 1 hàng EMR | đếm event/exchange/EMR = 1; `existing_count` | C4-02, D3-02, D3-03, D3-07 | NOT_RUN |
| TC-08 | Cùng mã, nội dung xung đột | `synthetic_mutation`: cùng external_id, đổi value | Gửi sang EMR | EMR 409; hàng gốc giữ nguyên mọi cột; không ghi đè | so hàng EMR trước/sau | C4-04, Worker 409 | NOT_RUN |
| TC-09 | Gián đoạn LIS → Middleware | Tắt Middleware khi Publish | Publish; giữ outage; bật lại | Không có ACK giả; retry có giới hạn; sau khôi phục có ACK + DELIVERED | trạng thái LIS PENDING/RETRY_WAIT trong outage; sau đó ACK | D3-04, D3-05, D2 dispatcher | NOT_RUN |
| TC-10 | Gián đoạn Middleware → EMR | Tắt EMR khi Worker SEND | Chạy Worker; giữ outage | Exchange RETRY_WAIT/SEND, chưa DELIVERED; không mất FHIR gốc | trạng thái exchange; EMR 0 hàng | Worker B4B (503/timeout) | NOT_RUN |
| TC-11 | Khôi phục và gửi lại | Sau TC-09/TC-10 bật lại dịch vụ | Chờ retry/Worker | Đúng 1 hàng EMR, DELIVERED, đọc lại khớp; không trùng | `spp82:verify` PASS + đếm hàng | D3-04/05, Worker "timeout AFTER storage" | NOT_RUN |
| TC-12 | Đọc lại từ EMR | Result đã DELIVERED | GET theo cặp external_system + external_id | Đúng 1 item; items rỗng hoặc >1 là lỗi | observer `emr_readback_observed` | D3-10 | NOT_RUN |
| TC-13 | Tập 1.000 — tính toàn vẹn đáp án | `expected.jsonl` | `npm run test:spp82:verify` | 1.000 ID duy nhất, 100 bệnh nhân, checksum khớp | test loader/oracle | 111/111 PASS ngày 03/11/2026 | **VERIFIED** (offline) |
| TC-14 | Tải tuần tự c=1 | 1.000 result | Theo `load-test-protocol.md` | — | — | — | NOT_RUN (dành cho SPP-73) |
| TC-15 | Tải đồng thời c=5 | 1.000 result | như trên | — | — | — | NOT_RUN (dành cho SPP-73) |
| TC-16 | Không có bằng chứng ⇒ không PASS | Thiếu before/after/oracle | `spp82:verify` | Exit 2, NOT_VERIFIED | `spp-82-c-missing-evidence/summary.md` | Có sẵn | **VERIFIED** (offline) |

Ghi chú: TC-03/04/05/06/08 cần **dữ liệu đột biến riêng** (xem `test-data-and-mutations.md`);
hiện kho **chưa có** tập dữ liệu gắn nhãn `synthetic_mutation` — các ca lỗi trong test hiện tại
là fixture tự soạn trong mã test, không phải đột biến của MIMIC.
