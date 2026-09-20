#!/usr/bin/env bash
set -euo pipefail
# Runs once per container start. For the web (php-fpm) role it prepares the app;
# for reverb/queue roles we pass a different CMD so this still execs it cleanly.

# Every role: make sure the storage tree + perms exist. `storage` is a named
# volume that starts empty on first boot, so we recreate the framework dirs
# here rather than relying solely on the image.
mkdir -p storage/framework/sessions storage/framework/views \
         storage/framework/cache/data storage/logs bootstrap/cache
# Repair old volumes once; avoid scanning every upload in every container.
# Remove this marker to request a full permission repair on the next start.
if [ ! -f storage/.permissions-v1 ]; then
  chown -R www-data:www-data storage
  chmod -R 775 storage
  touch storage/.permissions-v1
fi
chown www-data:www-data storage storage/framework storage/framework/sessions \
  storage/framework/views storage/framework/cache storage/framework/cache/data \
  storage/logs bootstrap/cache
chmod 775 bootstrap/cache

# Only the web role should run migrations / cache warming. We mark it with the
# RUN_RELEASE_TASKS env (set in docker-compose for the `app` service only) so
# the queue + reverb containers don't race on migrations.
if [ "${RUN_RELEASE_TASKS:-false}" = "true" ]; then
  echo "[entrypoint] Waiting for database…"
  database_ready=false
  for i in {1..20}; do
    if php -r "new PDO('mysql:host=' . (getenv('DB_HOST') ?: 'mysql') . ';port=' . (getenv('DB_PORT') ?: '3306'), getenv('DB_USERNAME') ?: 'dreamcabs', getenv('DB_PASSWORD') ?: '', [PDO::ATTR_TIMEOUT => 2]);" 2>/dev/null; then
      database_ready=true
      echo "  …database is ready!"
      break
    fi
    echo "  …db not ready, retrying in 1s ($i/20)..."; sleep 1
  done

  if [ "$database_ready" != "true" ]; then
    echo "[entrypoint] Database unavailable; refusing to start." >&2
    exit 1
  fi

  if [ -z "${APP_KEY:-}" ]; then
    echo "[entrypoint] Configure APP_KEY in backend/.env before deploying." >&2
    exit 1
  fi

  echo "[entrypoint] Running migrations…"
  php artisan migrate --force --no-interaction

  echo "[entrypoint] Preparing cache…"
  php artisan config:cache
  php artisan route:cache
  php artisan view:clear
  if [ ! -e public/storage ] && [ ! -L public/storage ]; then
    php artisan storage:link
  fi
fi

echo "[entrypoint] Launching: $@"
exec "$@"
