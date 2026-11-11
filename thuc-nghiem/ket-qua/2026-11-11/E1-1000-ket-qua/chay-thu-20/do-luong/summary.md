# SPP-82-B

Run: 64e5f2dd-9be1-44a6-b8f4-149d99e17c5b; scenario: E1-chay-thu; stop: completed.

Hoàn tất: 20/20; lỗi: 0; timeout: 0; đã Publish trước: 0.

p50: 11251.235678000001 ms; p95: 20358.350086000002 ms; throughput: 0.9223715755147526 kết quả/s.

Độ trễ: bắt đầu Publish → client đọc lại EMR đúng, sau ACK và DELIVERED. Đồng hồ monotonic; percentile nearest-rank. Throughput = hoàn tất / toàn bộ thời gian chạy (kể cả chờ kết quả chậm/timeout).

Polling 1000 ms; timeout run 3600000 ms; HTTP 10000 ms. Polling, lịch hàng đợi và HTTP làm tăng độ trễ quan sát; không cam kết độ chính xác microsecond. Timeout/lỗi đo không chứng minh dịch vụ chưa lưu. Metadata null = chưa biết.
