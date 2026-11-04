#!/usr/bin/env bash
# SPP-73 bước 3: 3 lượt A (tuần tự, c=1) và 3 lượt B (đồng thời, c=5), xen kẽ A1 B1 A2 B2 A3 B3.
# Mỗi lượt: reset an toàn -> kiểm tra baseline -> ghi phiên bản/cấu hình -> before -> publish -> after -> verify.
set -u
ROOT=/home/thien408/Projects/2026-2027/dacn/lis-fhir-emr
EV=$ROOT/docs/docs_backend/spp-73/pilot-evidence
S=/tmp/claude-1000/-home-thien408-Projects-2026-2027-dacn-lis-fhir-emr/c8fe7937-ffd6-4f42-9242-8324d0ba4db8/scratchpad
DB() { docker exec lis-fhir-emr-db-1 psql -U postgres -d dacn_db -Atc "$1"; }
cd $ROOT
for spec in "A1 A-seq-r1 SEQUENTIAL 1" "B1 B-con5-r1 CONCURRENT 5" "A2 A-seq-r2 SEQUENTIAL 1" "B2 B-con5-r2 CONCURRENT 5" "A3 A-seq-r3 SEQUENTIAL 1" "B3 B-con5-r3 CONCURRENT 5"; do
  set -- $spec; name=$1; scenario=$2; mode=$3; conc=$4; dir=$EV/final/$name
  [ -e "$dir" ] && { echo "REFUSE: $dir đã tồn tại (không ghi đè bằng chứng)"; exit 3; }
  docker exec -i lis-fhir-emr-db-1 psql -U postgres -d dacn_db -v ON_ERROR_STOP=1 < $EV/reset.sql > /dev/null || { echo "RESET FAILED $name"; exit 4; }
  base="events=$(DB 'select count(*) from lis.publish_events') exch=$(DB 'select count(*) from integration.exchange_transactions') emr=$(DB 'select count(*) from emr.lab_results') seed=$(DB "select count(*) from lis.results where provenance->>'seed_tag'='DACN-MIMIC22-SOURCE-ALIGNED-V2'") mut=$(DB "select count(*) from lis.results where result_id like 'MUT-%'")"
  [ "$base" = "events=1 exch=1 emr=1 seed=1000 mut=0" ] || { echo "BASELINE SAI ($name): $base"; exit 5; }
  nd=$(ps -eo args | grep -c '[l]is/dispatcher-main'); nw=$(ps -eo args | grep -c '[m]iddleware/worker-main')
  [ "$nd" = 1 ] && [ "$nw" = 1 ] || { echo "SỐ TIẾN TRÌNH SAI ($name): dispatcher=$nd worker=$nw"; exit 6; }
  mkdir -p $dir
  { echo "run=$name scenario=$scenario mode=$mode concurrency=$conc"; echo "baseline_before_run: $base";
    echo "git_head=$(git rev-parse HEAD)"; echo "source_tree_sha256=$(git ls-files -co --exclude-standard backend/src backend/scripts database | sort | xargs sha256sum | sha256sum | cut -d' ' -f1)";
    echo "oracle_manifest_sha256=$(sha256sum backend/scripts/spp82/reference/spp65-v2/manifest.json | cut -d' ' -f1)"; sha256sum database/seed/*.sql;
    echo "dispatcher_processes=$nd worker_processes=$nw";
    for p in $(ps -eo pid,args | awk '/(dispatcher|worker)-main/ && !/awk/ {print $1}'); do echo "pid $p env: $(tr '\0' ' ' < /proc/$p/environ | grep -oE '(LIS_DISPATCHER|MIDDLEWARE_WORKER)_[A-Z_]+=[0-9,]+' | tr '\n' ' ')"; done;
    echo "node=$(node -v)"; docker ps --format 'container {{.Names}} {{.Image}} {{.Status}}'; } > $dir/code-and-environment.txt
  echo "[$(date -u +%FT%TZ)] START $name" >> $EV/final/run-all.log
  $S/run-scenario.sh final/$name $scenario $mode $conc
  echo "[$(date -u +%FT%TZ)] END $name :: $(grep -E 'verify_exit|publish_exit' $dir/orchestration.log | tr '\n' ' ') :: after: events=$(DB 'select count(*) from lis.publish_events') delivered=$(DB "select count(*) from integration.exchange_transactions where status='DELIVERED'") emr=$(DB 'select count(*) from emr.lab_results')" >> $EV/final/run-all.log
done
echo "[$(date -u +%FT%TZ)] ALL DONE" >> $EV/final/run-all.log
