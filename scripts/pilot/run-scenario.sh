#!/usr/bin/env bash
# usage: PILOT_ENV_FILE=<file-môi-trường> run-scenario.sh <thư-mục-lượt> <nhãn-kịch-bản> <SEQUENTIAL|CONCURRENT> <concurrency>
# <thư-mục-lượt> là đường dẫn tương đối so với PILOT_EVIDENCE_DIR (mặc định docs/docs_backend/spp-73/pilot-evidence).
# SPP-75: bản sửa lỗi mã thoát. Trước đây script luôn trả 0 vì lệnh cuối là echo.
# Mã thoát: 0 = lượt PASS đã được kiểm tra nội dung báo cáo; 3 = đã có artifact (không ghi đè);
#   20 = before capture lỗi; 21 = publish lỗi; 22 = after capture lỗi; 23 = verify lỗi;
#   24 = báo cáo thiếu/hỏng/không PASS; 2 = thiếu tham số.
# Mọi lỗi được ghi vào orchestration.log kèm dòng "RUN_RESULT=FAIL step=... reason=..." và file run-result.txt.
# Biến tùy chọn: PILOT_EXPECTED_COUNT (mặc định 1000).
set -u
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=${PILOT_ROOT:-$(cd "$HERE/../.." && pwd)}
: "${PILOT_ENV_FILE:?Thiếu PILOT_ENV_FILE (file chứa biến môi trường, xem scripts/pilot/pilot.env.example)}"
[ $# -eq 4 ] || { echo "usage: run-scenario.sh <thư-mục-lượt> <nhãn> <MODE> <concurrency>"; exit 2; }
EV=${PILOT_EVIDENCE_DIR:-$ROOT/docs/docs_backend/spp-73/pilot-evidence}
EXPECTED=${PILOT_EXPECTED_COUNT:-1000}
E=$EV/$1
cd "$ROOT/backend" || exit 2
LOG=$E/orchestration.log
RESULT=$E/run-result.txt
mkdir -p "$E"
# Không ghi đè bằng chứng đã có (thư mục có thể đã chứa code-and-environment.txt do run-all.sh tạo).
for f in orchestration.log before.json after.json artifact-82b verification publish-output.jsonl run-result.txt; do
  if [ -e "$E/$f" ]; then echo "REFUSE: $E/$f đã tồn tại (không ghi đè bằng chứng)" >&2; exit 3; fi
done
set -a; . "$PILOT_ENV_FILE"; set +a
O=(--oracle scripts/spp82/reference/spp65-v2/manifest.json --oracle-sha256 55cb4256c77d731bff7e8ea1c1ad7f9788df889b4833d9a6b501282c169c7267)
echo "start $(date -u +%FT%TZ)" > "$LOG"

fail() { # fail <mã> <bước> <lý do>
  echo "RUN_RESULT=FAIL run=$1 step=$3 reason=$4 evidence=$E $(date -u +%FT%TZ)" | tee -a "$LOG" > "$RESULT"
  echo "LỖI lượt $1, bước $3: $4 (bằng chứng: $E)" >&2
  exit "$2"
}

npm run spp82:capture -- "${O[@]}" --phase before --output "$E/before.json" >> "$LOG" 2>&1
rc=$?; echo "before_exit=$rc $(date -u +%FT%TZ)" >> "$LOG"
[ $rc -eq 0 ] && [ -s "$E/before.json" ] || fail "$1" 20 before-capture "exit=$rc hoặc before.json thiếu"

SPP82_MEASURE=1 SPP82_SCENARIO=$2 SPP82_RUN_TIMEOUT_MS=3600000 SPP82_ARTIFACT_DIR=$E/artifact-82b \
  npm run spp82:dry-run -- --confirm-publish --mode "$3" --concurrency "$4" --output "$E/publish-output.jsonl" >> "$LOG" 2>&1
rc=$?; echo "publish_exit=$rc $(date -u +%FT%TZ)" >> "$LOG"
[ $rc -eq 0 ] || fail "$1" 21 publish "exit=$rc"

npm run spp82:capture -- "${O[@]}" --phase after --run-dir "$E/artifact-82b" --output "$E/after.json" >> "$LOG" 2>&1
rc=$?; echo "after_exit=$rc $(date -u +%FT%TZ)" >> "$LOG"
[ $rc -eq 0 ] && [ -s "$E/after.json" ] || fail "$1" 22 after-capture "exit=$rc hoặc after.json thiếu"

npm run spp82:verify -- "${O[@]}" --run-dir "$E/artifact-82b" --before "$E/before.json" --after "$E/after.json" --output "$E/verification" >> "$LOG" 2>&1
rc=$?; echo "verify_exit=$rc $(date -u +%FT%TZ)" >> "$LOG"
[ $rc -eq 0 ] || fail "$1" 23 verify "exit=$rc"

# Kiểm tra nội dung: exit 0 hoặc ACK chưa đủ để coi là PASS.
reason=$(node -e '
const fs=require("fs");const [e,n]=[process.argv[1],Number(process.argv[2])];
const rd=(p)=>{try{return JSON.parse(fs.readFileSync(p,"utf8"))}catch(x){return {__err:p+": "+x.message}}};
const c=rd(e+"/verification/comparison-report.json"),m=rd(e+"/artifact-82b/metrics.json"),r=rd(e+"/artifact-82b/run-manifest.json");
const bad=[];
for(const o of [c,m,r]) if(o.__err) bad.push(o.__err);
if(!c.__err){
  if(c.outcome!=="PASS") bad.push("outcome="+c.outcome);
  if(c.simulated!==false) bad.push("simulated="+c.simulated);
  if(c.total_expected_results!==n) bad.push("total_expected_results="+c.total_expected_results);
  if(c.matched_result_count!==n) bad.push("matched_result_count="+c.matched_result_count);
  for(const k of ["missing_result_count","duplicate_result_count","wrong_patient_linkage_count","field_mismatch_result_count","unexpected_extra_result_count","unverified_result_count","failed_result_count"]) if(c[k]!==0) bad.push(k+"="+c[k]);
}
if(!m.__err){ if(m.planned_count!==n) bad.push("planned_count="+m.planned_count); if(m.completion_count!==n) bad.push("completion_count="+m.completion_count); }
if(!r.__err && r.simulated!==false) bad.push("run-manifest.simulated="+r.simulated);
console.log(bad.join("; "));' "$E" "$EXPECTED" 2>&1)
[ -z "$reason" ] || fail "$1" 24 report-check "$reason"
echo "RUN_RESULT=PASS run=$1 $(date -u +%FT%TZ)" | tee -a "$LOG" > "$RESULT"
exit 0
