#!/usr/bin/env bash
# scripts/set-ai-keys.sh — push AI gateway keys to BOTH secret stores without
# ever writing them to disk, git, or chat logs.
#
# Usage (paste keys at the prompt — they never touch a file):
#   ./scripts/set-ai-keys.sh
# ...then paste the comma-separated keys when asked, or pipe via stdin:
#   echo "$KEYS" | ./scripts/set-ai-keys.sh --stdin
#
# What it sets:
#   1. GitHub repo secret GROQ_API_KEYS (striversahil/ai_pa) → GH Actions runners
#   2. Cloudflare Worker secret GROQ_API_KEYS (founder-os-worker) → Worker/Express gateway
#
# Reads Cloudflare creds from root .env (CLOUDFLARE_API_TOKEN/ACCOUNT_ID) without
# sourcing it (the SSH password contains $@ which bash would expand).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ "${1:-}" = "--stdin" ]; then
  KEYS="$(cat)"
else
  echo -n "Paste comma-separated AI keys (input hidden): " >&2
  IFS= read -rs KEYS
  echo >&2
fi
KEYS="$(echo "$KEYS" | tr -d ' \n\r\t')"
COUNT="$(echo "$KEYS" | awk -F',' '{print NF}')"
if [ -z "$KEYS" ] || [ "$COUNT" -lt 1 ]; then
  echo "No keys provided, aborting." >&2; exit 1
fi
echo "Setting GROQ_API_KEYS with $COUNT key(s)..." >&2

# 1. GitHub Actions secret (NOTE: --body is omitted so gh reads the value
# from stdin. Passing --body - stores the literal string "-" in gh >= 2.46.)
printf '%s' "$KEYS" | gh secret set GROQ_API_KEYS --repo striversahil/ai_pa
echo "GitHub secret GROQ_API_KEYS set." >&2

# 2. Cloudflare Worker secret (parse creds without sourcing .env)
CF_TOKEN="$(grep -m1 '^CLOUDFLARE_API_TOKEN=' "$ROOT/.env" | cut -d= -f2- | tr -d '\"')"
CF_ACCOUNT="$(grep -m1 '^CLOUDFLARE_ACCOUNT_ID=' "$ROOT/.env" | cut -d= -f2- | tr -d '\"')"
if [ -z "$CF_TOKEN" ] || [ -z "$CF_ACCOUNT" ]; then
  echo "Cloudflare creds missing from .env — set the Worker secret manually:" >&2
  echo "  printf '%s' \"\$KEYS\" | npx wrangler secret put GROQ_API_KEYS" >&2
  exit 1
fi
(
  cd "$ROOT/founder-os_backend"
  printf '%s' "$KEYS" | CLOUDFLARE_API_TOKEN="$CF_TOKEN" CLOUDFLARE_ACCOUNT_ID="$CF_ACCOUNT" \
    npx wrangler secret put GROQ_API_KEYS
)
echo "Worker secret GROQ_API_KEYS set." >&2
