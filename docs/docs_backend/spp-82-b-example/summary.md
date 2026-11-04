# SPP-82-B — SIMULATED DATA

Run: SPP82-B-SIMULATED; scenario: SPP-73-simulated; stop: completed.

Hoàn tất: 1/3; lỗi: 1; timeout: 0; đã Publish trước: 1.

p50: 1090 ms; p95: 1090 ms; throughput: 0.9174311926605504 kết quả/s.

Độ trễ: bắt đầu Publish → client đọc lại EMR đúng, sau ACK và DELIVERED. Đồng hồ monotonic; percentile nearest-rank. Throughput = hoàn tất / toàn bộ thời gian chạy (kể cả chờ kết quả chậm/timeout).

Polling 1000 ms; timeout run 10000 ms; HTTP 1000 ms. Polling, lịch hàng đợi và HTTP làm tăng độ trễ quan sát; không cam kết độ chính xác microsecond. Timeout/lỗi đo không chứng minh dịch vụ chưa lưu. Metadata null = chưa biết.
