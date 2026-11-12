#!/usr/bin/env bash
# Pure helpers: read/replace/append operations share the same lock.
checks_append() (
  flock -x 9
  printf '%s\n' "$1" >> "$CHECKS"
) 9>"$CHECKS.lock"

checks_remove_scenario() (
  flock -x 9
  local temp
  temp=$(mktemp "$CHECKS.tmp.XXXXXX")
  trap 'rm -f "$temp"' EXIT
  if [ -f "$CHECKS" ]; then
    jq -c --arg scenario "$1" 'select(.kich_ban != $scenario)' "$CHECKS" > "$temp"
  fi
  mv "$temp" "$CHECKS"
) 9>"$CHECKS.lock"
