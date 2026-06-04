#!/usr/bin/env bash
# One-time-per-session helper: flip the USB-connected phone to wireless adb and
# remember its IP, so `npm run dev:device` can auto-reconnect over Wi-Fi from
# then on (no cable, no typing the IP).
#
# Run it ONCE with the phone plugged in via USB:
#     npm run go:wireless          (from inside customer-mobile / driver-mobile)
# Then you can unplug the cable and just use  npm run dev:device.
#
# Requirements: phone on the SAME Wi-Fi as the laptop, USB debugging allowed.
set -e

[ -f "$HOME/android-dev/env.sh" ] && source "$HOME/android-dev/env.sh"
IP_FILE="$HOME/android-dev/wireless-ip"

# Find a USB-connected, authorized device (serial that is NOT already ip:5555).
USB="$(adb devices | awk 'NR>1 && $2=="device" && $1 !~ /:5555$/ {print $1; exit}')"
if [ -z "$USB" ]; then
  echo "❌ No USB phone found. Plug the phone in via USB and accept the"
  echo "   'Allow USB debugging?' prompt, then run this again."
  echo "   (Check with: adb devices — you want a plain serial in state 'device'.)"
  exit 1
fi

# Discover the phone's Wi-Fi IP from the device itself (no guessing).
IP="$(adb -s "$USB" shell ip -f inet addr show wlan0 2>/dev/null \
        | sed -n 's/.*inet \([0-9.]*\)\/.*/\1/p' | head -n1)"
if [ -z "$IP" ]; then
  IP="$(adb -s "$USB" shell ip route 2>/dev/null | sed -n 's/.*src \([0-9.]*\).*/\1/p' | head -n1)"
fi
if [ -z "$IP" ]; then
  echo "❌ Couldn't read the phone's Wi-Fi IP. Make sure Wi-Fi is ON and the"
  echo "   phone is on the same network, then run this again."
  exit 1
fi

echo "📶 Phone Wi-Fi IP: $IP"
echo "   Switching adb to TCP/IP mode on port 5555 ..."
adb -s "$USB" tcpip 5555 >/dev/null
sleep 1
echo "   Connecting over Wi-Fi ..."
echo "$IP" > "$IP_FILE"   # remember it regardless — dev:device auto-retries too

# Some phones are slow to bring the Wi-Fi adb link up — poll for a few seconds
# instead of giving up after one check.
ok=""
for _ in $(seq 1 10); do
  adb connect "$IP:5555" >/dev/null 2>&1 || true
  if adb devices | awk 'NR>1 && $1=="'"$IP"':5555" && $2=="device"{f=1} END{exit !f}'; then
    ok=1; break
  fi
  sleep 1
done

if [ -n "$ok" ]; then
  echo "✅ Wireless ready and remembered ($IP)."
  echo "   You can unplug the USB cable now."
  echo "   From now on just run:  npm run dev:device"
else
  echo "⚠️  Sent the connect command but the wireless device didn't come up."
  echo "   IP is remembered — keep USB plugged for now, or retry:  adb connect $IP:5555"
fi
