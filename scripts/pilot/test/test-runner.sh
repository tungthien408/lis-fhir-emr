#!/usr/bin/env bash
# SPP-75: kiểm thử đường lỗi của run-scenario.sh và run-all.sh bằng npm/docker/ps giả.
# KHÔNG chạm DB, dịch vụ hay Publish thật. Chạy: bash scripts/pilot/test/test-runner.sh
set -u
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PILOT=$(cd "$HERE/.." && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/root/backend" "$T/root/scripts/pilot"
TOKEN=11111111-2222-3333-4444-555555555555
printf 'SPP82_VERIFICATION_ISOLATION_TOKEN=%s\n' "$TOKEN" > "$T/env"
cp "$PILOT/run-scenario.sh" "$PILOT/run-all.sh" "$T/root/scripts/pilot/"; : > "$T/root/scripts/pilot/reset.sql"
(cd "$T/root" && git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m x)

cat > "$T/bin/npm" <<'M'
#!/usr/bin/env bash
# giả lập: MOCK_FAIL=<before|publish|after|verify>, MOCK_REPORT=<ok|fail|notverified|missing|corrupt|zero_exit_fail>, MOCK_FAIL_RUN=<tên lượt>
cmd=$2; out=""; rundir=""; prev=""
for a in "$@"; do [ "$prev" = --output ] && out=$a; prev=$a; done
case "${PWD}:${MOCK_FAIL_RUN:-}" in *) ;; esac
run=$(basename "$(dirname "$out")" 2>/dev/null)
[ -n "${MOCK_FAIL_RUN:-}" ] && [ "$run" != "$MOCK_FAIL_RUN" ] && [ "$cmd" != spp82:dry-run ] && MOCK_FAIL_ACTIVE=0 || MOCK_FAIL_ACTIVE=1
case "$cmd" in
  spp82:capture) ph=before; echo "$*" | grep -q 'phase after' && ph=after
    [ "$MOCK_FAIL_ACTIVE" = 1 ] && [ "${MOCK_FAIL:-}" = "$ph" ] && { echo "capture boom"; exit 5; }
    echo "{\"phase\":\"$ph\"}" > "$out";;
  spp82:dry-run) d=$SPP82_ARTIFACT_DIR
    # tên lượt lấy từ đường dẫn artifact: .../final/<RUN>/artifact-82b
    r=$(basename "$(dirname "$d")")
    [ "${MOCK_FAIL:-}" = publish ] && [ "${MOCK_FAIL_RUN:-$r}" = "$r" ] && { echo "publish boom"; exit 6; }
    mkdir -p "$d"; echo '{"planned_count":1000,"completion_count":1000}' > "$d/metrics.json"; echo '{"simulated":false}' > "$d/run-manifest.json";;
  spp82:verify) r=$(basename "$(dirname "$out")")
    [ "${MOCK_FAIL:-}" = verify ] && [ "${MOCK_FAIL_RUN:-$r}" = "$r" ] && { echo "verify boom"; exit 7; }
    mkdir -p "$out"; good='{"outcome":"PASS","simulated":false,"total_expected_results":1000,"matched_result_count":1000,"missing_result_count":0,"duplicate_result_count":0,"wrong_patient_linkage_count":0,"field_mismatch_result_count":0,"unexpected_extra_result_count":0,"unverified_result_count":0,"failed_result_count":0}'
    rep=${MOCK_REPORT:-ok}
    [ -n "${MOCK_FAIL_RUN:-}" ] && [ "$r" != "$MOCK_FAIL_RUN" ] && rep=ok
    case $rep in
      ok) echo "$good" > "$out/comparison-report.json";;
      fail|zero_exit_fail) echo "${good/PASS/FAIL}" > "$out/comparison-report.json";;
      notverified) echo "${good/PASS/NOT_VERIFIED}" > "$out/comparison-report.json";;
      corrupt) echo '{not json' > "$out/comparison-report.json";;
      missing) :;;
      matched) echo "${good/\"matched_result_count\":1000/\"matched_result_count\":999}" > "$out/comparison-report.json";;
    esac;;
esac
exit 0
M
sed -i 's/exit 0_ok/exit 0/' "$T/bin/npm"
cat > "$T/bin/docker" <<'M'
#!/usr/bin/env bash
q="${*: -1}"
case "$q" in
  *shobj_description*) echo "spp66-disposable:11111111-2222-3333-4444-555555555555";;
  *publish_events*) echo 0;; *exchange_transactions*) echo 0;; *emr.lab_results*) echo 0;;
  *seed_tag*) echo 1000;; *"MUT-%"*) echo 0;; *server_version*) echo 16;;
esac
exit 0
M
cat > "$T/bin/ps" <<'M'
#!/usr/bin/env bash
[ "$2" = args ] && printf 'node lis/dispatcher-main.js\nnode middleware/worker-main.js\n'
exit 0
M
chmod +x "$T/bin/"*
export PATH="$T/bin:$PATH" PILOT_ROOT="$T/root" PILOT_ENV_FILE="$T/env"

pass=0; failn=0
check() { if [ "$2" = "$3" ]; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1 (mong đợi '$3', thực tế '$2')"; failn=$((failn+1)); fi; }
newev() { export PILOT_EVIDENCE_DIR="$T/ev-$1"; rm -rf "$PILOT_EVIDENCE_DIR"; mkdir -p "$PILOT_EVIDENCE_DIR/final/A1"; }
scen() { bash "$T/root/scripts/pilot/run-scenario.sh" final/A1 lbl SEQUENTIAL 1 >/dev/null 2>&1; echo $?; }

newev ok; unset MOCK_FAIL MOCK_REPORT MOCK_FAIL_RUN
check "lượt hợp lệ trả 0" "$(scen)" 0
check "ghi RUN_RESULT=PASS" "$(grep -c RUN_RESULT=PASS "$PILOT_EVIDENCE_DIR/final/A1/run-result.txt")" 1

for s in before:20 publish:21 after:22 verify:23; do
  newev $s; MOCK_FAIL=${s%%:*} check "bước ${s%%:*} lỗi -> mã ${s##*:}" "$(MOCK_FAIL=${s%%:*} scen)" "${s##*:}"
  check "  log lỗi được giữ (${s%%:*})" "$(grep -c 'RUN_RESULT=FAIL' "$PILOT_EVIDENCE_DIR/final/A1/orchestration.log")" 1
  check "  log chứa đầu ra lệnh lỗi" "$(grep -c boom "$PILOT_EVIDENCE_DIR/final/A1/orchestration.log")" 1
done
for r in fail notverified missing corrupt matched; do
  newev r$r; check "verify exit 0 nhưng báo cáo '$r' -> 24" "$(MOCK_REPORT=$r scen)" 24
  check "  không có RUN_RESULT=PASS ($r)" "$(grep -c RUN_RESULT=PASS "$PILOT_EVIDENCE_DIR/final/A1/orchestration.log")" 0
done
newev exist; echo old > "$PILOT_EVIDENCE_DIR/final/A1/before.json"
check "đã có artifact -> từ chối (3)" "$(scen)" 3
check "  bằng chứng cũ còn nguyên" "$(cat "$PILOT_EVIDENCE_DIR/final/A1/before.json")" old

# run-all: chuỗi A1 B1 A2... , lượt B1 hỏng giữa chuỗi
newev all; rm -rf "$PILOT_EVIDENCE_DIR/final"
all() { PILOT_RUNS="${PILOT_RUNS:-A1 B1 A2}" bash "$T/root/scripts/pilot/run-all.sh" >/dev/null 2>&1; echo $?; }
check "run-all mọi lượt PASS -> 0" "$(all)" 0
check "  có ALL DONE" "$(grep -c 'ALL DONE' "$PILOT_EVIDENCE_DIR/final/run-all.log")" 1
newev all2; rm -rf "$PILOT_EVIDENCE_DIR/final"
check "run-all: B1 verify lỗi giữa chuỗi -> 10" "$(MOCK_FAIL=verify MOCK_FAIL_RUN=B1 all)" 10
check "  KHÔNG có ALL DONE giả" "$(grep -c 'ALL DONE' "$PILOT_EVIDENCE_DIR/final/run-all.log")" 0
check "  có ABORTED" "$(grep -c 'ABORTED at B1' "$PILOT_EVIDENCE_DIR/final/run-all.log")" 1
check "  A1 còn nguyên bằng chứng" "$([ -s "$PILOT_EVIDENCE_DIR/final/A1/run-result.txt" ] && echo yes)" yes
check "  A2 không được chạy" "$([ -e "$PILOT_EVIDENCE_DIR/final/A2" ] && echo yes || echo no)" no
check "  log B1 được giữ" "$(grep -c 'RUN_RESULT=FAIL' "$PILOT_EVIDENCE_DIR/final/B1/orchestration.log")" 1
newev all3
check "run-all: thư mục lượt đã tồn tại -> 3" "$(mkdir -p "$PILOT_EVIDENCE_DIR/final/A1" && all)" 3
check "run-all: không lượt nào chạy -> 11" "$(PILOT_RUNS=Z9 all)" 11
echo "--- $pass PASS, $failn FAIL"; [ $failn = 0 ]
