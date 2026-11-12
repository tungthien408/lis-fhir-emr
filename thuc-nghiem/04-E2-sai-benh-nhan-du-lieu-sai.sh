#!/usr/bin/env bash
# E2 – SAI BỆNH NHÂN và DỮ LIỆU SAI (TC02, TC03). Chạy sau bước 03, trên cùng môi trường.
# Mọi ca thử đều là BẢN SAO có mã bắt đầu bằng "MUT-" (đánh dấu synthetic), không đụng 1.000 kết quả gốc.
# Kỳ vọng chung: dữ liệu sai bị chặn, KHÔNG có bản ghi nào được lưu ở EMR, KHÔNG có ca nào báo hoàn tất (DELIVERED).
source "$(dirname "$0")/lib.sh"
require_step "02-E1-1000-ket-qua"
step_begin "04-E2-sai-benh-nhan-du-lieu-sai" "E2"
D="$OUT/E2-sai-benh-nhan-du-lieu-sai"; rm -rf "$D"; mkdir -p "$D"
S=E2
mw_post() { curl -s -w '\nHTTP %{http_code}\n' -X POST "$MIDDLEWARE_BASE_URL/api/exchanges" -H 'Content-Type: application/json' --data-binary @-; }
rehash()  { (cd "$BACKEND" && node --import tsx "$TN_DIR/tinh-lai-ma-bam.mjs"); }
emr_count() { sql1 "SELECT count(*) FROM emr.lab_results WHERE external_id='$1'"; }
mw_status() { sql1 "SELECT coalesce((SELECT status FROM integration.exchange_transactions WHERE source_result_id='$1'),'(không tạo giao dịch)')"; }
mw_reason() { sql1 "SELECT coalesce((SELECT e.detail->>'code' FROM integration.exchange_events e JOIN integration.exchange_transactions t USING (exchange_id)
                   WHERE t.source_result_id='$1' AND e.detail->>'code' IS NOT NULL ORDER BY e.occurred_at DESC LIMIT 1),'')"; }

# Kết quả gốc dùng làm khuôn (lấy 1 kết quả đã DELIVERED trong tập 40 lõi)
SRC=$(sql1 "SELECT t.source_result_id FROM integration.exchange_transactions t JOIN lis.results r ON r.result_id=t.source_result_id
            WHERE t.status='DELIVERED' ORDER BY (r.provenance->>'in_functional_40')='true' DESC, t.source_result_id LIMIT 1")
log "Dùng $SRC làm khuôn để tạo các ca lỗi"

########## 7a. TC02 – bệnh nhân KHÔNG có liên kết bên EMR (đi trọn luồng từ LIS) ##########
psqlx -q -c "INSERT INTO lis.patients (patient_id, source_subject_id, display_label)
             VALUES ('MUT-P-NOLINK-1','MUT-NOLINK-1','Ca thử: bệnh nhân không có liên kết ở EMR') ON CONFLICT DO NOTHING" \
         -c "INSERT INTO lis.results (result_id, patient_id, test_code, value_num, unit, reference_low, reference_high, effective_at, result_status, provenance)
             SELECT 'MUT-LAB-NOLINK-'||v.n, 'MUT-P-NOLINK-1', test_code, value_num, unit, reference_low, reference_high, effective_at, result_status,
                    provenance || '{\"synthetic\":\"true\",\"mutation\":\"patient_not_linked\"}'::jsonb
             FROM lis.results r JOIN (SELECT row_number() OVER (ORDER BY result_id) n, result_id FROM lis.results
                                      WHERE provenance->>'in_functional_40'='true' ORDER BY result_id LIMIT 3) v ON r.result_id=v.result_id
             ON CONFLICT DO NOTHING"
for n in 1 2 3; do
  printf 'MUT-LAB-NOLINK-%s %s\n' "$n" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$LIS_BASE_URL/api/results/MUT-LAB-NOLINK-$n/publish")"
done > "$D/7a-publish.txt"
wait_settled 120 || true
for n in 1 2 3; do
  id="MUT-LAB-NOLINK-$n"
  lis=$(sql1 "SELECT dispatch_status FROM lis.publish_events WHERE result_id='$id'")
  mw=$(mw_status "$id"); why=$(mw_reason "$id"); emr=$(emr_count "$id")
  echo "$id | LIS: $lis | middleware: $mw ($why) | bản ghi EMR: $emr" >> "$D/7a-ket-qua.txt"
  check $S "TC02-$n" "Bệnh nhân không có liên kết ($id): middleware từ chối, EMR không lưu" "REJECTED, EMR=0" "$mw, EMR=$emr"
done
psqlx -c "SELECT t.source_result_id, e.event_type, e.new_status, e.detail::text, e.occurred_at FROM integration.exchange_events e
          JOIN integration.exchange_transactions t USING (exchange_id) WHERE t.source_result_id LIKE 'MUT-LAB-NOLINK-%' ORDER BY 1, e.occurred_at" \
  > "$D/7a-lich-su-xu-ly.txt"

########## 7b. TC03 – gói tin LIS→middleware có nội dung sai (mã băm được tính lại cho khớp) ##########
sql1 "SELECT json_build_object('event_id',event_id,'source_system',source_system,'source_result_id',result_id,
       'source_snapshot',source_snapshot,'source_hash',source_hash,
       'published_at',to_char(published_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'))
      FROM lis.publish_events WHERE result_id='$SRC'" > "$D/goi-tin-khuon.json"
CASES=(
  'ma-xn-ngoai-danh-muc|.source_snapshot.test_code="99999"|Mã xét nghiệm không có trong danh mục'
  'don-vi-khong-duoc-duyet|.source_snapshot.unit="kg"|Đơn vị đo không thuộc danh sách được chấp nhận'
  'benh-nhan-khong-ton-tai|.source_snapshot.patient_id="MIMIC-P-KHONG-TON-TAI"|Mã bệnh nhân không tồn tại'
  'thieu-gia-tri|del(.source_snapshot.value_num)|Thiếu giá trị xét nghiệm'
  'can-duoi-lon-hon-can-tren|.source_snapshot.reference_low=9 | .source_snapshot.reference_high=1|Cận dưới lớn hơn cận trên'
  'chua-final|.source_snapshot.result_status="READY"|Kết quả chưa ở trạng thái FINAL'
)
i=0
for c in "${CASES[@]}"; do
  i=$((i+1)); name=${c%%|*}; rest=${c#*|}; f=${rest%|*}; desc=${rest##*|}
  id="MUT-MW-$name"; ev=$(cat /proc/sys/kernel/random/uuid)
  jq --arg id "$id" --arg ev "$ev" ".event_id=\$ev | .source_result_id=\$id | .source_snapshot.result_id=\$id | $f" "$D/goi-tin-khuon.json" \
    | rehash > "$D/7b-$name.goi-tin.json"
  mw_post < "$D/7b-$name.goi-tin.json" > "$D/7b-$name.phan-hoi.txt"
done
wait_settled 120 || true
i=0
for c in "${CASES[@]}"; do
  i=$((i+1)); name=${c%%|*}; rest=${c#*|}; desc=${rest##*|}; id="MUT-MW-$name"
  code=$(tail -n1 "$D/7b-$name.phan-hoi.txt" | awk '{print $2}')
  mw=$(mw_status "$id"); why=$(mw_reason "$id"); emr=$(emr_count "$id")
  if [[ "$code" == 4* ]]; then chan="bị chặn ngay ở middleware (HTTP $code)"
  elif [ "$mw" = REJECTED ] || [ "$mw" = FAILED ]; then chan="bị chặn sau khi tiếp nhận ($mw${why:+, $why})"
  else chan="KHÔNG bị chặn (middleware: $mw)"; fi
  echo "$id | $desc | HTTP $code | middleware: $mw ${why:+($why)} | bản ghi EMR: $emr" >> "$D/7b-ket-qua.txt"
  verdict=KHONG_DAT; [[ "$chan" != KHÔNG* ]] && [ "$emr" = 0 ] && verdict=DAT
  check $S "TC03-MW-$i" "$desc (gói tin gửi vào middleware)" "bị chặn, EMR không lưu" "$chan, EMR lưu $emr bản ghi" "$verdict"
done

########## 7c. TC03 – Observation hỏng gửi thẳng vào EMR (lớp chặn cuối cùng) ##########
sql1 "SELECT fhir_payload FROM integration.exchange_transactions WHERE source_result_id='$SRC'" > "$D/observation-khuon.json"
ECASES=(
  'thieu-benh-nhan|del(.subject)|Thiếu thông tin bệnh nhân'
  'benh-nhan-khong-lien-ket|.subject.identifier.value="MIMIC-P-KHONG-TON-TAI"|Bệnh nhân không có liên kết ở EMR'
  'gia-tri-khong-phai-so|.valueQuantity.value="abc"|Giá trị không phải là số'
  'can-duoi-lon-hon-can-tren|.referenceRange[0].low.value=9 | .referenceRange[0].high.value=1|Cận dưới lớn hơn cận trên'
  'thieu-thoi-diem|del(.effectiveDateTime)|Thiếu thời điểm xét nghiệm'
  'sai-loai-tai-nguyen|.resourceType="Patient"|Không phải tài nguyên Observation'
  'ma-xn-ngoai-danh-muc|.code.coding[0].code="99999"|Mã xét nghiệm không có trong danh mục'
  'don-vi-khong-duoc-duyet|.valueQuantity.unit="kg"|Đơn vị đo không thuộc danh sách được chấp nhận'
  'don-vi-sai-nhat-quan|.valueQuantity.unit="kg" | (.referenceRange[]? | .low?, .high? | select(. != null) | .unit)="kg"|Đơn vị sai nhưng giá trị và các cận đều nhất quán'
  'don-vi-sai-khong-co-can|.valueQuantity.unit="kg" | del(.referenceRange)|Đơn vị sai khi không có cận tham chiếu'
)
i=0
for c in "${ECASES[@]}"; do
  i=$((i+1)); name=${c%%|*}; rest=${c#*|}; f=${rest%|*}; desc=${rest##*|}; id="MUT-EMR-$name"
  jq --arg id "$id" ".identifier[0].value=\$id | $f" "$D/observation-khuon.json" > "$D/7c-$name.observation.json"
  emr_post < "$D/7c-$name.observation.json" > "$D/7c-$name.phan-hoi.txt"
  code=$(tail -n1 "$D/7c-$name.phan-hoi.txt" | awk '{print $2}'); emr=$(emr_count "$id")
  echo "$id | $desc | HTTP $code | bản ghi EMR: $emr" >> "$D/7c-ket-qua.txt"
  verdict=KHONG_DAT; [[ "$code" == 4* ]] && [ "$emr" = 0 ] && verdict=DAT
  check $S "TC03-EMR-$i" "$desc (gửi thẳng vào EMR)" "EMR từ chối (4xx), không lưu" "HTTP $code, EMR lưu $emr bản ghi" "$verdict"
done

########## Tổng kết: không ca lỗi nào được báo hoàn tất ##########
n_deliv=$(sql1 "SELECT count(*) FROM integration.exchange_transactions WHERE source_result_id LIKE 'MUT-%' AND status='DELIVERED'")
n_emr=$(sql1 "SELECT count(*) FROM emr.lab_results WHERE external_id LIKE 'MUT-%'")
check $S "E2-TONG-1" "Số ca lỗi bị báo hoàn tất (DELIVERED) sai" "0" "$n_deliv"
check $S "E2-TONG-2" "Số ca lỗi có bản ghi lọt vào EMR" "0" "$n_emr"
psqlx -c "SELECT external_id, analyte_code, quantity, unit_text, patient_key FROM emr.lab_results WHERE external_id LIKE 'MUT-%'" > "$D/ban-ghi-loi-lot-vao-EMR.txt"

step_end
