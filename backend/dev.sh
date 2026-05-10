#!/usr/bin/env bash
# DreamCabs dev orchestrator — boots every long-running service the live-map +
# realtime + queue features need, all in one terminal. Ctrl+C cleans up.
#
#   php artisan serve         (HTTP API + /broadcasting/auth, port 8000)
#   php artisan reverb:start  (WebSocket gateway, port 8080)
#   php artisan queue:work    (FCM dispatch jobs, FCM single-user notifications)
#   php artisan schedule:work (negotiation cleanup every minute, token prune nightly)
#
# Logs are interleaved and prefixed so you can spot which service emitted what.
# Override with env vars: PHP_BIN=php8.3 ./dev.sh

set -uo pipefail

PHP_BIN="${PHP_BIN:-php}"
ROOT="$(cd "$(dirname "$0")" && pwd)"

cd "$ROOT"

if ! command -v "$PHP_BIN" >/dev/null 2>&1; then
  echo "Error: '$PHP_BIN' not found in PATH. Set PHP_BIN=/path/to/php." >&2
  exit 1
fi

if [ ! -f artisan ]; then
  echo "Error: artisan not found at $ROOT/artisan. Run from backend/." >&2
  exit 1
fi

declare -a PIDS=()
cleanup() {
  echo
  echo "[dev.sh] Shutting down…"
  for pid in "${PIDS[@]:-}"; do
    if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  wait 2>/dev/null || true
  echo "[dev.sh] Bye."
}
trap cleanup INT TERM EXIT

# Colorized prefix for each child stream.
prefix() {
  local label="$1"
  while IFS= read -r line; do
    printf '[%s] %s\n' "$label" "$line"
  done
}

echo "[dev.sh] Starting services in $ROOT…"

"$PHP_BIN" artisan serve --host=0.0.0.0 --port=8000 2>&1 | prefix "serve" &
PIDS+=($!)

"$PHP_BIN" artisan reverb:start --host=0.0.0.0 --port=8080 2>&1 | prefix "reverb" &
PIDS+=($!)

"$PHP_BIN" artisan queue:work --tries=3 --sleep=1 2>&1 | prefix "queue" &
PIDS+=($!)

"$PHP_BIN" artisan schedule:work 2>&1 | prefix "sched" &
PIDS+=($!)

echo "[dev.sh] All services launched. Ctrl+C to stop."
echo "[dev.sh]"
echo "[dev.sh]   HTTP API:    http://localhost:8000/api"
echo "[dev.sh]   WebSocket:   ws://localhost:8080"
echo "[dev.sh]"
echo "[dev.sh] Tip: in another terminal run"
echo "[dev.sh]   php artisan drivers:simulate-nearby --count=5 --lat=<your-lat> --lng=<your-lng>"
echo "[dev.sh] to make pins appear on the customer search map."
echo

# Wait on any child; if one exits, tear down the rest.
wait -n
