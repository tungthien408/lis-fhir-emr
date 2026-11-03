# SPP-73 — Hướng dẫn tái lập thực nghiệm

Written for: một người trong nhóm (hoặc SPP-74) muốn chạy lại thực nghiệm từ đầu.

Lưu ý: mọi lệnh dưới đây đã được chạy thật ngày 03/11/2026 trên stack pilot (trừ khi ghi chú khác). Không chạy lệnh nào khác so với mục này nếu chưa kiểm lại.

## 0. Điều kiện an toàn (đọc trước)

- **Chỉ chạy trên DB cô lập, dùng riêng cho thử nghiệm.** Các lệnh Publish và reset ghi vào DB. Không chạy trên DB có dữ liệu thật hoặc DB dùng chung.
- DB phải có comment `spp66-disposable:<token>` và `<token>` phải khớp biến `SPP82_VERIFICATION_ISOLATION_TOKEN`. Kiểm tra:
  ```bash
  docker exec lis-fhir-emr-db-1 psql -U postgres -d dacn_db -Atc "select shobj_description(oid,'pg_database') from pg_database where datname='dacn_db'"
  ```
  Kết quả phải bắt đầu bằng `spp66-disposable:`. Không khớp thì **dừng**. (Ngày 03/11/2026 kiểm tra đúng; token không ghi trong tài liệu.)
- `reset.sql` **không tự kiểm tra** guard. Người chạy phải kiểm tra trước.
- Không tắt máy hoặc đóng nắp laptop giữa lượt (xem OPS-03).
- Không đưa mật khẩu, URL kết nối hay token vào báo cáo hay Git.
- Không sửa `database/seed/`, `scripts/spp82/reference/`, hay dữ liệu MIMIC.

## 1. Chuẩn bị môi trường

1. Mã nguồn: cùng phiên bản đã chạy (xem `source_tree_sha256` trong `pilot-evidence/final/A1/code-and-environment.txt`). Hiện chưa commit, nên cần người phụ trách cung cấp đúng snapshot (xem 07, mục 6).
2. Phụ thuộc: cài đặt thư viện Node trong `backend/` (`npm install`). Lệnh này không nằm trong bằng chứng pilot, nên kiểm lại khi chạy đầu tiên.
3. Docker: dựng các container từ gốc repo (lần pilot dùng `docker compose`; lệnh chính xác người dựng chưa ghi lại). PostgreSQL 17 chạy ở `127.0.0.1:5433`, DB `dacn_db`, container `lis-fhir-emr-db-1`.
4. File môi trường `../.env` (npm tự nạp với `--env-file-if-exists`). Tạo file môi trường riêng cho thực nghiệm, chứa các biến có tên trong `pilot-evidence/tools/pilot.env.example`. **Giá trị không ghi trong repo.**

## 2. Kiểm tra dữ liệu và cấu hình

```bash
cd backend
npm run check                 # phải exit 0
npm run test:spp82            # phải 112/112
npm run test:ops              # phải 13/13
```

Kiểm seed (đường dẫn `database/seed/`): hash phải khớp `final/A1/code-and-environment.txt`.

Kiểm đáp án:
```bash
sha256sum scripts/spp82/reference/spp65-v2/manifest.json   # 55cb4256c77d731bff7e8ea1c1ad7f9788df889b4833d9a6b501282c169c7267
```

Kiểm trạng thái DB trước khi chạy: sau khi reset (mục 7), đếm phải là `events=1 exch=1 emr=1 seed=1000 mut=0`.

## 3. Khởi động dịch vụ

1. LIS, Middleware, EMR (container). Kiểm sẵn sàng:
   ```bash
   for p in 3101 3102 3103; do curl -s -o /dev/null -w "$p %{http_code}\n" http://127.0.0.1:$p/ready; done   # phải 200
   ```
2. Dispatcher và Worker, **mỗi cái đúng 1 tiến trình**, chạy nền. Cấu hình thử lại đã dùng:
   ```bash
   cd backend
   LIS_DISPATCHER_RETRY_DELAYS_MS=2000,4000,8000,16000,32000,64000,64000 npm run dev:lis-dispatcher
   MIDDLEWARE_WORKER_RETRY_DELAYS_MS=2000,4000,8000,16000,32000,64000,64000 npm run dev:middleware-worker
   ```
3. Kiểm số tiến trình (phải đúng 1 và 1):
   ```bash
   ps -eo args | grep -c '[l]is/dispatcher-main'
   ps -eo args | grep -c '[m]iddleware/worker-main'
   ```

## 4. Chạy kịch bản

Dùng script đã lưu: `pilot-evidence/tools/run-scenario.sh <thư-mục-mới> <nhãn> <SEQUENTIAL|CONCURRENT> <concurrency>`. Script này cần file môi trường (mục 1, bước 4) và chạy theo thứ tự:

1. `spp82:capture --phase before` → `before.json`
2. `spp82:dry-run -- --confirm-publish --mode … --concurrency …` với `SPP82_MEASURE=1` → `artifact-82b/`
3. `spp82:capture --phase after` → `after.json`
4. `spp82:verify` → `verification/` (kết quả: `outcome`)

Lệnh chạy 6 lượt chính thức (đã dùng): `pilot-evidence/final/run-all.sh`. Script từ chối chạy nếu thư mục đã tồn tại, nếu baseline sai, hoặc nếu số tiến trình không phải 1+1.

Với kịch bản dịch lỗi (F1–F10): làm theo `pilot-evidence/faults/expected.md` (viết trước khi chạy) và `faults/lib.sh`. Dữ liệu lỗi nạp bằng `mutations.sql`, dọn bằng `cleanup-mut.sql`. Không trộn dữ liệu lỗi vào lượt chính thức.

## 5. Lưu log và báo cáo

Sau mỗi lượt, kiểm tra trong thư mục lượt:
- `orchestration.log` có `publish_exit=0` và `verify_exit=0`.
- `verification/summary.md` có `PASS`.
- `verification/comparison-report.json`: `matched_result_count=1000`, các số còn lại bằng 0.

Không xóa hoặc ghi đè bằng chứng cũ. Lượt lỗi hoặc bị hủy lưu vào thư mục `_aborted/` và không dùng làm số liệu.

## 6. Đọc lại dữ liệu tại EMR và đối chiếu nguồn–đích

Đối chiếu tự động: bước `spp82:capture --phase after` đọc EMR qua `EMR_VERIFY_DATABASE_URL`, rồi `spp82:verify` so với đáp án. Đây là căn cứ chính.

Đếm nhanh để kiểm tra (chỉ đọc):
```bash
docker exec lis-fhir-emr-db-1 psql -U postgres -d dacn_db -Atc "select count(*) from emr.lab_results"            # 1.001 sau lượt chính thức (1.000 + DEMO-R1)
docker exec lis-fhir-emr-db-1 psql -U postgres -d dacn_db -Atc "select status,count(*) from integration.exchange_transactions group by status"
```

## 7. Reset an toàn cho lần tiếp theo

1. Kiểm guard (mục 0).
2. Dispatcher/Worker có thể vẫn chạy. Reset không cần dừng chúng, nhưng sau reset phải kiểm baseline (bước 4) để chắc không còn event đang chờ từ lượt trước.
3. Chạy:
   ```bash
   docker exec -i lis-fhir-emr-db-1 psql -U postgres -d dacn_db -v ON_ERROR_STOP=1 < docs/docs_backend/spp-73/pilot-evidence/reset.sql
   ```
   Reset chạy trong một transaction, lỗi thì rollback. Đã xác minh: 3 lần COMMIT sau khi sửa DEF-01.
4. Kiểm baseline (mục 2). Phải đúng `events=1 exch=1 emr=1 seed=1000 mut=0`.

Reset chỉ xóa dữ liệu của 1.000 seed và dữ liệu phát sinh từ chúng. Không xóa `lis.results` gốc, bệnh nhân, catalog, `patient_links`, và `DEMO-*`.

## 8. Lặp lại phép đo

Lặp lại mục 4–7 với nhãn lượt mới. Giữ nguyên: cùng mã nguồn (`source_tree_sha256`), cùng seed, cùng oracle, cùng cấu hình retry, 1 Dispatcher + 1 Worker. Nên xen kẽ tuần tự và đồng thời như `run-all.sh`.

Lượt đầu tiên sau khi bật lại máy cần chạy lại baseline trước (mục 2).

## 9. Các lệnh đã xác minh và điều kiện

| Lệnh | Mục đích | Điều kiện | Đã chạy |
|---|---|---|---|
| `npm run check` | Kiểm kiểu | — | Có (exit 0) |
| `npm run test:spp82` | Test công cụ đo | — | Có (112/112) |
| `npm run test:ops` | Test công cụ gửi lại | — | Có (13/13) |
| `npm run spp82:dry-run -- --confirm-publish …` | Publish thật | DB guard, `SPP82_EXPERIMENT_TARGET`, môi trường cô lập | Có |
| `npm run spp82:capture` / `spp82:verify` | Chụp và đối chiếu | oracle SHA khớp | Có |
| `npm run ops:requeue-failed -- lis\|middleware <id> --budget N [--confirm]` | Gửi lại `FAILED` | Không có `--confirm` thì chỉ xem trước | Có (R1–R4) |
| `reset.sql` | Reset | Guard (mục 0) | Có |
