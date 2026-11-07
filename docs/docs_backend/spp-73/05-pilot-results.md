# SPP-73 — Kết quả pilot (Giai đoạn 2)

Ngày chạy: 03/11/2026. Môi trường: Docker Compose cục bộ do người dùng xác nhận là **cô lập, được phép Publish và reset** (xác nhận bằng lời trong phiên). DB được gắn dấu guard `spp66-disposable:<uuid>` (token không lưu trong báo cáo).
Cấu hình mọi lượt: 1 LIS Dispatcher, 1 Middleware Worker; `SPP82_MEASURE=1`; polling 1.000 ms; HTTP timeout của client Publish (runner 82-B) 10.000 ms, của Dispatcher/Worker 3.000 ms (mặc định, không đặt biến); `SPP82_RUN_TIMEOUT_MS=3.600.000`; observer concurrency 2; seed `DACN-MIMIC22-SOURCE-ALIGNED-V2`, oracle `spp65-v2` (SHA-256 manifest `55cb4256…7267`). Code: HEAD `763da66` + thay đổi chưa commit (xem `pilot-evidence/*/code-and-environment.txt`).
Phụ thuộc P4-01/P4-02/P4-03: người dùng xác nhận đã duyệt (không có tài liệu trong repo).

## Kết luận từng scenario
| Scenario | Kết luận | Căn cứ |
|---|---|---|
| Pilot nhỏ (10, tuần tự) | **PASS (tập con)** | 10/10 hoàn tất, 10/10 khớp. Công cụ 82-C in `FAIL` chỉ vì mẫu số cố định 1.000 (990 chưa chạy) — đúng thiết kế, không phải sai lệch dữ liệu |
| A — tuần tự, c=1, 1.000 (lượt đầu, 1 lượt) | **PASS** | `runA1-seq/` |
| B — đồng thời, c=5, 1.000 (lượt đầu, 1 lượt) | **PASS** | `runB1-con5/` |
| **A — 3 lượt chính thức** (cùng code/cấu hình) | **PASS 3/3** | `final/A1,A2,A3/` |
| **B — 3 lượt chính thức** (cùng code/cấu hình) | **PASS 3/3** (B2 có máy suspend, xem dưới) | `final/B1,B2,B3/` |
| TC-06 liên kết sai bệnh nhân (stack pilot) | **PASS** — bộ đối chiếu phát hiện | `tc06-swapped-patient/` |
| Ca lỗi trên stack pilot với dữ liệu `MUT-*` (F1–F10) | **8 PASS, 2 FAIL ở phần khôi phục (lượt đầu) → đã xử lý bằng cấu hình retry dài + công cụ gửi lại, kiểm tra lại PASS** | Mục "Ca lỗi trên stack pilot" và "Xử lý DEF-04/05" |
| Ca lỗi trong harness tự động (PostgreSQL container riêng, fixture tự soạn) | **PASS** | Xem bảng dưới |

## Số đo (mỗi scenario chỉ **1 lượt**; protocol dự kiến 3)
| | Pilot nhỏ | A (c=1) | B (c=5) |
|---|---|---|---|
| Run ID | bc29c712… | f12e09e1… | b6c95b27… |
| Phát đi / hoàn tất / lỗi / timeout / đã tồn tại | 10/10/0/0/0 | 1000/1000/0/0/0 | 1000/1000/0/0/0 |
| Khớp / thiếu / trùng / sai trường / sai bệnh nhân / dữ liệu cũ | 10/—/0/0/0/0 | 1000/0/0/0/0/0 | 1000/0/0/0/0/0 |
| Tổng thời gian (s) | 11,4 | 1.068,9 | 1.056,5 |
| Thông lượng (kết quả/s) | 0,874 | 0,9355 | 0,9465 |
| p50 / p95 (s) | 5,1 / 11,2 | 529,8 / 1.008,6 | 526,7 / 1.002,3 |
| Retry (`dispatch_attempt_count>1`) | — | — | 0 |

Sau B: DB có 1.001 event, 1.001 exchange `DELIVERED`, 1.001 hàng EMR (1.000 + 1 bản `DEMO-R1` có sẵn trước pilot, nằm ngoài tập 1.000).

### Cách đọc số đo (giới hạn phương pháp)
- "Hoàn tất" = ACK + DELIVERED + client đọc lại đúng hàng EMR (mốc M3), **không** chỉ HTTP 202. Đối chiếu độc lập (82-C) là kết luận đúng/sai dữ liệu.
- Concurrency chỉ giới hạn số **HTTP Publish đang chờ tới LIS**. Publish trả 202 gần như ngay, nên cả 1.000 event vào hàng đợi LIS gần như cùng lúc; phía sau chỉ có **1 Dispatcher và 1 Worker** (mỗi process xử lý 1 bản ghi mỗi vòng). Vì vậy A và B có thông lượng gần như nhau (0,9355 và 0,9465, chênh ~1,2%, mỗi bên 1 lượt) — **không đủ cơ sở kết luận B nhanh hơn A** và không nên hiểu c=5 là "5 kết quả được EMR xử lý song song".
- Độ trễ p50/p95 tính từ lúc bắt đầu Publish, nên chủ yếu là thời gian **chờ trong hàng đợi** sau Dispatcher/Worker; không phải thời gian xử lý của một giao dịch riêng lẻ. Chưa tách được thời gian từng chặng (LIS public API không công khai timestamp ACK/attempt).
- Polling 1 giây và hàng đợi observer làm tăng độ trễ quan sát. Nút cổ chai cụ thể (poll interval Dispatcher/Worker hay xử lý) **chưa xác định**.
- Lượt A chạy trước khi sửa `report-writer.ts`/`evidence-loader.ts` (DEF-02/03); B chạy sau. Số đo không bị ảnh hưởng, nhưng code hai lượt khác nhau.
- Chỉ 1 lượt mỗi scenario, không có lượt khởi động riêng, nên chưa có phương sai giữa các lượt.


## Ca lỗi trên stack pilot (dữ liệu `MUT-*`, chạy 03/11/2026 09:06–09:11 UTC)
Dữ liệu đột biến tạo riêng bằng `pilot-evidence/faults/mutations.sql` (nhãn `synthetic_mutation`, nền là bản sao MIMIC-LAB-100142, không có `seed_tag`, không sửa seed). Expected viết trước khi chạy (`faults/expected.md`). Chạy trên đúng stack của A/B; mất kết nối bằng `docker stop/start` container Middleware/EMR. Transcript: `faults/transcript.log`; ảnh chụp DB: `faults/db-snapshot-*.csv`. Dữ liệu `MUT-*` đã dọn sau khi lưu bằng chứng; seed 1.000 không đổi.

| Ca | Tình huống | Kết quả thực tế | Kết luận |
|---|---|---|---|
| F1 TC-03 | Thiếu đơn vị | LIS trả 422 `INVALID_UNIT`; 0 event/exchange/EMR | PASS |
| F2 TC-04 | Đơn vị ngoài danh mục | 422 `INVALID_UNIT`; 0 event/exchange/EMR | PASS |
| F3 TC-04 | Kết quả chưa FINAL | 422 `RESULT_NOT_READY`; 0 event/exchange/EMR | PASS |
| F4 TC-05 | Bệnh nhân không có liên kết EMR | LIS ACK; Middleware `REJECTED`; 0 hàng EMR | PASS |
| F5 TC-07 | Gửi lặp (2 lần trước, 1 lần sau DELIVERED) | 202, 200, 200 cùng `event_id`; 1 event, 1 exchange, 1 hàng EMR | PASS |
| F6 TC-08 | Cùng mã, đổi giá trị (0,9→2,9) gửi thẳng EMR | 409 `DUPLICATE_CONFLICT`; hàng EMR giữ nguyên mọi cột (md5 trùng), giá trị 0,9 mg/dL đúng nguồn | PASS |
| F7 TC-09 | Middleware tắt ~5 s | Trong lúc tắt: `RETRY_WAIT`, không ACK, 0 exchange; sau bật: ACK, DELIVERED, 1 hàng EMR | PASS |
| F8 TC-09 | Middleware tắt ~30 s (vượt 4 lần thử) | Không ACK giả, 0 exchange/EMR (an toàn). Sau khôi phục sự kiện **vẫn `FAILED`**, Publish lại chỉ trả 200 `FAILED` cũ; kết quả **không bao giờ tới EMR** | An toàn PASS; **khôi phục FAIL (DEF-04)** |
| F9 TC-10 | EMR tắt ~5 s | LIS ACK; Worker thử lại (3 lần `NETWORK_ERROR`); sau bật: DELIVERED, 1 hàng EMR | PASS |
| F10 TC-10 | EMR tắt ~60 s (vượt 4 lần thử) | Không DELIVERED giả, 0 hàng EMR (an toàn). Exchange **`FAILED` vĩnh viễn** sau khi EMR trở lại; Publish lại trả 200 ACK, không gửi lại | An toàn PASS; **khôi phục FAIL (DEF-05)** |
| TC-06 | Liên kết sai bệnh nhân (hoán đổi) | **NOT_RUN trên stack pilot**: hệ thống tin bảng liên kết nên lỗi này chỉ bộ đối chiếu độc lập mới phát hiện (đã có unit test) | NOT_RUN |

Giới hạn: mỗi ca chạy 1 lần; dữ liệu đột biến thuộc bản sao của một kết quả (Creatinine); F6 gửi thẳng EMR vì LIS không cho đổi nội dung đã Publish; thời gian tắt dịch vụ là xấp xỉ (sleep), không phải ranh giới chính xác; thời gian retry theo cấu hình mặc định (Dispatcher 2/4/8 s; Worker không đổi cấu hình).


## Xử lý DEF-04/05 (F8/F10) — kiểm tra lại 03/11/2026
Bằng chứng: `pilot-evidence/faults-retry-config/` (`expected.md` viết trước, `transcript.log`, `db-snapshot-*.csv`).
Cấu hình: Dispatcher và Worker `RETRY_DELAYS_MS=2000,4000,8000,16000,32000,64000` (7 lần thử, cửa sổ ~126 s); sau đó thêm một phần tử cuối (8 lần thử) để kiểm tra gửi lại.

| Ca | Kết quả thực tế | Kết luận |
|---|---|---|
| F8-R: Middleware tắt ~30 s | Trong lúc tắt: `RETRY_WAIT`, không ACK, 0 exchange. Sau khi bật: tự ACK (6 lần thử, 5 lỗi mạng), DELIVERED, 1 event/1 exchange/1 hàng EMR | **PASS** |
| F10-R: EMR tắt ~60 s | Trong lúc tắt: exchange `RETRY_WAIT/SEND`, 0 hàng EMR. Sau khi bật: tự DELIVERED (5 lỗi mạng rồi 201 + VERIFY 200); hàng EMR 0,9 mg/dL đúng nguồn, đúng `patient_key` của oracle | **PASS** |
| F8-Z: Middleware tắt ~140 s (vượt cửa sổ) | Event `FAILED` sau 7 lần thử, không ACK giả; Publish lại trả 200 `FAILED`, không gửi lại | Giới hạn xác nhận |
| F10-Z: EMR tắt ~145 s | Exchange `FAILED` sau 7 lần SEND, 0 hàng EMR | Giới hạn xác nhận |
| R1: công cụ `ops:requeue-failed` — từ chối | Từ chối đúng: ngân sách quá nhỏ, event không ở `FAILED` (đang `ACK`), không tồn tại, sai chặng | PASS |
| R2: requeue khi ngân sách thật vẫn = 7 (khai báo sai 8) | Quay lại `FAILED/RETRY_EXHAUSTED`, 7 hàng lịch sử, không gửi, không mất dữ liệu | PASS (thất bại an toàn) |
| R3: LIS — Dispatcher ngân sách 8, requeue thật | ACK + DELIVERED ở lần thử 8; 1 event, 1 exchange, 1 hàng EMR | **PASS** |
| R4: Middleware→EMR — Worker ngân sách 8, requeue thật | DELIVERED (7 SEND lỗi mạng, SEND 201, VERIFY 200); 1 exchange, 1 hàng EMR; có sự kiện `RETRY_EXHAUSTED` rồi `OPERATOR_REQUEUE` | **PASS** |

Kết luận: **F8/F10 đã xử lý ở mức MVP** — gián đoạn 30–60 s tự phục hồi; gián đoạn dài hơn cửa sổ retry thì phục hồi bằng công cụ gửi lại có kiểm soát (thao tác vận hành, không tự động). Mã: `backend/scripts/ops/requeue-failed.ts` (+13 test `npm run test:ops`). Hướng dẫn: `04-execution-guide.md` mục D.
Giới hạn: mỗi ca chạy 1 lần; thời gian tắt là xấp xỉ; chưa thử gián đoạn ngắt giữa chừng nhiều lần; công cụ gửi lại xử lý từng `result_id`, chưa có chế độ hàng loạt; ngân sách thật phải do người vận hành đặt đúng (khai báo sai chỉ gây `FAILED` lại).

## TC-06 — liên kết sai bệnh nhân trên stack pilot
Bằng chứng: `pilot-evidence/tc06-swapped-patient/` (`expected.md` viết trước, `run.sh`, `transcript.log`, `verification/`).
Hoán đổi `emr.patient_links` của MIMIC-P-10007928 ↔ MIMIC-P-10000032 (sao lưu CSV trước), chạy pilot nhỏ 10 kết quả qua LIS → Middleware → EMR, rồi bộ đối chiếu 82-C với oracle đã khóa.
- Hệ thống **không** báo lỗi: runner 82-B vẫn ghi 10/10 "hoàn tất" và Middleware `DELIVERED`.
- Bộ đối chiếu độc lập: **FAIL**, `matched=0`; MR02 `patient_key` sai ở 32 kết quả: 10 hàng EMR thực sự được lưu với key `7c17a3a0…` thay vì `6eac20d5…` (oracle), và 22 kết quả của bệnh nhân còn lại (chưa gửi) bị gắn cờ vì bảng liên kết của họ lệch oracle. Ví dụ MIMIC-LAB-100142: expected `6eac20d5-c71c-50a6-8adb-17bd7b5677de`, actual `7c17a3a0-aed9-5a6a-85bc-18059b24de20`.
- Khôi phục: hash `patient_links` trước = sau (`8253dc52…`); dữ liệu pilot dọn bằng `reset.sql`; không sửa `lis.*`, MIMIC gốc hay oracle.
**Kết luận: PASS** (lỗi được phát hiện). Giới hạn: 1 lượt; chỉ một cặp bệnh nhân; mọi kết quả trong lượt đều thuộc một bệnh nhân.

## Ba lượt A và B (cùng code, dữ liệu, cấu hình) — `pilot-evidence/final/`
Điều kiện chung (`final/*/code-and-environment.txt`): `source_tree_sha256=49e9ebcb…14e2e` (giống nhau cả 6 lượt; HEAD `763da66` + thay đổi chưa commit); seed/oracle cố định; 1 Dispatcher + 1 Worker, `RETRY_DELAYS_MS=2000,4000,8000,16000,32000,64000,64000` cho cả hai; polling 1.000 ms; HTTP timeout của client Publish (runner 82-B) 10.000 ms, của Dispatcher/Worker 3.000 ms (mặc định, không đặt biến); observer concurrency 2; reset bằng `reset.sql` và kiểm tra baseline (1 event/1 exchange/1 EMR demo; 1.000 seed; 0 `MUT-*`) trước mỗi lượt; thứ tự xen kẽ A1 B1 A2 B2 A3 B3 (`final/run-all.log`).

| Lượt | c | Hoàn tất / lỗi / timeout / có trước | Đối chiếu độc lập | Tổng thời gian (s) | Thông lượng (kq/s) | p50 / p95 (s) |
|---|---|---|---|---|---|---|
| A1 | 1 | 1000/0/0/0 | PASS, khớp 1.000 | 1.057,2 | 0,9459 | 524,9 / 996,6 |
| B1 | 5 | 1000/0/0/0 | PASS, khớp 1.000 | 1.061,2 | 0,9423 | 528,9 / 1.005,7 |
| A2 | 1 | 1000/0/0/0 | PASS, khớp 1.000 | 1.056,8 | 0,9463 | 521,9 / 995,0 |
| B2 ⚠ | 5 | 1000/0/0/0 | PASS, khớp 1.000 | 1.067,8 | 0,9365 | 531,2 / 1.012,7 |
| A3 | 1 | 1000/0/0/0 | PASS, khớp 1.000 | 1.068,5 | 0,9359 | 527,3 / 1.005,4 |
| B3 | 5 | 1000/0/0/0 | PASS, khớp 1.000 | 1.069,6 | 0,9350 | 533,5 / 1.012,5 |

Cả 6 lượt: 0 thiếu, 0 trùng, 0 sai trường, 0 sai bệnh nhân, 0 dữ liệu cũ, 0 hàng thừa; DB sau mỗi lượt có 1.001 event, 1.001 `DELIVERED`, 1.001 hàng EMR (1.000 + bản demo có sẵn); 0 `POLL_UNAVAILABLE`/`NETWORK_ERROR` trong journal.

⚠ **B2:** máy tự suspend (`Lid closed` → `Suspending...` lúc 11:01:53 UTC, journald) giữa lượt; đồng hồ treo tường lệch (3.395,6 s) so với monotonic (1.067,8 s). Kết quả đúng/sai dữ liệu (PASS 1.000/1.000) giữ nguyên, nhưng **số đo thời gian của B2 bị coi là không tin cậy** vì dịch vụ bị tạm dừng giữa chừng; thống kê hiệu năng bên dưới nêu cả hai cách tính.

| | Thông lượng min / trung bình / max (kq/s) | Tổng thời gian trung bình (s) |
|---|---|---|
| A (3 lượt) | 0,9359 / 0,9427 / 0,9463 | 1.060,8 |
| B (3 lượt, kể cả B2) | 0,9350 / 0,9379 / 0,9423 | 1.066,2 |
| B (B1, B3, loại B2) | 0,9350 / 0,9386 / 0,9423 | 1.065,4 |

**Không kết luận B nhanh hơn A — bằng chứng không ủng hộ.** Chênh lệch trung bình A − B (không B2) chỉ khoảng 0,4%, nhỏ hơn độ dao động giữa các lượt của chính A (khoảng 1,1%); nếu có khác biệt thì thiên về A nhỉnh hơn nhẹ, nhưng với 3 lượt không đủ để khẳng định. Lý do khả dĩ (chưa kiểm chứng bằng thực nghiệm riêng): c=5 chỉ giới hạn Publish tới LIS; phía sau vẫn 1 Dispatcher + 1 Worker. p50/p95 (≈ 522–534 s / 995–1.013 s) chủ yếu là thời gian chờ trong hàng đợi, không phải thời gian xử lý một giao dịch.
Giới hạn: 3 lượt mỗi chế độ trên một máy, một cấu hình 1 Dispatcher + 1 Worker; không có lượt khởi động riêng; chưa thử nhiều Dispatcher/Worker nên chưa biết nút cổ chai thật; chưa tách thời gian từng chặng; số đo không đại diện cho môi trường khác hay tải khác.

## Ca lỗi (harness tự động, container PostgreSQL 17 riêng, fixture tự soạn — không phải MIMIC, không phải stack pilot)
| Ca SPP-72 | Test chạy | Kết quả |
|---|---|---|
| TC-03/04 thiếu/sai dữ liệu | LIS service integration (đơn vị ngoài catalog, READY, NUMERIC/timestamp không hợp lệ) | PASS |
| TC-05 sai/không có liên kết bệnh nhân | D3-06 (Middleware REJECTED, EMR 0 hàng), C4-03 (422, không dùng bệnh nhân "mồi") | PASS |
| TC-06 hoán đổi bệnh nhân | Comparator 82-C (unit, dữ liệu giả) | PASS (không phải stack thật) |
| TC-07 gửi lặp | D3-02, D3-03, D3-07, C4-02 (1 event/exchange/hàng EMR) | PASS |
| TC-08 cùng mã, nội dung xung đột | C4-04 (409, giữ nguyên cột gốc), Worker 409 | PASS |
| TC-09 gián đoạn LIS→Middleware | D3-04, D3-05 (không ACK giả, phục hồi sau restart) | PASS |
| TC-10 gián đoạn Middleware→EMR | Worker: POST 503/timeout, GET 503 retry | PASS |
| TC-11 khôi phục và gửi lại | D3-04/05/08, Worker "timeout AFTER storage" → ALREADY_EXISTS | PASS |
| TC-12 đọc lại EMR | D3-10, C4-08 (mismatch ⇒ FAILED, không DELIVERED) | PASS |

Tổng: `test:e2e:postgres` 15/15; `test:integration:postgres` 16/16; `test:repositories:postgres` các nhóm 173/191/101/16/15 pass, 0 fail, 0 skip; `test:spp82` 112/112; `npm run check` exit 0. Log: `pilot-evidence/fault-tests/`.
Giới hạn: các test này không chạy trên stack pilot và không dùng dữ liệu `MUT-*`; chúng chứng minh hành vi của hệ thống với fixture riêng, chưa phải ca lỗi trên dataset MIMIC.

## Chốt protocol / giai đoạn 3 đã đủ điều kiện chưa?
**Đủ điều kiện về kỹ thuật để chốt protocol; còn việc cần con người quyết định/ký.**
Đã đạt: A và B đều chạy đủ 3 lượt, PASS đối chiếu độc lập (6/6) trên cùng phiên bản code và cấu hình; ca lỗi F1–F10 và TC-06 đã chạy trên stack pilot; DEF-04/05 xử lý ở mức MVP; lỗi công cụ đo (DEF-01/02/03) đã sửa và chạy lại.
Còn lại (không do tôi tự quyết): (1) mã SPP-72/82/73 chưa commit — cần SPP-74 khóa phiên bản (`source_tree_sha256=49e9ebcb…` ghi nhận trạng thái đã chạy); (2) lượt B2 bị suspend, số đo của nó không tin cậy (kết quả dữ liệu vẫn PASS) — nên chạy lại B2 nếu cần số liệu hiệu năng sạch; (3) chưa thử nhiều Dispatcher/Worker nên chưa kết luận về khả năng mở rộng; (4) gián đoạn vượt cửa sổ retry vẫn cần thao tác vận hành (`ops:requeue-failed`); (5) người phụ trách xác nhận chấp nhận các giới hạn trên.
