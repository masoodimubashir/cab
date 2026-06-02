#!/usr/bin/env bash
#
# Resumes + finishes the Android toolchain install after a stalled download.
# JDK is already installed; this completes cmdline-tools + SDK packages.
# Robust against stalls: --retry, and --speed-time aborts a frozen connection
# so --retry can reconnect (and -C - resumes from the partial file).
#
set -euo pipefail

DEV_DIR="$HOME/android-dev"
SDK_DIR="$HOME/Android/Sdk"
JDK_DIR="$DEV_DIR/jdk"
CLT_ZIP="$DEV_DIR/cmdline-tools.zip"
CLT_URL="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"

log() { echo -e "\n\033[1;36m==> $*\033[0m"; }

export JAVA_HOME="$JDK_DIR"
export PATH="$JAVA_HOME/bin:$PATH"

# ---------------------------------------------------------------------------
# 1. Resume the cmdline-tools download until the zip is complete & valid.
# ---------------------------------------------------------------------------
if [ -x "$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" ]; then
  log "cmdline-tools already installed — skipping download."
else
  for attempt in 1 2 3 4 5 6 7 8; do
    log "Download attempt $attempt (resuming from $(stat -c %s "$CLT_ZIP" 2>/dev/null || echo 0) bytes)…"
    if curl -L --fail -C - \
         --retry 5 --retry-delay 3 --retry-all-errors \
         --connect-timeout 30 --speed-time 20 --speed-limit 1024 \
         -o "$CLT_ZIP" "$CLT_URL"; then
      log "Download finished."
      break
    else
      log "Stalled/failed; will resume…"; sleep 3
    fi
  done

  # Validate the zip before extracting.
  if ! unzip -tq "$CLT_ZIP" >/dev/null 2>&1; then
    log "Zip incomplete/corrupt — restarting from scratch."
    rm -f "$CLT_ZIP"
    curl -L --fail --retry 8 --retry-delay 3 --retry-all-errors \
         --connect-timeout 30 --speed-time 20 --speed-limit 1024 \
         -o "$CLT_ZIP" "$CLT_URL"
  fi

  log "Extracting cmdline-tools…"
  rm -rf "$DEV_DIR/cmdline-tools-tmp"; mkdir -p "$DEV_DIR/cmdline-tools-tmp"
  unzip -q -o "$CLT_ZIP" -d "$DEV_DIR/cmdline-tools-tmp"
  mkdir -p "$SDK_DIR/cmdline-tools"
  rm -rf "$SDK_DIR/cmdline-tools/latest"
  mv "$DEV_DIR/cmdline-tools-tmp/cmdline-tools" "$SDK_DIR/cmdline-tools/latest"
  rm -rf "$DEV_DIR/cmdline-tools-tmp" "$CLT_ZIP"
fi

export ANDROID_HOME="$SDK_DIR"
export ANDROID_SDK_ROOT="$SDK_DIR"
export PATH="$SDK_DIR/cmdline-tools/latest/bin:$SDK_DIR/platform-tools:$PATH"

# ---------------------------------------------------------------------------
# 2. SDK packages for Capacitor 8 (compile/target SDK 35).
# ---------------------------------------------------------------------------
log "Accepting SDK licenses…"
yes | sdkmanager --sdk_root="$SDK_DIR" --licenses >/dev/null 2>&1 || true

log "Installing platform-tools, platforms;android-35, build-tools;35.0.0…"
sdkmanager --sdk_root="$SDK_DIR" "platform-tools" "platforms;android-35" "build-tools;35.0.0"

# ---------------------------------------------------------------------------
# 3. Persist env vars.
# ---------------------------------------------------------------------------
ENV_FILE="$DEV_DIR/env.sh"
cat > "$ENV_FILE" <<EOF
# DreamCabs Android toolchain — sourced from ~/.bashrc
export JAVA_HOME="$JDK_DIR"
export ANDROID_HOME="$SDK_DIR"
export ANDROID_SDK_ROOT="$SDK_DIR"
export PATH="\$JAVA_HOME/bin:\$ANDROID_HOME/cmdline-tools/latest/bin:\$ANDROID_HOME/platform-tools:\$ANDROID_HOME/build-tools/35.0.0:\$PATH"
EOF

MARKER="# >>> DreamCabs Android toolchain >>>"
if ! grep -q "$MARKER" "$HOME/.bashrc" 2>/dev/null; then
  { echo ""; echo "$MARKER"; echo "source \"$ENV_FILE\""; echo "# <<< DreamCabs Android toolchain <<<"; } >> "$HOME/.bashrc"
  log "Added toolchain sourcing to ~/.bashrc"
fi

log "DONE. Verifying:"
"$JDK_DIR/bin/java" -version
"$SDK_DIR/platform-tools/adb" --version | head -1
echo -e "\n\033[1;32mAndroid toolchain COMPLETE. Open a new terminal or run: source ~/android-dev/env.sh\033[0m"
