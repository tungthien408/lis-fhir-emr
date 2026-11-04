# SPP-74 — Danh mục bằng chứng SPP-73

Written for: người lưu trữ và kiểm chéo bằng chứng; người dùng bằng chứng ở Chương 3.

Bằng chứng gốc của SPP-73 **được giữ nguyên**, không sửa, không xóa, không di chuyển trong SPP-74. Tài liệu này chỉ lập danh mục và mã toàn vẹn.

## 1. Trạng thái lưu trữ: **BLOCKED**

| Mục | Hiện trạng |
|---|---|
| Vị trí duy nhất | Thư mục cục bộ `docs/docs_backend/spp-73/pilot-evidence/` trên máy pilot (151 file, ≈3,9 GB) |
| Trong Git | **Không.** `.gitignore` dòng 16 loại trừ toàn bộ thư mục. Đúng chủ ý |
| Bản sao bền vững ngoài máy | **Không có.** Chưa xác minh bất kỳ bản sao nào. SPP-74 không tự sao lưu và không khẳng định đã sao lưu |
| Rủi ro | Mất ổ đĩa, xóa nhầm, hoặc `git clean -fdx` làm mất bằng chứng duy nhất của pilot |

**Điều kiện gỡ BLOCKED:** người phụ trách chọn nơi lưu, sao chép, rồi chạy kiểm tra toàn vẹn ở mục 5 trên bản sao và ghi kết quả. Đề xuất (chưa thực hiện):
1. Nén có kiểm tra: `tar -C docs/docs_backend/spp-73 -cf - pilot-evidence | zstd -T0 -19 > spp73-pilot-evidence.tar.zst`, rồi `sha256sum spp73-pilot-evidence.tar.zst`. Các file `per-result.jsonl` chiếm phần lớn dung lượng và nén tốt (một bản đã được nén gzip từ 19 GB còn 1,49 GB).
2. Chép bản nén lên ít nhất một nơi ngoài máy này (ổ ngoài, hoặc kho lưu trữ nhóm như Google Drive hay storage của trường), kèm file `.sha256`.
3. Ghi vị trí, ngày, người thực hiện và kết quả `sha256sum -c` vào mục 6 bên dưới.
4. Giữ `pilot-evidence.sha256` (file trong thư mục này, nhỏ, được Git theo dõi) làm bản kê để kiểm lại.

Không dùng Git thường cho 3,9 GB. Nếu cần Git, dùng Git LFS hoặc release asset, và phải cấu hình riêng; chưa được chọn.

## 2. Mã toàn vẹn

| File | Nội dung |
|---|---|
| [`pilot-evidence.sha256`](pilot-evidence.sha256) | SHA-256 của **toàn bộ 151 file** trong `pilot-evidence/`, đường dẫn tương đối từ `docs/docs_backend/spp-73/`. Sinh ngày 04/11/2026 bằng `sha256sum`, trước khi SPP-74 thêm file nào vào thư mục |

Kiểm lại: `cd docs/docs_backend/spp-73 && sha256sum -c ../spp-74/pilot-evidence.sha256` (kết quả ghi ở mục 5).

## 3. Cấu trúc và vai trò

Kích thước đọc bằng `du -sh`.

| Đường dẫn (trong `pilot-evidence/`) | Vai trò | Kích thước |
|---|---|---|
| `final/A1…A3/`, `final/B1…B3/` | **6 lượt chính thức** (tuần tự, đồng thời): `before.json`, `after.json`, `artifact-82b/`, `verification/`, `orchestration.log`, `code-and-environment.txt` | 2,0 GB |
| `final/run-all.log` | Nhật ký thứ tự và mã thoát 6 lượt | nhỏ |
| `runA1-seq/` | Lượt A đầu tiên (trước khi sửa DEF-02/03; journal gzip 1,49 GB) | 1,5 GB |
| `runB1-con5/` | Lượt B đầu tiên | 346 MB |
| `run0-small/` | Pilot nhỏ 10 kết quả | 14 MB |
| `_aborted/` | Lượt B bị hủy (OPS-01). **Không dùng làm số liệu** | 1,5 MB |
| `faults/` | Ca lỗi F1–F10 trên stack pilot (`expected.md` viết trước, `transcript.log`, snapshot DB, `mutations.sql`) | 52 KB |
| `faults-retry-config/` | F8-R, F10-R, F8-Z, F10-Z, R1–R4 (retry dài, `ops:requeue-failed`) | 48 KB |
| `tc06-swapped-patient/` | TC-06: hoán đổi liên kết bệnh nhân, bộ đối chiếu phát hiện | 14 MB |
| `fault-tests/` | Log test e2e, integration, repositories (PostgreSQL) | 64 KB |
| `tools/pilot.env.example` | Tên biến môi trường (bản gốc nay ở `scripts/pilot/`) | 4 KB |
| `README.md` | Mô tả ngắn | 4 KB |

Ba tệp lớn nhất: `runA1-seq/artifact-82b/per-result.jsonl.gz` (1.561.408.377 byte), và các `per-result.jsonl` 317–353 MB của từng lượt.

Script và `reset.sql` dùng trong pilot **không còn nằm trong `pilot-evidence/`** (người dùng chuyển sang `scripts/pilot/` ở commit `e0c9717`). Bản dùng ở pilot được giữ trong lịch sử Git tại `e0c9717:scripts/pilot/`.

## 4. SHA-256 các artifact quan trọng (6 lượt chính thức)

Đường dẫn tính từ `docs/docs_backend/spp-73/pilot-evidence/final/<lượt>/`. Hash `per-result.jsonl` trùng giá trị `input_checksums.per_result_jsonl` mà bộ đối chiếu ghi lúc verify (kiểm tra chéo toàn vẹn của 6 lượt).

| Lượt | `artifact-82b/per-result.jsonl` | `artifact-82b/metrics.json` | `verification/comparison-report.json` |
|---|---|---|---|
| A1 | `719a8b22a0200328843557a33c131168ed805c44ccba6dd0b226b5e48f957169` | `364279bfaee1d525d73f7ec2ff44e358f1b9987a9699a90f737cb2086b0de1a4` | `3b68523f59fd631a8293bee71e9c9334fc498003c23c124a202209fcaa10de29` |
| A2 | `91981cea930b843221dcd24732e68969205f86854466e1a2dae3220dcf2e2d59` | `216ac75a492e9f78be7462bc6100b83b9a5422bec6eb0d7273748ba589c079c4` | `c55d524537c83935f847485b8cae6bc2c659dc0ebab0dfdd6480524fb542a406` |
| A3 | `c8acfd13c1625a7bb25ba5fda972d3a32a5e7a23d4189ebd92df83fb83f6d8ea` | `41066af53ceacb98bed385bf6b1cd86fec888e69d5678cc9a8fb94f096f91d26` | `10b31157952c5a0dfefcb7f27f329901054985124220e53aad852dd812a8eaad` |
| B1 | `1ce65f67ab981b9a769f34554c5b38895a5a3ef8721e17768bd22660abddccd3` | `c18a93031a8d2e0492cc838fe8b345ce24c62e94d433b20ad9ef8dec395936d0` | `69960a37d9fec80dfaff5f96bb7efe91d1248c972b1fe55de7487eb0e33394d6` |
| B2 | `d789c67a73c23535e75552cd4679fae91346e197b880537acbac6dada803e502` | `0a43263292b8e7c8bb4d090f432fafd0948d17871b1b8235662d7057930dfe29` | `21a773239c579474ac8f2721b4c54b858d663a69157ea21d9d0cbcce1466ba2c` |
| B3 | `ee9f7f061bd5ad8417ebb24fed65999e66b804e45f88828fe7b7cd42b936e9bb` | `651d2fde2488dd7bc2f014ee52ad93b052a644fa15d65e53df3c76ce4b74a937` | `d53923b7a132f2a412d4825525bbe9c563660a1f97d2aad34176b1e088ad29b5` |

Khác:

| Artifact | SHA-256 |
|---|---|
| `runA1-seq/artifact-82b/per-result.jsonl.gz` | `d5a4899488dd069a44408dadfabd06d42a2206084649aa8199f7410ea39d7650` |
| `runA1-seq/verification/comparison-report.json` | `df896b03496bd52fe162dcb3ecc75d8fa5dab4df84c4d2a7563d4d2ed87dcfc6` |
| `tc06-swapped-patient/after.json` | `0bb98eaec0306292131cc9a326d672f8e891291b8d75a9dee5ba23a960d40bc7` |
| `tc06-swapped-patient/verification/comparison-report.json` | `d82cf62e784e85773a0ebb0663407251abeee950e578d57bea841ef6002e136c` |
| Bản giải nén của `runA1-seq/artifact-82b/per-result.jsonl.gz` (`gunzip -c … \| sha256sum` phải ra giá trị này; ghi ở `input_checksums.per_result_jsonl` trong `runA1-seq/verification/comparison-report.json`) | `cefd0272c67abf16adb59fafcedbc52485a5e6411916a53398c942e43a3dd478` |

Hash của mọi file còn lại: `pilot-evidence.sha256`.

## 5. Cách tìm lại và kiểm tra toàn vẹn

```bash
cd docs/docs_backend/spp-73
sha256sum -c ../spp-74/pilot-evidence.sha256 | grep -v ': OK$' || echo "TẤT CẢ 151 FILE KHỚP"
```
Kiểm một lượt: `jq '.input_checksums' final/A1/verification/comparison-report.json` rồi `sha256sum final/A1/artifact-82b/per-result.jsonl` — hai giá trị phải trùng.

Kết quả chạy kiểm tra toàn vẹn ngày 04/11/2026: xem [05-reproduction-check.md](05-reproduction-check.md), mục "Toàn vẹn bằng chứng".

## 6. Bản ghi lưu trữ (người phụ trách điền)

| Ngày | Người thực hiện | Nơi lưu | SHA-256 bản lưu | Kết quả `sha256sum -c` |
|---|---|---|---|---|
| | | | | |

## 7. Bằng chứng của chính SPP-74

Lượt tái lập A1 trên checkout sạch (DB tạm) được lưu ở thư mục ngoài repo, nằm trong thư mục scratchpad của phiên làm việc, và **không** có tính bền vững. Chỉ phần tóm tắt nhỏ được đưa vào [05-reproduction-check.md](05-reproduction-check.md). Đây không phải số liệu chính thức của đề tài.
