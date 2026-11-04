#!/usr/bin/env bash
# SPP-74: kiểm tra trước mỗi lượt thực nghiệm. CHỈ ĐỌC (không reset, không Publish, không ghi DB).
# usage: PILOT_ENV_FILE=<file-môi-trường> scripts/pilot/preflight.sh
# Biến tùy chọn: PILOT_DB_CONTAINER (mặc định lis-fhir-emr-db-1), PILOT_DB_NAME (dacn_db),
#   PILOT_EXPECTED_TAG (mặc định spp75-runner-v2 = runner đã sửa; đặt rỗng để bỏ qua kiểm tag),
#   PILOT_APP_TAG (mặc định spp74-experiment-v1: mã nguồn application/dữ liệu không được khác tag này),
#   PILOT_EXPECTED_BASELINE (mặc định "events=0 exch=0 emr=0 seed=1000 mut=0"; DB pilot SPP-73 là "events=1 exch=1 emr=1 ..."),
#   PILOT_EXPECT_CLEAN_DB=1 (mặc định) hoặc 0 để bỏ qua kiểm baseline (vd. ngay sau một lượt).
# Mã thoát: 0 = mọi kiểm tra đạt; 1 = có kiểm tra FAIL.
set -u
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=${PILOT_ROOT:-$(cd "$HERE/../.." && pwd)}
: "${PILOT_ENV_FILE:?Thiếu PILOT_ENV_FILE}"
CT=${PILOT_DB_CONTAINER:-lis-fhir-emr-db-1}
DBN=${PILOT_DB_NAME:-dacn_db}
TAG=${PILOT_EXPECTED_TAG-spp75-runner-v2}
APP_TAG=${PILOT_APP_TAG-spp74-experiment-v1}   # SPP-75: application/data thuộc bản khóa SPP-74; runner thuộc TAG
BASELINE=${PILOT_EXPECTED_BASELINE:-"events=0 exch=0 emr=0 seed=1000 mut=0"}
CHECK_BASELINE=${PILOT_EXPECT_CLEAN_DB:-1}

# ---- Giá trị đã khóa (nguồn sự thật: docs/docs_backend/spp-74/04-experiment-config.md) ----
SRC_TREE=49e9ebcb66b099760e2b8a6431a01bff66a5e1bbc774cb8ca02213f89cd14e2e
RETRY=2000,4000,8000,16000,32000,64000,64000
declare -A H=(
  [database/seed/01_reference_data.sql]=b66613cf2e1ed1f8d46ce6f0a0efc2efa976532e4e487bf6058ec43e835023e5
  [database/seed/02_lis_results.sql]=28b21b4e19f1df9b79d8ee10944e33e1f1fe20c0045abfd5b5d3fbcd89644fe7
  [database/dacn_db_init_v2.sql]=42d313db34bd54ccedd3b3a60fef734b4f773ced5a0e3ba9b2b0c2414fd87439
  [database/access_roles.sql]=d83ab593c1b0fb99237e7c9122e083f1fdaecae3bb16398f4ecb12992f33c0cb
  [backend/scripts/spp82/reference/spp65-v2/manifest.json]=55cb4256c77d731bff7e8ea1c1ad7f9788df889b4833d9a6b501282c169c7267
  [backend/scripts/spp82/reference/spp65-v2/expected.jsonl]=a421c3c2facb4d45946d44d533365339fe4d4375b2d61a9551326130311fe772
  [backend/scripts/spp82/reference/spp65-v2/patient-links.json]=a93970b2a011f3cb50295554feec2fed52e7fb499f3d36811e7529a4e5992adf
  [backend/scripts/spp82/reference/spp65-v2/rules.json]=a3580b4c62caf2d28c33ecdcacbee27ab6209c12af5d7c5cb232bd81a0cdca80
  [backend/scripts/spp82/reference/spp65-v2/upstream-answers.csv]=8e93c46edcab5a6d4e5d2e06fb8260958590a2b55c2242118fe89525e2fc318a
  [backend/package-lock.json]=524842e3cf639aee7e94ac226fd9e6eb7d8d0ea54d9ca119924bad501b880466
)

fail=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; fail=1; }
cd "$ROOT" || exit 1
DB() { docker exec "$CT" psql -U postgres -d "$DBN" -Atc "$1"; }

# 1. Git
if [ -z "$(git status --porcelain)" ]; then ok "git: working tree sạch"; else bad "git: còn thay đổi chưa commit"; fi
if [ -n "$TAG" ]; then
  # HEAD có thể đứng sau TAG (chỉ thêm tài liệu); runner (scripts/pilot) không được khác TAG.
  if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && git merge-base --is-ancestor "$TAG" HEAD \
     && git diff --quiet "$TAG" HEAD -- scripts/pilot; then
    ok "git: runner (scripts/pilot) đúng tag $TAG; HEAD=$(git rev-parse --short HEAD)"
  else bad "git: runner khác tag $TAG hoặc tag không phải tổ tiên của HEAD"; fi
else echo "SKIP  git: không kiểm tag (PILOT_EXPECTED_TAG rỗng); HEAD=$(git rev-parse --short HEAD)"; fi
if [ -n "$APP_TAG" ]; then
  if git rev-parse -q --verify "refs/tags/$APP_TAG" >/dev/null && git merge-base --is-ancestor "$APP_TAG" HEAD \
     && git diff --quiet "$APP_TAG" HEAD -- backend/src backend/scripts database backend/package.json backend/package-lock.json; then
    ok "application/data/oracle không đổi so với tag $APP_TAG"
  else bad "application/data/oracle KHÁC tag $APP_TAG (hoặc tag không tồn tại / không phải tổ tiên của HEAD)"; fi
fi
# 2. Mã nguồn
t=$(git ls-files -co --exclude-standard backend/src backend/scripts database | sort | xargs sha256sum | sha256sum | cut -d' ' -f1)
[ "$t" = "$SRC_TREE" ] && ok "source_tree_sha256 = ${SRC_TREE:0:12}…" || bad "source_tree_sha256 khác ($t)"
# 3. Dữ liệu, oracle, lockfile
for f in "${!H[@]}"; do
  a=$(sha256sum "$f" 2>/dev/null | cut -d' ' -f1)
  [ "$a" = "${H[$f]}" ] && ok "sha256 $f" || bad "sha256 $f khác ($a)"
done
# 4. Dịch vụ sẵn sàng
set -a; . "$PILOT_ENV_FILE"; set +a
for u in "$LIS_BASE_URL" "$MIDDLEWARE_BASE_URL" "$EMR_BASE_URL"; do
  c=$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$u/ready"); [ "$c" = 200 ] && ok "ready $u" || bad "ready $u -> $c"
done
# 5. Dispatcher/Worker: đúng 1+1, đúng cấu hình retry, không đặt biến chỉnh khác
nd=$(ps -eo args | grep -c '[l]is/dispatcher-main'); nw=$(ps -eo args | grep -c '[m]iddleware/worker-main')
[ "$nd" = 1 ] && [ "$nw" = 1 ] && ok "tiến trình: 1 Dispatcher + 1 Worker" || bad "tiến trình: dispatcher=$nd worker=$nw"
for p in $(ps -eo pid,args | awk '/(dispatcher|worker)-main/ && !/awk/ {print $1}'); do
  e=$(tr '\0' '\n' < /proc/$p/environ | grep -E '^(LIS_DISPATCHER|MIDDLEWARE_WORKER)_' | sort | tr '\n' ' ')
  case "$e" in
    "LIS_DISPATCHER_RETRY_DELAYS_MS=$RETRY "|"MIDDLEWARE_WORKER_RETRY_DELAYS_MS=$RETRY ") ok "pid $p: $e";;
    *) bad "pid $p: biến cấu hình khác khóa: '$e'";;
  esac
done
# 6. Guard cô lập
tok=${SPP82_VERIFICATION_ISOLATION_TOKEN:-}
[[ "$tok" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] && ok "token cô lập có dạng UUID" || bad "token cô lập phải là UUID (spp82:capture từ chối nếu không)"
m=$(DB "select shobj_description(oid,'pg_database') from pg_database where datname='$DBN'" 2>/dev/null)
[ -n "$tok" ] && [ "$m" = "spp66-disposable:$tok" ] && ok "guard cô lập khớp token (DB $DBN, container $CT)" || bad "guard cô lập KHÔNG khớp"
# 7. Baseline
if [ "$CHECK_BASELINE" = 1 ]; then
  b="events=$(DB 'select count(*) from lis.publish_events') exch=$(DB 'select count(*) from integration.exchange_transactions') emr=$(DB 'select count(*) from emr.lab_results') seed=$(DB "select count(*) from lis.results where provenance->>'seed_tag'='DACN-MIMIC22-SOURCE-ALIGNED-V2'") mut=$(DB "select count(*) from lis.results where result_id like 'MUT-%'")"
  [ "$b" = "$BASELINE" ] && ok "baseline: $b" || bad "baseline '$b' khác '$BASELINE' (cần reset?)"
fi
echo "---"; [ $fail = 0 ] && echo "PREFLIGHT: PASS" || echo "PREFLIGHT: FAIL"
exit $fail
