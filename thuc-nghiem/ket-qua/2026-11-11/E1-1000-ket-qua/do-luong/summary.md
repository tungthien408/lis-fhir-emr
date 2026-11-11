# SPP-82-B

Run: 0addde7f-d46d-4525-a4e3-cb75aeaee3be; scenario: E1-1000; stop: completed.

Hoàn tất: 1000/1000; lỗi: 0; timeout: 0; đã Publish trước: 0.

p50: 525290.391447 ms; p95: 999927.417296 ms; throughput: 0.9408545604431181 kết quả/s.

Độ trễ: bắt đầu Publish → client đọc lại EMR đúng, sau ACK và DELIVERED. Đồng hồ monotonic; percentile nearest-rank. Throughput = hoàn tất / toàn bộ thời gian chạy (kể cả chờ kết quả chậm/timeout).

Polling 1000 ms; timeout run 3600000 ms; HTTP 10000 ms. Polling, lịch hàng đợi và HTTP làm tăng độ trễ quan sát; không cam kết độ chính xác microsecond. Timeout/lỗi đo không chứng minh dịch vụ chưa lưu. Metadata null = chưa biết.
