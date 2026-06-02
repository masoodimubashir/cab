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
  until php -r "new PDO('mysql:host=${DB_HOST};port=${DB_PORT:-3306}', '${DB_USERNAME}', '${DB_PASSWORD}');" 2>/dev/null; do
    echo "  …db not ready, retrying in 3s"; sleep 3
  done

  echo "[entrypoint] Generating APP_KEY if missing…"
  php artisan key:generate --force --no-interaction || true

  echo "[entrypoint] Running migrations…"
  php artisan migrate --force --no-interaction

  echo "[entrypoint] Caching config / routes / events…"
  php artisan config:cache
  php artisan route:cache
  php artisan event:cache
  php artisan storage:link || true
fi

exec "$@"
