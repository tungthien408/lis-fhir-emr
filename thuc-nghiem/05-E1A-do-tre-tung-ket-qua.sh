#!/usr/bin/env bash
# E1A – ĐỘ TRỄ KHI GỬI TỪNG KẾT QUẢ MỘT (TC01, phần thời gian M9, M10).
# Ở bước 02, 1.000 kết quả được dồn vào cùng lúc nên thời gian chủ yếu là "xếp hàng chờ".
# Bước này gửi lần lượt 40 kết quả lõi, mỗi kết quả chờ xong hẳn mới gửi cái tiếp theo,
# để đo thời gian xử lý thật của MỘT kết quả khi hệ thống rảnh.
# Dựng môi trường sạch mới. Bước 06 (E4) chạy tiếp trên môi trường này.
source "$(dirname "$0")/lib.sh"
require_step "00-kiem-tra-truoc"
step_begin "05-E1A-do-tre-tung-ket-qua" "E1A"
D="$OUT/E1A-do-tre-tung-ket-qua"; rm -rf "$D"; mkdir -p "$D"
S=E1A

exp_reset
mapfile -t IDS < <(sql1 "SELECT result_id FROM lis.results WHERE provenance->>'in_functional_40'='true' ORDER BY result_id")
printf '%s\n' "${IDS[@]}" > "$D/danh-sach-40.txt"
echo "ma_ket_qua,http_publish,trang_thai_cuoi" > "$D/ket-qua-tung-lan.csv"
for id in "${IDS[@]}"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$LIS_BASE_URL/api/results/$id/publish")
  st=""
  for _ in $(seq 1 300); do   # tối đa 60 giây
    st=$(sql1 "SELECT coalesce((SELECT status FROM integration.exchange_transactions WHERE source_result_id='$id'),'')")
    case "$st" in DELIVERED|REJECTED|FAILED) break;; esac
    sleep 0.2
  done
  echo "$id,$code,${st:-CHUA_XONG}" >> "$D/ket-qua-tung-lan.csv"
  sleep 1   # nghỉ 1 giây để các kết quả không chồng lên nhau
done
list=$(printf "'%s'," "${IDS[@]}"); list=${list%,}
stage_csv "t.source_result_id IN ($list)" > "$D/thoi-gian-tung-chang.csv"
check $S "E1A-HOANTAT" "Gửi lần lượt 40 kết quả lõi: số kết quả hoàn tất" "40" "$(grep -c ',DELIVERED$' "$D/ket-qua-tung-lan.csv" || true)"
check $S "E1A-1LAN" "Tất cả đều xong ngay lần gửi đầu, không phải thử lại" "40" \
  "$(sql1 "SELECT count(*) FROM integration.exchange_transactions WHERE source_result_id IN ($list) AND send_attempt_count=1")"
step_end
