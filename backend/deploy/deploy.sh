#!/usr/bin/env bash
# ===========================================================================
# DreamCabs Unified Production Deploy
# Builds Angular Admin Frontend + starts full Laravel Backend Docker stack
# ===========================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "==> Checking prerequisites..."
command -v docker >/dev/null || { echo "Docker is not installed."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required."; exit 1; }

cd "$ROOT_DIR/backend"
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

echo "==> Building Angular Admin Frontend (base-href: /admin/)..."
cd "$ROOT_DIR/frontend"
if command -v npm >/dev/null 2>&1; then
  npm install --prefer-offline --no-audit
  npm run build -- --configuration production --base-href /admin/
else
  # Use cached temporary Node container
  docker run --rm \
    -v "$ROOT_DIR/frontend":/app \
    -v dreamcabs_npm_cache:/root/.npm \
    -w /app \
    node:20-alpine sh -c "npm install --prefer-offline --no-audit && npm run build -- --configuration production --base-href /admin/"
fi

echo "==> Building + starting Docker stack (Backend + Database + WebSockets + Nginx)..."
cd "$ROOT_DIR/backend"
docker compose up -d --build

echo "==> Running database migrations & cache optimization..."
docker compose exec -T app php artisan migrate --force --no-interaction
docker compose exec -T app php artisan config:cache
docker compose exec -T app php artisan route:cache
docker compose exec -T app php artisan event:cache

echo "==> Waiting a moment, then checking container status..."
sleep 2
docker compose ps

echo ""
echo "========================================================================="
echo "✅ DreamCabs is LIVE!"
echo "👉 Landing Website:    https://$(hostname -I | awk '{print $1}')/ (or https://dreamcabs.in/)"
echo "👉 Admin Dashboard:    https://$(hostname -I | awk '{print $1}')/admin/ (or https://dreamcabs.in/admin/signin)"
echo "👉 Backend API:        https://$(hostname -I | awk '{print $1}')/api"
echo "👉 Reverb WebSockets:  ws://$(hostname -I | awk '{print $1}'):8080"
echo "========================================================================="

