#!/usr/bin/env bash
# Thư viện dùng chung cho các script thực nghiệm. KHÔNG chạy trực tiếp file này.
# Mọi script trong thư mục thuc-nghiem/ đều "source" file này ở dòng đầu.
set -Eeuo pipefail

TN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$TN_DIR/.." && pwd)"
BACKEND="$ROOT/backend"

[ -f "$ROOT/.env" ] || { echo "LỖI: thiếu file .env ở thư mục gốc repo (copy từ .env.example rồi đặt mật khẩu)." >&2; exit 1; }
set -a; . "$ROOT/.env"; set +a

# ---------- Thư mục kết quả: cố định cho cả đợt chạy (kể cả khi chạy qua nhiều ngày) ----------
mkdir -p "$TN_DIR/ket-qua"
if [ -z "${RUN_TAG:-}" ]; then
  if [ -f "$TN_DIR/ket-qua/.run-tag" ]; then RUN_TAG="$(cat "$TN_DIR/ket-qua/.run-tag")"
  else RUN_TAG="$(date +%Y-%m-%d)"; echo "$RUN_TAG" > "$TN_DIR/ket-qua/.run-tag"; fi
fi
OUT="$TN_DIR/ket-qua/$RUN_TAG"
mkdir -p "$OUT/trang-thai"
CHECKS="$OUT/kiem-tra.jsonl"          # mỗi dòng = 1 phép kiểm tra "kỳ vọng ↔ thực tế"
source "$TN_DIR/checks-store.sh"

# ---------- Địa chỉ dịch vụ và tài khoản DB ----------
export LIS_BASE_URL=http://127.0.0.1:3101
export MIDDLEWARE_BASE_URL=http://127.0.0.1:3102
export EMR_BASE_URL=http://127.0.0.1:3103
DB_HOSTPORT=127.0.0.1:5433
export LIS_DATABASE_URL="postgresql://lis_app:${LIS_DB_PASSWORD}@${DB_HOSTPORT}/dacn_db"
export MIDDLEWARE_DATABASE_URL="postgresql://integration_app:${MIDDLEWARE_DB_PASSWORD}@${DB_HOSTPORT}/dacn_db"
export EMR_DATABASE_URL="postgresql://emr_app:${EMR_DB_PASSWORD}@${DB_HOSTPORT}/dacn_db"
export LIS_VERIFY_DATABASE_URL="$LIS_DATABASE_URL"
export MIDDLEWARE_VERIFY_DATABASE_URL="$MIDDLEWARE_DATABASE_URL"
export EMR_VERIFY_DATABASE_URL="$EMR_DATABASE_URL"
export SPP82_EXPERIMENT_TARGET=lisexp-local

EXPERIMENT_REFERENCE_VERSION="${EXPERIMENT_REFERENCE_VERSION:-v3}"
case "$EXPERIMENT_REFERENCE_VERSION" in v2|v3) ;; *) echo 'EXPERIMENT_REFERENCE_VERSION phải là v2 hoặc v3' >&2; exit 1 ;; esac
export EXPERIMENT_REFERENCE_VERSION
ORACLE_DIR="$BACKEND/scripts/spp82/reference/spp65-$EXPERIMENT_REFERENCE_VERSION"
ORACLE="$ORACLE_DIR/manifest.json"
ORACLE_SHA="$(cut -d' ' -f1 "$ORACLE_DIR/manifest.sha256")"
TOKEN_FILE="$OUT/.isolation-token"
[ -f "$TOKEN_FILE" ] && export SPP82_VERIFICATION_ISOLATION_TOKEN="$(cat "$TOKEN_FILE")"

# Cấu hình mặc định của hệ thống (để ghi vào báo cáo, không đổi hành vi)
DEFAULT_RETRY_DELAYS="2000,4000,8000"

# ---------- Môi trường thực nghiệm riêng: docker compose project "lisexp" ----------
COMPOSE_PROJECT=lisexp
dcx()   { docker compose -p "$COMPOSE_PROJECT" --project-directory "$ROOT" -f "$ROOT/compose.yaml" "$@"; }
dcx_all() { dcx --profile dispatcher --profile worker "$@"; }
psqlx() { dcx exec -T db psql -U postgres -d dacn_db -X -v ON_ERROR_STOP=1 "$@"; }
pgdumpx() { dcx exec -T db pg_dump -U postgres -d dacn_db --no-owner "$@"; }
svc_stop()  { dcx stop "$1" >/dev/null 2>&1; }     # $1 = emr | middleware
svc_start() { dcx start "$1" >/dev/null 2>&1; }
# Khởi động lại worker với chuỗi chờ thử lại khác (rỗng = mặc định)
worker_restart_with_delays() {
  if [ -n "${1:-}" ]; then MIDDLEWARE_WORKER_RETRY_DELAYS_MS="$1" dcx --profile worker up -d --no-deps --force-recreate middleware-worker >/dev/null 2>&1
  else (unset MIDDLEWARE_WORKER_RETRY_DELAYS_MS; dcx --profile worker up -d --no-deps --force-recreate middleware-worker >/dev/null 2>&1); fi
}

# Xóa sạch môi trường "lisexp" và dựng lại từ đầu. DB demo của nhóm (project lis-fhir-emr) KHÔNG bị đụng tới.
exp_reset() {
  log "Dựng lại môi trường thực nghiệm sạch (lisexp)…"
  dcx_all down -v --remove-orphans >/dev/null 2>&1 || true
  dcx up -d --wait db >/dev/null
  psqlx -q -c "ALTER ROLE lis_app PASSWORD '$LIS_DB_PASSWORD'" \
           -c "ALTER ROLE integration_app PASSWORD '$MIDDLEWARE_DB_PASSWORD'" \
           -c "ALTER ROLE emr_app PASSWORD '$EMR_DB_PASSWORD'" >/dev/null
  dcx_all up -d --build --wait >/dev/null
  wait_ready
  mark_disposable_db
  log "Môi trường sẵn sàng."
}

# Đánh dấu DB này là "DB thực nghiệm dùng một lần". Công cụ đối chiếu của repo CHỈ chịu đọc DB có dấu này,
# nhờ vậy không bao giờ đọc nhầm DB demo của nhóm.
mark_disposable_db() {
  cat /proc/sys/kernel/random/uuid > "$TOKEN_FILE"
  export SPP82_VERIFICATION_ISOLATION_TOKEN="$(cat "$TOKEN_FILE")"
  psqlx -q -c "COMMENT ON DATABASE dacn_db IS 'spp66-disposable:$SPP82_VERIFICATION_ISOLATION_TOKEN'" >/dev/null
}

# Cho phép thay cách vận hành (chỉ dùng khi tự kiểm thử script). Người dùng bình thường không cần.
if [ -n "${EXP_LIB_OVERRIDE:-}" ] && [ -f "$EXP_LIB_OVERRIDE" ]; then . "$EXP_LIB_OVERRIDE"; fi

# ---------- Tiện ích ----------
log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$OUT/nhat-ky-chay.log" >&2; }
now_iso() { date '+%Y-%m-%dT%H:%M:%S.%3N%:z'; }
sql1() { psqlx -Atc "$1"; }          # chạy 1 câu SQL, in kết quả gọn

wait_ready() {
  local i
  for i in $(seq 1 90); do
    if curl -sf "$LIS_BASE_URL/ready" >/dev/null && curl -sf "$MIDDLEWARE_BASE_URL/ready" >/dev/null \
       && curl -sf "$EMR_BASE_URL/ready" >/dev/null; then return 0; fi
    sleep 1
  done
  log "LỖI: 3 dịch vụ chưa sẵn sàng sau 90 giây"; return 1
}

# Chờ đến khi không còn việc nào đang dở (đang gửi / đang chờ thử lại / đang xác minh)
wait_settled() {
  local timeout="${1:-600}" start; start=$(date +%s); local stable=0 n
  while :; do
    n=$(sql1 "SELECT (SELECT count(*) FROM lis.publish_events WHERE dispatch_status IN ('PENDING','IN_FLIGHT','RETRY_WAIT'))
                   + (SELECT count(*) FROM integration.exchange_transactions WHERE status IN ('RECEIVED','PROCESSING','VERIFYING','RETRY_WAIT'))")
    if [ "$n" = "0" ]; then stable=$((stable+1)); [ $stable -ge 3 ] && return 0; else stable=0; fi
    if [ $(( $(date +%s) - start )) -ge "$timeout" ]; then log "Hết thời gian chờ: còn $n việc đang dở"; return 1; fi
    sleep 2
  done
}

# Publish N kết quả MIMIC chưa publish. In ra: result_id mã_HTTP
publish_next() {
  local id
  sql1 "SELECT result_id FROM lis.results r WHERE result_id LIKE 'MIMIC-LAB-%'
        AND NOT EXISTS (SELECT 1 FROM lis.publish_events p WHERE p.result_id=r.result_id)
        ORDER BY result_id LIMIT $1" |
  while read -r id; do printf '%s %s\n' "$id" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$LIS_BASE_URL/api/results/$id/publish")"; done
}

# Gửi 1 Observation (đọc từ stdin) thẳng vào EMR. In: thân phản hồi + dòng cuối "HTTP <mã>"
emr_post() { curl -s -w '\nHTTP %{http_code}\n' -X POST "$EMR_BASE_URL/api/observations" \
             -H 'Content-Type: application/fhir+json' --data-binary @-; }

# Ghi 1 phép kiểm tra: check <kịch_bản> <mã_ca> <mô_tả> <kỳ_vọng> <thực_tế> [DAT|KHONG_DAT]
# Nếu không truyền tham số thứ 6: ĐẠT khi thực tế == kỳ vọng.
check() {
  local scen="$1" id="$2" desc="$3" exp="$4" act="$5" verdict="${6:-}"
  if [ -z "$verdict" ]; then [ "$exp" = "$act" ] && verdict=DAT || verdict=KHONG_DAT; fi
  local record
  record=$(jq -cn --arg s "$scen" --arg i "$id" --arg d "$desc" --arg e "$exp" --arg a "$act" --arg v "$verdict" --arg t "$(now_iso)" \
     '{kich_ban:$s, ma:$i, mo_ta:$d, ky_vong:$e, thuc_te:$a, ket_qua:$v, luc:$t}')
  checks_append "$record"
  if [ "$verdict" = DAT ]; then log "  ✔ [$scen/$id] $desc → $act"; else log "  ✘ [$scen/$id] $desc → kỳ vọng: $exp | thực tế: $act"; fi
}

# Đánh dấu trạng thái bước (để theo dõi và chạy tiếp nếu bị ngắt)
STEP_NAME=""
step_begin() {
  STEP_NAME="$1"; mkdir -p "$OUT/trang-thai"
  rm -f "$OUT/trang-thai/$STEP_NAME".{xong,loi}
  now_iso > "$OUT/trang-thai/$STEP_NAME.dang-chay"
  log "===== BẮT ĐẦU: $STEP_NAME ====="
  # Không để kiểm tra cũ của chính bước này bị tính 2 lần khi chạy lại
  checks_remove_scenario "${2:-__none__}"
}
step_end() {
  rm -f "$OUT/trang-thai/$STEP_NAME.dang-chay"
  now_iso > "$OUT/trang-thai/$STEP_NAME.xong"
  log "===== XONG: $STEP_NAME ====="
}
on_error() {
  local line="$1" code="$2"
  [ -n "$STEP_NAME" ] && printf 'Lỗi ở dòng %s (mã thoát %s) lúc %s\n' "$line" "$code" "$(now_iso)" > "$OUT/trang-thai/$STEP_NAME.loi"
  [ -n "$STEP_NAME" ] && rm -f "$OUT/trang-thai/$STEP_NAME.dang-chay"
  log "LỖI ở dòng $line của ${BASH_SOURCE[1]:-?} (mã $code). Xem nhat-ky-chay.log"
}
trap 'on_error $LINENO $?' ERR

require_step() {  # dừng nếu bước trước chưa xong
  [ -f "$OUT/trang-thai/$1.xong" ] || { log "Cần chạy xong bước '$1' trước."; exit 1; }
}

# Chạy công cụ đo/đối chiếu có sẵn của repo
spp82_publish() { (cd "$BACKEND" && node --import tsx scripts/spp82/publish-runner-main.ts "$@"); }
spp82_capture() { (cd "$BACKEND" && node --import tsx scripts/spp82/verification/verification-main.ts capture \
                    --oracle "$ORACLE" --oracle-sha256 "$ORACLE_SHA" "$@"); }
spp82_verify()  { (cd "$BACKEND" && node --import tsx scripts/spp82/verification/verification-main.ts verify \
                    --oracle "$ORACLE" --oracle-sha256 "$ORACLE_SHA" "$@"); }

# Bảng thời gian từng chặng của mỗi kết quả (CSV), tính từ mốc thời gian hệ thống tự ghi.
#  lis_sang_mw_ms      : từ lúc LIS ghi nhận Publish → middleware nhận được gói tin
#  cho_worker_ms       : middleware đã nhận → bộ xử lý nền bắt đầu làm
#  anh_xa_ms           : thời gian chuyển dữ liệu sang FHIR (từ lúc kiểm tra xong → chuyển đổi xong)
#  gui_emr_den_luu_ms  : lần gửi cuối sang EMR → EMR báo đã lưu
#  doc_lai_xac_minh_ms : EMR báo đã lưu → middleware đọc lại, đối chiếu đúng và ghi hoàn tất
#  tong_ms             : từ lúc LIS ghi nhận Publish → hoàn tất (DELIVERED)
# $1 = điều kiện lọc trên bảng giao dịch t (vd: "t.source_result_id LIKE 'MIMIC-%'")
stage_csv() {
  psqlx -c "COPY (
    WITH ev AS (
      SELECT t.source_result_id, t.status, t.send_attempt_count, t.verify_attempt_count, t.published_at,
        min(e.occurred_at) FILTER (WHERE e.event_type='RECEIVED')      AS t_received,
        min(e.occurred_at) FILTER (WHERE e.event_type='CLAIMED')       AS t_claimed,
        min(e.occurred_at) FILTER (WHERE e.event_type='VALIDATED')     AS t_validated,
        min(e.occurred_at) FILTER (WHERE e.event_type='TRANSFORMED')   AS t_transformed,
        max(e.occurred_at) FILTER (WHERE e.event_type='SENT')          AS t_last_sent,
        min(e.occurred_at) FILTER (WHERE e.event_type='TARGET_STORED') AS t_stored,
        min(e.occurred_at) FILTER (WHERE e.event_type='DELIVERED')     AS t_delivered
      FROM integration.exchange_transactions t JOIN integration.exchange_events e USING (exchange_id)
      WHERE $1
      GROUP BY 1,2,3,4,5)
    SELECT source_result_id AS ma_ket_qua, status AS trang_thai, send_attempt_count AS so_lan_gui,
      verify_attempt_count AS so_lan_doc_lai,
      to_char(published_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS luc_publish,
      round((extract(epoch FROM t_received - published_at)*1000)::numeric,1)   AS lis_sang_mw_ms,
      round((extract(epoch FROM t_claimed - t_received)*1000)::numeric,1)      AS cho_worker_ms,
      round((extract(epoch FROM t_transformed - t_validated)*1000)::numeric,3) AS anh_xa_ms,
      round((extract(epoch FROM t_stored - t_last_sent)*1000)::numeric,1)      AS gui_emr_den_luu_ms,
      round((extract(epoch FROM t_delivered - t_stored)*1000)::numeric,1)      AS doc_lai_xac_minh_ms,
      round((extract(epoch FROM t_delivered - published_at)*1000)::numeric,1)  AS tong_ms
    FROM ev ORDER BY published_at, source_result_id) TO STDOUT WITH CSV HEADER"
}
