# SPP-74 — Cấu hình thực nghiệm chính thức (đã khóa)

Written for: người chạy thực nghiệm SPP-75 và người kiểm chéo.

Mọi giá trị dưới đây được lấy từ cấu hình **đã chạy thật** ở SPP-73 (tiến trình đang chạy, `code-and-environment.txt`, mã nguồn), không đặt mới. Cột "Nguồn" chỉ chỗ kiểm lại. Script `scripts/pilot/preflight.sh` kiểm các giá trị đánh dấu ✔ trước mỗi lượt.

## 1. Quy ước khóa

1. Trong suốt SPP-75, **không đổi** mã nguồn, seed, oracle, hay bất kỳ giá trị nào ở mục 2–5 giữa các lượt.
2. Mọi lượt chạy cùng tag `spp74-experiment-v1`. `preflight.sh` thất bại nếu HEAD không đúng tag hoặc working tree không sạch.
3. Nếu bắt buộc đổi một giá trị, dừng đợt, ghi lý do, chạy lại các bài ở mục 6, và làm lại từ lượt đầu của đợt.
4. Cấu hình được chia sẻ giữa A và B trừ đúng hai thông số: chế độ và concurrency.

## 2. Thông số thử tải

| Thông số | Giá trị | Nguồn | Kiểm |
|---|---|---|---|
| Tập dữ liệu | 1.000 kết quả, seed `DACN-MIMIC22-SOURCE-ALIGNED-V2`, oracle `spp65-v2` | [02-data-manifest.md](02-data-manifest.md) | ✔ hash |
| Chế độ A | `SEQUENTIAL`, `--concurrency 1` | `scripts/pilot/run-all.sh` | |
| Chế độ B | `CONCURRENT`, `--concurrency 5` | `scripts/pilot/run-all.sh` | |
| Số lượt | 3 mỗi chế độ, thứ tự xen kẽ A1 B1 A2 B2 A3 B3 | `run-all.sh` | |
| Số LIS Dispatcher | 1 | `final/*/code-and-environment.txt` | ✔ đếm tiến trình |
| Số Middleware Worker | 1 | như trên | ✔ |
| Đo thời gian | `SPP82_MEASURE=1` | `scripts/pilot/run-scenario.sh` | |
| Thời gian tối đa một lượt | 3.600.000 ms (`SPP82_RUN_TIMEOUT_MS`; mặc định của công cụ chỉ 120.000 ms) | `run-scenario.sh` | |
| Polling của runner | 1.000 ms (`SPP82_POLL_MS`, mặc định, không đặt biến) | `measurement-config.ts` | |
| Observer concurrency | 2 (`SPP82_OBSERVER_CONCURRENCY`, mặc định) | `measurement-config.ts` | |
| HTTP timeout của runner (Publish) | 10.000 ms (`DEFAULT_HTTP_TIMEOUT_MS`, mặc định) | `load-config.ts` | |
| Số Dispatcher/Worker khai báo cho runner | 1 / 1 (`SPP82_DECLARED_*`) | `pilot.env.example` | |

## 3. Retry và timeout của Dispatcher và Worker

| Thông số | Giá trị khóa | Nguồn | Kiểm |
|---|---|---|---|
| `LIS_DISPATCHER_RETRY_DELAYS_MS` | `2000,4000,8000,16000,32000,64000,64000` | Biến môi trường tiến trình, đọc từ `/proc/<pid>/environ` | ✔ |
| `MIDDLEWARE_WORKER_RETRY_DELAYS_MS` | `2000,4000,8000,16000,32000,64000,64000` | như trên | ✔ |
| Số lần thử tối đa (mỗi chặng) | 8 (= số phần tử + 1; Dispatcher có `LIS_DISPATCHER_MAX_ATTEMPTS` nhưng không đặt, Worker không có biến này) | `dispatcher-config.ts`, `worker-config.ts` | |
| Tổng thời gian chờ giữa các lần thử | 190 giây (2+4+8+16+32+64+64) | tính từ danh sách | |
| HTTP timeout Dispatcher | 3.000 ms (mặc định, **không** đặt biến) | `dispatcher-config.ts:48` | ✔ không có biến lạ |
| HTTP timeout Worker | 3.000 ms (mặc định) | `worker-config.ts:44` | ✔ |
| Lease Dispatcher / Worker | 15.000 ms (mặc định) | `*-config.ts` | ✔ |
| Poll Dispatcher / Worker | 1.000 ms (mặc định) | `*-config.ts` | ✔ |

`preflight.sh` còn kiểm Dispatcher/Worker **không** có biến `LIS_DISPATCHER_*` / `MIDDLEWARE_WORKER_*` nào khác ngoài danh sách retry (tức các giá trị mặc định ở trên đang hiệu lực). Cấu hình mặc định `2000,4000,8000` trong `compose.yaml` và `.env.example` **không** được dùng.

Cách khởi động đúng (từ `backend/`):
```bash
LIS_DISPATCHER_RETRY_DELAYS_MS=2000,4000,8000,16000,32000,64000,64000 npm run dev:lis-dispatcher
MIDDLEWARE_WORKER_RETRY_DELAYS_MS=2000,4000,8000,16000,32000,64000,64000 npm run dev:middleware-worker
```

## 4. Đối chiếu retry với các bài F8/F10 đã đạt (kết quả từ SPP-73)

| Bài | Cấu hình khi chạy | Kết quả | Bằng chứng |
|---|---|---|---|
| F7, F9 (tắt ~5 s) | Mặc định `2000,4000,8000` | PASS | `pilot-evidence/faults/` |
| F8, F10 (tắt 30 s, 60 s) | Mặc định | FAIL khôi phục (kẹt `FAILED`) | `pilot-evidence/faults/` |
| F8-R (Middleware tắt ~30 s) | 6 phần tử `2000…64000` (7 lần thử, 126 s) | PASS | `pilot-evidence/faults-retry-config/` |
| F10-R (EMR tắt ~60 s) | như trên | PASS | như trên |
| F8-Z, F10-Z (~140–145 s) | như trên | `FAILED` (giới hạn đã xác nhận) | như trên |
| R3, R4 (`ops:requeue-failed`) | 7 phần tử (8 lần thử) = **cấu hình khóa** | PASS | như trên |
| 6 lượt A/B 1.000 | 7 phần tử = **cấu hình khóa** | PASS 6/6 | `pilot-evidence/final/` |

**Khác biệt cần lưu ý:** F8-R và F10-R chạy với 6 phần tử, còn cấu hình khóa có 7 phần tử (thêm một lần chờ 64 s ở cuối). Lượt A/B và R3/R4 dùng đúng cấu hình khóa. Việc cấu hình khóa chịu được gián đoạn 30 s và 60 s là suy ra (cửa sổ dài hơn, 190 s so với 126 s) chứ **chưa được đo trực tiếp**. Trạng thái: **NOT_VERIFIED**. Cách đóng: chạy lại F8-R và F10-R với cấu hình khóa trước đợt chính thức (xem [08-spp75-handoff.md](08-spp75-handoff.md)).

Gián đoạn dài hơn khoảng 190 giây: vẫn kẹt `FAILED`, phục hồi bằng `npm run ops:requeue-failed` (thao tác tay, từng `result_id`). Đây là giới hạn đã chấp nhận ở mức MVP (DEF-04/05).

## 5. Reset, baseline và an toàn

| Thông số | Giá trị | Kiểm |
|---|---|---|
| Script reset | `scripts/pilot/reset.sql` (SHA-256 `685e4056…c36`), chạy trong 1 transaction | |
| Baseline sau reset (DB dựng sạch từ repo) | `events=0 exch=0 emr=0 seed=1000 mut=0` | ✔ (`preflight.sh`; `run-all.sh` kiểm mỗi lượt) |
| Guard cô lập | Comment DB `spp66-disposable:<token>` khớp `SPP82_VERIFICATION_ISOLATION_TOKEN` | ✔ (`preflight.sh`; `run-all.sh` kiểm trước mỗi reset, thoát mã 7 nếu sai) |
| `SPP82_EXPERIMENT_TARGET` | Bắt buộc có khi `--confirm-publish`; nhãn môi trường thử nghiệm do người chạy đặt | `load-config.ts` |
| Tiến trình | Đúng 1 Dispatcher + 1 Worker | ✔ |
| Thư mục bằng chứng | Mới cho mỗi lượt; `run-all.sh` từ chối nếu đã tồn tại | |

## 6. Khi thay đổi, phải chạy lại

| Nếu đổi | Chạy lại tối thiểu |
|---|---|
| Danh sách retry | F8-R, F10-R, R3, R4 và 1 lượt A |
| HTTP timeout, lease, poll | F7, F9, F8-R, F10-R và 1 lượt A |
| Concurrency, số lượt, số Dispatcher/Worker | Toàn bộ 3 lượt của chế độ bị đổi |
| `backend/src`, schema, seed, oracle | Toàn bộ pilot (đây là thay đổi phiên bản, không phải cấu hình) |
| Phiên bản Node (host hoặc image), PostgreSQL | 1 lượt A và 1 lượt B, ghi rõ khác biệt |

## 7. Kiểm trước mỗi lần chạy

```bash
# từ gốc repo, với file môi trường riêng (xem scripts/pilot/pilot.env.example)
PILOT_ENV_FILE=<file-môi-trường> scripts/pilot/preflight.sh
```
Chỉ đọc, không ghi DB. Mã thoát 0 nghĩa mọi kiểm tra ✔ ở mục 2–5 đạt (kèm hash dữ liệu/oracle, `/ready`, git sạch + đúng tag). Đã chạy thử trên stack tái lập: PASS khi cấu hình đúng, FAIL khi guard không khớp ([05-reproduction-check.md](05-reproduction-check.md)).
