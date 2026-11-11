#!/usr/bin/env bash
# E4 – MỘT THÀNH PHẦN TẠM NGỪNG (TC05). Chạy ngay sau bước 05, trên cùng môi trường.
#  E4a: EMR tắt ~5 giây (ngắn hơn khoảng thời gian tự thử lại)  → kỳ vọng tự phục hồi, không mất, không trùng.
#  E4b: EMR tắt 60 giây (dài hơn số lần tự thử lại)              → kỳ vọng dừng ở FAILED, KHÔNG báo hoàn tất sai,
#                                                                 dữ liệu vẫn được giữ.
#  E4c: người vận hành đưa các ca FAILED của E4b chạy lại (script có sẵn ops:requeue-failed)
#                                                              → kỳ vọng hoàn tất, không sinh bản ghi trùng.
#  E4d: middleware tắt ~5 giây → LIS giữ việc, KHÔNG xác nhận (ACK) giả, tự gửi lại khi middleware chạy lại.
# Mỗi phần dùng 10 kết quả MIMIC chưa từng gửi.
source "$(dirname "$0")/lib.sh"
require_step "05-E1A-do-tre-tung-ket-qua"
step_begin "06-E4-gian-doan" "E4"
D="$OUT/E4-gian-doan"; rm -rf "$D"; mkdir -p "$D"
S=E4
N=10
ids_of() { awk '{print $1}' "$1" | sed "s/.*/'&'/" | paste -sd,; }
snapshot_csv() {  # $1 = danh sách mã, $2 = mốc bật lại (ISO)
  psqlx -c "COPY (SELECT t.source_result_id AS ma_ket_qua, t.status AS trang_thai_middleware, p.dispatch_status AS trang_thai_LIS,
      t.send_attempt_count AS so_lan_gui,
      to_char(t.completed_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS luc_hoan_tat,
      CASE WHEN t.status='DELIVERED' THEN round((extract(epoch FROM
        (SELECT min(occurred_at) FROM integration.exchange_events e WHERE e.exchange_id=t.exchange_id AND e.event_type='DELIVERED')
        - '$2'::timestamptz)*1000)::numeric) END AS phuc_hoi_ms,
      (SELECT count(*) FROM emr.lab_results l WHERE l.external_id=t.source_result_id) AS so_ban_ghi_emr
    FROM integration.exchange_transactions t JOIN lis.publish_events p ON p.event_id=t.event_id
    WHERE t.source_result_id IN ($1) ORDER BY 1) TO STDOUT WITH CSV HEADER"
}
lich_su() { psqlx -c "SELECT t.source_result_id, e.event_type, e.old_status, e.new_status, e.detail::text, e.occurred_at
                      FROM integration.exchange_events e JOIN integration.exchange_transactions t USING (exchange_id)
                      WHERE t.source_result_id IN ($1) ORDER BY 1, e.occurred_at"; }

########## E4a – EMR tắt ngắn ##########
log "E4a: tắt EMR, gửi $N kết quả, 5 giây sau bật lại"
svc_stop emr; now_iso > "$D/E4a-luc-tat-emr.txt"
publish_next $N > "$D/E4a-publish.txt"
sleep 5
now_iso > "$D/E4a-luc-bat-lai-emr.txt"; svc_start emr; wait_ready
wait_settled 180 || true
A=$(ids_of "$D/E4a-publish.txt")
snapshot_csv "$A" "$(cat "$D/E4a-luc-bat-lai-emr.txt")" > "$D/E4a-ket-qua.csv"; lich_su "$A" > "$D/E4a-lich-su-xu-ly.txt"
check $S "E4a-1" "EMR tắt ngắn: số kết quả tự hoàn tất sau khi EMR chạy lại" "$N" "$(grep -c ',DELIVERED,' "$D/E4a-ket-qua.csv" || true)"
check $S "E4a-2" "EMR tắt ngắn: có tự thử lại (số kết quả phải gửi > 1 lần)" "> 0" \
  "$(sql1 "SELECT count(*) FROM integration.exchange_transactions WHERE source_result_id IN ($A) AND send_attempt_count>1")" \
  "$([ "$(sql1 "SELECT count(*) FROM integration.exchange_transactions WHERE source_result_id IN ($A) AND send_attempt_count>1")" -gt 0 ] && echo DAT || echo KHONG_DAT)"
check $S "E4a-3" "EMR tắt ngắn: mỗi kết quả đúng 1 bản ghi ở EMR (không mất, không trùng)" "$N" \
  "$(sql1 "SELECT count(DISTINCT external_id) FROM emr.lab_results WHERE external_id IN ($A)")/$(sql1 "SELECT count(*) FROM emr.lab_results WHERE external_id IN ($A)")" \
  "$([ "$(sql1 "SELECT count(*) FROM emr.lab_results WHERE external_id IN ($A)")" = "$N" ] && [ "$(sql1 "SELECT count(DISTINCT external_id) FROM emr.lab_results WHERE external_id IN ($A)")" = "$N" ] && echo DAT || echo KHONG_DAT)"

########## E4b – EMR tắt lâu ##########
log "E4b: tắt EMR, gửi $N kết quả, 60 giây sau mới bật lại"
svc_stop emr; now_iso > "$D/E4b-luc-tat-emr.txt"
publish_next $N > "$D/E4b-publish.txt"
B=$(ids_of "$D/E4b-publish.txt")
sleep 30
lich_su "$B" > "$D/E4b-lich-su-khi-EMR-dang-tat.txt"
n_deliv_down=$(sql1 "SELECT count(*) FROM integration.exchange_transactions WHERE source_result_id IN ($B) AND status='DELIVERED'")
sleep 30
now_iso > "$D/E4b-luc-bat-lai-emr.txt"; svc_start emr; wait_ready
sleep 20
snapshot_csv "$B" "$(cat "$D/E4b-luc-bat-lai-emr.txt")" > "$D/E4b-ket-qua.csv"; lich_su "$B" > "$D/E4b-lich-su-xu-ly.txt"
check $S "E4b-1" "EMR tắt lâu: không ca nào bị báo hoàn tất khi EMR đang tắt" "0" "$n_deliv_down"
check $S "E4b-2" "EMR tắt lâu: hết số lần thử lại thì dừng ở FAILED (không thử mãi)" "$N" "$(grep -c ',FAILED,' "$D/E4b-ket-qua.csv" || true)"
check $S "E4b-3" "EMR tắt lâu: không có bản ghi nào lọt vào EMR" "0" "$(sql1 "SELECT count(*) FROM emr.lab_results WHERE external_id IN ($B)")"
check $S "E4b-4" "EMR tắt lâu: LIS vẫn ghi nhận middleware đã nhận (ACK), dữ liệu gốc còn nguyên ở middleware" "$N" \
  "$(sql1 "SELECT count(*) FROM integration.exchange_transactions t JOIN lis.publish_events p ON p.event_id=t.event_id
           WHERE t.source_result_id IN ($B) AND p.dispatch_status='ACK' AND t.source_payload IS NOT NULL")"

########## E4c – người vận hành đưa các ca FAILED chạy lại ##########
log "E4c: khởi động lại worker với chuỗi chờ dài hơn rồi đưa các ca FAILED chạy lại"
worker_restart_with_delays "2000,4000,8000,8000,8000,8000"
now_iso > "$D/E4c-luc-dua-lai.txt"
for id in $(awk '{print $1}' "$D/E4b-publish.txt"); do
  (cd "$BACKEND" && node --import tsx scripts/ops/requeue-failed.ts middleware "$id" --budget 7 --confirm) >> "$D/E4c-dua-lai.log" 2>&1 \
    || echo "$id: không đưa lại được" >> "$D/E4c-dua-lai.log"
done
wait_settled 180 || true
snapshot_csv "$B" "$(cat "$D/E4c-luc-dua-lai.txt")" > "$D/E4c-ket-qua.csv"; lich_su "$B" > "$D/E4c-lich-su-xu-ly.txt"
check $S "E4c-1" "Sau khi người vận hành đưa lại: số ca hoàn tất" "$N" "$(grep -c ',DELIVERED,' "$D/E4c-ket-qua.csv" || true)"
check $S "E4c-2" "Sau khi đưa lại: mỗi kết quả đúng 1 bản ghi ở EMR" "$N" \
  "$(sql1 "SELECT count(DISTINCT external_id) FROM emr.lab_results WHERE external_id IN ($B)")" \
  "$([ "$(sql1 "SELECT count(*) FROM emr.lab_results WHERE external_id IN ($B)")" = "$N" ] && [ "$(sql1 "SELECT count(DISTINCT external_id) FROM emr.lab_results WHERE external_id IN ($B)")" = "$N" ] && echo DAT || echo KHONG_DAT)"
worker_restart_with_delays ""   # trả worker về cấu hình mặc định
wait_ready

########## E4d – middleware tắt ngắn ##########
log "E4d: tắt middleware, gửi $N kết quả, 5 giây sau bật lại"
svc_stop middleware; now_iso > "$D/E4d-luc-tat-middleware.txt"
publish_next $N > "$D/E4d-publish.txt"
Dd=$(ids_of "$D/E4d-publish.txt")
sleep 3
n_ack_down=$(sql1 "SELECT count(*) FROM lis.publish_events WHERE result_id IN ($Dd) AND dispatch_status='ACK'")
psqlx -c "SELECT result_id, dispatch_status, dispatch_attempt_count, last_error_code FROM lis.publish_events
          WHERE result_id IN ($Dd) ORDER BY 1" > "$D/E4d-LIS-khi-middleware-dang-tat.txt"
sleep 2
now_iso > "$D/E4d-luc-bat-lai-middleware.txt"; svc_start middleware; wait_ready
wait_settled 180 || true
snapshot_csv "$Dd" "$(cat "$D/E4d-luc-bat-lai-middleware.txt")" > "$D/E4d-ket-qua.csv"
check $S "E4d-1" "Middleware tắt: LIS KHÔNG báo 'đã nhận' (ACK) giả trong lúc middleware tắt" "0" "$n_ack_down"
check $S "E4d-2" "Middleware chạy lại: số kết quả LIS tự gửi lại và hoàn tất" "$N" "$(grep -c ',DELIVERED,ACK,' "$D/E4d-ket-qua.csv" || true)"
check $S "E4d-3" "Middleware chạy lại: không sinh giao dịch trùng" "$N" \
  "$(sql1 "SELECT count(*) FROM integration.exchange_transactions WHERE source_result_id IN ($Dd)")"

pgdumpx | gzip > "$D/sao-luu-db-sau-E1A-E4.sql.gz"
step_end
