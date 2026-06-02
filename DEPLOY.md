# DreamCabs — Server Deployment (Backend)

This deploys **everything the apps need** with one command: the Laravel API,
MySQL, the Reverb websocket server (real-time ride updates), the queue worker,
and the scheduler. It uses Docker Compose so the same stack runs identically on
any Linux server — no "works on my machine" surprises.

> **What deploys where:** the **backend** runs on the server. The **customer**
> and **driver** apps are Android APKs that run on phones (see
> `MOBILE_SETUP.md` → *Build a release APK*). The APKs just need to point at the
> server's IP.

---

## 1. Pick a server (cheapest that runs everything reliably)

Your app needs **persistent processes** (Reverb websockets + queue worker), so
shared/cPanel hosting won't work. The cheapest reliable option is a small VPS:

| Provider             | Plan            | ~Price/mo | Good for |
| -------------------- | --------------- | --------- | -------- |
| **Hetzner Cloud**    | CX22 (2 vCPU/4 GB) | ~€4   | Best value (EU) |
| **DigitalOcean**     | Basic 2 GB      | ~$12      | Easiest UI, lots of guides |
| **Contabo / Vultr**  | 4 GB            | ~$6       | Budget |

Pick **Ubuntu 24.04 LTS**. 2 GB RAM is the realistic minimum (MySQL + PHP +
Reverb). 4 GB gives headroom. You get a **public IP** — that's your
`SERVER_IP` everywhere below.

---

## 2. One-time server setup (install Docker)

SSH in (`ssh root@SERVER_IP`) and run:

```bash
# Install Docker Engine + Compose plugin (official convenience script)
curl -fsSL https://get.docker.com | sh

# Let your user run docker without sudo (optional; re-login after)
usermod -aG docker $USER

# Open the firewall ports the apps use
ufw allow 22/tcp      # SSH
ufw allow 80/tcp      # API (nginx)
ufw allow 8080/tcp    # Reverb websockets
ufw --force enable
```

---

## 3. Get the code onto the server

```bash
git clone <your-repo-url> dreamcabs
cd dreamcabs/backend
```

(Or `scp` the project up if it's not on GitHub.)

---

## 4. Configure it (edit ONE file)

```bash
cp .env.production.example .env
nano .env
```

Fill in the lines marked `>>> CHANGE <<<`:

- `APP_URL=http://SERVER_IP`
- `DB_PASSWORD` and `DB_ROOT_PASSWORD` — pick strong passwords
- `REVERB_APP_SECRET` — any long random string (e.g. `openssl rand -hex 24`)
- Keep `REVERB_APP_KEY=4jsb8ggrbvcriyaskojh` (it must match the mobile apps)

Then add your Firebase service-account key (needed for push + phone-auth
verification):

```bash
# Download from Firebase Console → project dreamcabs-c851f → Project settings
# → Service accounts → Generate new private key. Then put it here:
cp /path/to/downloaded.json deploy/secrets/firebase.json
```

---

## 5. Launch everything

```bash
bash deploy/deploy.sh
```

That builds the image and starts all six services. On first boot the `app`
container waits for MySQL, generates `APP_KEY`, runs migrations, and caches
config. Check it:

```bash
docker compose ps                       # all services "running"/"healthy"
docker compose logs -f app reverb queue # live logs
curl http://localhost/api               # API responds
```

Your API is now live at **`http://SERVER_IP/api`** and Reverb at
**`ws://SERVER_IP:8080`**.

---

## 6. Point the apps at the server + ship APKs

In **both** `customer-mobile/src/environments/environment.prod.ts` and
`driver-mobile/src/environments/environment.prod.ts`, set the single line:

```ts
const SERVER_HOST = 'SERVER_IP';   // e.g. '203.0.113.42'
```

Then build the release APKs (on your laptop):

```bash
cd customer-mobile && npm run apk:release
cd ../driver-mobile && npm run apk:release
```

APKs land at `android/app/build/outputs/apk/release/`. Install on phones via
`adb install <file>.apk` or share the file directly.

---

## 7. Updating later

```bash
cd dreamcabs/backend
bash deploy/deploy.sh     # pulls code, rebuilds, restarts — DB is preserved
```

---

## 8. Adding a domain + HTTPS later (recommended before real users)

1. Point an A record (e.g. `api.yoursite.com`) at `SERVER_IP`.
2. Easiest path: put **Caddy** or **nginx + certbot** in front, or add a
   `caddy` service to the compose file for automatic Let's Encrypt certs.
3. In both apps' `environment.prod.ts`: set `SERVER_HOST = 'api.yoursite.com'`
   and `USE_HTTPS = true`; set `cleartext: false` in `capacitor.config.ts`;
   rebuild the APKs.
4. Firebase phone auth is happier with a real domain (add it to *Authorized
   domains* in the Firebase console).

---

## Troubleshooting

| Symptom | Fix |
| ------- | --- |
| `docker compose` says permission denied | Re-login after `usermod -aG docker`, or use `sudo`. |
| App can't reach API from phone | Confirm port 80 open (`ufw status`) and `SERVER_HOST` is the public IP. |
| Real-time updates dead | Confirm `BROADCAST_CONNECTION=reverb` in `.env`, port 8080 open, `reverb` container running. |
| Push notifications fail | `deploy/secrets/firebase.json` missing or wrong project. |
| Migrations didn't run | `docker compose logs app` — check DB credentials match between `.env` and the `mysql` service. |
