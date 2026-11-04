# SPP-75 – Sẵn sàng thực thi (trạng thái: BLOCKED ở Phase 1)

Ngày: 04/11/2026. Tài liệu này chỉ ghi những gì đã làm và kiểm tra; **chưa có lượt chính thức nào được chạy**.

## 1. Đã hoàn thành (VERIFIED)
| Hạng mục | Kết quả |
|---|---|
| Tag `spp74-experiment-v1` | trỏ đúng `64e6265c72eb92fb2868c7d3fe6d3f44db05c468`, giữ nguyên |
| Sửa `run-scenario.sh` | kiểm mã thoát từng bước (before 20 / publish 21 / after 22 / verify 23), kiểm nội dung `comparison-report.json` + `metrics.json` + `run-manifest.json` (mã 24), từ chối ghi đè (mã 3), ghi `run-result.txt`, giữ log lỗi |
| Sửa `run-all.sh` | dừng chuỗi (mã 10) khi một lượt không PASS; chỉ ghi `ALL DONE` khi mọi lượt PASS; mã 11 nếu không lượt nào chạy |
| Test đường lỗi | `bash scripts/pilot/test/test-runner.sh` → 36 PASS / 0 FAIL (npm/docker/ps giả, không chạm DB) |
| Phiên bản runner | commit `cc6036c86ed32a21fbce4b069e84032653a2a24c`, tag cục bộ `spp75-runner-v1` (chưa push) |
| Application/dữ liệu không đổi | `source_tree_sha256` = `49e9ebcb…14e2e` (khớp bản khóa); `git diff spp74-experiment-v1..HEAD` trên backend/src, backend/scripts, database, package*.json rỗng |
| `preflight.sh` | mặc định kiểm tag runner `spp75-runner-v1` và thêm kiểm "application không đổi so với `spp74-experiment-v1`" |

SHA-256 script runner: run-scenario.sh `986b8dff…aae43`; run-all.sh `b29eb26f…3a92`; preflight.sh `d308822a…018a`; test-runner.sh `e9575816…6786`.

## 2. Chặn (BLOCKED)
1. **SPP-74 chưa có xác nhận của người phụ trách** cho phép dùng phiên bản khóa (checklist `spp-74/07-review-checklist.md` mục C để trống; SPP-74 còn Review; B1 SINGLE_COPY_RISK chưa xử lý). → Không chạy chính thức.
2. **Preflight (chỉ đọc, `PILOT_EXPECT_CLEAN_DB=0`) FAIL**: `dispatcher=0 worker=0` – hiện không có tiến trình Dispatcher/Worker đúng dạng (chỉ thấy `dist/lis/main.js`); các kiểm tra tag, hash, ready, guard UUID đều PASS. Retry của tiến trình chưa kiểm được.
3. **F8-R/F10-R (retry 7 phần tử)**: NOT_RUN. Cần dừng/khởi động Middleware/EMR; chưa có xác nhận thao tác trong phiên này.
4. Chưa kiểm baseline sạch sau reset (không reset khi chưa được phép).

## 3. Cần người phụ trách quyết định
- Xác nhận cho phép dùng `spp74-experiment-v1` + runner `spp75-runner-v1`, và xác nhận DB `dacn_db` trong `lis-fhir-emr-db-1` là DB cô lập được phép reset.
- Khởi động lại đúng 1 Dispatcher + 1 Worker với retry khóa, rồi cho phép chạy F8-R/F10-R và 6 lượt.
- Quyết định nơi lưu bản sao bằng chứng (tránh SINGLE_COPY_RISK).

Các tài liệu 02–10 chưa tạo vì chưa có dữ liệu chính thức; không tạo số liệu thay thế.
