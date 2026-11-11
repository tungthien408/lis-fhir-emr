# Tiến độ thực nghiệm – 2026-11-11
| Giờ | Bước | Trạng thái | Ghi chú ngắn |
|---|---|---|---|
| 23:46 | 00 | xong | Phát hiện đã có `trang-thai/00-kiem-tra-truoc.xong` khi bắt đầu; kiểm tra trước đạt (1/1), stack demo đã tạm dừng. Không chạy lại. |
| 23:50 | — | bắt đầu | Tạo TIEN_DO.md. Bước kế tiếp: 02 (E1). |
| 00:09 | 02 | xong | E1: 1000/1000 DELIVERED, đối chiếu PASS; kiểm tra tích lũy 14 đạt / 0 không đạt |
| 00:10 | 03 | xong | E3: 15 phép kiểm tra đều đạt (tích lũy 29 đạt / 0 không đạt) |
| 00:11 | 04 | xong | E2: 5 phép kiểm tra KHÔNG ĐẠT (TC03-MW-1, TC03-MW-2, TC03-EMR-7, E2-TONG-1, E2-TONG-2: mã xét nghiệm lạ và đơn vị lạ lọt qua middleware/EMR). Đây là kết quả, không sửa. Tích lũy 43 đạt / 5 không đạt |
| 00:12 | 05 | xong | E1A: 40/40 hoàn tất, đều xong ở lần gửi đầu. Tích lũy 45 đạt / 5 không đạt |
| 00:15 | 06 | xong | E4a–E4d: 12 phép kiểm tra đều đạt. Tích lũy 57 đạt / 5 không đạt |
| 00:15 | 01 + 07 | lỗi lần 1 | Khởi động cùng giây nên tranh file tạm; 07 bị `.loi`; 01 lỗi do định dạng log test (xem dưới) |
| 00:18 | 01 | xong (chạy lại) | 514/514 test đạt, 0 không đạt; TC06: 6 test đạt; TC07: 23 test đạt |
| 00:17 | 07 | xong (chạy lại) | 1000/1000 file được validator đọc; 0/1000 đạt (mỗi file 3 lỗi `Example URLs are not allowed` do dùng example.org). FHIR-M8 KHÔNG ĐẠT — là kết quả, không sửa |
| 00:19 | 08 | xong | 67 phép kiểm tra: 61 đạt / 6 không đạt. Không có biểu đồ (thiếu matplotlib, cần sudo → bỏ qua theo mục 5) |
| 00:20 | báo cáo | xong | `BAO_CAO_KET_QUA_THUC_NGHIEM.md`; đã đối chiếu số với TONG_HOP_SO_LIEU.md |
| 00:21 | 09 | xong | SHA-256 cho 1112 file; môi trường lisexp đã xóa; stack demo đã bật lại; commit nhánh `thuc-nghiem/so-lieu-2026-11-11` (chưa push) |

## Lựa chọn/sửa đổi đã làm
- 00:15: khởi động 01 và 07 trong cùng một giây làm 2 script tranh nhau file tạm `kiem-tra.jsonl.tmp` trong `step_begin` (lib.sh dòng 142) → 07 báo `.loi`. Không sửa script; kiểm tra `kiem-tra.jsonl` vẫn nguyên (62 dòng = 57 đạt + 5 không đạt). Chạy lại 07 khi 01 đã qua `step_begin` (lần chạy lại 1/2).
- Bước 00 đã có kết quả `.xong` từ trước khi tạo TIEN_DO.md nên không chạy lại (theo mục 4 "chạy tiếp khi bị ngắt").

- 00:16 (07, lỗi vận hành): validator bản hiện tại không in dòng `Success/FAILURE` từng file nên phép đếm bằng `grep` ra 0 và `grep` thất bại làm script dừng. Sửa `07-kiem-tra-fhir.sh`: đếm từ `ket-qua-validator.json` (mỗi file = 1 OperationOutcome; có lỗi nếu có issue severity error/fatal) và liệt kê loại lỗi/cảnh báo từ JSON. Không đổi ngưỡng hay cách tính đạt/không đạt. Đây là lần chạy lại thứ 2 của 07.
- 00:17 (01, lỗi vận hành): Node dùng reporter `spec` (dòng `ℹ tests N`, `✔`/`✖`) thay vì TAP (`# tests N`, `ok`/`not ok`) nên `grep` ra rỗng và script dừng. Sửa `01-test-tu-dong.sh`: `sum_of` nhận cả `ℹ`, `pick` nhận `✔/✖` rồi đổi về `ok/not ok`. Test vẫn chạy y nguyên (lần 1: 514/514 đạt; chạy lại lần 2 cho kết quả như nhau).
- Khi chạy lại 07 lần đầu mình đã khởi động 01 và 07 cùng một giây (theo hướng dẫn "chạy nền cùng lúc") nên tranh file `kiem-tra.jsonl.tmp`; đã chạy lại tuần tự.

- Báo cáo: p95/trung vị lấy theo cách nearest-rank của 08 (hơi khác `statistics.median`, lệch dưới 1 giây trên 525 giây); báo cáo dùng đúng số của TONG_HOP_SO_LIEU.md.
- Không có bieu-do/ nên báo cáo không chèn hình; mục 4.1/4.2/4.5 ghi rõ "không có biểu đồ".
- Không sửa code sản phẩm. 6 phép kiểm tra KHÔNG ĐẠT (5 ở E2: mã/đơn vị lạ lọt qua, 1 ở FHIR-M8: lỗi example.org) được giữ nguyên làm kết quả.
- 00:24: sau bước 09, `lis-dispatcher` và `middleware-worker` của stack demo vẫn ở trạng thái Exited (SIGTERM lúc tạm dừng) dù 09 đã `start`; đã chạy `docker compose up -d` rồi `docker compose start lis-dispatcher middleware-worker` → cả 6 container demo đang chạy. `up -d` đã tạo lại container `emr` và `middleware` (không xóa volume).

## Việc cần người dùng làm khi quay lại
- Push nhánh `thuc-nghiem/so-lieu-2026-11-11` cho bạn cùng nhóm: `git push -u origin thuc-nghiem/so-lieu-2026-11-11` (mình chưa push).
- (Tùy chọn) cài `python-matplotlib` rồi chạy lại `python3 thuc-nghiem/08-tong-hop.py` để có biểu đồ; sau đó chạy lại bước 09 để cập nhật mã SHA-256.
- Báo cáo mục 6: 2 nhóm không đạt (kiểm tra danh mục mã/đơn vị; địa chỉ `example.org` trong FHIR) – nhóm nên quyết định ghi vào chương 3 như hạn chế hay sửa code.
- Kiểm tra stack demo: `docker ps` (đã bật lại tự động).
