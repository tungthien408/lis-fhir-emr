# SPP-73 — Tóm tắt kết quả pilot

Written for: nhóm đồ án và người viết Chương 3 (đọc được không cần nắm chi tiết kỹ thuật).

Ngày chạy: 03/11/2026. Trạng thái tài liệu: **NOT_READY** (xem mục 6 — còn 2 việc tái lập chưa làm được trong phạm vi tài liệu này). Tài liệu chỉ tổng hợp bằng chứng đã đo, không tự ký nghiệm thu.

## 1. Hệ thống đã thử gì

Luồng dữ liệu: LIS (gửi kết quả xét nghiệm) → Dispatcher (chuyển tiếp) → Middleware (kiểm tra, chuyển đổi) → Worker → EMR (hồ sơ điện tử, chuẩn HL7 FHIR R4).

Dữ liệu thử: 1.000 kết quả xét nghiệm lấy từ MIMIC-IV Demo 2.2, 100 bệnh nhân (seed `DACN-MIMIC22-SOURCE-ALIGNED-V2`). Đáp án chuẩn được khóa trước khi chạy (oracle `spp65-v2`, SHA-256 manifest `55cb4256…7267`). Không sửa dataset, không sửa đáp án để đạt PASS.

Cấu hình mọi lượt chính thức: 1 Dispatcher + 1 Worker; thời gian chờ thử lại 2, 4, 8, 16, 32, 64, 64 giây.

## 2. Kết quả đã xác minh

Ký hiệu: **PASS** (đạt, có bằng chứng đo), **FAIL** (sai lệch đã đo), **NOT_RUN** (chưa chạy), **NOT_VERIFIED** (có chạy nhưng bằng chứng không đủ để kết luận).

### 2.1 Thử tuần tự và đồng thời (1.000 kết quả)

Ba lượt tuần tự (A, c=1) và ba lượt đồng thời (B, c=5), cùng mã nguồn, cùng dữ liệu, cùng cấu hình, mỗi lượt reset và kiểm tra trạng thái đầu trước khi chạy.

| Lượt | Hoàn tất | Đối chiếu độc lập | Tổng thời gian (s) | Thông lượng (kết quả/s) | p50 / p95 (s) |
|---|---|---|---|---|---|
| A1 | 1.000/1.000 | PASS, khớp 1.000 | 1.057,2 | 0,9459 | 524,9 / 996,6 |
| A2 | 1.000/1.000 | PASS, khớp 1.000 | 1.056,8 | 0,9463 | 521,9 / 995,0 |
| A3 | 1.000/1.000 | PASS, khớp 1.000 | 1.068,5 | 0,9359 | 527,3 / 1.005,4 |
| B1 | 1.000/1.000 | PASS, khớp 1.000 | 1.061,2 | 0,9423 | 528,9 / 1.005,7 |
| B2 ⚠ | 1.000/1.000 | PASS, khớp 1.000 | 1.067,8 (không tin cậy) | 0,9365 | 531,2 / 1.012,7 |
| B3 | 1.000/1.000 | PASS, khớp 1.000 | 1.069,6 | 0,9350 | 533,5 / 1.012,5 |

- Cả 6 lượt: 0 thiếu, 0 trùng, 0 sai trường, 0 sai bệnh nhân, 0 dữ liệu cũ, 0 hàng thừa.
- ⚠ B2: máy tính bị tạm ngủ giữa lượt, số thời gian của lượt này không dùng để so sánh. Dữ liệu vẫn đúng.
- **Kết luận về tốc độ:** chưa thấy B nhanh hơn A. Chênh lệch trung bình khoảng 0,4%, nhỏ hơn độ dao động giữa các lượt A (khoảng 1,1%).

Bằng chứng: `docs/docs_backend/spp-73/pilot-evidence/final/` (`A1`…`B3`, `run-all.log`, `run-all.sh`).

### 2.2 Ca lỗi (dữ liệu MUT-*, trên đúng môi trường pilot)

| Ca | Kết quả | Trạng thái |
|---|---|---|
| F1–F5 (đơn vị sai/thiếu, chưa FINAL, thiếu liên kết bệnh nhân, gửi lặp) | Đúng như kỳ vọng, không sinh dữ liệu thừa | PASS |
| F6 (cùng mã, đổi giá trị) | EMR từ chối 409, giữ nguyên dữ liệu cũ | PASS |
| F7, F9 (gián đoạn ngắn ~5 s) | Tự phục hồi, không trùng | PASS |
| F8, F10 (gián đoạn 30 s và 60 s) | Lượt đầu: kẹt `FAILED`. Sau chỉnh cấu hình thử lại: tự phục hồi | PASS (sau xử lý) |
| F8-Z, F10-Z (gián đoạn ~140 s, vượt cửa sổ thử lại) | Vẫn `FAILED`, cần gửi lại thủ công bằng công cụ `ops:requeue-failed` (R3, R4 đã thử thật, PASS) | Giới hạn đã xác nhận |

Bằng chứng: `pilot-evidence/faults/` (lượt đầu), `pilot-evidence/faults-retry-config/` (kiểm tra lại).

### 2.3 TC-06 — liên kết sai bệnh nhân

Hoán đổi liên kết của hai bệnh nhân trong DB thử nghiệm, chạy 10 kết quả. Hệ thống vẫn báo "hoàn tất", nhưng bộ đối chiếu độc lập phát hiện 32 kết quả sai bệnh nhân. Đã khôi phục nguyên trạng (hash trước và sau trùng khớp).

**PASS** (lỗi được phát hiện). Bằng chứng: `pilot-evidence/tc06-swapped-patient/`.

### 2.4 Kiểm tra nội bộ mã (không phải thử nghiệm pilot)

- `npm run check`: exit 0.
- `npm run test:spp82`: 112/112 pass.
- `npm run test:ops`: 13/13 pass.
- Test e2e, integration, repositories (PostgreSQL): 0 fail. Log: `pilot-evidence/fault-tests/`.

Các test này dùng dữ liệu tự soạn, không phải dữ liệu MIMIC trên stack pilot.

## 3. Lỗi đã tìm thấy và cách xử lý

| Mã | Lỗi | Trạng thái |
|---|---|---|
| DEF-01 | Script reset lỗi thứ tự xóa khóa ngoại | Đã sửa, reset chạy được |
| DEF-02 | Nhật ký đo (journal) phình tới 19 GB | Đã sửa, có test hồi quy |
| DEF-03 | Bộ đọc bằng chứng không đọc được file lớn | Đã sửa (đọc theo luồng) |
| DEF-04 | Gián đoạn dài làm kết quả kẹt `FAILED` | Xử lý mức MVP: tăng thời gian thử lại + công cụ gửi lại. Vẫn cần thao tác tay với gián đoạn dài |
| DEF-05 | Tương tự DEF-04 ở chặng Middleware → EMR | Như DEF-04 |
| DEF-06 | Thiếu đường gửi lại thủ công | Đã thêm `ops:requeue-failed` |
| OPS-01 | Dispatcher/Worker không chạy khi bắt đầu lượt B đầu | Đã hủy lượt, lưu riêng, không dùng số liệu |
| OPS-02 | Có ~1 phút chạy 2 Dispatcher + 2 Worker do tắt tiến trình nhầm | Đã khắc phục, các lượt sau kiểm tra 1+1 |
| OPS-03 | Máy tạm ngủ trong lượt B2 | Mở. Cần chạy lại B2 nếu muốn số thời gian sạch |

Chi tiết: [06-defect-log.md](06-defect-log.md).

## 4. Điều chưa biết (không được kết luận)

- Chưa thử nhiều Dispatcher/Worker song song, nên chưa biết nút cổ chai thật.
- Chưa đo được thời gian từng chặng riêng (LIS không công khai thời điểm ACK).
- Chưa biết c=5 có thực sự tạo 5 Publish đồng thời tới LIS hay không (chỉ biết giới hạn đã cấu hình).
- Chỉ một máy, một cấu hình, một bộ dữ liệu. Không suy ra cho môi trường khác.

## 5. Đã đủ điều kiện nghiệm thu chưa?

Chi tiết theo tiêu chí ở [10-review-checklist.md](10-review-checklist.md). Tóm tắt: dữ liệu và ca lỗi đã đạt; còn thiếu về tái lập (mục 6).

## 6. Blocker trước khi chuyển READY_FOR_REVIEW

1. **Mã chưa commit.** Lượt chạy ghi `source_tree_sha256=49e9ebcb…14e2e` trên nội dung working tree, nhưng Git hiện chỉ có `763da66` cộng thay đổi chưa commit (`backend/scripts/`, `backend/package.json`, `backend/tsconfig.test.json`). Người khác chưa thể lấy lại đúng phiên bản đã chạy. Cần người phụ trách quyết định commit hoặc snapshot. Tôi không commit vì bạn chưa yêu cầu.
2. **Nơi lưu bằng chứng.** `pilot-evidence/` nặng khoảng 3,9 GB, không đưa vào Git. Cần quyết định nơi lưu bền vững.

Không phải blocker nhưng cần người phụ trách chấp nhận: OPS-03 (B2), giới hạn gián đoạn dài, và các mục ở mục 4.

## 7. Bằng chứng gốc

| Nội dung | Đường dẫn |
|---|---|
| Kết quả chi tiết | [05-pilot-results.md](05-pilot-results.md) |
| Nhật ký lỗi | [06-defect-log.md](06-defect-log.md) |
| 6 lượt chính thức | `pilot-evidence/final/` |
| Pilot nhỏ, A1/B1 đầu | `pilot-evidence/run0-small/`, `pilot-evidence/runA1-seq/`, `pilot-evidence/runB1-con5/` |
| Ca lỗi và kiểm tra lại | `pilot-evidence/faults/`, `pilot-evidence/faults-retry-config/` |
| TC-06 | `pilot-evidence/tc06-swapped-patient/` |
| Log test | `pilot-evidence/fault-tests/` |
| Script điều khiển | `pilot-evidence/tools/run-scenario.sh` |
