#!/usr/bin/env bash
# waba-worker/install/setup.sh — installs the local AI processing queue runner
# as a systemd service that auto-starts on boot and restarts on crash.
#
# Prereqs: node (>=18), curl, systemd, and a filled-in local-runner.env.
set -euo pipefail

SERVICE_SRC="$(dirname "$0")/local-runner.service"
ENV_FILE="/home/sahil/development/ai_pa/local-runner.env"
RUNNER_DIR="/home/sahil/development/ai_pa"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found. Copy local-runner.env.example to local-runner.env and fill in CRON_SECRET + OMNIROUTE_API_KEY first." >&2
  exit 1
fi

echo "Installing service..."
sudo cp "$SERVICE_SRC" /etc/systemd/system/whatsapp-ai-runner.service
sudo chmod 600 "$ENV_FILE"
sudo systemctl daemon-reload
sudo systemctl enable whatsapp-ai-runner.service
sudo systemctl restart whatsapp-ai-runner.service

echo "Service installed. Check status with:"
echo "  systemctl status whatsapp-ai-runner"
echo "  tail -f $RUNNER_DIR/local-runner.log"