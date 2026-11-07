# Expected F8-R / F10-R (viết TRƯỚC khi chạy, 04/11/2026)
Cấu hình: Dispatcher và Worker `RETRY_DELAYS_MS=2000,4000,8000,16000,32000,64000,64000` (8 lần thử, cửa sổ ~190 s). Dữ liệu: MUT-* (nhân bản MIMIC-LAB-100142, 0.9 mg/dL), không đụng seed 1.000.
| Ca | Thao tác | Expected |
|---|---|---|
| F8-R | Dừng container Middleware ~30 s rồi bật (MUT-VALID-OUT-LIS-LONG) | Khi tắt: không ACK/exchange. Sau khi bật: tự ACK, exchange DELIVERED, đúng 1 event, 1 exchange, 1 hàng EMR, giá trị 0.9 mg/dL |
| F10-R | Dừng container EMR ~60 s rồi bật (MUT-VALID-OUT-EMR-LONG) | Khi tắt: exchange chưa DELIVERED, 0 hàng EMR. Sau khi bật: tự DELIVERED, đúng 1 hàng EMR, 0.9 mg/dL |
Sau thử nghiệm: xóa MUT-*, mọi container Up, số liệu seed và 1.000 gốc không đổi (mut=0, seed=1000, events/exch/emr bằng giá trị trước thử nghiệm).
