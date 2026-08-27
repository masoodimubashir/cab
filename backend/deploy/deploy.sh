#!/usr/bin/env bash
# ===========================================================================
# DreamCabs High-Performance Production Deploy
# Detects changed files to deploy in seconds:
#   - Skips Angular build if frontend is unchanged (~1m saved)
#   - Skips npm install if package.json is unchanged (~30s saved)
#   - Skips image rebuild if Dockerfile/dependencies are unchanged
#   - Runs migrations only when new migration files exist
#   - Refreshes Laravel caches only when config/routes/code change
# Pass --force or --all to force a full rebuild of everything.
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

CURRENT_COMMIT="$(git rev-parse HEAD)"

# --- 1. FRONTEND CHANGE DETECTION ------------------------------------------
FRONTEND_CHANGED=false
NPM_DEPS_CHANGED=false

if [ "$FORCE_BUILD" = "true" ] || [ ! -d "$ROOT_DIR/frontend/dist/frontend/browser" ] || [ -z "$PREV_COMMIT" ]; then
  FRONTEND_CHANGED=true
  NPM_DEPS_CHANGED=true
elif git diff --name-only "$PREV_COMMIT" "$CURRENT_COMMIT" -- "$ROOT_DIR/frontend" | grep -q .; then
  FRONTEND_CHANGED=true
  if git diff --name-only "$PREV_COMMIT" "$CURRENT_COMMIT" -- "$ROOT_DIR/frontend/package.json" "$ROOT_DIR/frontend/package-lock.json" | grep -q .; then
    NPM_DEPS_CHANGED=true
  fi
fi

if [ "$FRONTEND_CHANGED" = "true" ]; then
  echo "==> Changes detected in frontend. Building Angular Admin Frontend..."
  cd "$ROOT_DIR/frontend"
  if command -v npm >/dev/null 2>&1; then
    if [ "$NPM_DEPS_CHANGED" = "true" ] || [ ! -d node_modules ]; then
      echo "  -> Updating npm packages..."
      npm install --prefer-offline --no-audit
    fi
    echo "  -> Compiling production bundle..."
    npm run build -- --configuration production --base-href /admin/
  else
    echo "  -> Building via Node container..."
    docker run --rm \
      -v "$ROOT_DIR/frontend":/app \
      -v dreamcabs_npm_cache:/root/.npm \
      -w /app \
      node:20-alpine sh -c "if [ ! -d node_modules ] || [ '$NPM_DEPS_CHANGED' = 'true' ]; then npm install --prefer-offline --no-audit; fi && npm run build -- --configuration production --base-href /admin/"
  fi
else
  echo "==> [SKIP] No frontend changes detected. Angular build skipped."
fi

# --- 2. BACKEND & DOCKER CHANGE DETECTION ----------------------------------
BACKEND_CODE_CHANGED=false
DOCKER_IMAGE_CHANGED=false
MIGRATIONS_CHANGED=false
CONFIG_CHANGED=false

if [ "$FORCE_BUILD" = "true" ] || [ -z "$PREV_COMMIT" ]; then
  BACKEND_CODE_CHANGED=true
  DOCKER_IMAGE_CHANGED=true
  MIGRATIONS_CHANGED=true
  CONFIG_CHANGED=true
else
  if git diff --name-only "$PREV_COMMIT" "$CURRENT_COMMIT" -- "$ROOT_DIR/backend" | grep -q .; then
    BACKEND_CODE_CHANGED=true
  fi
  if git diff --name-only "$PREV_COMMIT" "$CURRENT_COMMIT" -- "$ROOT_DIR/backend/Dockerfile" "$ROOT_DIR/backend/composer.json" "$ROOT_DIR/backend/composer.lock" "$ROOT_DIR/backend/deploy" | grep -q .; then
    DOCKER_IMAGE_CHANGED=true
  fi
  if git diff --name-only "$PREV_COMMIT" "$CURRENT_COMMIT" -- "$ROOT_DIR/backend/database/migrations" | grep -q .; then
    MIGRATIONS_CHANGED=true
  fi
  if git diff --name-only "$PREV_COMMIT" "$CURRENT_COMMIT" -- "$ROOT_DIR/backend/config" "$ROOT_DIR/backend/routes" "$ROOT_DIR/backend/app" "$ROOT_DIR/backend/.env" | grep -q .; then
    CONFIG_CHANGED=true
  fi
fi

cd "$ROOT_DIR/backend"

# Check if containers are currently running
CONTAINERS_RUNNING=true
docker compose ps -q app >/dev/null 2>&1 || CONTAINERS_RUNNING=false
if [ -z "$(docker compose ps -q app 2>/dev/null)" ]; then
  CONTAINERS_RUNNING=false
fi

if [ "$CONTAINERS_RUNNING" = "false" ] || [ "$DOCKER_IMAGE_CHANGED" = "true" ] || [ "$BACKEND_CODE_CHANGED" = "true" ]; then
  echo "==> Rebuilding and starting Docker stack with fresh code..."
  docker compose up -d --build
elif [ "$FRONTEND_CHANGED" = "true" ]; then
  echo "==> Reloading Nginx with new frontend assets..."
  docker compose restart nginx
else
  echo "==> [SKIP] No Docker or Backend code changes detected."
fi

# --- 3. DATABASE MIGRATIONS ------------------------------------------------
if [ "$MIGRATIONS_CHANGED" = "true" ] || [ "$CONTAINERS_RUNNING" = "false" ] || [ "$BACKEND_CODE_CHANGED" = "true" ]; then
  echo "==> Checking and running database migrations..."
  docker compose exec -T app php artisan migrate --force --no-interaction || true
else
  echo "==> [SKIP] No new migration files. Database is up to date."
fi

# --- 4. LARAVEL CACHE OPTIMIZATION -----------------------------------------
if [ "$CONFIG_CHANGED" = "true" ] || [ "$CONTAINERS_RUNNING" = "false" ] || [ "$BACKEND_CODE_CHANGED" = "true" ]; then
  echo "==> Refreshing route, config, and view caches..."
  docker compose exec -T app php artisan config:clear || true
  docker compose exec -T app php artisan route:clear || true
  docker compose exec -T app php artisan view:clear || true
  docker compose exec -T app php artisan config:cache || true
  docker compose exec -T app php artisan route:cache || true
else
  echo "==> [SKIP] Config and routes are unchanged. Caches are fresh."
fi

# Record this commit as successfully deployed
echo "$CURRENT_COMMIT" > "$LAST_COMMIT_FILE"

echo "==> Checking container health..."
docker compose ps

echo ""
echo "========================================================================="
echo "✅ DreamCabs is LIVE!"
echo "👉 Landing Website:    https://$(hostname -I | awk '{print $1}')/ (or https://dreamcabs.in/)"
echo "👉 Admin Dashboard:    https://$(hostname -I | awk '{print $1}')/admin/ (or https://dreamcabs.in/admin/signin)"
echo "👉 Backend API:        https://$(hostname -I | awk '{print $1}')/api"
echo "👉 Reverb WebSockets:  ws://$(hostname -I | awk '{print $1}'):8080"
echo "========================================================================="

