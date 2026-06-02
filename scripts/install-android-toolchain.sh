#!/usr/bin/env bash
#
# Installs a complete Android build toolchain for Capacitor 8 WITHOUT sudo and
# WITHOUT Android Studio. Everything lands under $HOME so it touches no system
# files. Safe to re-run (idempotent-ish): it skips downloads that already exist.
#
#   - Temurin JDK 21      -> ~/android-dev/jdk
#   - Android cmdline-tools -> ~/Android/Sdk/cmdline-tools/latest
#   - platform-tools (adb), platforms;android-35, build-tools;35.0.0
#   - Writes env vars into ~/.bashrc and ~/android-dev/env.sh
#
set -euo pipefail

DEV_DIR="$HOME/android-dev"
SDK_DIR="$HOME/Android/Sdk"
JDK_DIR="$DEV_DIR/jdk"
mkdir -p "$DEV_DIR" "$SDK_DIR"

log() { echo -e "\n\033[1;36m==> $*\033[0m"; }

# ---------------------------------------------------------------------------
# 1. JDK 21 (Temurin) — needed to launch Gradle. No sudo: just a tarball.
# ---------------------------------------------------------------------------
if [ -x "$JDK_DIR/bin/javac" ]; then
  log "JDK 21 already present at $JDK_DIR — skipping."
else
  log "Downloading Temurin JDK 21 (linux x64)…"
  curl -L --fail -o "$DEV_DIR/jdk21.tar.gz" \
    "https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse?project=jdk"
  log "Extracting JDK…"
  rm -rf "$JDK_DIR" && mkdir -p "$JDK_DIR"
  tar -xzf "$DEV_DIR/jdk21.tar.gz" -C "$JDK_DIR" --strip-components=1
  rm -f "$DEV_DIR/jdk21.tar.gz"
fi
export JAVA_HOME="$JDK_DIR"
export PATH="$JAVA_HOME/bin:$PATH"
"$JDK_DIR/bin/java" -version

# ---------------------------------------------------------------------------
# 2. Android command-line tools (sdkmanager / avdmanager) — no Studio needed.
# ---------------------------------------------------------------------------
if [ -x "$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" ]; then
  log "cmdline-tools already present — skipping."
else
  log "Downloading Android command-line tools…"
  CLT_ZIP="$DEV_DIR/cmdline-tools.zip"
  curl -L --fail -o "$CLT_ZIP" \
    "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
  log "Extracting cmdline-tools…"
  rm -rf "$DEV_DIR/cmdline-tools-tmp"
  mkdir -p "$DEV_DIR/cmdline-tools-tmp"
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
# 3. SDK packages required by Capacitor 8 (compileSdk/targetSdk 35).
# ---------------------------------------------------------------------------
log "Accepting SDK licenses…"
yes | sdkmanager --sdk_root="$SDK_DIR" --licenses >/dev/null 2>&1 || true

log "Installing platform-tools, platforms;android-35, build-tools;35.0.0…"
sdkmanager --sdk_root="$SDK_DIR" \
  "platform-tools" \
  "platforms;android-35" \
  "build-tools;35.0.0"

# ---------------------------------------------------------------------------
# 4. Persist env vars so every new terminal + VS Code has them.
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
  {
    echo ""
    echo "$MARKER"
    echo "source \"$ENV_FILE\""
    echo "# <<< DreamCabs Android toolchain <<<"
  } >> "$HOME/.bashrc"
  log "Added toolchain sourcing to ~/.bashrc"
else
  log "~/.bashrc already sources the toolchain — skipping."
fi

log "DONE. Verifying:"
echo "JAVA_HOME = $JAVA_HOME"
"$JDK_DIR/bin/java" -version
"$SDK_DIR/platform-tools/adb" --version | head -1
echo -e "\n\033[1;32mAndroid toolchain installed. Open a new terminal (or run: source ~/android-dev/env.sh)\033[0m"
