#!/usr/bin/env bash
# dev-sync.sh — workshop → consumer sync helper for the local-clone setup.
#
# Runs the long-term maintenance protocol documented in
# Docs/agent-guides/vault-paths.md § "Consumer workshop resolution".
#
# Sequence:
#   1. Workshop sanity (clean tree, up to date with origin/main, harness PASS)
#   2. For each consumer vault: bump pins + sauce status
#
# Exit codes:
#   0  all consumers in sync, drift: none
#   1  workshop has uncommitted changes
#   2  workshop is ahead/behind origin/main
#   3  harness failed
#   4  one or more consumers reported drift
#
# Edit CONSUMERS array to include/exclude vaults. Default covers the three
# day-to-day vaults on this machine.

set -euo pipefail

WORKSHOP="/Users/willfellhoelter/projects/repos/sauce"
CONSUMERS=(
  "/Users/willfellhoelter/notes/sauce/headspace-sauce"
  "/Users/willfellhoelter/notes/sauce/accuris-sauce"
  # "/Users/willfellhoelter/notes/sauce/ero-sauce"          # uncomment when needed
  # "/Users/willfellhoelter/notes/sauce/barebones"          # uncomment when needed
)

red() { printf "\033[31m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
header() { printf "\n\033[1m=== %s ===\033[0m\n" "$*"; }

header "1. Workshop sanity"
cd "$WORKSHOP"

if [[ -n "$(git status --porcelain)" ]]; then
  red "FAIL: workshop has uncommitted changes:"
  git status --short
  exit 1
fi

git fetch origin --quiet
ahead=$(git rev-list --count origin/main..HEAD)
behind=$(git rev-list --count HEAD..origin/main)

if [[ "$ahead" -ne 0 || "$behind" -ne 0 ]]; then
  red "FAIL: workshop diverged from origin/main (ahead=$ahead, behind=$behind)"
  exit 2
fi

head_sha=$(git rev-parse --short HEAD)
head_tag=$(git describe --tags --exact-match HEAD 2>/dev/null || echo "<no tag>")
green "Workshop: $head_sha ($head_tag) — clean + synced with origin/main"

header "2. Harness gate"
if ! node platform/test/run-helper-cases.js > /tmp/dev-sync-harness.log 2>&1; then
  red "FAIL: harness reported failures. See /tmp/dev-sync-harness.log."
  tail -10 /tmp/dev-sync-harness.log
  exit 3
fi
green "$(tail -1 /tmp/dev-sync-harness.log)"

drift_count=0

for vault in "${CONSUMERS[@]}"; do
  header "Consumer: $(basename "$vault")"
  if [[ ! -d "$vault" ]]; then
    yellow "SKIP: $vault not present"
    continue
  fi

  cd "$vault"
  sauce update --bump-pins 2>&1 | tail -3 || true
  status_output=$(sauce status 2>&1)
  echo "$status_output" | tail -8

  if echo "$status_output" | grep -q "Drift:.*none"; then
    green "  -> drift: none"
  else
    red "  -> DRIFT DETECTED"
    drift_count=$((drift_count + 1))
  fi
done

header "Summary"
if [[ "$drift_count" -eq 0 ]]; then
  green "All consumers in sync with workshop $head_sha ($head_tag)."
  echo "Cmd+R in Obsidian on each vault to load fresh CustomJS classes."
  exit 0
else
  red "$drift_count consumer(s) reported drift. Investigate manually."
  exit 4
fi
