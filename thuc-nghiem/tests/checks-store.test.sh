#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/../checks-store.sh"
TEST_DIR=$(mktemp -d /tmp/lis-checks-test.XXXXXX)
trap 'rm -rf "$TEST_DIR"' EXIT
CHECKS="$TEST_DIR/checks.jsonl"
write_checks() {
  local scenario="$1" first="$2" last="$3" n
  for ((n=first;n<=last;n++)); do checks_append "{\"kich_ban\":\"$scenario\",\"ma\":$n}"; done
}
(checks_remove_scenario A; write_checks A 1 100) &
p1=$!
(checks_remove_scenario B; write_checks B 1 100) &
p2=$!
wait "$p1"; wait "$p2"
jq -es 'length == 200 and ([.[] | [.kich_ban,.ma]] | unique | length) == 200' "$CHECKS" >/dev/null
(checks_remove_scenario A; write_checks A 1 100) &
p1=$!
write_checks B 101 200 &
p2=$!
wait "$p1"; wait "$p2"
jq -es 'length == 300 and ([.[] | select(.kich_ban == "B")] | length) == 200 and ([.[] | [.kich_ban,.ma]] | unique | length) == 300' "$CHECKS" >/dev/null
echo 'PASS: concurrent writes and scenario rerun preserve every independent check'
