#!/usr/bin/env bash
# Parse both Node TAP/spec reporters. Failed processes cannot produce a PASS verdict.
test_sum() {
  awk -v name="$2" '($1 == "#" || $1 == "ℹ") && $2 == name && $3 ~ /^[0-9]+$/ {sum += $3} END {print sum+0}' "$1"
}
test_pick() {
  awk -v pattern="$2" '
    /^[[:space:]]*[✔✖] / && $0 ~ pattern {sub(/^[[:space:]]*✔ /,"ok - "); sub(/^[[:space:]]*✖ /,"not ok - "); print; next}
    /^[[:space:]]*(not )?ok [0-9]+ - / && $0 ~ pattern {sub(/^[[:space:]]*/,""); sub(/^ok [0-9]+ - /,"ok - "); sub(/^not ok [0-9]+ - /,"not ok - "); print}
  ' "$1" | sort -u
}
test_run_passed() { [ "$1" = 0 ] && [ "$2" -gt 0 ] && [ "$3" = 0 ]; }
