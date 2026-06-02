# DreamCabs — Mobile & Backend Dev Setup (Linux)

Everything you need to run the **customer** and **driver** apps live on your
phone with hot reload, and to build installable APKs — all from VS Code +
terminal, **no Android Studio required**.

> New here? Start with the top-level **`README.md`** (full 0→100 guide).
> Deploying the backend to a server? See **`DEPLOY.md`**.

---

## 0. What's already wired up for you

- **Auto LAN-IP detection** — in dev, the apps figure out your laptop's IP on
  their own (from `window.location`). You **never** hand-edit IP addresses.
  (`src/main.ts` rewrites `apiUrl`/`reverbHost` automatically.)
- **Cleartext HTTP allowed** — so the phone can talk to your laptop / a no-SSL
  server over plain `http://` (`capacitor.config.ts` + Android manifest).
- **Android toolchain installer** — one script, no sudo, no Android Studio.
- **npm scripts** — `dev:device`, `go:wireless`, `apk:debug`, `apk:release` in
  both apps. `go:wireless` (run once over USB) sets up cable-free hot reload.

---

## 1. Prerequisites

Already present on this machine: **Node 22, PHP 8.3, Composer, MySQL**. You only
need the Android build toolchain, which installs into your home folder (no sudo,
no system changes, no Android Studio):

```bash
bash scripts/install-android-toolchain.sh
```

This installs **Temurin JDK 21**, the **Android SDK command-line tools**,
**platform-tools (adb)**, and **build-tools 35**, and adds them to `~/.bashrc`.

> Already installed once in this repo. To use the tools in a fresh terminal:
> `source ~/android-dev/env.sh` (new terminals pick it up automatically).

Verify:

```bash
source ~/android-dev/env.sh
java -version        # 21.x
adb --version        # 1.0.41
sdkmanager --list | head
```

---

## 2. First-time project install

```bash
# Backend
cd backend
composer install
cp .env.example .env        # then set DB_* for your local MySQL
php artisan key:generate
php artisan migrate --seed

# Customer app
cd ../customer-mobile && npm install

# Driver app
cd ../driver-mobile && npm install
```

The Capacitor `android/` projects are already generated. If you ever need to
recreate them: `npx cap add android`.

---

## 3. Run the backend (one command, or three)

Your phone and laptop must be on the **same Wi-Fi**. The easy way — one command
runs the API + websockets + queue + scheduler together:

```bash
cd backend
php artisan cab:dev          # serve :8000 + reverb :8080 + queue + scheduler
```

Or run them as three separate processes (note the `0.0.0.0` — it lets the phone
reach your laptop):

```bash
php artisan serve --host=0.0.0.0 --port=8000
php artisan reverb:start --host=0.0.0.0 --port=8080
php artisan queue:work
```

---

## 4. Run live on your phone (hot reload)

1. Plug your Android phone in via USB and enable **USB debugging**
   (Settings → Developer options). Also enable **"Stay awake"**.
2. Confirm it's seen:
   ```bash
   source ~/android-dev/env.sh
   adb devices            # your device shows as "device" (not "unauthorized")
   ```
3. Launch with live reload (run inside the app folder):
   ```bash
   cd customer-mobile && npm run dev:device     # customer  (dev server :8100)
   # or
   cd driver-mobile && npm run dev:device       # driver    (dev server :8200)
   ```

This builds the app, installs it on the phone, and **hot-reloads on every
save**. Because of auto-IP detection, the app automatically talks to your
laptop's `:8000` API and `:8080` Reverb — no config editing. Leave the terminal
open while you code; you only re-run for native changes (new plugin, etc.).

### Go wireless (drop the cable) — one command

With the phone **plugged in over USB**, run this **once** (inside either app
folder):
```bash
npm run go:wireless
```
It reads the phone's Wi-Fi IP itself, switches adb to TCP/IP, connects, and
**remembers the IP** (in `~/android-dev/wireless-ip`). Then unplug the cable.

From now on just run `npm run dev:device` — if no device is attached it
**auto-reconnects** to that remembered phone over Wi-Fi and waits a few seconds
for it to come up, so a briefly-dropped link heals itself instead of erroring.

> If the phone sleeps, Wi-Fi can still drop the link — enable **Developer
> options → "Stay awake"** to prevent it. To re-pair after a reboot or an IP
> change, just run `npm run go:wireless` again over USB.
>
> Prefer doing it by hand? That still works:
> ```bash
> adb tcpip 5555
> adb connect <phone-wifi-ip>:5555    # find IP: Settings → About → Status
> ```

---

## 5. Build an installable APK

```bash
# Debug APK (quick, for testing/sharing)
cd customer-mobile && npm run apk:debug
#   -> android/app/build/outputs/apk/debug/app-debug.apk

# Release APK (for the server-pointed production build)
npm run apk:release
#   -> android/app/build/outputs/apk/release/app-release.apk  (unsigned)
```

Install on a connected phone:

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

> A **release** APK must point at your deployed server. Set `SERVER_HOST` in
> `src/environments/environment.prod.ts` first (see `DEPLOY.md` step 6). For the
> Play Store you'll also need to **sign** the release APK — out of scope for the
> first launch; the debug/unsigned APK installs fine for testing.

---

## 6. How the config is structured

| File | Purpose |
| ---- | ------- |
| `src/environments/environment.ts` | **Dev** config. `localhost` by default; auto-rewritten to your LAN IP on a real device. |
| `src/environments/environment.prod.ts` | **Prod** config. Edit one line: `SERVER_HOST`. Used by `--configuration production` builds. |
| `src/main.ts` | Contains the dev-only auto-IP rewrite. |
| `capacitor.config.ts` | `cleartext: true` for HTTP. Set `false` once you have HTTPS. |

---

## 7. Common issues

| Symptom | Fix |
| ------- | --- |
| `adb: command not found` | `source ~/android-dev/env.sh` (or open a new terminal). |
| Phone shows "unauthorized" | Accept the USB-debugging prompt on the phone (unlock it first). |
| App loads but no data | Backend not on `0.0.0.0`, or not same Wi-Fi. Restart with `php artisan cab:dev`. |
| Real-time not updating | Reverb not running, or `reverbAppKey` mismatch between app and `backend/.env`. |
| `invalid source release: 21` | `source ~/android-dev/env.sh` so `JAVA_HOME` points at JDK 21. |
| Prod build CSS budget error | Already raised to 50kb in `angular.json`. |
| Ionic re-runs `capacitor init` / `npm i` each launch | `ionic.config.json` must contain `"integrations": { "capacitor": {} }` (already set). |
