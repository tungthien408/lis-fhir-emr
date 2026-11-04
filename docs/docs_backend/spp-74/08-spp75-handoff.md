# SPP-74 → SPP-75 — Bàn giao chạy thực nghiệm chính thức

Written for: người chạy SPP-75 (thực nghiệm chính thức và lưu bằng chứng).

SPP-74 **không** chạy thực nghiệm chính thức. Tài liệu này nói SPP-75 nhận gì, phải làm gì trước khi chạy, và không được đổi gì.

## 1. SPP-75 nhận được

| Thứ | Ở đâu |
|---|---|
| Phiên bản mã đã chốt | tag `spp74-experiment-v1` (cục bộ, chưa push); `source_tree_sha256=49e9ebcb66b099760e2b8a6431a01bff66a5e1bbc774cb8ca02213f89cd14e2e` |
| Dữ liệu, oracle, hash | [02-data-manifest.md](02-data-manifest.md) |
| Môi trường | [03-environment-manifest.md](03-environment-manifest.md) |
| Cấu hình đã khóa | [04-experiment-config.md](04-experiment-config.md) |
| Cách tái lập, kết quả kiểm chứng | [05-reproduction-check.md](05-reproduction-check.md) |
| Bằng chứng pilot và mã toàn vẹn | [06-evidence-index.md](06-evidence-index.md), `pilot-evidence.sha256` |
| Script chạy | `scripts/pilot/preflight.sh`, `run-all.sh`, `run-scenario.sh`, `reset.sql`, `pilot.env.example` |
| Công cụ đo, đối chiếu, gửi lại | `npm run spp82:dry-run`, `spp82:capture`, `spp82:verify`, `ops:requeue-failed` (từ `backend/`) |
| Tiêu chí PASS, cách tính | `docs/docs_backend/spp-73/08-locked-protocol.md` mục 8; `07-pilot-summary.md` |

## 2. Việc phải làm trước khi chạy (theo thứ tự)

1. **Quyết định nơi lưu bằng chứng SPP-73 và sao lưu** — mục BLOCKED ở [06-evidence-index.md](06-evidence-index.md). Nên làm trước, vì pilot-evidence là bản duy nhất.
2. `git fetch --tags && git checkout spp74-experiment-v1`. Nếu tag chưa có trên máy, lấy từ người phụ trách. Working tree phải sạch.
3. Dựng DB thử nghiệm cô lập và **đặt mật khẩu role + dấu guard** (không có trong repo, xem [02-data-manifest.md](02-data-manifest.md) mục 6). Nếu dùng lại DB pilot hiện tại, nhớ DB đó có `DEMO-R1` và baseline là `events=1 exch=1 emr=1`: đặt `PILOT_EXPECTED_BASELINE="events=1 exch=1 emr=1 seed=1000 mut=0"`. Nên dùng DB dựng sạch (baseline mặc định).
4. Dùng **image Docker hiện có** (`sha256:bf9c57ed…bcad`) cho LIS, Middleware, EMR. Không build lại. Nếu bắt buộc build lại, ghi ID mới và so từng file `src/` như ở [01-source-freeze.md](01-source-freeze.md) mục 4.
5. Tạo file môi trường riêng từ `scripts/pilot/pilot.env.example`. Không đưa vào Git.
6. Khởi động đúng 1 Dispatcher và 1 Worker với cấu hình retry khóa ([04-experiment-config.md](04-experiment-config.md) mục 3).
7. **Chạy lại F8-R và F10-R với cấu hình khóa** (7 phần tử) để đóng mục NOT_VERIFIED. Làm theo `pilot-evidence/faults-retry-config/expected.md` và `transcript.log`. Dữ liệu `MUT-*` nạp bằng `pilot-evidence/faults/mutations.sql`, dọn bằng `cleanup-mut.sql`. Dọn xong mới chạy lượt chính thức. *(Khuyến nghị; nhóm quyết định có bắt buộc không.)*
8. `PILOT_ENV_FILE=… scripts/pilot/preflight.sh` phải ra `PREFLIGHT: PASS`.
9. Chạy: `PILOT_ENV_FILE=… PILOT_EVIDENCE_DIR=<thư-mục-SPP-75> scripts/pilot/run-all.sh` (3 lượt A và 3 lượt B, xen kẽ). `PILOT_EVIDENCE_DIR` phải là thư mục mới. Nếu đặt trong repo, thêm vào `.gitignore` trước.

## 3. SPP-75 không được đổi

- Mã nguồn, seed, oracle, danh sách retry, HTTP timeout, concurrency 1 và 5, 3 lượt, 1 Dispatcher + 1 Worker. Xem [04-experiment-config.md](04-experiment-config.md) mục 1 và 6.
- Không sửa `expected`, oracle hay `reset.sql` để ép PASS.
- Không trộn dữ liệu `MUT-*` vào lượt chính thức.
- Không ghi đè thư mục bằng chứng đã có.

## 4. Đừng làm

- Không chạy `reset.sql` hoặc Publish trên DB chưa qua kiểm guard.
- Không để máy suspend giữa lượt (OPS-03). Nếu suspend, đánh dấu số đo thời gian của lượt đó không tin cậy và chạy lại.
- Không so hiệu năng với kiến trúc khác (không có baseline). Không kết luận B nhanh hơn A nếu số liệu không ủng hộ.
- Không đưa mật khẩu, URL kết nối hay token vào báo cáo.
- Không đưa `per-result.jsonl` (≈300–350 MB mỗi lượt) vào Git.

## 5. Quyết định còn mở (cần người phụ trách)

| # | Quyết định | Khuyến nghị |
|---|---|---|
| 1 | Nơi lưu bằng chứng SPP-73 và SPP-75 | Ổ ngoài hoặc kho nhóm, kèm `sha256sum` |
| 2 | Push nhánh `testing/spp-74` và tag | Chỉ khi đồng ý. Lệnh ở [01-source-freeze.md](01-source-freeze.md) mục 6 |
| 3 | Có bắt buộc chạy lại F8-R/F10-R với cấu hình khóa | Có, rất rẻ (mỗi ca vài phút) |
| 4 | Có chạy thêm đợt nhiều Dispatcher/Worker | Ngoài phạm vi; làm riêng nếu cần giải thích nút cổ chai |
| 5 | Có chạy lại B2 của pilot | Không cần: SPP-75 tạo đủ 3 lượt B mới |
| 6 | Có pin digest cho `node:22` và `postgres:17` | Nên, nếu cần dựng lại ở nơi khác |

## 6. Giới hạn đã biết khi nhận bàn giao

- DEF-04/05: gián đoạn quá ~190 giây vẫn cần `ops:requeue-failed` bằng tay (từng `result_id`).
- Nút cổ chai chưa xác định; concurrency 5 chỉ giới hạn số Publish đang chờ tới LIS, hạ tầng phía sau chỉ có 1+1.
- Máy duy nhất, laptop; số đo không đại diện môi trường khác.
- Oracle là bản đóng băng cục bộ, chưa có xác nhận của chủ SPP-65.
- Dispatcher/Worker (host, Node v26) khác phiên bản Node với container (v22).
