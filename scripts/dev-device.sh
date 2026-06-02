#!/usr/bin/env bash
# Launch Capacitor live-reload (hot reload) onto the connected phone — USB OR
# wireless, with zero fuss:
#   • Auto-loads the Android toolchain env (no manual `source`).
#   • If nothing is connected, auto-reconnects to the last wireless phone we
#     remembered (see go-wireless.sh) and waits a few seconds for it to come up
#     — so a dropped Wi-Fi link heals itself instead of erroring out.
#   • Reads the --target id from the SAME list Ionic validates against
#     (`cap run android --list --json`), so it can never pass a stale id that
#     Ionic rejects with "<id> is not a valid Target ID."
#
# Usage:  bash scripts/dev-device.sh <port> [phone-ip]
#         <port>      dev-server port (8100 customer / 8200 driver)
#         [phone-ip]  optional: connect this wireless IP first (also remembered)
set -e

# Load JAVA_HOME / ANDROID_HOME / adb if not already on PATH.
[ -f "$HOME/android-dev/env.sh" ] && source "$HOME/android-dev/env.sh"

PORT="${1:-8100}"
IP_ARG="${2:-}"
IP_FILE="$HOME/android-dev/wireless-ip"      # remembers the last wireless phone

# --- helpers ---------------------------------------------------------------

# Print the id of the first device Capacitor sees (the list Ionic validates
# against). Empty if none / not ready yet.
cap_target() {
  npx cap run android --list --json 2>/dev/null | node -e '
    let s = "";
    process.stdin.on("data", d => (s += d)).on("end", () => {
      try {
        const a = JSON.parse(s);
        const d = Array.isArray(a) ? a[0] : null;
        process.stdout.write(d && d.id ? d.id : "");
      } catch (e) {}
    });'
}

# Is any adb device in state "device" (authorized & online)?
have_device() { adb devices | awk 'NR>1 && $2=="device"{f=1} END{exit !f}'; }

# --- 1. make sure a phone is attached --------------------------------------

# Try a wireless (re)connect when nothing is attached: prefer an explicit IP
# arg, else the IP we remembered from a previous `go:wireless`.
if ! have_device; then
  IP="$IP_ARG"
  [ -z "$IP" ] && [ -f "$IP_FILE" ] && IP="$(cat "$IP_FILE")"
  if [ -n "$IP" ]; then
    echo "🔌 No device attached — trying wireless reconnect to $IP:5555 ..."
    adb connect "$IP:5555" >/dev/null 2>&1 || true
    [ -n "$IP_ARG" ] && echo "$IP_ARG" > "$IP_FILE"   # remember a freshly given IP
  fi
fi

# Wait up to ~10s for a device to come online (handles a slow/flaky reconnect).
for _ in $(seq 1 20); do
  have_device && break
  sleep 0.5
done

if ! have_device; then
  echo "❌ No authorized device found."
  echo "   • USB:      plug in the phone and accept 'Allow USB debugging'."
  echo "   • Wireless: run  npm run go:wireless  once (while on USB) to set it up,"
  echo "               then this command auto-reconnects every time."
  echo "   Check with:  adb devices   (state must be 'device')"
  exit 1
fi

# Remember the wireless phone's IP so next time we auto-reconnect.
WL="$(adb devices | awk 'NR>1 && $2=="device" && $1 ~ /:5555$/ {print $1; exit}')"
[ -n "$WL" ] && echo "${WL%:5555}" > "$IP_FILE"

# --- 2. resolve the target id Ionic will accept ----------------------------

# cap's list can lag adb by a moment after a reconnect — retry briefly.
TARGET=""
for _ in $(seq 1 10); do
  TARGET="$(cap_target)"
  [ -n "$TARGET" ] && break
  sleep 0.5
done

if [ -z "$TARGET" ]; then
  echo "❌ Phone is attached but Capacitor can't see it yet. Re-run the command,"
  echo "   or unplug/replug (USB) / re-run  adb connect <ip>:5555  (wireless)."
  exit 1
fi

# --- 3. go -----------------------------------------------------------------

echo "✅ Deploying live-reload to: $TARGET   (port $PORT)"
echo "   Leave this terminal open — every save hot-reloads on the phone."
echo "   Press Ctrl+C to stop."
exec npx ionic cap run android -l --external --port="$PORT" --target="$TARGET"
