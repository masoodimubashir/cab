#!/usr/bin/env bash
# ===========================================================================
# One-shot (re)deploy of the DreamCabs backend on the server.
# Run from the backend/ directory:   bash deploy/deploy.sh
# Safe to re-run for every update: pull → rebuild → restart, DB is preserved.
# ===========================================================================
set -euo pipefail
cd "$(dirname "$0")/.."   # -> backend/

echo "==> Checking prerequisites…"
command -v docker >/dev/null || { echo "Docker is not installed. See DEPLOY.md step 2."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required."; exit 1; }

if [ ! -f .env ]; then
  echo "==> No .env found — creating from .env.production.example."
  cp .env.production.example .env
  echo "!!! Edit .env now (passwords, APP_URL, Reverb secret) then re-run this script."
  exit 1
fi

if [ ! -f deploy/secrets/firebase.json ]; then
  echo "!!! Missing deploy/secrets/firebase.json (Firebase service-account key)."
  echo "    Push + phone-auth verification will fail until you add it. Continuing anyway…"
fi

echo "==> Pulling latest code (if this is a git checkout)…"
git pull --ff-only 2>/dev/null || echo "   (not a git pull context — skipping)"

echo "==> Building + starting the stack…"
docker compose up -d --build

echo "==> Waiting a moment, then showing status…"
sleep 5
docker compose ps

echo ""
echo "==> Tail logs with:   docker compose logs -f app reverb queue"
echo "==> API should now answer on:   http://<this-server-ip>/api"
echo "==> Reverb websockets on:        ws://<this-server-ip>:8080"
echo "Done."
