# SPP-75 – Kết quả chính thức (từ metrics.json / comparison-report.json thực tế)
| Lượt | Mode | c | Matched | Missing | Duplicate | Lỗi/timeout/reject | Thời gian (s) | Thông lượng (kq/s) | p50 (s) | p95 (s) | Outcome | Hiệu lực thời gian |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A1 | SEQUENTIAL | 1 | 1000/1000 | 0 | 0 | 0/0/0 | 1064.9 | 0.9390 | 526.1 | 1001.5 | PASS | hợp lệ |
| B1 (gốc, INVALID thời gian) | CONCURRENT | 5 | 1000/1000 | 0 | 0 | 0/0/0 | 1063.7 | 0.9401 | 532.0 | 1007.9 | PASS | INVALID (suspend) |
| A2 | SEQUENTIAL | 1 | 1000/1000 | 0 | 0 | 0/0/0 | 1057.4 | 0.9457 | 524.5 | 997.6 | PASS | hợp lệ |
| B2 | CONCURRENT | 5 | 1000/1000 | 0 | 0 | 0/0/0 | 1061.0 | 0.9425 | 528.2 | 1005.4 | PASS | hợp lệ |
| A3 | SEQUENTIAL | 1 | 1000/1000 | 0 | 0 | 0/0/0 | 1056.1 | 0.9468 | 523.8 | 995.5 | PASS | hợp lệ |
| B3 | CONCURRENT | 5 | 1000/1000 | 0 | 0 | 0/0/0 | 1062.0 | 0.9416 | 530.3 | 1006.1 | PASS | hợp lệ |
| B1R (chạy lại) | CONCURRENT | 5 | 1000/1000 | 0 | 0 | 0/0/0 | 1063.0 | 0.9408 | 530.7 | 1007.5 | PASS | hợp lệ |

Cả 7 lượt: planned=completion=total_expected=matched=1000; missing, duplicate, wrong_patient_linkage, field_mismatch, unexpected_extra, unverified, failed đều 0; simulated=false; partial_run=false (VERIFIED, đọc từ file bằng chứng).

**Kết luận:** A1, A2, A3, B2, B3 và B1R hợp lệ và PASS. B1 gốc PASS về độ đúng dữ liệu nhưng **INVALID cho phép đo thời gian** do máy suspend. Có đủ 3 lượt A hợp lệ và 3 lượt B hợp lệ (B1R, B2, B3). Dữ liệu B1 gốc không dùng trong thống kê.
Ghi chú điều tra: elapsed của B1 gốc (1.063,7 s) gần các lượt khác dù thời gian thực là ~2h40; có vẻ đồng hồ đo là monotonic nên không tính thời gian suspend, nhưng chưa xác minh tác động lên timeout/lease đang chạy, nên giữ INVALID.
