# Thực nghiệm Chương 3 – đọc file này trước (dành cho Thiện)

Thư mục này chứa toàn bộ script để Claude Code **tự chạy** thực nghiệm khi bạn treo máy, và hướng dẫn cho nó
(`HUONG_DAN_CHO_CLAUDE_CODE.md`). Bạn chỉ cần làm phần "Chuẩn bị" dưới đây (~10 phút), rồi giao việc.

## Kết quả bạn sẽ nhận được

Trong `thuc-nghiem/ket-qua/<ngày>/`:
- `BAO_CAO_KET_QUA_THUC_NGHIEM.md` – báo cáo dễ đọc, bố cục bám Chương 3, để bạn cùng nhóm viết tiếp.
- `TONG_HOP_SO_LIEU.md` + `bieu-do/` – bảng số liệu M1–M13 và biểu đồ, sinh tự động từ dữ liệu thô.
- `TIEN_DO.md` – Claude Code ghi lại đã làm gì, gặp gì.
- Các thư mục `E1-…`, `E1A-…`, `E2-…`, `E3-…`, `E4-…`, `kiem-tra-fhir/`, `01-test-tu-dong/` – minh chứng thô.
- `MINH_CHUNG_SHA256.txt` – "dấu vân tay" từng file, chứng minh số liệu không bị sửa sau khi chạy.
Tất cả được commit vào nhánh `thuc-nghiem/so-lieu-<ngày>` trên máy bạn (chưa push).

## Chuẩn bị (làm tay, trước khi treo máy)

1. **Đặt thư mục này vào repo** (giải nén ở thư mục gốc `lis-fhir-emr/`, cùng cấp với `backend/`).
2. **Cài công cụ** (cần mật khẩu sudo nên phải tự làm):
   ```bash
   sudo pacman -S --needed jq jre-openjdk python-matplotlib
   ```
3. **Kiểm tra `.env`** ở thư mục gốc: 4 mật khẩu đã đặt và **chỉ gồm chữ + số**.
4. **Cho phép Claude Code chạy mà không hỏi** (chỉ trong phạm vi an toàn đã liệt kê):
   ```bash
   mkdir -p .claude && cp thuc-nghiem/claude-settings.local.json .claude/settings.local.json
   ```
   File này: cho chạy các script trong `thuc-nghiem/`, cho sửa file trong `thuc-nghiem/`;
   cấm `git push`, `sudo`, xóa volume, đụng stack demo, sửa `backend/`, `database/`, `frontend/`, đọc `.env`.
   Nếu bạn đã có `.claude/settings.local.json` thì gộp tay hai phần `allow`/`deny`.
5. **Chạy thử bước kiểm tra** (30 giây, giúp phát hiện thiếu gì trước khi đi):
   ```bash
   bash thuc-nghiem/00-kiem-tra-truoc.sh
   ```
   Thấy `XONG: 00-kiem-tra-truoc` là được. (Bước này tạm dừng stack demo – dữ liệu demo vẫn giữ nguyên.)
6. **Cắm sạc, không để máy ngủ**, rồi mở Claude Code với Sonnet:
   ```bash
   systemd-inhibit --what=sleep:idle:handle-lid-switch --why="Chay thuc nghiem" claude --model sonnet
   ```
7. **Dán câu giao việc** này rồi đi:
   ```
   Đọc thuc-nghiem/HUONG_DAN_CHO_CLAUDE_CODE.md và làm theo từ đầu đến cuối.
   Tôi vắng mặt đến khi xong, đừng hỏi lại; gặp sự cố thì xử lý theo mục 5 của hướng dẫn.
   Bắt đầu bằng việc tạo TIEN_DO.md.
   ```

Thời gian dự kiến: khoảng 1,5–2 giờ.

## Vì sao chọn Sonnet

Phần lớn việc là chạy script đã viết sẵn, đọc file tóm tắt ngắn và viết báo cáo tiếng Việt – Sonnet (Sonnet 5.5) làm tốt
mà tốn ít token hơn Opus nhiều. Không chọn Haiku vì phần chẩn đoán khi có lỗi và phần viết báo cáo cần chất lượng tốt hơn.
Mức suy nghĩ (effort) để mặc định là `medium`. Nếu bạn quay lại thấy nó **kẹt ở một lỗi khó**, gõ `/model opus` để xử lý lỗi đó,
xong thì `/model sonnet` lại.

## Khi quay lại

1. Mở `thuc-nghiem/ket-qua/<ngày>/TIEN_DO.md` xem có gì cần bạn làm.
2. Đọc `BAO_CAO_KET_QUA_THUC_NGHIEM.md`.
3. Gửi cho bạn cùng nhóm: `git push -u origin thuc-nghiem/so-lieu-<ngày>`.
4. Stack demo đã được bật lại ở bước 09; nếu chưa: `docker compose up -d`.

## Chạy tay một bước (nếu cần)

Mọi script chạy từ thư mục gốc repo, chạy lại an toàn:
`bash thuc-nghiem/<số>-<tên>.sh` – nhật ký ở `ket-qua/<ngày>/nhat-ky-chay.log`, trạng thái ở `ket-qua/<ngày>/trang-thai/`.
Muốn chạy một đợt mới hoàn toàn: `RUN_TAG=2026-11-13 bash thuc-nghiem/00-kiem-tra-truoc.sh` (và đặt cùng `RUN_TAG` cho các bước sau),
hoặc xóa file `thuc-nghiem/ket-qua/.run-tag`.
