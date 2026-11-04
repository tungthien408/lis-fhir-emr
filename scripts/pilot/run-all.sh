#!/usr/bin/env bash
# SPP-73 bước 3: 3 lượt A (tuần tự, c=1) và 3 lượt B (đồng thời, c=5), xen kẽ A1 B1 A2 B2 A3 B3.
# Mỗi lượt: reset an toàn -> kiểm tra baseline -> ghi phiên bản/cấu hình -> before -> publish -> after -> verify.
# Logic giống bản đã chạy ở SPP-73. SPP-74 chỉ: (1) thay đường dẫn tuyệt đối/scratchpad bằng biến môi trường,
# (2) cho chọn lượt (PILOT_RUNS) và baseline (PILOT_EXPECTED_BASELINE), (3) ghi thêm phiên bản công cụ vào code-and-environment.txt.
#
# Biến môi trường:
#   PILOT_ENV_FILE            (bắt buộc) file biến môi trường cho run-scenario.sh
#   PILOT_EVIDENCE_DIR        thư mục lưu bằng chứng (mặc định docs/docs_backend/spp-73/pilot-evidence)
#   PILOT_DB_CONTAINER        container PostgreSQL (mặc định lis-fhir-emr-db-1)
#   PILOT_DB_NAME             tên DB (mặc định dacn_db)
#   PILOT_RUNS                các lượt cần chạy (mặc định "A1 B1 A2 B2 A3 B3")
#   PILOT_EXPECTED_BASELINE   baseline sau reset. Mặc định là DB dựng sạch từ repo: "events=0 exch=0 emr=0 seed=1000 mut=0".
#                             Pilot SPP-73 chạy trên DB còn sót DEMO-R1 nên baseline là "events=1 exch=1 emr=1 seed=1000 mut=0".
set -u
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=${PILOT_ROOT:-$(cd "$HERE/../.." && pwd)}
EV=${PILOT_EVIDENCE_DIR:-$ROOT/docs/docs_backend/spp-73/pilot-evidence}
CT=${PILOT_DB_CONTAINER:-lis-fhir-emr-db-1}
DBN=${PILOT_DB_NAME:-dacn_db}
RUNS=${PILOT_RUNS:-"A1 B1 A2 B2 A3 B3"}
BASELINE=${PILOT_EXPECTED_BASELINE:-"events=0 exch=0 emr=0 seed=1000 mut=0"}
: "${PILOT_ENV_FILE:?Thiếu PILOT_ENV_FILE}"
DB() { docker exec $CT psql -U postgres -d $DBN -Atc "$1"; }
cd $ROOT
# SPP-74: kiểm tra guard cô lập TRƯỚC khi reset (bản SPP-73 để người chạy tự kiểm tra bằng tay).
TOKEN=$(. "$PILOT_ENV_FILE" >/dev/null 2>&1; echo "${SPP82_VERIFICATION_ISOLATION_TOKEN:-}")
[ -n "$TOKEN" ] || { echo "THIẾU SPP82_VERIFICATION_ISOLATION_TOKEN trong PILOT_ENV_FILE"; exit 7; }
[ "$(DB "select shobj_description(oid,'pg_database') from pg_database where datname='$DBN'")" = "spp66-disposable:$TOKEN" ] \
  || { echo "GUARD CÔ LẬP KHÔNG KHỚP: DB '$DBN' trong container '$CT' không được xác nhận là DB thử nghiệm; dừng, không reset"; exit 7; }
mkdir -p $EV/final
for spec in "A1 A-seq-r1 SEQUENTIAL 1" "B1 B-con5-r1 CONCURRENT 5" "A2 A-seq-r2 SEQUENTIAL 1" "B2 B-con5-r2 CONCURRENT 5" "A3 A-seq-r3 SEQUENTIAL 1" "B3 B-con5-r3 CONCURRENT 5"; do
  set -- $spec; name=$1; scenario=$2; mode=$3; conc=$4; dir=$EV/final/$name
  case " $RUNS " in *" $name "*) ;; *) continue;; esac
  [ -e "$dir" ] && { echo "REFUSE: $dir đã tồn tại (không ghi đè bằng chứng)"; exit 3; }
  # reset.sql KHÔNG tự kiểm tra guard: người chạy phải xác minh DB cô lập trước (xem docs spp-74/05-reproduction-check.md).
  docker exec -i $CT psql -U postgres -d $DBN -v ON_ERROR_STOP=1 < $HERE/reset.sql > /dev/null || { echo "RESET FAILED $name"; exit 4; }
  base="events=$(DB 'select count(*) from lis.publish_events') exch=$(DB 'select count(*) from integration.exchange_transactions') emr=$(DB 'select count(*) from emr.lab_results') seed=$(DB "select count(*) from lis.results where provenance->>'seed_tag'='DACN-MIMIC22-SOURCE-ALIGNED-V2'") mut=$(DB "select count(*) from lis.results where result_id like 'MUT-%'")"
  [ "$base" = "$BASELINE" ] || { echo "BASELINE SAI ($name): $base (mong đợi: $BASELINE)"; exit 5; }
  nd=$(ps -eo args | grep -c '[l]is/dispatcher-main'); nw=$(ps -eo args | grep -c '[m]iddleware/worker-main')
  [ "$nd" = 1 ] && [ "$nw" = 1 ] || { echo "SỐ TIẾN TRÌNH SAI ($name): dispatcher=$nd worker=$nw"; exit 6; }
  mkdir -p $dir
  { echo "run=$name scenario=$scenario mode=$mode concurrency=$conc"; echo "baseline_before_run: $base";
    echo "git_head=$(git rev-parse HEAD)"; echo "git_describe=$(git describe --tags --always --dirty 2>/dev/null)"; echo "source_tree_sha256=$(git ls-files -co --exclude-standard backend/src backend/scripts database | sort | xargs sha256sum | sha256sum | cut -d' ' -f1)";
    echo "oracle_manifest_sha256=$(sha256sum backend/scripts/spp82/reference/spp65-v2/manifest.json | cut -d' ' -f1)"; sha256sum database/seed/*.sql;
    echo "dispatcher_processes=$nd worker_processes=$nw";
    for p in $(ps -eo pid,args | awk '/(dispatcher|worker)-main/ && !/awk/ {print $1}'); do echo "pid $p env: $(tr '\0' ' ' < /proc/$p/environ | grep -oE '(LIS_DISPATCHER|MIDDLEWARE_WORKER)_[A-Z_]+=[0-9,]+' | tr '\n' ' ')"; done;
    echo "node=$(node -v) npm=$(npm -v)"; echo "postgres=$(DB 'show server_version')"; docker ps --format 'container {{.Names}} {{.Image}} {{.Status}}'; } > $dir/code-and-environment.txt
  echo "[$(date -u +%FT%TZ)] START $name" >> $EV/final/run-all.log
  $HERE/run-scenario.sh final/$name $scenario $mode $conc
  echo "[$(date -u +%FT%TZ)] END $name :: $(grep -E 'verify_exit|publish_exit' $dir/orchestration.log | tr '\n' ' ') :: after: events=$(DB 'select count(*) from lis.publish_events') delivered=$(DB "select count(*) from integration.exchange_transactions where status='DELIVERED'") emr=$(DB 'select count(*) from emr.lab_results')" >> $EV/final/run-all.log
done
echo "[$(date -u +%FT%TZ)] ALL DONE" >> $EV/final/run-all.log
