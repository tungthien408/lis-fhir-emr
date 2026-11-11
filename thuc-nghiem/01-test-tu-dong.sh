#!/usr/bin/env bash
# BƯỚC 01 – CHẠY BỘ TEST TỰ ĐỘNG CỦA REPO (khoảng 10–20 phút).
# Bộ test tự tạo 1 PostgreSQL tạm riêng trong Docker và tự dọn sau khi xong → không ảnh hưởng gì.
# Dùng làm minh chứng cho 2 kịch bản khó tạo bằng tay:
#   TC06: EMR đã lưu nhưng phản hồi bị mất → gửi lại không sinh bản ghi mới
#   TC07: đọc lại thấy dữ liệu khác → không báo hoàn tất (FAILED / VERIFY_MISMATCH)
source "$(dirname "$0")/lib.sh"
require_step "00-kiem-tra-truoc"
step_begin "01-test-tu-dong" "AUTO"
D="$OUT/01-test-tu-dong"; rm -rf "$D"; mkdir -p "$D"
S=AUTO

log "Chạy toàn bộ test tự động (npm run test:repositories:postgres)…"
rc=0; (cd "$BACKEND" && npm run test:repositories:postgres) > "$D/log-day-du.txt" 2>&1 || rc=$?
sum_of() { grep -E "^(# |ℹ )$1 [0-9]+" "$D/log-day-du.txt" | awk '{s+=$3} END{print s+0}'; }
tests=$(sum_of tests); pass=$(sum_of pass); failn=$(sum_of fail); skipped=$(sum_of skipped)
printf 'Tổng số test: %s\nĐạt: %s\nKhông đạt: %s\nBỏ qua: %s\nMã thoát: %s\n' "$tests" "$pass" "$failn" "$skipped" "$rc" > "$D/tom-tat.txt"
check $S "AUTO-TONG" "Bộ test tự động: số test không đạt" "0" "$failn"
check $S "AUTO-SO-TEST" "Bộ test tự động: có chạy test (tổng số > 0)" "có" "$([ "$tests" -gt 0 ] && echo có || echo không)"

# Các test làm minh chứng cho TC06, TC07 (và các ca liên quan)
# Node dùng reporter "spec": dòng test đạt bắt đầu bằng ✔, không đạt bằng ✖ → đổi về dạng "ok - …"/"not ok - …" để các lệnh đếm bên dưới dùng lại.
pick() { grep -E "^[[:space:]]*(✔|✖) .*($1)" "$D/log-day-du.txt" | sed -E 's/^[[:space:]]*✔ /ok - /; s/^[[:space:]]*✖ /not ok - /' | sort -u; }
{
  echo "### TC06 – EMR đã lưu nhưng phản hồi bị mất / gửi lại an toàn"
  pick 'POST timeout AFTER storage|ALREADY_EXISTS|D3-05|C4-02'
  echo; echo "### TC07 – đọc lại thấy dữ liệu khác → không báo hoàn tất"
  pick 'mismatch is FAILED|C4-08|D3-10'
  echo; echo "### Liên quan TC04/TC05 (gửi lặp, middleware gián đoạn, tranh chấp, khởi động lại)"
  pick 'D3-02|D3-03|D3-04|D3-07|D3-08'
} > "$D/test-minh-chung-TC06-TC07.txt"
for tc in TC06 TC07; do
  block=$(awk -v h="### $tc" '$0 ~ "^### "{p=($0 ~ h)} p' "$D/test-minh-chung-TC06-TC07.txt" | grep -E '^(not )?ok' || true)
  n_ok=$(grep -c '^ok' <<<"$block" || true); n_bad=$(grep -c '^not ok' <<<"$block" || true)
  verdict=KHONG_DAT; [ "${n_ok:-0}" -gt 0 ] && [ "${n_bad:-0}" = 0 ] && verdict=DAT
  check $S "AUTO-$tc" "$tc được chứng minh bằng test tự động (số test liên quan đạt / không đạt)" "≥1 đạt, 0 không đạt" "${n_ok:-0} đạt, ${n_bad:-0} không đạt" "$verdict"
done
step_end
