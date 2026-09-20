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

# Client configuration is provisioned privately, outside the Git checkout.
FRONTEND_CONFIG_DIR="${DREAMCABS_FRONTEND_CONFIG_DIR:-$HOME/dreamcabs-config/frontend}"

# Also serialize manual deploys on the VPS.
exec 9>"$ROOT_DIR/backend/.deploy.lock"
if ! flock -n 9; then
  echo "Another deployment is running. Try again after it finishes." >&2
  exit 1
fi
SECONDS=0
trap 'echo "Deployment failed at line $LINENO; success marker was not updated." >&2' ERR

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

# Without a successful-deploy marker, rebuild everything. Git reflog entries
# do not prove which revision is actually running on the server.

CURRENT_COMMIT="$(git rev-parse HEAD 2>/dev/null || echo 'manual')"

# --- 1. FRONTEND BUILD -----------------------------------------------------
FRONTEND_CHANGED=false
NPM_DEPS_CHANGED=false

# Validate both inputs before copying either. Never print their contents.
for config_name in environment.ts environment.prod.ts; do
  if [ ! -s "$FRONTEND_CONFIG_DIR/$config_name" ] || [ ! -r "$FRONTEND_CONFIG_DIR/$config_name" ]; then
    echo "!!! Missing readable private frontend configuration: $FRONTEND_CONFIG_DIR/$config_name" >&2
    exit 1
  fi
done
mkdir -p "$ROOT_DIR/frontend/src/environments"
for config_name in environment.ts environment.prod.ts; do
  install -m 600 "$FRONTEND_CONFIG_DIR/$config_name" "$ROOT_DIR/frontend/src/environments/$config_name"
done
# Private configuration changes are invisible to git diff. Always rebuild the
# frontend so rotations (including retries after a failed build) take effect.
FRONTEND_CHANGED=true

if [ "$FORCE_BUILD" = "true" ] || [ ! -d "$ROOT_DIR/frontend/dist/frontend" ] || [ -z "$PREV_COMMIT" ]; then
  FRONTEND_CHANGED=true
  NPM_DEPS_CHANGED=true
elif git diff --name-only "$PREV_COMMIT" "$CURRENT_COMMIT" -- "$ROOT_DIR/frontend" | grep . >/dev/null; then
  FRONTEND_CHANGED=true
  if git diff --name-only "$PREV_COMMIT" "$CURRENT_COMMIT" -- "$ROOT_DIR/frontend/package.json" "$ROOT_DIR/frontend/package-lock.json" | grep . >/dev/null; then
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
    echo "!!! npm not found and Docker not available. Unable to build frontend." >&2
    exit 1
  fi
else
  echo "==> [SKIP] No frontend changes detected. Angular build skipped."
fi

# --- 2. BACKEND & DOCKER DEPLOYMENT ----------------------------------------
cd "$ROOT_DIR/backend"

if [ "$USE_DOCKER" = "true" ]; then
  BACKEND_CODE_CHANGED=false
  DOCKER_IMAGE_CHANGED=false

  if [ "$FORCE_BUILD" = "true" ] || [ -z "$PREV_COMMIT" ]; then
    BACKEND_CODE_CHANGED=true
    DOCKER_IMAGE_CHANGED=true
  else
    if git diff --name-only "$PREV_COMMIT" "$CURRENT_COMMIT" -- "$ROOT_DIR/backend" | grep . >/dev/null; then
      BACKEND_CODE_CHANGED=true
    fi
    if git diff --name-only "$PREV_COMMIT" "$CURRENT_COMMIT" -- "$ROOT_DIR/backend/Dockerfile" "$ROOT_DIR/backend/composer.json" "$ROOT_DIR/backend/composer.lock" "$ROOT_DIR/backend/deploy" | grep . >/dev/null; then
      DOCKER_IMAGE_CHANGED=true
    fi
  fi

  # Check if containers are currently running
  CONTAINERS_RUNNING=true
  if [ -z "$(docker compose ps -q app 2>/dev/null)" ]; then
    CONTAINERS_RUNNING=false
  fi

  if [ "$CONTAINERS_RUNNING" = "false" ] || [ "$DOCKER_IMAGE_CHANGED" = "true" ] || [ "$BACKEND_CODE_CHANGED" = "true" ]; then
    echo "==> Building the backend while the existing containers keep serving..."
    docker compose build app
  fi

  # The entrypoint alone runs migrations and caches before FPM starts listening.
  # Compose waits for that readiness check, not just container creation.
  echo "==> Starting services and waiting for PHP readiness..."
  if ! docker compose up -d --no-build --wait --wait-timeout 180; then
    docker compose ps
    docker compose logs --tail=80 app nginx
    exit 1
  fi

  # A graceful reload picks up bind-mounted config and refreshes upstreams,
  # including on the first deployment from the old static-DNS configuration.
  docker compose exec -T nginx nginx -t
  docker compose exec -T nginx nginx -s reload
  echo "==> Checking HTTPS -> nginx -> Laravel..."
  curl --fail --silent --show-error --output /dev/null \
    --connect-timeout 5 --max-time 10 --retry 10 --retry-delay 2 --retry-connrefused \
    --resolve dreamcabs.in:443:127.0.0.1 https://dreamcabs.in/up
  docker compose ps

else
  # --- BARE-METAL / DIRECT HOST EXECUTION ----------------------------------
  echo "==> Running Composer autoloader & optimization..."
  if command -v composer >/dev/null 2>&1; then
    composer install --no-dev --prefer-dist --no-interaction --optimize-autoloader
  fi

  echo "==> Running database migrations..."
  php artisan migrate --force --no-interaction

  echo "==> Clearing and warming Laravel caches..."
  php artisan view:clear
  php artisan config:cache
  php artisan route:cache

  if command -v supervisorctl >/dev/null 2>&1; then
    echo "==> Restarting supervisor worker queues..."
    supervisorctl restart all
  fi
fi

echo "==> Deployment verified in ${SECONDS}s."

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
