#!/bin/bash

# Run each dev server in its own process group so Ctrl+C (via the trap below)
# reliably kills the whole tree. Plain 'kill 0' is NOT enough: npm/next spawn
# worker processes that survive and keep holding their ports.
set -m

# Cleanup: Ctrl+C often orphans the previous run's dev servers (backend
# while-loop respawns ts-node, next dev leaves next-server on :3000). Kill the
# parent loops first, then anything still holding the dev ports.
kill_port_listeners() {
  local port=$1
  # fuser handles both IPv4 and IPv6 wildcard listeners (lsof can miss IPv6)
  fuser -k "${port}/tcp" 2>/dev/null || true
  sleep 1
  # Fallback if fuser is unavailable or a process is still holding the port
  pids=$(lsof -ti "tcp:${port}" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 1
    pids=$(lsof -ti "tcp:${port}" 2>/dev/null || true)
    if [ -n "$pids" ]; then
      # shellcheck disable=SC2086
      kill -9 $pids 2>/dev/null || true
    fi
  fi
}

echo "🧹 Cleaning up stale dev servers from a previous run..."
pkill -f 'npx ts-node src/server.ts' 2>/dev/null
pkill -f 'next dev -p 3000' 2>/dev/null
sleep 1
kill_port_listeners 3000
kill_port_listeners 5000

echo "🐘 Starting PostgreSQL database container..."
docker-compose up -d db

echo "⏳ Waiting for database to be ready..."
until docker exec founder-os-db pg_isready -U postgres >/dev/null 2>&1; do
  sleep 1
done
echo "✅ Database is online!"

# Sync Prisma Schema
echo "⚙️ Syncing database schema with Prisma..."
cd founder-os_backend
npx prisma db push --accept-data-loss
cd ..

echo "🚀 Starting local development servers directly on host Mac..."
echo "👉 Express Backend API: http://localhost:5000"
echo "👉 Next.js Frontend Dashboard: http://localhost:3000"
echo ""

# Load environment variables from backend .env
if [ -f founder-os_backend/.env ]; then
  export $(grep -v '^#' founder-os_backend/.env | xargs)
fi

# Run backend with pnpm
(cd founder-os_backend && pnpm run dev) &
BACKEND_PID=$!

# Run frontend with npm (explicitly specifying port 3000 to avoid port 5000 conflict)
(cd founder-os_frontend && npm run dev -- -p 3000) &
FRONTEND_PID=$!

# Kill every dev server (and its whole process group) on Ctrl+C / normal exit.
# Escalate INT -> TERM -> KILL so npm/next workers actually die; pre-start
# cleanup above remains the guarantee against port conflicts.
_cleanup_dev='if [ -z "$_CLEANUP_DONE" ]; then _CLEANUP_DONE=1; echo "Shutting down dev servers..."; kill -INT -- -$BACKEND_PID -$FRONTEND_PID 2>/dev/null; sleep 1; kill -TERM -- -$BACKEND_PID -$FRONTEND_PID 2>/dev/null; sleep 1; kill -KILL -- -$BACKEND_PID -$FRONTEND_PID 2>/dev/null; fi'
trap "$_cleanup_dev; exit 0" INT TERM EXIT

# Start public tunnel for WhatsApp webhooks if configured
if [ "$TUNNEL_PROVIDER" = "localtunnel" ]; then
  SUBDOMAIN_FLAG=""
  if [ ! -z "$TUNNEL_SUBDOMAIN" ]; then
    SUBDOMAIN_FLAG="--subdomain $TUNNEL_SUBDOMAIN"
  fi
  echo "🔌 Starting Localtunnel on port 5000..."
  npx localtunnel --port 5000 $SUBDOMAIN_FLAG > /tmp/localtunnel.log 2>&1 &
  # Poll up to 15 seconds for URL resolution
  LT_URL=""
  for i in {1..15}; do
    sleep 1
    LT_URL=$(grep -o 'https://[^ ]*loca[^ ]*' /tmp/localtunnel.log | head -n 1)
    if [ ! -z "$LT_URL" ]; then
      break
    fi
  done
  if [ ! -z "$LT_URL" ]; then
    echo "🔗 Localtunnel Webhook URL: $LT_URL/api/whatsapp/webhook"
  else
    echo "⚠️ Failed to resolve Localtunnel URL. Check /tmp/localtunnel.log"
  fi
elif [ "$TUNNEL_PROVIDER" = "ngrok" ]; then
  if [ ! -z "$NGROK_AUTHTOKEN" ]; then
    npx ngrok config add-authtoken $NGROK_AUTHTOKEN >/dev/null 2>&1
  fi
  NGROK_FLAG=""
  if [ ! -z "$NGROK_DOMAIN" ]; then
    NGROK_FLAG="--domain $NGROK_DOMAIN"
  fi
  echo "🔌 Starting Ngrok tunnel on port 5000..."
  npx ngrok http 5000 $NGROK_FLAG >/dev/null 2>&1 &
  # Poll up to 15 seconds for URL resolution
  NGROK_URL=""
  for i in {1..15}; do
    sleep 1
    NGROK_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | grep -o 'https://[^"]*ngrok-free[^"]*' | head -n 1)
    if [ ! -z "$NGROK_URL" ]; then
      break
    fi
  done
  if [ ! -z "$NGROK_URL" ]; then
    echo "🔗 Ngrok Webhook URL: $NGROK_URL/api/whatsapp/webhook"
  else
    echo "⚠️ Failed to resolve Ngrok URL. Make sure ngrok authtoken is configured."
  fi
fi

# Wait for background processes to run
wait $BACKEND_PID $FRONTEND_PID
