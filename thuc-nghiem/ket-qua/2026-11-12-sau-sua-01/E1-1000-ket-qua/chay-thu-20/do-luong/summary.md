# SPP-82-B

Run: 13660601-65c1-4f57-ba68-2140a43eed7d; scenario: E1-chay-thu; stop: completed.

Hoàn tất: 20/20; lỗi: 0; timeout: 0; đã Publish trước: 0.

p50: 11147.493052 ms; p95: 19189.524366999998 ms; throughput: 0.9790393210967276 kết quả/s.

Độ trễ: bắt đầu Publish → client đọc lại EMR đúng, sau ACK và DELIVERED. Đồng hồ monotonic; percentile nearest-rank. Throughput = hoàn tất / toàn bộ thời gian chạy (kể cả chờ kết quả chậm/timeout).

Polling 1000 ms; timeout run 3600000 ms; HTTP 10000 ms. Polling, lịch hàng đợi và HTTP làm tăng độ trễ quan sát; không cam kết độ chính xác microsecond. Timeout/lỗi đo không chứng minh dịch vụ chưa lưu. Metadata null = chưa biết.
