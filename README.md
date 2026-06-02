# 🚕 DreamCabs — Full Setup Guide (0 → 100%)

A complete, step-by-step guide for a brand-new developer to get the **entire
DreamCabs platform** running locally and deployed to a server — with **zero
prior knowledge of the project**. Follow it top to bottom.

> Two deeper companion docs exist and are linked where relevant:
> **[`MOBILE_SETUP.md`](MOBILE_SETUP.md)** (mobile deep-dive) and
> **[`DEPLOY.md`](DEPLOY.md)** (server deployment deep-dive).

---

## 1. What is DreamCabs? (the big picture)

DreamCabs is a ride-hailing platform (like Uber/Ola) with **four** parts that
all talk to one backend:

```
                       ┌────────────────────────────┐
                       │        BACKEND (API)        │
                       │  Laravel 13 · PHP 8.3       │
                       │  MySQL · Reverb (websockets)│
                       │  Queue worker · Scheduler   │
                       └─────────────┬──────────────┘
            ┌────────────────────────┼────────────────────────┐
            │                        │                         │
   ┌────────▼────────┐      ┌────────▼────────┐      ┌─────────▼────────┐
   │ CUSTOMER mobile │      │  DRIVER mobile  │      │  ADMIN frontend  │
   │ Ionic + Angular │      │ Ionic + Angular │      │   Angular 17     │
   │   (Capacitor)   │      │   (Capacitor)   │      │   (web, :4200)   │
   │  books rides    │      │  accepts rides  │      │ manage platform  │
   └─────────────────┘      └─────────────────┘      └──────────────────┘
```

| Folder | What it is | Tech | Runs on |
| ------ | ---------- | ---- | ------- |
| `backend/` | The API + websockets + jobs — the brain | Laravel 13, PHP 8.3, MySQL, Reverb | Server (or laptop in dev) |
| `customer-mobile/` | The rider app | Ionic 8 + Angular 20 + Capacitor 8 | Android phone |
| `driver-mobile/` | The driver app | Ionic 8 + Angular 20 + Capacitor 8 | Android phone |
| `frontend/` | Admin web dashboard | Angular 17 | Browser |

**How they connect:** the mobile apps and admin panel send HTTP requests to the
backend's API (`/api`) and open a websocket to **Reverb** for real-time updates
(a driver's live location, ride status changes, etc.).

---

## 2. Prerequisites (install once)

| Tool | Version | Check | Install |
| ---- | ------- | ----- | ------- |
| **Node.js** | 20+ (22 ok) | `node -v` | [nodejs.org](https://nodejs.org) |
| **PHP** | 8.3+ | `php -v` | `sudo apt install php8.3-cli php8.3-{mysql,mbstring,xml,bcmath,curl,gd,zip}` |
| **Composer** | 2.x | `composer -V` | [getcomposer.org](https://getcomposer.org) |
| **MySQL** | 8.x | `mysql --version` | `sudo apt install mysql-server` (or XAMPP/Laragon) |
| **Git** | any | `git --version` | `sudo apt install git` |
| **Android toolchain** | JDK 21 + SDK | `adb --version` | **Auto-installed by our script — see §5** |

> ⚠️ You do **NOT** need Android Studio. Our script installs only the Android
> command-line tools. Everything works from VS Code + terminal.

---

## 3. Get the code

```bash
git clone <your-repo-url> cab
cd cab
```

You'll see `backend/`, `customer-mobile/`, `driver-mobile/`, `frontend/`.

---

## 4. PART A — Backend (do this first; everything depends on it)

```bash
cd backend

# 1. Install PHP dependencies
composer install

# 2. Create your config file
cp .env.example .env

# 3. Create the database (in MySQL)
#    mysql -u root -p  ->  CREATE DATABASE dreamcabs;
#    Then edit .env:
#      DB_CONNECTION=mysql
#      DB_DATABASE=dreamcabs
#      DB_USERNAME=root
#      DB_PASSWORD=<your mysql password>
#    And turn ON realtime + set the websocket key:
#      BROADCAST_CONNECTION=reverb
#      REVERB_APP_KEY=4jsb8ggrbvcriyaskojh
#      REVERB_APP_ID=dreamcabs
#      REVERB_APP_SECRET=<any long random string>

# 4. Generate the app key
php artisan key:generate

# 5. Create all tables + seed starter data (admin user, roles, sample trips)
php artisan migrate --seed

# 6. Install frontend tooling assets used by Laravel
npm install && npm run build
```

### Default admin login (created by the seeder)
- **Email:** `admin@example.com`
- **Password:** `password`

> To use your own: set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env` **before**
> running `php artisan migrate --seed`.

### Run the backend (one command runs ALL of it)

```bash
php artisan cab:dev
```

This single command starts **everything the apps need**, with color-coded logs:
- `serve`  → API on `http://0.0.0.0:8000`
- `reverb` → websockets on `ws://0.0.0.0:8080`
- `queue`  → background job worker
- `sched`  → scheduled tasks (pricing, cleanup, etc.)

Press **Ctrl+C** to stop them all. `0.0.0.0` is important — it lets your phone
reach the backend over Wi-Fi.

> Prefer separate terminals? Run these three instead:
> ```bash
> php artisan serve --host=0.0.0.0 --port=8000
> php artisan reverb:start --host=0.0.0.0 --port=8080
> php artisan queue:work
> ```

✅ **Test it:** open `http://localhost:8000/api` in a browser — you should get a
JSON response (not an error page).

---

## 5. PART B — Mobile apps (customer + driver)

### 5.1 One-time: install the Android toolchain (no sudo, no Android Studio)

From the **repo root**:

```bash
bash scripts/install-android-toolchain.sh
```

This installs JDK 21 + Android SDK + `adb` into your home folder and wires them
into `~/.bashrc`. After it finishes, open a new terminal (or run
`source ~/android-dev/env.sh`) and verify:

```bash
java -version   # 21.x
adb --version   # 1.0.41
```

### 5.2 Install dependencies for both apps

```bash
cd customer-mobile && npm install && cd ..
cd driver-mobile   && npm install && cd ..
```

> The Capacitor `android/` native projects are already generated. To recreate
> them from scratch: `npx cap add android`.

### 5.3 Turn on debugging on the phone (one-time, do this first)

Required for both USB and wireless:

1. **Settings → About phone → tap "Build number" 7×** → unlocks Developer options.
2. **Settings → Developer options → enable "USB debugging"**.
3. *(Recommended)* In Developer options also enable **"Stay awake"** — keeps the
   screen on while charging so the Wi-Fi link doesn't sleep and drop.

### 5.4 Connect the phone — pick ONE path

> First, load the Android tools into your terminal (only needed if `adb` isn't
> found — a fresh terminal does it automatically):
> ```bash
> source ~/android-dev/env.sh
> ```

#### Path A — USB cable (simplest, most reliable)

```bash
# 1. Plug the phone into the laptop with a USB cable.
# 2. On the phone, tap "Allow" on the "Allow USB debugging?" popup.
# 3. Verify the phone is connected:
adb devices
#    Expected — a serial in state "device":
#      List of devices attached
#      RZ8R21B23PF     device
```
If you see `unauthorized`, unlock the phone and tap **Allow**. If you see
nothing, replug the cable. That's it — skip to §5.5.

#### Path B — Wireless / Wi-Fi (no cable) — set up once

With the phone **still plugged in via USB** (from Path A) and on the **same
Wi-Fi** as the laptop, run this **once** from inside either app folder:

```bash
cd customer-mobile           # or driver-mobile
npm run go:wireless
#    Expected:
#      📶 Phone Wi-Fi IP: 192.168.x.x
#      ✅ Wireless ready and remembered (192.168.x.x)
#      You can unplug the USB cable now.
```

This reads the phone's Wi-Fi IP automatically, switches adb to wireless,
connects, and **remembers the IP** (in `~/android-dev/wireless-ip`). Now
**unplug the cable** — from here on `npm run dev:device` auto-reconnects to that
phone over Wi-Fi (and waits out a briefly-dropped link).

```bash
# Confirm it's connected wirelessly:
adb devices
#      192.168.x.x:5555     device
```

> Re-run `npm run go:wireless` (over USB) only if the phone reboots or its Wi-Fi
> IP changes. Keep **"Stay awake"** on so the link doesn't drop.

### 5.5 Run live on the phone with hot reload

Make sure the **backend is running** (§4) and the phone shows up in
`adb devices` (§5.4), then:

```bash
cd customer-mobile && npm run dev:device   # customer app  (dev server :8100)
# in another terminal:
cd driver-mobile   && npm run dev:device   # driver app    (dev server :8200)
```

Each command builds the app, installs it on your phone, and **hot-reloads on
every save**. Leave the terminal open while you code. To stop, press **Ctrl+C**.

> **🪄 Zero IP editing:** the apps auto-detect your laptop's IP at runtime, so
> they find the backend automatically — you never edit an IP address. (See
> `src/main.ts` and [`MOBILE_SETUP.md`](MOBILE_SETUP.md) for how.)
>
> **Tip:** if both USB *and* Wi-Fi are connected at once, `dev:device` just
> picks the first one adb lists — unplug USB to force the wireless device.

### 5.6 Build installable APKs

```bash
cd customer-mobile && npm run apk:debug      # -> android/app/build/outputs/apk/debug/app-debug.apk
cd driver-mobile   && npm run apk:debug
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

---

## 6. PART C — Admin web dashboard (`frontend/`)

```bash
cd frontend
npm install
npm start          # = ng serve  →  http://localhost:4200
```

Open `http://localhost:4200`, log in with the admin credentials from §4.
(The dashboard talks to `http://localhost:8000/api` by default in dev.)

Build for production: `npm run build` → output in `frontend/dist/`.

---

## 7. The complete dev checklist (everything running at once)

| # | Terminal | Folder | Command | Gives you |
| - | -------- | ------ | ------- | --------- |
| 1 | Backend  | `backend/` | `php artisan cab:dev` | API + websockets + jobs |
| 2 | Admin    | `frontend/` | `npm start` | Dashboard at `:4200` |
| 3 | Customer | `customer-mobile/` | `npm run dev:device` | Rider app on phone |
| 4 | Driver   | `driver-mobile/` | `npm run dev:device` | Driver app on phone |

Phone + laptop must be on the **same Wi-Fi**. That's a fully working platform. 🎉

---

## 8. PART D — Deployment (going to a real server)

Full step-by-step is in **[`DEPLOY.md`](DEPLOY.md)**. Short version:

Your app needs **persistent processes** (Reverb + queue), so use a small **VPS**
(Hetzner/DigitalOcean, ~$5–12/mo on Ubuntu 24.04) — not shared/cPanel hosting.
The backend ships with a **one-command Docker stack** that runs nginx + PHP +
MySQL + Reverb + queue + scheduler together:

```bash
# On the server (after installing Docker — see DEPLOY.md §2):
cd backend
cp .env.production.example .env     # set passwords, APP_URL, Reverb secret
cp <firebase-key>.json deploy/secrets/firebase.json
bash deploy/deploy.sh               # builds + launches everything
```

Then point the apps at the server: set `SERVER_HOST` in **one line** of each
app's `src/environments/environment.prod.ts`, run `npm run apk:release`, and
distribute the APKs. The admin dashboard: `npm run build` and host the
`dist/` folder (or behind the same nginx). Details + HTTPS-later steps in
`DEPLOY.md`.

---

## 9. Reference

### Ports
| Service | Port | URL |
| ------- | ---- | --- |
| Backend API | 8000 | `http://localhost:8000/api` |
| Reverb websockets | 8080 | `ws://localhost:8080` |
| Admin dashboard | 4200 | `http://localhost:4200` |
| Customer dev server | 8100 | (live-reload) |
| Driver dev server | 8200 | (live-reload) |

### Key files to know
| File | Purpose |
| ---- | ------- |
| `backend/.env` | All backend config (DB, Reverb, Firebase, Razorpay) |
| `*/src/environments/environment.ts` | Mobile **dev** config (auto-IP) |
| `*/src/environments/environment.prod.ts` | Mobile **prod** config (set `SERVER_HOST`) |
| `*/capacitor.config.ts` | Native app config (cleartext HTTP toggle) |
| `backend/docker-compose.yml` | The whole production stack |
| `scripts/install-android-toolchain.sh` | One-shot Android setup |

### Useful backend commands
```bash
php artisan migrate:fresh --seed   # wipe + rebuild DB with sample data
php artisan db:seed                # re-run seeders only
php artisan cab:dev                # run the whole backend for dev
php artisan queue:work             # process jobs
```

---

## 10. Troubleshooting

| Symptom | Fix |
| ------- | --- |
| `adb: command not found` | `source ~/android-dev/env.sh` or open a new terminal |
| Phone shows `unauthorized` | Tap **Allow** on the USB-debugging popup (unlock phone first) |
| App loads but **no data** | Backend not running, not on `0.0.0.0`, or phone on different Wi-Fi |
| **Real-time not updating** | `BROADCAST_CONNECTION=reverb` in `.env`; Reverb running on `:8080`; `REVERB_APP_KEY` matches the app |
| Wireless adb dropped | `npm run dev:device` auto-reconnects; enable "Stay awake" to stop drops. Re-pair after reboot/IP change: `npm run go:wireless` (over USB) |
| `<ip>:5555 is not a valid Target ID` | Stale wireless link — `npm run dev:device` now reads the id from Capacitor's list so this is fixed; if it persists, re-run `npm run go:wireless` |
| `invalid source release: 21` | `source ~/android-dev/env.sh` so JDK 21 is active |
| Prod build "CSS budget" error | Already raised to 50kb in `angular.json` |
| Admin login fails | Run `php artisan migrate --seed`; default `admin@example.com` / `password` |
| `docker compose` permission denied | Re-login after `usermod -aG docker $USER`, or use `sudo` |

---

*Built with: Laravel 13 · Ionic 8 · Angular 20/17 · Capacitor 8 · Reverb · MySQL · Docker.*
