# SPP-82-B

Run: bb1d7e4c-960b-45e9-8e40-6cfec7789526; scenario: E1-1000; stop: completed.

Hoàn tất: 1000/1000; lỗi: 0; timeout: 0; đã Publish trước: 0.

p50: 521916.2688870001 ms; p95: 987793.060451 ms; throughput: 0.9529343607503785 kết quả/s.

Độ trễ: bắt đầu Publish → client đọc lại EMR đúng, sau ACK và DELIVERED. Đồng hồ monotonic; percentile nearest-rank. Throughput = hoàn tất / toàn bộ thời gian chạy (kể cả chờ kết quả chậm/timeout).

Polling 1000 ms; timeout run 3600000 ms; HTTP 10000 ms. Polling, lịch hàng đợi và HTTP làm tăng độ trễ quan sát; không cam kết độ chính xác microsecond. Timeout/lỗi đo không chứng minh dịch vụ chưa lưu. Metadata null = chưa biết.
