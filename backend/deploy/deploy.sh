#!/usr/bin/env bash
# ===========================================================================
# DreamCabs High-Performance Production Deploy Script
#
# Automatically handles:
#   1. Frontend Angular Admin build (installs deps & compiles production bundle)
#   2. Docker stack rebuild & restart (App, Reverb, Queue, Nginx)
#   3. Automatic database migrations
#   4. Cache warming (route:clear, config:clear, route:cache, config:cache)
#   5. Queue & WebSocket worker reload
#
# Usage:
#   ./deploy.sh          # Intelligent fast deploy (rebuilds changed services)
#   ./deploy.sh --force  # Force rebuild of frontend, Docker images, and caches
# ===========================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

FORCE_ALL="${1:-}"
if [ "$FORCE_ALL" = "--force" ] || [ "$FORCE_ALL" = "--all" ] || [ "$FORCE_ALL" = "-f" ]; then
  FORCE_BUILD=true
  echo "==> Force mode enabled: Full rebuild of all components requested."
else
  FORCE_BUILD=false
fi

echo "==> Checking prerequisites..."
USE_DOCKER=true
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "==> [NOTICE] Docker or Docker Compose v2 not found. Running in bare-metal mode."
  USE_DOCKER=false
fi

cd "$ROOT_DIR/backend"
if [ ! -f .env ]; then
  if [ -f .env.production.example ]; then
    echo "==> No .env found — creating from .env.production.example."
    cp .env.production.example .env
    echo "!!! Edit .env now (passwords, APP_URL, Reverb secret) then re-run this script."
    exit 1
  else
    echo "!!! No .env file found in backend directory. Please create one."
    exit 1
  fi
fi

if [ ! -f deploy/secrets/firebase.json ] && [ "$USE_DOCKER" = "true" ]; then
  echo "!!! Missing deploy/secrets/firebase.json (Firebase service-account key)."
  echo "    Push + phone-auth verification will fail until you add it. Continuing anyway…"
fi

# Determine the baseline commit for change detection
LAST_COMMIT_FILE="$ROOT_DIR/backend/.last_deployed_commit"
PREV_COMMIT=""

if [ "$FORCE_BUILD" = "false" ] && [ -f "$LAST_COMMIT_FILE" ]; then
  CANDIDATE="$(cat "$LAST_COMMIT_FILE" | tr -d '[:space:]')"
  if git rev-parse --verify "$CANDIDATE" >/dev/null 2>&1; then
    PREV_COMMIT="$CANDIDATE"
  fi
fi

if [ -z "$PREV_COMMIT" ] && [ "$FORCE_BUILD" = "false" ]; then
  if git rev-parse --verify ORIG_HEAD >/dev/null 2>&1; then
    PREV_COMMIT="ORIG_HEAD"
  elif git rev-parse --verify "HEAD@{1}" >/dev/null 2>&1; then
    PREV_COMMIT="HEAD@{1}"
  elif git rev-parse --verify "HEAD~1" >/dev/null 2>&1; then
    PREV_COMMIT="HEAD~1"
  fi
fi

CURRENT_COMMIT="$(git rev-parse HEAD 2>/dev/null || echo 'manual')"

# --- 1. FRONTEND BUILD -----------------------------------------------------
FRONTEND_CHANGED=false
NPM_DEPS_CHANGED=false

if [ "$FORCE_BUILD" = "true" ] || [ ! -d "$ROOT_DIR/frontend/dist/frontend" ] || [ -z "$PREV_COMMIT" ]; then
  FRONTEND_CHANGED=true
  NPM_DEPS_CHANGED=true
elif git diff --name-only "$PREV_COMMIT" "$CURRENT_COMMIT" -- "$ROOT_DIR/frontend" 2>/dev/null | grep -q .; then
  FRONTEND_CHANGED=true
  if git diff --name-only "$PREV_COMMIT" "$CURRENT_COMMIT" -- "$ROOT_DIR/frontend/package.json" "$ROOT_DIR/frontend/package-lock.json" 2>/dev/null | grep -q .; then
    NPM_DEPS_CHANGED=true
  fi
fi

if [ "$FRONTEND_CHANGED" = "true" ]; then
  echo "==> Building Angular Admin Frontend..."
  cd "$ROOT_DIR/frontend"
  if command -v npm >/dev/null 2>&1; then
    if [ "$NPM_DEPS_CHANGED" = "true" ] || [ ! -d node_modules ]; then
      echo "  -> Installing npm dependencies..."
      npm install --prefer-offline --no-audit
    fi
    echo "  -> Compiling production bundle..."
    npm run build -- --configuration production --base-href /admin/
  elif [ "$USE_DOCKER" = "true" ]; then
    echo "  -> Building via Node Docker container..."
    docker run --rm \
      -v "$ROOT_DIR/frontend":/app \
      -v dreamcabs_npm_cache:/root/.npm \
      -w /app \
      node:20-alpine sh -c "if [ ! -d node_modules ] || [ '$NPM_DEPS_CHANGED' = 'true' ]; then npm install --prefer-offline --no-audit; fi && npm run build -- --configuration production --base-href /admin/"
  else
    echo "!!! npm not found and Docker not available. Unable to build frontend."
  fi
else
  echo "==> [SKIP] No frontend changes detected. Angular build skipped."
fi

# --- 2. BACKEND & DOCKER DEPLOYMENT ----------------------------------------
cd "$ROOT_DIR/backend"

if [ "$USE_DOCKER" = "true" ]; then
  BACKEND_CODE_CHANGED=false
  DOCKER_IMAGE_CHANGED=false
  MIGRATIONS_CHANGED=false

  if [ "$FORCE_BUILD" = "true" ] || [ -z "$PREV_COMMIT" ]; then
    BACKEND_CODE_CHANGED=true
    DOCKER_IMAGE_CHANGED=true
    MIGRATIONS_CHANGED=true
  else
    if git diff --name-only "$PREV_COMMIT" "$CURRENT_COMMIT" -- "$ROOT_DIR/backend" 2>/dev/null | grep -q .; then
      BACKEND_CODE_CHANGED=true
    fi
    if git diff --name-only "$PREV_COMMIT" "$CURRENT_COMMIT" -- "$ROOT_DIR/backend/Dockerfile" "$ROOT_DIR/backend/composer.json" "$ROOT_DIR/backend/composer.lock" "$ROOT_DIR/backend/deploy" 2>/dev/null | grep -q .; then
      DOCKER_IMAGE_CHANGED=true
    fi
    if git diff --name-only "$PREV_COMMIT" "$CURRENT_COMMIT" -- "$ROOT_DIR/backend/database/migrations" 2>/dev/null | grep -q .; then
      MIGRATIONS_CHANGED=true
    fi
  fi

  # Check if containers are currently running
  CONTAINERS_RUNNING=true
  if [ -z "$(docker compose ps -q app 2>/dev/null)" ]; then
    CONTAINERS_RUNNING=false
  fi

  if [ "$CONTAINERS_RUNNING" = "false" ] || [ "$DOCKER_IMAGE_CHANGED" = "true" ] || [ "$BACKEND_CODE_CHANGED" = "true" ]; then
    echo "==> Rebuilding and starting Docker stack with fresh code..."
    docker compose up -d --build
  elif [ "$FRONTEND_CHANGED" = "true" ]; then
    echo "==> Reloading Nginx with new frontend assets..."
    docker compose restart nginx
  fi

  # --- 3. DATABASE MIGRATIONS ----------------------------------------------
  echo "==> Checking and running database migrations..."
  docker compose exec -T app php artisan migrate --force --no-interaction || true

  # --- 4. LARAVEL CACHE REFRESH (ALWAYS RUN TO AVOID STALE ROUTES) ----------
  echo "==> Refreshing route, config, and view caches..."
  docker compose exec -T app php artisan config:clear || true
  docker compose exec -T app php artisan route:clear || true
  docker compose exec -T app php artisan view:clear || true
  docker compose exec -T app php artisan config:cache || true
  docker compose exec -T app php artisan route:cache || true

  # Restart worker processes to pick up updated code & routes
  echo "==> Restarting queue and websocket workers..."
  docker compose restart queue reverb || true

  echo "==> Checking container health..."
  docker compose ps

else
  # --- BARE-METAL / DIRECT HOST EXECUTION ----------------------------------
  echo "==> Running Composer autoloader & optimization..."
  if command -v composer >/dev/null 2>&1; then
    composer install --no-dev --prefer-dist --no-interaction --optimize-autoloader || true
  fi

  echo "==> Running database migrations..."
  php artisan migrate --force --no-interaction || true

  echo "==> Clearing and warming Laravel caches..."
  php artisan config:clear || true
  php artisan route:clear || true
  php artisan view:clear || true
  php artisan config:cache || true
  php artisan route:cache || true

  if command -v supervisorctl >/dev/null 2>&1; then
    echo "==> Restarting supervisor worker queues..."
    supervisorctl restart all || true
  fi
fi

# Record this commit as successfully deployed
if [ "$CURRENT_COMMIT" != "manual" ]; then
  echo "$CURRENT_COMMIT" > "$LAST_COMMIT_FILE"
fi

echo ""
echo "========================================================================="
echo "✅ DreamCabs is LIVE and updated!"
echo "👉 Landing Website:    https://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost')/ (or https://dreamcabs.in/)"
echo "👉 Admin Dashboard:    https://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost')/admin/ (or https://dreamcabs.in/admin/signin)"
echo "👉 Backend API:        https://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost')/api"
echo "👉 Reverb WebSockets:  ws://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost'):8080"
echo "========================================================================="
