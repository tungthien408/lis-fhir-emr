SPP-75 – chạy chính thức (04/11/2026). App/dữ liệu: tag spp74-experiment-v1 (source_tree_sha256 49e9ebcb…); runner spp75-runner-v3 (sửa mã thoát, 36 test PASS).
Kết quả: A1/A2/A3 và B2/B3 PASS 1000/1000; B1 gốc PASS dữ liệu nhưng thời gian INVALID (máy suspend) nên chạy lại B1R PASS 1000/1000. 0 thiếu/trùng/sai/lỗi/retry/timeout.
Hiệu năng (n=3/nhóm): A ≈ 1.059 s, 0,944 kq/s, p50 ≈ 525 s, p95 ≈ 998 s; B ≈ 1.062 s, 0,942 kq/s, p50 ≈ 530 s, p95 ≈ 1.006 s. Không có bằng chứng concurrency=5 nhanh hơn (1 Dispatcher + 1 Worker).
F8-R/F10-R PASS với retry 7 phần tử. Ca F1–F7, F9, TC-06 kế thừa SPP-73 (chưa chạy lại).
Sai lệch: xem docs/docs_backend/spp-75/06. SINGLE_COPY_RISK: bằng chứng 2,5 GiB chỉ có một bản. Chờ kiểm chéo (Thiện) trước Done.
