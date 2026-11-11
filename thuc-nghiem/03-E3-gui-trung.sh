#!/usr/bin/env bash
# E3 – GỬI TRÙNG (TC04). Chạy NGAY sau bước 02, trên cùng môi trường (không dựng lại).
# Kiểm tra: gửi lại cùng một kết quả nhiều lần, ở cả 3 chặng, không sinh thêm bản ghi;
#           cùng mã nhưng khác nội dung thì bị báo xung đột, không ghi đè.
source "$(dirname "$0")/lib.sh"
require_step "02-E1-1000-ket-qua"
step_begin "03-E3-gui-trung" "E3"
D="$OUT/E3-gui-trung"; rm -rf "$D"; mkdir -p "$D"
S=E3

# Chọn 3 kết quả đã DELIVERED (ưu tiên kết quả trong tập 40 lõi)
mapfile -t IDS < <(sql1 "SELECT t.source_result_id FROM integration.exchange_transactions t JOIN lis.results r ON r.result_id=t.source_result_id
                        WHERE t.status='DELIVERED' ORDER BY (r.provenance->>'in_functional_40')='true' DESC, t.source_result_id LIMIT 3")
[ "${#IDS[@]}" -eq 3 ] || { log "Không đủ 3 kết quả DELIVERED để thử"; exit 1; }
printf '%s\n' "${IDS[@]}" > "$D/ket-qua-duoc-chon.txt"

dem() { sql1 "SELECT (SELECT count(*) FROM lis.publish_events)||' '||(SELECT count(*) FROM integration.exchange_transactions)||' '||
              (SELECT count(*) FROM emr.lab_results)||' '||
              (SELECT count(*) FROM (SELECT 1 FROM emr.lab_results GROUP BY external_system, external_id HAVING count(*)>1) x)"; }
TRUOC="$(dem)"; echo "su_kien_lis giao_dich_mw ban_ghi_emr ma_bi_trung" > "$D/dem-truoc.txt"; echo "$TRUOC" >> "$D/dem-truoc.txt"
log "Số lượng trước khi thử: $TRUOC (sự kiện LIS / giao dịch middleware / bản ghi EMR / mã bị trùng)"

# ---- Chặng 1: bấm Publish lại ở LIS ----
for id in "${IDS[@]}"; do
  ev_truoc=$(sql1 "SELECT event_id FROM lis.publish_events WHERE result_id='$id'")
  resp=$(curl -s -w '\n%{http_code}' -X POST "$LIS_BASE_URL/api/results/$id/publish")
  code=$(tail -n1 <<<"$resp"); body=$(head -n -1 <<<"$resp")
  printf '== %s\n%s\nHTTP %s\n' "$id" "$body" "$code" >> "$D/1-publish-lai-o-LIS.txt"
  check $S "E3-LIS-$id" "Publish lại $id: LIS trả 200 (đã có), không tạo sự kiện mới" "200" "$code"
  check $S "E3-LIS-EV-$id" "Publish lại $id: vẫn giữ đúng mã sự kiện cũ" "$ev_truoc" "$(jq -r '.event_id // empty' <<<"$body")"
done

# ---- Chặng 2: LIS gửi lại y nguyên gói tin sang middleware ----
ID0="${IDS[0]}"
envelope_sql="SELECT json_build_object('event_id',event_id,'source_system',source_system,'source_result_id',result_id,
  'source_snapshot',source_snapshot,'source_hash',source_hash,
  'published_at',to_char(published_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'))
  FROM lis.publish_events WHERE result_id='$ID0'"
sql1 "$envelope_sql" > "$D/goi-tin-goc-$ID0.json"
ex_goc=$(sql1 "SELECT exchange_id FROM integration.exchange_transactions WHERE source_result_id='$ID0'")
mw_post() { curl -s -w '\nHTTP %{http_code}\n' -X POST "$MIDDLEWARE_BASE_URL/api/exchanges" -H 'Content-Type: application/json' --data-binary @-; }

r=$(mw_post < "$D/goi-tin-goc-$ID0.json"); printf '%s\n' "$r" > "$D/2a-mw-gui-lai-giong-het.txt"
check $S "E3-MW-1" "Gửi lại y nguyên gói tin sang middleware: được nhận (202)" "HTTP 202" "$(tail -n1 <<<"$r")"
check $S "E3-MW-2" "…và trả lại ĐÚNG mã giao dịch cũ (không tạo giao dịch mới)" "$ex_goc" "$(head -n -1 <<<"$r" | jq -r '.exchange_id // empty')"

# cùng mã sự kiện nhưng nội dung bị sửa (giá trị khác) → phải bị từ chối, không ghi đè
jq '.source_snapshot.value_num = 999' "$D/goi-tin-goc-$ID0.json" > "$D/goi-tin-sua-noi-dung.json"
r=$(mw_post < "$D/goi-tin-sua-noi-dung.json"); printf '%s\n' "$r" > "$D/2b-mw-cung-ma-khac-noi-dung.txt"
code=$(tail -n1 <<<"$r" | awk '{print $2}')
check $S "E3-MW-3" "Cùng mã sự kiện nhưng nội dung khác: middleware từ chối (4xx)" "4xx" "${code:0:1}xx"

# ---- Chặng 3: middleware gửi lại y nguyên Observation sang EMR ----
sql1 "SELECT fhir_payload FROM integration.exchange_transactions WHERE source_result_id='$ID0'" > "$D/observation-goc-$ID0.json"
tg_goc=$(sql1 "SELECT target_id FROM emr.lab_results WHERE external_id='$ID0'")
gt_goc=$(sql1 "SELECT quantity FROM emr.lab_results WHERE external_id='$ID0'")
r=$(emr_post < "$D/observation-goc-$ID0.json"); printf '%s\n' "$r" > "$D/3a-emr-gui-lai-giong-het.txt"
check $S "E3-EMR-1" "Gửi lại y nguyên Observation vào EMR: trả 200 (đã có)" "HTTP 200" "$(tail -n1 <<<"$r")"
check $S "E3-EMR-2" "…và trả lại ĐÚNG mã bản ghi cũ" "$tg_goc" "$(head -n -1 <<<"$r" | jq -r '.target_id // empty')"

jq '.valueQuantity.value = 999' "$D/observation-goc-$ID0.json" | emr_post > "$D/3b-emr-cung-ma-khac-noi-dung.txt"
check $S "E3-EMR-3" "Cùng mã kết quả nhưng giá trị khác: EMR báo xung đột (409)" "HTTP 409" "$(tail -n1 "$D/3b-emr-cung-ma-khac-noi-dung.txt")"
check $S "E3-EMR-4" "…giá trị đã lưu KHÔNG bị ghi đè" "$gt_goc" "$(sql1 "SELECT quantity FROM emr.lab_results WHERE external_id='$ID0'")"

# ---- Đếm lại toàn hệ thống ----
sleep 5
SAU="$(dem)"; echo "su_kien_lis giao_dich_mw ban_ghi_emr ma_bi_trung" > "$D/dem-sau.txt"; echo "$SAU" >> "$D/dem-sau.txt"
check $S "E3-DEM-1" "Tổng số sự kiện / giao dịch / bản ghi EMR không đổi sau mọi lần gửi trùng" "$(cut -d' ' -f1-3 <<<"$TRUOC")" "$(cut -d' ' -f1-3 <<<"$SAU")"
check $S "E3-DEM-2" "Không có mã kết quả nào bị lưu 2 lần ở EMR" "0" "$(cut -d' ' -f4 <<<"$SAU")"

step_end
