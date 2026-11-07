# SPP-74 — Kiểm chứng khả năng tái lập

Written for: người chạy SPP-75 (làm theo từng bước) và người kiểm chéo (kiểm lại kết quả).

Ngày: 04/11/2026. Mục tiêu: chứng minh một người khác lấy đúng phiên bản đã chốt, dựng môi trường sạch và chạy ra kết quả đúng, chỉ bằng lệnh trong tài liệu. Ký hiệu: **VERIFIED** (đã làm thật và có bằng chứng), **NOT_VERIFIED** (chưa làm, có nguyên nhân).

## 1. Cách kiểm chứng

Tất cả thực hiện trên **môi trường tách biệt với stack pilot**, để không đụng dữ liệu pilot:
- Mã: `git clone` repository vào thư mục tạm rồi `git checkout` đúng commit (`110a07d`, chứa mọi script và mã của tag), sau đó `npm ci` từ `package-lock.json`.
- DB: container PostgreSQL 17 mới (`spp74-repro-db`, cổng 55433) với 4 file khởi tạo gắn giống `compose.yaml`; dữ liệu không liên quan đến DB pilot.
- Dịch vụ: LIS (13101), Middleware (13102), EMR (13103), 1 Dispatcher, 1 Worker, chạy trực tiếp từ checkout sạch bằng `node --import tsx`, với retry khóa.
- Stack pilot (cổng 3101–3103, 5433) không bị đụng. Chỉ dừng Dispatcher và Worker host của pilot để lượt tái lập đếm tiến trình 1+1 (hai tiến trình này do phiên SPP-73 khởi động và đã xong việc).

## 2. Kết quả theo chín bước của quy trình

| # | Bước | Trạng thái | Chi tiết và bằng chứng |
|---|---|---|---|
| 1 | Checkout đúng commit | **VERIFIED** | `git clone` + `checkout 110a07d`; `git status` sạch; `source_tree_sha256=49e9ebcb…14e2e` (khớp pilot) ghi trong `repro-evidence/attempt2-pass/code-and-environment.txt` |
| 2 | Cài dependency đúng phiên bản | **VERIFIED** | `npm ci` exit 0 (3 lần, trên 3 bản checkout/giải nén); `package-lock.json` trùng SHA-256 `524842e3…0466` |
| 3 | Khởi động PostgreSQL | **VERIFIED** (bằng `docker run`) / **NOT_VERIFIED** (bằng `docker compose`) | Dùng `docker run` với đúng 4 mount của `compose.yaml`. Chưa chạy `docker compose up` vì cổng cố định 3101–3103, 5433 đang bị stack pilot chiếm; không dừng stack pilot để thử |
| 4 | Khởi tạo và nạp dữ liệu | **VERIFIED** | Sau khởi tạo: `seed=1000`, `lis.results=1000`, `lis.patients=100`, `emr.patient_links=100`, `events=0 exch=0 emr=0`. Hai bước tay (đặt mật khẩu role, gắn guard) làm theo [02-data-manifest.md](02-data-manifest.md) mục 6 |
| 5 | Khởi động LIS, Middleware, EMR | **VERIFIED** (từ mã nguồn) / **NOT_VERIFIED** (từ image) | Chạy từ checkout bằng `tsx`. Dựng lại image từ `Dockerfile` chưa làm; nội dung `src/` của image pilot đã so từng file khớp repo ([01-source-freeze.md](01-source-freeze.md) mục 4) |
| 6 | Khởi động Dispatcher và Worker | **VERIFIED** | Đúng 1+1, retry khóa; `preflight.sh` đọc `/proc/<pid>/environ` và xác nhận không có biến lạ |
| 7 | Kiểm readiness | **VERIFIED** | `/ready` trả 200 cho 3 dịch vụ (trong `preflight.sh`) |
| 8 | Kiểm baseline | **VERIFIED** | `events=0 exch=0 emr=0 seed=1000 mut=0` ở đầu cả hai lượt |
| 9 | Công cụ chạy và đối chiếu | **VERIFIED** | Lượt A1 1.000 kết quả, xem mục 3 |

Thêm:

| Kiểm tra | Trạng thái | Chi tiết |
|---|---|---|
| `npm run check` trên checkout sạch | **VERIFIED** | exit 0 |
| `npm run test:spp82` | **VERIFIED** | 112/112 pass |
| `npm run test:ops` | **VERIFIED** | 13/13 pass |
| Reset từ trạng thái đã có dữ liệu về baseline | **VERIFIED** | `run-all.sh` lần 2 bắt đầu khi DB còn 1.000 event của lần 1; `reset.sql` chạy, rồi baseline đúng `events=0 …`, nếu sai script thoát mã 5 |
| `preflight.sh` đạt khi cấu hình đúng | **VERIFIED** | `PREFLIGHT: PASS`, 20 kiểm tra (git sạch, định dạng UUID của token, hash mã, hash dữ liệu/oracle/lockfile, `/ready`, tiến trình, biến retry, guard) |
| `preflight.sh` báo lỗi khi sai | **VERIFIED** | Dùng sai container DB: `FAIL guard cô lập KHÔNG khớp`, `PREFLIGHT: FAIL` |
| `run-all.sh` từ chối token không phải UUID trước khi reset | **VERIFIED** | Thoát mã 7, DB nguyên vẹn (1.000 event vẫn còn) |
| Chế độ B (đồng thời) trên checkout sạch | **NOT_VERIFIED** | Không chạy; dùng cùng script, chỉ đổi `--mode CONCURRENT --concurrency 5`. B đã chạy 3 lần ở SPP-73 |
| Chạy từ tag `spp74-experiment-v1` | Xem mục 5 | |

## 3. Lượt A1 tái lập trên checkout sạch

Hai lần chạy, **giữ cả hai** để minh bạch.

### Lần 1 — hỏng ở bước đối chiếu (lỗi tài liệu, đã sửa)

| Mục | Kết quả |
|---|---|
| Publish | `publish_exit=0`: 1.000 hoàn tất, 0 lỗi, 0 timeout; DB có 1.000 `DELIVERED`, 1.000 hàng EMR |
| `spp82:capture` | **Thất bại** (cả `before` và `after`: file đầu ra rỗng) |
| `spp82:verify` | `NOT_VERIFIED`, exit 2 |
| Nguyên nhân | `spp82:capture` chỉ chấp nhận `SPP82_VERIFICATION_ISOLATION_TOKEN` dạng **UUID** (`evidence-collector.ts`); token thử là chuỗi hex 16 ký tự. Tài liệu SPP-73 không ghi điều kiện này |
| Xử lý | `run-all.sh` kiểm UUID trước reset (commit `110a07d`); `preflight.sh` kiểm định dạng; ghi vào [02-data-manifest.md](02-data-manifest.md) mục 6 |
| Hệ quả với số liệu | Không có: bộ đối chiếu trả `NOT_VERIFIED`, không phải PASS. Đây đúng là hành vi an toàn mong muốn (thiếu bằng chứng ≠ thành công) |

Bằng chứng: `repro-evidence/attempt1-token-not-uuid/`.

### Lần 2 — PASS

| Mục | Giá trị |
|---|---|
| Commit | `110a07d1dabff39b7c0456d08d7072ba326f9f0d` |
| `source_tree_sha256` | `49e9ebcb66b099760e2b8a6431a01bff66a5e1bbc774cb8ca02213f89cd14e2e` (giống pilot) |
| Baseline | `events=0 exch=0 emr=0 seed=1000 mut=0` |
| Chế độ | `SEQUENTIAL`, concurrency 1 |
| Hoàn tất / lỗi / timeout / đã tồn tại | 1.000 / 0 / 0 / 0 |
| Đối chiếu độc lập | **PASS**, `verify_exit=0`: khớp 1.000, thiếu 0, trùng 0, sai bệnh nhân 0, sai trường 0, dữ liệu cũ 0 |
| DB sau lượt | 1.000 event, 1.000 `DELIVERED`, 1.000 hàng EMR (DB sạch, không có bản `DEMO-R1` nên 1.000 chứ không phải 1.001) |
| Tổng thời gian | 1.059,8 giây |
| Thông lượng | 0,9435 kết quả/giây |
| p50 / p95 | 524,0 / 995,6 giây |
| Suspend máy trong lượt | 0 sự kiện trong `journalctl` |
| Toàn vẹn | SHA-256 `per-result.jsonl` = `7d4ee4c8…9398084` và trùng `input_checksums.per_result_jsonl` mà bộ đối chiếu ghi |

So với pilot (chế độ A, 3 lượt): thông lượng 0,9359 – 0,9463; tổng thời gian 1.056,8 – 1.068,5 giây. Lượt tái lập nằm trong khoảng đó. **Đây là một lượt kiểm chứng tái lập, không phải số liệu thực nghiệm chính thức**, và không dùng để so sánh hiệu năng.

Bằng chứng (bản tóm tắt nhỏ, nằm trong Git): `repro-evidence/attempt2-pass/`. Journal đầy đủ ≈ 300 MB nằm ngoài repo, không bền vững.

## 4. Toàn vẹn bằng chứng SPP-73

Lệnh: `cd docs/docs_backend/spp-73 && sha256sum -c ../spp-74/pilot-evidence.sha256`.

Kết quả ngày 04/11/2026: **151/151 file khớp, 0 sai lệch** (≈12 giây). Bằng chứng gốc của SPP-73 chưa bị sửa.

## 5. Chạy từ tag

Tag được tạo trên commit cuối của SPP-74 (commit chứa tài liệu này). Cách kiểm lại:

```bash
git rev-parse spp74-experiment-v1^{commit}          # phải khớp commit ghi trong báo cáo SPP-74
git clone <repo> /tmp/spp74-check && git -C /tmp/spp74-check checkout spp74-experiment-v1
cd /tmp/spp74-check && git ls-files -co --exclude-standard backend/src backend/scripts database | sort | xargs sha256sum | sha256sum
# phải ra 49e9ebcb66b099760e2b8a6431a01bff66a5e1bbc774cb8ca02213f89cd14e2e
```
Kết quả kiểm khi tạo tag ghi trong báo cáo cuối của SPP-74 (không thể nằm trong chính commit được gắn tag).

## 6. Điều chưa kiểm chứng

1. `docker compose up` từ đầu (xung đột cổng với stack pilot).
2. Dựng lại image từ `Dockerfile` ra cùng ID (tag trôi `node:22`).
3. Chế độ đồng thời (B) và đủ 3 lượt mỗi chế độ trên checkout sạch.
4. F8-R/F10-R với cấu hình retry khóa (7 phần tử).
5. Máy thứ hai hoặc người thứ hai. Người kiểm chéo nên tự làm lại mục 2 trên máy của mình.
