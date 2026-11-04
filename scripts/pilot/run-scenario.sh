#!/usr/bin/env bash
# usage: run-scenario.sh <dirname> <scenario-label> <mode> <concurrency>
set -u
cd /home/thien408/Projects/2026-2027/dacn/lis-fhir-emr/backend
S=/tmp/claude-1000/-home-thien408-Projects-2026-2027-dacn-lis-fhir-emr/c8fe7937-ffd6-4f42-9242-8324d0ba4db8/scratchpad
E=../docs/docs_backend/spp-73/pilot-evidence/$1
set -a; . $S/pilot.env; set +a
O=(--oracle scripts/spp82/reference/spp65-v2/manifest.json --oracle-sha256 55cb4256c77d731bff7e8ea1c1ad7f9788df889b4833d9a6b501282c169c7267)
echo "start $(date -u +%FT%TZ)" > $E/orchestration.log
npm run spp82:capture -- "${O[@]}" --phase before --output $E/before.json >> $E/orchestration.log 2>&1
SPP82_MEASURE=1 SPP82_SCENARIO=$2 SPP82_RUN_TIMEOUT_MS=3600000 SPP82_ARTIFACT_DIR=$E/artifact-82b \
  npm run spp82:dry-run -- --confirm-publish --mode $3 --concurrency $4 --output $E/publish-output.jsonl >> $E/orchestration.log 2>&1
echo "publish_exit=$? $(date -u +%FT%TZ)" >> $E/orchestration.log
npm run spp82:capture -- "${O[@]}" --phase after --run-dir $E/artifact-82b --output $E/after.json >> $E/orchestration.log 2>&1
npm run spp82:verify -- "${O[@]}" --run-dir $E/artifact-82b --before $E/before.json --after $E/after.json --output $E/verification >> $E/orchestration.log 2>&1
echo "verify_exit=$? $(date -u +%FT%TZ)" >> $E/orchestration.log
