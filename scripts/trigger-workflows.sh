#!/usr/bin/env bash
set -euo pipefail

# trigger-workflows.sh — fire workflow_dispatch for all recurring workflows.
# Intended to be called by an EXTERNAL cron service (cron-job.org, UptimeRobot)
# because GitHub Actions `schedule` is unreliable (runs are delayed ~30-40 min
# in practice). Set GITHUB_PAT to a fine-grained token with Actions: write.
#
# Usage:
#   GITHUB_PAT=... ./scripts/trigger-workflows.sh <every-5min|every-10min|every-15min|every-30min|daily|all>
#
# Cron schedules to configure externally:
#   every-5min:   */5 * * * *
#   every-10min:  */10 * * * *
#   every-15min:  */15 * * * *
#   every-30min:  */30 * * * *
#   daily:        30 2,3,13,21 * * *   (IST 08:00, 08:30, 18:30, 03:00)

REPO="${GITHUB_REPO:-striversahil/ai_pa}"
BRANCH="${GITHUB_BRANCH:-main}"
PAT="${GITHUB_PAT:-}"

if [[ -z "$PAT" ]]; then
  echo "error: GITHUB_PAT is required (fine-grained token with Actions: write)" >&2
  exit 1
fi

trigger() {
  local workflow="$1"
  local inputs="$2"
  local body
  if [[ -n "$inputs" ]]; then
    body=$(printf '{"ref":"%s","inputs":%s}' "$BRANCH" "$inputs")
  else
    body=$(printf '{"ref":"%s"}' "$BRANCH")
  fi
  echo "triggering $workflow"
  curl -fsS -X POST \
    -H "Authorization: Bearer $PAT" \
    -H "Accept: application/vnd.github+json" \
    -H "Content-Type: application/json" \
    -d "$body" \
    "https://api.github.com/repos/$REPO/actions/workflows/$workflow/dispatches"
}

TARGET="${1:-all}"

case "$TARGET" in
  every-5min)   trigger "cron-every-5min.yml" "" ;;
  every-10min)  trigger "cron-every-10min.yml" "" ;;
  every-15min)  trigger "cron-every-15min.yml" '{"force":"1"}' ;;
  every-30min)  trigger "cron-every-30min.yml" "" ;;
  daily)        trigger "cron-daily-ist.yml" "" ;;
  all)
    trigger "cron-every-5min.yml" ""
    trigger "cron-every-10min.yml" ""
    trigger "cron-every-15min.yml" '{"force":"1"}'
    trigger "cron-every-30min.yml" ""
    trigger "cron-daily-ist.yml" ""
    ;;
  *) echo "usage: $0 <every-5min|every-15min|every-30min|daily|all>"; exit 2 ;;
esac

echo "done"