#!/usr/bin/env bash
# E1 – LUỒNG HỢP LỆ VỚI 1.000 KẾT QUẢ (TC01).
#  1) Chạy thử 20 kết quả trên môi trường sạch để chắc mọi thứ hoạt động.
#  2) Dựng lại môi trường sạch, chụp DB "trước", gửi đủ 1.000 kết quả, chờ xử lý xong, chụp DB "sau".
#  3) Đối chiếu độc lập với bộ đáp án có sẵn (spp65-v2) → đúng bệnh nhân? đúng từng trường? có trùng không?
#  4) Tách thời gian từng chặng, xuất 1.000 bản FHIR (cho bước kiểm tra cấu trúc), sao lưu DB làm minh chứng.
# Thời gian: khoảng 25–40 phút (hệ thống xử lý khoảng 1 kết quả/giây khi bị dồn việc).
source "$(dirname "$0")/lib.sh"
require_step "00-kiem-tra-truoc"
step_begin "02-E1-1000-ket-qua" "E1"
D="$OUT/E1-1000-ket-qua"; rm -rf "$D"; mkdir -p "$D"
S=E1
RUN_ENV=(SPP82_MEASURE=1 SPP82_RUN_TIMEOUT_MS=3600000 SPP82_OBSERVER_CONCURRENCY=10 SPP82_POLL_MS=1000)

# ---------- 1) Chạy thử 20 kết quả ----------
exp_reset
log "Chạy thử 20 kết quả…"
mkdir -p "$D/chay-thu-20"
( export "${RUN_ENV[@]}" SPP82_SCENARIO=E1-chay-thu SPP82_ARTIFACT_DIR="$D/chay-thu-20/do-luong"
  spp82_publish --confirm-publish --limit 20 --output "$D/chay-thu-20/publish.jsonl" ) \
  > "$D/chay-thu-20/stdout.log" 2> "$D/chay-thu-20/stderr.log" || true
wait_settled 120 || true
done20=$(jq -r '.completion_count // 0' "$D/chay-thu-20/do-luong/metrics.json" 2>/dev/null || echo 0)
check $S "E1-THU" "Chạy thử: 20/20 kết quả đi trọn luồng" "20" "$done20"
if [ "$done20" != "20" ]; then log "Chạy thử chưa đạt → DỪNG để xem lỗi (xem $D/chay-thu-20/stderr.log)"; false; fi

# ---------- 2) Chạy chính 1.000 kết quả ----------
exp_reset
sql1 "SELECT result_id FROM lis.results WHERE provenance->>'in_functional_40'='true' ORDER BY result_id" > "$OUT/danh-sach-40-ket-qua-loi.txt"
log "Chụp DB TRƯỚC khi chạy…"
spp82_capture --phase before --output "$D/db-truoc.json" > "$D/capture-truoc.log" 2>&1
check $S "E1-TRUOC" "Trước khi chạy: EMR chưa có kết quả nào" "0" "$(sql1 'SELECT count(*) FROM emr.lab_results')"

log "Gửi 1.000 kết quả (khoảng 20–30 phút)…"
now_iso > "$D/bat-dau.txt"
( export "${RUN_ENV[@]}" SPP82_SCENARIO=E1-1000 SPP82_ARTIFACT_DIR="$D/do-luong"
  spp82_publish --confirm-publish --mode SEQUENTIAL --output "$D/publish.jsonl" ) \
  > "$D/stdout.log" 2> "$D/stderr.log" || log "Công cụ đo kết thúc với mã lỗi (vẫn tiếp tục thu dữ liệu)"
wait_settled 900 || true
now_iso > "$D/ket-thuc.txt"

log "Chụp DB SAU khi chạy và đối chiếu độc lập…"
spp82_capture --phase after --run-dir "$D/do-luong" --output "$D/db-sau.json" > "$D/capture-sau.log" 2>&1 || true
spp82_verify --run-dir "$D/do-luong" --before "$D/db-truoc.json" --after "$D/db-sau.json" --output "$D/doi-chieu" \
  > "$D/doi-chieu.log" 2>&1 || true
cat "$D/doi-chieu.log" >&2

# ---------- 3) Ghi các phép kiểm tra chính ----------
M="$D/do-luong/metrics.json"; R="$D/doi-chieu/comparison-report.json"
check $S "E1-M1-CONGCU"  "Số kết quả công cụ đo thấy đi trọn luồng (LIS→EMR, đọc lại đúng)" "1000" "$(jq -r '.completion_count' "$M")"
check $S "E1-DELIVERED"  "Số giao dịch middleware ở trạng thái hoàn tất (DELIVERED)" "1000" "$(sql1 "SELECT count(*) FROM integration.exchange_transactions WHERE status='DELIVERED'")"
check $S "E1-DOICHIEU"   "Kết luận của bộ đối chiếu độc lập" "PASS" "$(jq -r '.outcome' "$R")"
check $S "E1-KHOP"       "Số kết quả khớp hoàn toàn với đáp án" "1000" "$(jq -r '.matched_result_count' "$R")"
check $S "E1-M4"         "Số kết quả gắn sai bệnh nhân" "0" "$(jq -r '.wrong_patient_linkage_count' "$R")"
check $S "E1-M5"         "Số kết quả bị lưu trùng" "0" "$(jq -r '.duplicate_result_count' "$R")"
check $S "E1-SAI-TRUONG" "Số kết quả có ít nhất 1 trường sai" "0" "$(jq -r '.field_mismatch_result_count' "$R")"
check $S "E1-THIEU"      "Số kết quả không tìm thấy ở EMR" "0" "$(jq -r '.missing_result_count' "$R")"
# M6: DELIVERED nhưng đối chiếu độc lập không xác nhận đúng
jq -r 'select(.outcome!="PASS") | .result_id' "$D/doi-chieu/per-result-verification.jsonl" 2>/dev/null | sort -u > "$D/ket-qua-khong-dat-doi-chieu.txt" || true
m6=0
if [ -s "$D/ket-qua-khong-dat-doi-chieu.txt" ]; then
  list=$(sed "s/.*/'&'/" "$D/ket-qua-khong-dat-doi-chieu.txt" | paste -sd,)
  m6=$(sql1 "SELECT count(*) FROM integration.exchange_transactions WHERE status='DELIVERED' AND source_result_id IN ($list)")
fi
check $S "E1-M6" "Số giao dịch báo hoàn tất nhưng đối chiếu độc lập thấy sai" "0" "$m6"

# Bảng đúng/sai theo từng trường (MR01–MR09) – dùng cho M2, M3
jq -r '.per_field | to_entries[] | select(.key|test("^MR")) | [.key, .value.PASS, .value.FAIL, .value.NOT_VERIFIED] | @csv' "$R" \
  | sed '1i "quy_tac:truong","dung","sai","chua_xac_minh"' > "$D/dung-sai-theo-truong.csv"
# Riêng 40 kết quả lõi
jq -c 'select(.result_id != null)' "$D/doi-chieu/per-result-verification.jsonl" \
  | grep -F -f <(sed 's/.*/"&"/' "$OUT/danh-sach-40-ket-qua-loi.txt") > "$D/doi-chieu-40-ket-qua-loi.jsonl" || true
check $S "E1-40-LOI" "Tập 40 kết quả lõi: số kết quả đạt đối chiếu" "40" "$(jq -s '[.[]|select(.outcome=="PASS")]|length' "$D/doi-chieu-40-ket-qua-loi.jsonl")"

# ---------- 4) Thời gian từng chặng, FHIR, sao lưu ----------
stage_csv "true" > "$D/thoi-gian-tung-chang.csv"
mkdir -p "$OUT/fhir-1000"
sql1 "SELECT source_result_id || E'\t' || fhir_payload::text FROM integration.exchange_transactions
      WHERE source_result_id LIKE 'MIMIC-LAB-%' AND fhir_payload IS NOT NULL" |
while IFS=$'\t' read -r id json; do printf '%s\n' "$json" > "$OUT/fhir-1000/$id.json"; done
check $S "E1-FHIR-XUAT" "Số bản FHIR Observation đã xuất để kiểm tra cấu trúc" "1000" "$(ls "$OUT/fhir-1000" | wc -l | tr -d ' ')"
pgdumpx | gzip > "$D/sao-luu-db-sau-E1.sql.gz"
log "Đã sao lưu DB sau E1 (để kiểm tra lại khi cần)."

step_end
