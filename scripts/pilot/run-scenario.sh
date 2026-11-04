#!/usr/bin/env bash
# usage: PILOT_ENV_FILE=<file-môi-trường> run-scenario.sh <thư-mục-lượt> <nhãn-kịch-bản> <SEQUENTIAL|CONCURRENT> <concurrency>
# <thư-mục-lượt> là đường dẫn tương đối so với PILOT_EVIDENCE_DIR (mặc định docs/docs_backend/spp-73/pilot-evidence).
# Logic giống bản đã chạy ở SPP-73; SPP-74 chỉ thay đường dẫn tuyệt đối/scratchpad bằng biến môi trường.
set -u
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=${PILOT_ROOT:-$(cd "$HERE/../.." && pwd)}
: "${PILOT_ENV_FILE:?Thiếu PILOT_ENV_FILE (file chứa biến môi trường, xem tools/pilot.env.example)}"
EV=${PILOT_EVIDENCE_DIR:-$ROOT/docs/docs_backend/spp-73/pilot-evidence}
cd "$ROOT/backend"
E=$EV/$1
set -a; . "$PILOT_ENV_FILE"; set +a
O=(--oracle scripts/spp82/reference/spp65-v2/manifest.json --oracle-sha256 55cb4256c77d731bff7e8ea1c1ad7f9788df889b4833d9a6b501282c169c7267)
echo "start $(date -u +%FT%TZ)" > $E/orchestration.log
npm run spp82:capture -- "${O[@]}" --phase before --output $E/before.json >> $E/orchestration.log 2>&1
SPP82_MEASURE=1 SPP82_SCENARIO=$2 SPP82_RUN_TIMEOUT_MS=3600000 SPP82_ARTIFACT_DIR=$E/artifact-82b \
  npm run spp82:dry-run -- --confirm-publish --mode $3 --concurrency $4 --output $E/publish-output.jsonl >> $E/orchestration.log 2>&1
echo "publish_exit=$? $(date -u +%FT%TZ)" >> $E/orchestration.log
npm run spp82:capture -- "${O[@]}" --phase after --run-dir $E/artifact-82b --output $E/after.json >> $E/orchestration.log 2>&1
npm run spp82:verify -- "${O[@]}" --run-dir $E/artifact-82b --before $E/before.json --after $E/after.json --output $E/verification >> $E/orchestration.log 2>&1
echo "verify_exit=$? $(date -u +%FT%TZ)" >> $E/orchestration.log
