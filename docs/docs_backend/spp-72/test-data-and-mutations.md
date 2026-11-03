# SPP-72 — Dữ liệu kiểm thử và đột biến

## Dữ liệu hợp lệ (đã kiểm tra)
- Nguồn: MIMIC-IV Clinical Database Demo v2.2 (`datasets/`, giấy phép tại `datasets/LICENSE.txt`),
  chọn lọc thành `database/seed/02_lis_results.sql` (SHA-256 `28b21b4e…4fe7`) và
  `01_reference_data.sql` (`b66613cf…23e5`).
- Đã đếm trực tiếp trong seed: 1.000 dòng, cả 1.000 có `provenance.synthetic = "false"`, 40 dòng
  `in_functional_40 = "true"`. `expected.jsonl`: 1.000 `result_id` duy nhất, 100 bệnh nhân.
- Đáp án độc lập: `backend/scripts/spp82/reference/spp65-v2/` (CSV bàn giao `8e93c46e…318a`).

## Giả định và giới hạn (đã khai báo trong provenance)
1. `charttime` của MIMIC không có múi giờ; dự án **giả định UTC**.
2. Trạng thái `FINAL` là **giả định của dự án** (MIMIC không có trạng thái công bố).
3. Không thêm LOINC, không đổi đơn vị.
4. Chỉ 5 xét nghiệm (50802, 50912, 50971, 51222, 51492); 100 bệnh nhân. Không đại diện cho toàn bộ LIS thực.
5. Không tìm thấy `manifest_1000.csv` gốc/chữ ký chủ sở hữu SPP-65; bản khóa là **khóa cục bộ**, chưa có xác nhận của người sở hữu SPP-65.
6. Khoảng tham chiếu chỉ kiểm trong phạm vi: có cả hai cận, một cận hoặc không có.

## Dữ liệu đột biến (`synthetic_mutation`)
**Trạng thái: CHƯA TẠO.** Seed hiện không có dòng nào đột biến; test lỗi hiện dùng fixture tự soạn
(`tests/e2e/fixtures/d3-synthetic.json`, `tests/integration/fixtures/c4-synthetic.json`),
không gắn nhãn `synthetic_mutation` và không dựa trên MIMIC.

Quy tắc khi tạo (để SPP-73 hoặc người được giao thực hiện):
- Không sửa `datasets/`, seed hay `reference/spp65-v2/`. Đột biến là **bản sao riêng**, `result_id` mới
  có tiền tố `MUT-` (không trùng 1.000 ID), nạp vào DB cô lập.
- Mỗi bản ghi mang `provenance.synthetic_mutation = {"type": ..., "base_result_id": ...}`,
  `provenance.synthetic = "true"`, và **không** có `seed_tag` của tập 1.000 (để không lọt vào tập chọn của 82-A).
- Expected của ca đột biến viết **tay theo loại lỗi** (kết quả mong đợi: bị từ chối / 422 / 409), không sinh từ output.

| Loại đột biến | Ca |
|---|---|
| missing_unit / missing_value / missing_time | TC-03 |
| unit_not_in_catalog / status_not_final / nonfinite_value | TC-04 |
| patient_not_linked | TC-05 |
| patient_swapped (chỉ trong evidence giả của comparator) | TC-06 |
| conflicting_value_same_id | TC-08 |

Phân biệt: tập 1.000 (hợp lệ, dùng cho tải) và tập `MUT-*` (cố ý lỗi) **không bao giờ chạy chung một lượt đo**.
