#!/usr/bin/env bash
# Runs once per container start. For the web (php-fpm) role it prepares the app;
# for reverb/queue roles we pass a different CMD so this still execs it cleanly.
set -e

# Every role: make sure the storage tree + perms exist. `storage` is a named
# volume that starts empty on first boot, so we recreate the framework dirs
# here rather than relying solely on the image.
mkdir -p storage/framework/sessions storage/framework/views \
         storage/framework/cache/data storage/logs bootstrap/cache
chown -R www-data:www-data storage bootstrap/cache || true
chmod -R 775 storage bootstrap/cache || true

# Only the web role should run migrations / cache warming. We mark it with the
# RUN_RELEASE_TASKS env (set in docker-compose for the `app` service only) so
# the queue + reverb containers don't race on migrations.
if [ "${RUN_RELEASE_TASKS:-false}" = "true" ]; then
  echo "[entrypoint] Waiting for database…"
  for i in {1..30}; do
    if php -r "new PDO('mysql:host=' . (getenv('DB_HOST') ?: 'mysql') . ';port=' . (getenv('DB_PORT') ?: '3306'), getenv('DB_USERNAME') ?: 'dreamcabs', getenv('DB_PASSWORD') ?: '');" 2>/dev/null; then
      echo "  …database is ready!"
      break
    fi
    echo "  …db not ready, retrying in 2s ($i/30)..."; sleep 2
  done

  if [ -z "${APP_KEY:-}" ]; then
    echo "[entrypoint] Generating APP_KEY because it is missing…"
    php artisan key:generate --force --no-interaction || true
  fi

  echo "[entrypoint] Running migrations…"
  php artisan migrate --force --no-interaction || true

  echo "[entrypoint] Caching config / routes / events…"
  php artisan config:cache || true
  php artisan route:cache || true
  php artisan event:cache || true
  php artisan storage:link || true
fi

exec "$@"
