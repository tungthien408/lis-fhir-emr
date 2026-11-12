#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/../test-log.sh"
TEST_DIR=$(mktemp -d /tmp/lis-log-test.XXXXXX)
trap 'rm -rf "$TEST_DIR"' EXIT
printf '# tests 2\n# pass 1\n# fail 1\nok 1 - timeout\nnot ok 2 - mismatch\n' > "$TEST_DIR/tap"
printf 'ℹ tests 2\nℹ pass 1\nℹ fail 1\n✔ timeout (1ms)\n✖ mismatch (1ms)\n' > "$TEST_DIR/spec"
for format in tap spec; do
  [ "$(test_sum "$TEST_DIR/$format" tests)" = 2 ]
  [ "$(test_sum "$TEST_DIR/$format" fail)" = 1 ]
  [ "$(test_pick "$TEST_DIR/$format" 'timeout|mismatch' | wc -l)" = 2 ]
  ! test_run_passed 0 2 1
done
! test_run_passed 1 2 0
! test_run_passed 0 0 0
test_run_passed 0 2 0
echo 'PASS: TAP/spec counts, evidence extraction and failed/empty process guards'
