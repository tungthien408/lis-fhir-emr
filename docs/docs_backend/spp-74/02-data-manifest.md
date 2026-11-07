# SPP-74 — Bản kê dữ liệu và đáp án đối chiếu

Written for: người chạy thực nghiệm SPP-75 và người kiểm chéo.

SHA-256 tính ngày 04/11/2026 từ file trong repository (commit `fdb9738`), đối chiếu với giá trị ghi trong bằng chứng pilot. Script `scripts/pilot/preflight.sh` kiểm lại các giá trị này (mục 1 và 2) trước mỗi lượt.

## 1. Dữ liệu nạp vào DB

| File | SHA-256 | Ghi chú |
|---|---|---|
| `database/dacn_db_init_v2.sql` | `42d313db34bd54ccedd3b3a60fef734b4f773ced5a0e3ba9b2b0c2414fd87439` | Schema `lis`, `integration`, `emr` |
| `database/access_roles.sql` | `d83ab593c1b0fb99237e7c9122e083f1fdaecae3bb16398f4ecb12992f33c0cb` | Tạo role không mật khẩu (xem mục 5) |
| `database/seed/01_reference_data.sql` | `b66613cf2e1ed1f8d46ce6f0a0efc2efa976532e4e487bf6058ec43e835023e5` | Khớp bằng chứng pilot `final/A1/code-and-environment.txt` |
| `database/seed/02_lis_results.sql` | `28b21b4e19f1df9b79d8ee10944e33e1f1fe20c0045abfd5b5d3fbcd89644fe7` | Khớp bằng chứng pilot |

Nạp tự động khi DB khởi tạo lần đầu qua `docker-entrypoint-initdb.d` (cấu hình trong `compose.yaml`, theo thứ tự 01-schema, 02-roles, 03-reference-data, 04-lis-results).

## 2. Bộ đáp án đối chiếu (oracle `spp65-v2`)

Thư mục `backend/scripts/spp82/reference/spp65-v2/`.

| File | SHA-256 |
|---|---|
| `manifest.json` | `55cb4256c77d731bff7e8ea1c1ad7f9788df889b4833d9a6b501282c169c7267` |
| `manifest.sha256` | `ab1fe149f1d7a6e90d125ed7785dc71315f6eb01343bf98cb529a3c80e155db4` |
| `expected.jsonl` (1.000 dòng) | `a421c3c2facb4d45946d44d533365339fe4d4375b2d61a9551326130311fe772` |
| `patient-links.json` | `a93970b2a011f3cb50295554feec2fed52e7fb499f3d36811e7529a4e5992adf` |
| `rules.json` | `a3580b4c62caf2d28c33ecdcacbee27ab6209c12af5d7c5cb232bd81a0cdca80` |
| `upstream-answers.csv` | `8e93c46edcab5a6d4e5d2e06fb8260958590a2b55c2242118fe89525e2fc318a` |

Kiểm tra nhất quán: nội dung `manifest.sha256` trùng SHA-256 của `manifest.json`; bốn hash con trong `manifest.json` trùng hash từng file ở bảng trên; hai hash seed trong `manifest.json` trùng mục 1. Công cụ `spp82:verify` đòi tham số `--oracle-sha256 55cb4256…7267` và dừng nếu không khớp.

Oracle **không bị sửa** trong SPP-72, 73, 74. Lưu ý đã ghi sẵn trong chính `manifest.json` (`provenance.limitations`):
- Bản `manifest_1000.csv` gốc và upstream lock checksum không có trong bàn giao.
- Đây là bản đóng băng cục bộ, **không phải xác nhận của chủ sở hữu SPP-65**.
- Raw `charttime` không có múi giờ: UTC và FINAL là giả định của dự án.

## 3. Dữ liệu nguồn MIMIC-IV

| File | SHA-256 | Trùng `manifest.json` |
|---|---|---|
| `datasets/hosp/labevents.csv.gz` | `d51a4cf1ea63245abe7d544b0d50a928e9ee2ec5eb9a5ce85500aed0bd6c6dfc` | Có |
| `datasets/hosp/d_labitems.csv.gz` | `72ea5f020469fd24543bd98ab3bd0a4f645a5a4b7802d9d52af20d736f9d76db` | Có |

Giấy phép và mô tả: `datasets/LICENSE.txt`, `datasets/README.txt`. Không sửa các file này.

## 4. Quy mô tập thực nghiệm

| Mục | Giá trị | Nguồn |
|---|---|---|
| Số kết quả hợp lệ | 1.000 | `manifest.json` (`population`), `metrics.json` (`planned_count`) |
| Seed tag | `DACN-MIMIC22-SOURCE-ALIGNED-V2` | `rules.json`, bằng chứng pilot |
| Số bệnh nhân | 100 | DB dựng sạch: `lis.patients=100`, `emr.patient_links=100` |
| Phân bố theo mã xét nghiệm | 50802: 210; 50912: 210; 50971: 210; 51222: 210; 51492: 160 | Đầu ra runner `[SPP82]` |
| Dữ liệu cố ý gây lỗi (`MUT-*`) | 0 trong DB sạch; chỉ nạp riêng cho ca lỗi bằng `pilot-evidence/faults/mutations.sql` | |

## 5. Baseline DB — điểm khác pilot cần biết

Baseline thực nghiệm = DB dựng sạch từ repository. Đã đo trên DB tạm dựng bằng đúng 4 file ở mục 1 (PostgreSQL 17.11):

| Bảng | DB sạch từ repo (SPP-74) | DB pilot SPP-73 |
|---|---|---|
| `lis.results` (tổng) | 1.000 | 1.001 |
| `lis.results` có seed tag | 1.000 | 1.000 |
| `lis.patients` | 100 | 101 |
| `emr.patient_links` | 100 | 101 |
| `lis.publish_events` | 0 | 1 |
| `integration.exchange_transactions` | 0 | 1 |
| `emr.lab_results` | 0 | 1 |

Chênh lệch là bản demo `DEMO-R1` / `DEMO-P1` có sẵn trong DB pilot, **không nằm trong `database/seed/`**. Do đó baseline `events=1 exch=1 emr=1` trong `run-all.sh` của SPP-73 không dựng lại được từ repo. Đã chuyển mặc định sang baseline sạch `events=0 exch=0 emr=0 seed=1000 mut=0` (có biến `PILOT_EXPECTED_BASELINE` để giữ baseline cũ).

Tác động: sau mỗi lượt chính thức, DB sạch có **1.000** event/exchange/hàng EMR thay vì 1.001 như pilot. Bộ đối chiếu chỉ xét 1.000 kết quả thuộc seed nên kết quả PASS không đổi về nguyên tắc; điều này được xác nhận bằng lượt tái lập ở [05-reproduction-check.md](05-reproduction-check.md).

## 6. Bước thủ công khi dựng DB (không có trong repo)

Hai bước sau **không** nằm trong script nào của repo và phải làm tay (đã làm và kiểm trên DB tạm):
1. Đặt mật khẩu cho 3 role `lis_app`, `integration_app`, `emr_app` (`access_roles.sql` chỉ tạo role, không đặt mật khẩu).
2. Gắn dấu cô lập: `COMMENT ON DATABASE dacn_db IS 'spp66-disposable:<token>'`, và đặt đúng `<token>` vào `SPP82_VERIFICATION_ISOLATION_TOKEN`. Công cụ capture/verify và `run-all.sh` từ chối chạy nếu không khớp. **`<token>` phải là UUID** (ví dụ tạo bằng `uuidgen`): `spp82:capture` từ chối token không phải UUID. Điều kiện này không có trong tài liệu SPP-73 và chỉ được phát hiện khi tái lập ở SPP-74 (lượt thử đầu publish xong 1.000 kết quả nhưng capture/verify hỏng vì token hex 16 ký tự). `run-all.sh` và `preflight.sh` nay kiểm định dạng trước khi chạy.

Cả mật khẩu lẫn token chỉ nằm trong file `.env` riêng, không vào Git hay tài liệu.

## 7. Tệp khác ảnh hưởng kết quả

| File | SHA-256 |
|---|---|
| `backend/package-lock.json` | `524842e3cf639aee7e94ac226fd9e6eb7d8d0ea54d9ca119924bad501b880466` |
| `backend/package.json` | `2c996ef9806085e7cdfe7b9d7ff85c0a302c9a7d25e53539f310af41e724e60f` |
| `backend/Dockerfile` | `820d487eaffaf7e03a4df022ccf2ace81bf0e4c96d31ef6230c5e82bc91eb8c2` |
| `compose.yaml` | `6fb705c4bfc994ee0d8529b073ba661a1e294e60e4afc2d26012d8d4f68db934` |
| `.env.example` | `d4c854589c005d88739ce77d115dada75feb7120aa417003e6101b328795fe2c` |
| `scripts/pilot/reset.sql` | `685e4056971a6901c01d74502a7c00314e732861b6d84cda36d0de1518b57c36` |

Hash `run-all.sh`, `run-scenario.sh`, `preflight.sh` sau chỉnh sửa SPP-74: tính bằng `sha256sum scripts/pilot/*` tại tag, vì chính tài liệu này nằm trong cùng commit và không thể chứa hash của chính nó.
