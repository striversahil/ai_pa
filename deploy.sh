#!/bin/bash
# ──────────────────────────────────────────────────────────────
# deploy.sh — Canonical deploy script for Founder OS
# Usage: ./deploy.sh
#
# This script ensures a clean, reproducible Docker build by:
#   1. Clearing auto-generated local artifacts that must NOT be
#      volume-mounted into the container (they are built inside Docker)
#   2. Building the Docker image with BuildKit enabled (fast cached builds)
#   3. Starting containers with the fresh image
# ──────────────────────────────────────────────────────────────

set -e  # Exit immediately on any error

echo "🧹 Clearing stale local artifacts..."
# These directories are generated INSIDE Docker — never serve them as volumes
rm -rf founder-os_backend/public
mkdir -p founder-os_backend/public
echo "   ✓ founder-os_backend/public cleared"

echo ""
echo "🐳 Building Docker image (BuildKit enabled)..."
DOCKER_BUILDKIT=1 docker-compose up --build -d

echo ""
echo "✅ Deploy complete! Container is running at http://localhost:3000"
