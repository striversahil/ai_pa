#!/bin/bash
# Secure entrypoint for Founder OS frontend dev server.
#
# WHY: Next 16.2.9's default Turbopack dev server leaks memory (~+200MB/min
# while idle — RSS reached 5.5GB and OOM-killed the process). Webpack is flat.
# This wrapper fails FAST if the --webpack flag ever gets dropped/silently
# ignored by a future Next version, so we never regress to Turbopack silently.

set -euo pipefail

NEXT_BIN="/home/sahil/development/ai_pa/founder-os_frontend/node_modules/.bin/next"

# 1. Confirm the webpack switch actually exists in this Next build.
if ! "$NEXT_BIN" dev --help 2>&1 | grep -q -- "--webpack"; then
  echo "ERROR: 'next dev --webpack' is no longer supported by this Next version." >&2
  echo "Re-test memory behavior; if Turbopack is patched, remove the guard in $0" >&2
  exit 90
fi

# 2. Run with NODE_OPTIONS heap cap from the service environment (if set).
exec "$NEXT_BIN" dev --webpack --port 3000