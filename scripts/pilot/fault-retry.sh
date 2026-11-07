#!/usr/bin/env bash
# SPP-75 bước 1.5: F8-R (Middleware tắt ~30s) và F10-R (EMR tắt ~60s) với retry khóa. CHỈ chạy trên stack cô lập đã xác nhận.
# usage: PILOT_ENV_FILE=... scripts/pilot/fault-retry.sh <thư-mục-bằng-chứng-mới>
set -u
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd); ROOT=$(cd "$HERE/../.." && pwd)
: "${PILOT_ENV_FILE:?}"; OUT=${1:?thư mục bằng chứng}
[ -e "$OUT/transcript.log" ] && { echo "REFUSE: $OUT/transcript.log đã tồn tại"; exit 3; }
mkdir -p "$OUT"; LOG=$OUT/transcript.log
CT=${PILOT_DB_CONTAINER:-lis-fhir-emr-db-1}; DBN=${PILOT_DB_NAME:-dacn_db}
set -a; . "$PILOT_ENV_FILE"; set +a
DB() { docker exec $CT psql -U postgres -d $DBN -Atc "$1"; }
say() { echo "[$(date -u +%FT%TZ)] $*" | tee -a "$LOG"; }
[ "$(DB "select shobj_description(oid,'pg_database') from pg_database where datname='$DBN'")" = "spp66-disposable:$SPP82_VERIFICATION_ISOLATION_TOKEN" ] || { echo "GUARD KHÔNG KHỚP"; exit 7; }
cd "$ROOT"
cnt() { echo "events=$(DB 'select count(*) from lis.publish_events') exch=$(DB 'select count(*) from integration.exchange_transactions') emr=$(DB 'select count(*) from emr.lab_results') seed=$(DB "select count(*) from lis.results where provenance->>'seed_tag'='DACN-MIMIC22-SOURCE-ALIGNED-V2'") mut=$(DB "select count(*) from lis.results where result_id like 'MUT-%'")"; }
state() { say "STATE $1 :: event=$(DB "select dispatch_status||'/attempts='||dispatch_attempt_count||'/err='||coalesce(last_error_code,'-') from lis.publish_events where result_id='$1'") exch=$(DB "select status from integration.exchange_transactions where source_result_id='$1'") emr_rows=$(DB "select count(*) from emr.lab_results where external_id='$1'") emr_value=$(DB "select quantity||' '||unit_text from emr.lab_results where external_id='$1'")"; }
wait_delivered() { for i in $(seq 1 90); do [ "$(DB "select status from integration.exchange_transactions where source_result_id='$1'")" = DELIVERED ] && return 0; sleep 2; done; return 1; }
[ "$(DB "select count(*) from lis.results where result_id like 'MUT-%'")" = 0 ] || { echo "Còn MUT-* từ trước"; exit 5; }
BEFORE=$(cnt); say "BASELINE trước thử nghiệm: $BEFORE"
say "git_head=$(git rev-parse HEAD) tag_runner=$(git describe --tags --always)"
for p in $(ps -eo pid,args | awk '/(dispatcher|worker)-main/ && !/awk/ {print $1}'); do say "pid $p: $(tr '\0' '\n' < /proc/$p/environ | grep -E '^(LIS_DISPATCHER|MIDDLEWARE_WORKER)_' | tr '\n' ' ')"; done
docker exec -i $CT psql -U postgres -d $DBN -v ON_ERROR_STOP=1 -q < "$ROOT/docs/docs_backend/spp-73/pilot-evidence/faults-retry-config/mutations.sql" >/dev/null && say "đã nạp MUT-*"
pub() { say "PUBLISH $1 -> $(curl -s -m 15 -w ' HTTP=%{http_code}' -X POST http://127.0.0.1:3101/api/results/$1/publish)"; }
restore() { docker start lis-fhir-emr-middleware-1 lis-fhir-emr-emr-1 >/dev/null 2>&1; }
trap restore EXIT
R=PASS
say "=== F8-R: Middleware tắt ~30s ==="
docker stop lis-fhir-emr-middleware-1 >/dev/null; say "middleware stopped"
pub MUT-VALID-OUT-LIS-LONG; sleep 30; state MUT-VALID-OUT-LIS-LONG
docker start lis-fhir-emr-middleware-1 >/dev/null; say "middleware started"
if wait_delivered MUT-VALID-OUT-LIS-LONG; then state MUT-VALID-OUT-LIS-LONG; else say "F8-R: KHÔNG DELIVERED sau 180s"; R=FAIL; fi
say "attempts: $(DB "select string_agg(attempt_no||':'||coalesce(error_code,'ok'),' ' order by attempt_no) from lis.dispatch_attempts where event_id=(select event_id from lis.publish_events where result_id='MUT-VALID-OUT-LIS-LONG')")"
sleep 5
say "=== F10-R: EMR tắt ~60s ==="
docker stop lis-fhir-emr-emr-1 >/dev/null; say "emr stopped"
pub MUT-VALID-OUT-EMR-LONG; sleep 60; state MUT-VALID-OUT-EMR-LONG
docker start lis-fhir-emr-emr-1 >/dev/null; say "emr started"
if wait_delivered MUT-VALID-OUT-EMR-LONG; then state MUT-VALID-OUT-EMR-LONG; else say "F10-R: KHÔNG DELIVERED sau 180s"; R=FAIL; fi
for id in MUT-VALID-OUT-LIS-LONG MUT-VALID-OUT-EMR-LONG; do
  n=$(DB "select count(*) from emr.lab_results where external_id='$id'"); v=$(DB "select quantity||' '||unit_text from emr.lab_results where external_id='$id'"); e=$(DB "select count(*) from lis.publish_events where result_id='$id'"); x=$(DB "select count(*) from integration.exchange_transactions where source_result_id='$id'")
  [ "$n" = 1 ] && [ "$e" = 1 ] && [ "$x" = 1 ] && [ "$v" = "0.9 mg/dL" ] && say "CHECK $id PASS (emr=1 event=1 exch=1 value='$v')" || { say "CHECK $id FAIL (emr=$n event=$e exch=$x value='$v')"; R=FAIL; }
done
# xuất bằng chứng rồi dọn
for t in "lis.publish_events:result_id like 'MUT-%'" "integration.exchange_transactions:source_result_id like 'MUT-%'" "emr.lab_results:external_id like 'MUT-%'"; do
  docker exec $CT psql -U postgres -d $DBN -c "\copy (select * from ${t%%:*} where ${t#*:}) to stdout csv header" > "$OUT/db-snapshot-${t%%:*}.csv"; done
docker exec -i $CT psql -U postgres -d $DBN -v ON_ERROR_STOP=1 -q < "$ROOT/docs/docs_backend/spp-73/pilot-evidence/faults-retry-config/cleanup-mut.sql" >/dev/null && say "đã dọn MUT-*"
restore; sleep 5
for p in 3101 3102 3103; do say "ready $p -> $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$p/ready)"; done
AFTER=$(cnt); say "BASELINE sau thử nghiệm: $AFTER"
[ "$AFTER" = "$BEFORE" ] || { say "CẢNH BÁO: số liệu sau khác trước"; R=FAIL; }
say "KẾT QUẢ F8-R/F10-R: $R"; [ $R = PASS ]
