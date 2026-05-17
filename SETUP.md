# DreamCabs — Setup Guide (Local + Server)

This document explains how to bring the **entire DreamCabs platform** up from a fresh machine, both on a **developer's laptop** and on a **production server** ready for real users.

The platform has four pieces:

| Piece | Folder | What it is | Tech |
|---|---|---|---|
| **Backend API** | `backend/` | The brain — stores data, runs the dispatch engine, sends push notifications | Laravel 13, PHP 8.3, MySQL |
| **Admin Web** | `frontend/` | The dashboard for operators (you and your staff) | Angular 17 + PrimeNG |
| **Customer App** | `customer-mobile/` | What riders install on Android/iOS | Ionic 8 + Capacitor |
| **Driver App** | `driver-mobile/` | What drivers install on Android/iOS | Ionic 8 + Capacitor |

Each section below has a **plain-English** part anyone can follow, and a `*For developers:*` block underneath with the exact commands.

---

## Part 1 — Prerequisites (one-time, on every machine)

You need these installed before anything else works.

### Plain English
- **A computer** running Linux, macOS, or Windows (Windows users should use WSL2 — the project is tested on Linux).
- **PHP 8.3** — the language the backend is written in.
- **Composer** — PHP's package manager.
- **MySQL 8** — the database.
- **Node.js 20 LTS** + **npm** — needed by all three frontend apps.
- **Git** — to download the source code.
- **Android Studio** (only when you want to build the Android apps).
- **Xcode** (only on a Mac, only when you want to build the iOS apps).

### *For developers:*
```bash
# Ubuntu / Debian
sudo apt update
sudo apt install -y php8.3-cli php8.3-fpm php8.3-mysql php8.3-mbstring \
                    php8.3-xml php8.3-curl php8.3-bcmath php8.3-gd \
                    php8.3-zip php8.3-intl php8.3-redis \
                    composer mysql-server git curl unzip

# Node 20 LTS via nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20

# Ionic CLI (global) — used by both mobile apps
npm install -g @ionic/cli @angular/cli
```

Verify with:
```bash
php -v        # 8.3.x
composer -V   # 2.x
node -v       # v20.x
mysql --version
```

---

## Part 2 — Third-party accounts you must create

These are **outside** the source code. The app cannot fully function without them.

| Service | Used for | Required? |
|---|---|---|
| **Firebase** (Google) | Phone-OTP login, Google sign-in, push notifications | Yes — non-negotiable |
| **Google Cloud → Maps Platform** | Maps, places autocomplete, geocoding | Yes |
| **Razorpay** | UPI / card payments (India) | Only if you want online payments. Cash works without it. |
| **Domain name + SSL** | A real address like `dreamcabs.com` | For production only |
| **Play Console** ($25 one-time) | Publishing the Android apps | For production only |
| **Apple Developer** ($99 / year) | Publishing the iOS apps | For production only |

### Firebase — what to create

1. Go to [Firebase Console](https://console.firebase.google.com) → **Add project** → name it (e.g. `dreamcabs`).
2. **Authentication → Sign-in method** → enable **Phone** and **Google**.
3. Add a **Web app** (`</>` icon). Copy the config object — you'll paste it into the mobile environment files.
4. **Cloud Messaging → Web Push certificates → Generate key pair**. Copy the long string — that's your VAPID key.
5. **Project Settings → Service accounts → Generate new private key** — you get a JSON file. **Treat this like a password.** Save it somewhere safe; the backend reads it.

### Google Maps key

1. [console.cloud.google.com](https://console.cloud.google.com) → **APIs & Services**.
2. Enable: **Maps JavaScript API**, **Places API**, **Geocoding API**, **Maps SDK for Android**, **Maps SDK for iOS**.
3. **Credentials → Create credentials → API key**. Restrict it (HTTP referrers for the web key, package name + SHA-1 for Android, bundle ID for iOS).

---

## Part 3 — Local development setup

Goal: **run all four apps on your laptop**, talking to each other over `localhost`.

### Step 1 — Clone the repo

```bash
git clone <your-repo-url> dreamcabs
cd dreamcabs
```

### Step 2 — Set up the database

Plain English: create an empty MySQL database called `dreamcabs` that the backend can fill with tables.

```bash
sudo mysql -u root
```
Inside the MySQL prompt:
```sql
CREATE DATABASE dreamcabs CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'dreamcabs'@'localhost' IDENTIFIED BY 'change-me';
GRANT ALL ON dreamcabs.* TO 'dreamcabs'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

### Step 3 — Backend

```bash
cd backend
cp .env.example .env
composer install
php artisan key:generate
php artisan storage:link
```

Open `backend/.env` and fill in:

```env
APP_NAME=DreamCabs
APP_ENV=local
APP_DEBUG=true
APP_URL=http://localhost:8000

DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=dreamcabs
DB_USERNAME=dreamcabs
DB_PASSWORD=change-me

# Realtime (WebSocket) — values can be anything random; just match them in mobile envs
BROADCAST_CONNECTION=reverb
REVERB_APP_ID=619412
REVERB_APP_KEY=local-app-key-change-me
REVERB_APP_SECRET=local-secret-change-me
REVERB_HOST=localhost
REVERB_PORT=8080
REVERB_SCHEME=http

# Queue (sync = run jobs inline; fine for dev. Use 'database' once you start queue:work)
QUEUE_CONNECTION=database

# Firebase service account JSON — point to the file you downloaded
FIREBASE_CREDENTIALS_PATH=/absolute/path/to/dreamcabs-firebase-adminsdk.json

# Razorpay (leave blank if not using online payments yet)
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
RAZORPAY_CURRENCY=INR
```

Run migrations and seed the demo data:
```bash
php artisan migrate --seed
```

This creates ~70 tables (users, trips, cities, ride_types, dispatcher_settings, etc.) and seeds at least one admin login.

**Boot the backend services in one shot** using the included orchestrator:
```bash
./dev.sh
```

This script (see `backend/dev.sh`) runs four processes side by side with prefixed logs:
- `php artisan serve` on **:8000** — the HTTP API
- `php artisan reverb:start` on **:8080** — the WebSocket gateway (live driver pins, chat, fare-negotiation events)
- `php artisan queue:work` — picks up dispatch jobs and push notifications
- `php artisan schedule:work` — wakes scheduled rides every minute, prunes stale device tokens nightly

Hit `Ctrl+C` to stop everything cleanly.

### Step 4 — Admin web

In a new terminal:
```bash
cd frontend
npm install
npm start
```
Opens at **http://localhost:4200**. Sign in with the seeded admin credentials (check `backend/database/seeders/`).

### Step 5 — Customer mobile app (browser preview)

```bash
cd customer-mobile
npm install
```

Open `customer-mobile/src/environments/environment.ts` and fill:

```ts
export const environment = {
  production: false,
  apiUrl: 'http://localhost:8000/api',
  googleMapsApiKey: 'AIza...your-maps-key',
  reverbAppKey: 'local-app-key-change-me',  // must match backend .env
  reverbHost: 'localhost',
  reverbPort: 8080,
  reverbScheme: 'http',
  firebase: {
    apiKey: '...',           // From Firebase Console → Web app config
    authDomain: '...',
    projectId: '...',
    storageBucket: '...',
    messagingSenderId: '...',
    appId: '...',            // MUST contain ':web:' for browser to work
  },
  fcmVapidKey: 'B....the-long-vapid-key',
};
```

Run:
```bash
ionic serve
```
Opens at **http://localhost:8100**. Use Chrome's device-mode to simulate phone size.

### Step 6 — Driver mobile app

Same as Step 5 but in the `driver-mobile/` folder. Use a **different port** so both can run side by side:
```bash
cd driver-mobile
npm install
ionic serve --port=8101
```

### Step 7 — Build & install on a real Android phone (development)

Plain English: this puts the app on your physical device so you can test GPS, push, and background location for real (a browser cannot test these).

```bash
# Customer
cd customer-mobile
ionic build
npx cap sync android
npx cap open android      # opens Android Studio
# Then in Android Studio: connect phone via USB, click ▶ Run
```
Repeat for `driver-mobile/`.

> **Important:** before the first run, drop `google-services.json` (download from Firebase Console → Project Settings → Android app) into `android/app/`. Without it, push and Google sign-in won't work on Android.

### Step 8 — Build on iOS (Mac only)

```bash
cd customer-mobile
ionic build
npx cap sync ios
npx cap open ios          # opens Xcode
# Drop GoogleService-Info.plist into the Xcode project, then ▶ Run
```

### Local-dev verification checklist

- [ ] http://localhost:8000/api/health returns `200 OK`
- [ ] http://localhost:4200 — admin sign-in works
- [ ] WebSocket: open DevTools → Network → WS — you see a `wss://localhost:8080` connection
- [ ] http://localhost:8100 — customer app loads, can request OTP
- [ ] Customer OTP login lands you on the booking screen with the map
- [ ] Driver app `http://localhost:8101` — driver can come online; pin appears on customer search map within 5 s
- [ ] Hit **Book** — driver sees the ride within 5 s (auto-dispatch hop)

---

## Part 4 — Production server setup

Goal: a real, public deployment users can sign up to from the Play Store.

### Server sizing recommendation

| Tier | Concurrent rides | Spec |
|---|---|---|
| Pilot (1 city, < 50 active drivers) | < 50 | 1 VM: 2 vCPU, 4 GB RAM, 80 GB SSD |
| Growth (1 city, 50–500 drivers) | 50–500 | 1 VM: 4 vCPU, 8 GB RAM, 160 GB SSD + managed MySQL |
| Scale (multi-city) | 500+ | API VM(s) + separate MySQL + separate Reverb + Redis |

Cheapest reliable host: **Hetzner**, **DigitalOcean**, **Linode**, **AWS Lightsail**. Use **Ubuntu 24.04 LTS**.

### Step 1 — Server hardening (do once)

```bash
# As root, then create a non-root user and lock down SSH
adduser deploy
usermod -aG sudo deploy
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable
# Disable root SSH login: edit /etc/ssh/sshd_config → PermitRootLogin no, then `systemctl restart ssh`
```

### Step 2 — Install the runtime

```bash
sudo apt update
sudo apt install -y nginx mysql-server redis-server \
    php8.3-fpm php8.3-cli php8.3-mysql php8.3-mbstring php8.3-xml \
    php8.3-curl php8.3-bcmath php8.3-gd php8.3-zip php8.3-intl php8.3-redis \
    composer git unzip supervisor certbot python3-certbot-nginx

curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 20
```

### Step 3 — MySQL setup

```bash
sudo mysql_secure_installation
sudo mysql -u root -p
```
```sql
CREATE DATABASE dreamcabs CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'dreamcabs'@'localhost' IDENTIFIED BY 'a-strong-random-password';
GRANT ALL ON dreamcabs.* TO 'dreamcabs'@'localhost';
FLUSH PRIVILEGES;
```

### Step 4 — Pull the code

```bash
sudo mkdir -p /var/www
sudo chown deploy:deploy /var/www
cd /var/www
git clone <your-repo-url> dreamcabs
cd dreamcabs
```

### Step 5 — Backend deploy

```bash
cd /var/www/dreamcabs/backend
cp .env.example .env
composer install --no-dev --optimize-autoloader
php artisan key:generate
php artisan storage:link
```

Edit `/var/www/dreamcabs/backend/.env` for **production**:
```env
APP_NAME=DreamCabs
APP_ENV=production
APP_DEBUG=false
APP_URL=https://api.yourdomain.com
LOG_CHANNEL=daily
LOG_LEVEL=warning

DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_DATABASE=dreamcabs
DB_USERNAME=dreamcabs
DB_PASSWORD=a-strong-random-password

# Use database queue in prod so jobs survive crashes
QUEUE_CONNECTION=database
SESSION_DRIVER=database
CACHE_STORE=database
BROADCAST_CONNECTION=reverb

# Reverb — keep these long and random
REVERB_APP_ID=<random-6-digit>
REVERB_APP_KEY=<32-char-random>
REVERB_APP_SECRET=<32-char-random>
REVERB_HOST=ws.yourdomain.com
REVERB_PORT=443
REVERB_SCHEME=https

# Service account JSON — put it OUTSIDE the web root
FIREBASE_CREDENTIALS_PATH=/etc/dreamcabs/firebase-admin.json

RAZORPAY_KEY_ID=rzp_live_xxx
RAZORPAY_KEY_SECRET=xxx
RAZORPAY_WEBHOOK_SECRET=xxx
```

Place the Firebase JSON at `/etc/dreamcabs/firebase-admin.json` and `chmod 600` it.

Run migrations:
```bash
php artisan migrate --force
php artisan config:cache && php artisan route:cache && php artisan view:cache
```

Permissions:
```bash
sudo chown -R deploy:www-data storage bootstrap/cache
sudo chmod -R 775 storage bootstrap/cache
```

### Step 6 — Nginx for the API

`/etc/nginx/sites-available/api.yourdomain.com`:
```nginx
server {
    listen 80;
    server_name api.yourdomain.com;
    root /var/www/dreamcabs/backend/public;
    index index.php;
    client_max_body_size 20M;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        fastcgi_pass unix:/var/run/php/php8.3-fpm.sock;
        fastcgi_index index.php;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
    }

    location ~ /\.ht { deny all; }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/api.yourdomain.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.yourdomain.com   # gets free SSL
```

### Step 7 — Reverb (WebSocket) as a system service

`/etc/systemd/system/reverb.service`:
```ini
[Unit]
Description=Laravel Reverb
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/var/www/dreamcabs/backend
ExecStart=/usr/bin/php artisan reverb:start --host=127.0.0.1 --port=8080
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now reverb
```

Front Reverb behind Nginx with TLS at `ws.yourdomain.com`:
```nginx
server {
    listen 443 ssl http2;
    server_name ws.yourdomain.com;
    ssl_certificate /etc/letsencrypt/live/ws.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ws.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
    }
}
```
```bash
sudo certbot --nginx -d ws.yourdomain.com
```

### Step 8 — Queue worker via Supervisor

`/etc/supervisor/conf.d/dreamcabs-worker.conf`:
```ini
[program:dreamcabs-worker]
process_name=%(program_name)s_%(process_num)02d
command=/usr/bin/php /var/www/dreamcabs/backend/artisan queue:work --tries=3 --sleep=1 --max-time=3600
autostart=true
autorestart=true
user=deploy
numprocs=2
redirect_stderr=true
stdout_logfile=/var/log/dreamcabs/worker.log
stopwaitsecs=3600
```
```bash
sudo mkdir -p /var/log/dreamcabs
sudo supervisorctl reread && sudo supervisorctl update
sudo supervisorctl start dreamcabs-worker:*
```

### Step 9 — Cron for the scheduler

The scheduler powers `dispatch:wake-scheduled` (every minute), stale-negotiation cleanup, and nightly device-token pruning.

```bash
sudo crontab -e -u deploy
```
Add:
```
* * * * * cd /var/www/dreamcabs/backend && php artisan schedule:run >> /dev/null 2>&1
```

### Step 10 — Admin web (Angular) deploy

```bash
cd /var/www/dreamcabs/frontend
# Edit src/environments/environment.prod.ts → set apiUrl: 'https://api.yourdomain.com/api'
npm ci
npm run build -- --configuration=production
sudo mkdir -p /var/www/dreamcabs-admin
sudo cp -r dist/frontend/browser/* /var/www/dreamcabs-admin/
```

`/etc/nginx/sites-available/admin.yourdomain.com`:
```nginx
server {
    listen 80;
    server_name admin.yourdomain.com;
    root /var/www/dreamcabs-admin;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/admin.yourdomain.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d admin.yourdomain.com
```

### Step 11 — Mobile app production builds

#### Android (both apps)

1. Edit `customer-mobile/src/environments/environment.prod.ts`:
   ```ts
   apiUrl: 'https://api.yourdomain.com/api',
   reverbHost: 'ws.yourdomain.com',
   reverbPort: 443,
   reverbScheme: 'https',
   ```
2. Build and bundle:
   ```bash
   cd customer-mobile
   ionic build --prod
   npx cap sync android
   cd android
   ./gradlew bundleRelease
   ```
3. Output: `android/app/build/outputs/bundle/release/app-release.aab` — upload to Play Console.

> Sign the bundle with a **release keystore** (`keytool -genkey -v -keystore dreamcabs.keystore ...`). Never commit the keystore. Lose it = you can never update the app again.

Repeat for `driver-mobile/`. Use a **different `appId`** (`com.dreamcabs.driver`) so the two apps install side-by-side.

#### iOS (both apps)

```bash
cd customer-mobile
ionic build --prod
npx cap sync ios
npx cap open ios
```
In Xcode → **Product → Archive → Distribute App → App Store Connect**.

You need: Apple Developer account, an App ID per app (`com.dreamcabs.customer`, `com.dreamcabs.driver`), distribution provisioning profiles, and APNs Auth Key uploaded to Firebase.

### Step 12 — Production verification checklist

- [ ] `https://api.yourdomain.com/api/health` → `200`
- [ ] `https://admin.yourdomain.com` loads, sign-in works against prod DB
- [ ] WebSocket: `wscat -c wss://ws.yourdomain.com/app/<APP_KEY>` connects
- [ ] `sudo supervisorctl status` → `dreamcabs-worker:*` are RUNNING
- [ ] `sudo systemctl status reverb` → active (running)
- [ ] `sudo crontab -u deploy -l` shows the schedule:run entry
- [ ] OTP login on a real device (not emulator) succeeds
- [ ] A test booking on the customer app reaches a real driver and triggers a push notification

---

## Part 5 — Updating after the first deploy

Plain English: every time you change the code, you need to publish those changes.

```bash
# On the server
cd /var/www/dreamcabs
git pull

# Backend
cd backend
composer install --no-dev --optimize-autoloader
php artisan migrate --force
php artisan config:cache && php artisan route:cache
sudo supervisorctl restart dreamcabs-worker:*
sudo systemctl restart reverb

# Admin web
cd ../frontend
npm ci
npm run build -- --configuration=production
sudo cp -r dist/frontend/browser/* /var/www/dreamcabs-admin/
```

For the mobile apps, you build new `.aab` / `.ipa` files locally and upload to Play Console / App Store Connect. Users get the update from the store.

---

## Part 6 — Backups (do this from day 1)

### Database
Daily MySQL dump to a safe location:
```bash
sudo crontab -e
```
```
30 2 * * * mysqldump -u dreamcabs -p'<password>' dreamcabs | gzip > /var/backups/dreamcabs-$(date +\%Y\%m\%d).sql.gz
0 3 * * 0 find /var/backups -name 'dreamcabs-*.sql.gz' -mtime +30 -delete
```
Push the dumps off-server (S3, Backblaze B2, or `rsync` to another host) — a backup on the same VM is not a backup.

### Uploaded files
`storage/app/public/` holds city logos, splash images, profile pictures. Back this up too:
```bash
0 4 * * * tar -czf /var/backups/storage-$(date +\%Y\%m\%d).tar.gz -C /var/www/dreamcabs/backend storage/app/public
```

---

## Part 7 — Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Mobile app shows "no internet" but you have wifi | `apiUrl` in env points to `localhost` and you're not on the dev machine | Use your laptop's LAN IP (e.g. `http://192.168.1.10:8000/api`) or a tunnel like `ngrok http 8000` |
| Push notifications don't arrive on Android | `google-services.json` missing or wrong project | Re-download from Firebase Console; rebuild |
| OTP login throws `auth/configuration-not-found` in browser | The Firebase `appId` in env is for Android/iOS, not Web | Get the **Web** app config (must contain `:web:`) from Firebase → Project settings |
| Live driver pin doesn't move on customer map | Reverb not running, or `reverbAppKey` mismatch | `sudo systemctl status reverb`; verify env value matches both sides |
| Auto-dispatch never fires | Queue worker not running | `sudo supervisorctl status` — start `dreamcabs-worker:*` |
| Scheduled rides never wake up | Cron entry missing or wrong path | `sudo crontab -u deploy -l`; the line must call `php artisan schedule:run` every minute |
| Image uploads return 500 | `storage/` not writable, or `php artisan storage:link` was never run | `chmod -R 775 storage` and re-run `storage:link` |
| `php artisan migrate` says "Could not open input file" | You're not in `backend/` | `cd backend && php artisan migrate` |
| Frontend build error: TypeScript version mismatch | npm picked the wrong angular cli | `nvm use 20 && rm -rf node_modules package-lock.json && npm install` |

---

## Part 8 — File map (where to look when something is wrong)

| File | What to check |
|---|---|
| `backend/.env` | DB creds, Firebase path, Reverb keys, Razorpay keys, `APP_ENV`, `APP_DEBUG` |
| `backend/storage/logs/laravel.log` | Backend errors |
| `backend/dev.sh` | Local-dev orchestrator (serve + reverb + queue + scheduler in one) |
| `backend/routes/api.php` | All HTTP endpoints — start here when "where is X handled?" |
| `backend/routes/console.php` | Cron schedule (wake-scheduled, cleanup, prune-tokens) |
| `customer-mobile/src/environments/environment.ts` | Customer app endpoints, Firebase, maps key |
| `driver-mobile/src/environments/environment.ts` | Driver app endpoints, Firebase, maps key |
| `frontend/src/environments/environment.prod.ts` | Admin web prod API URL |
| `customer-mobile/android/app/google-services.json` | Android push config (Firebase) |
| `customer-mobile/ios/App/App/GoogleService-Info.plist` | iOS push config (Firebase) |
| `REALTIME_SETUP.md` | Deeper guide for the realtime/push pipeline |
| `DONE.md` | Everything that's already built |
| `TODO.md` | Everything still pending (production-readiness checklist lives here) |

---

## Quick-reference: the eight things that **must** be running in production

1. **Nginx** — serves API, admin web, and proxies Reverb (`systemctl status nginx`)
2. **PHP-FPM** — runs the Laravel app (`systemctl status php8.3-fpm`)
3. **MySQL** — the database (`systemctl status mysql`)
4. **Reverb** — WebSocket gateway (`systemctl status reverb`)
5. **Queue worker** — runs dispatch + push jobs (`supervisorctl status`)
6. **Cron** — fires the scheduler every minute (`crontab -u deploy -l`)
7. **TLS certificates** — auto-renewed by certbot (`certbot renew --dry-run`)
8. **Backups** — at least nightly DB dump going off-server

If any of these eight stops, **something user-visible breaks**. Set up uptime monitoring (e.g. UptimeRobot, Better Stack) on `https://api.yourdomain.com/api/health` and on `wss://ws.yourdomain.com`.
