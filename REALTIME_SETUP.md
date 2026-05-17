# Realtime Stack — Setup Guide

Everything that's been wired in code is listed below, plus the **manual steps you need to perform** before the realtime + push features will work end-to-end on browser, Android, and iOS.

---

## 1. Backend prerequisites (one-time)

### a) Run the new migration
```bash
cd backend
php artisan migrate
```
Adds the `device_tokens` table.

### b) Confirm Firebase Admin SDK credentials
The backend reuses the existing `FIREBASE_CREDENTIALS_PATH` env var (already set for OTP auth). FCM is sent through the same Service Account — no new credentials needed.

Verify:
```bash
grep FIREBASE_CREDENTIALS_PATH backend/.env
ls -l "$(grep ^FIREBASE_CREDENTIALS_PATH backend/.env | cut -d= -f2)"
```

### c) Reverb running locally
```bash
cd backend
php artisan reverb:start         # in one terminal
php artisan serve                # in another
```
Without Reverb the apps fall back to polling (15s) — slower but functional.

---

## 2. Browser (web push) setup

### a) Get the VAPID key
1. https://console.firebase.google.com → project `dreamcabs-c851f`
2. Project Settings → **Cloud Messaging** tab
3. Scroll to **Web Push certificates** → click **Generate key pair**
4. Copy the long string

### b) Paste into both environment files
Replace the empty `fcmVapidKey: ''` in:
- `customer-mobile/src/environments/environment.ts`
- `customer-mobile/src/environments/environment.prod.ts`
- `driver-mobile/src/environments/environment.ts`
- `driver-mobile/src/environments/environment.prod.ts`

### c) Verify the service worker is being served
After `ionic serve`, open `http://localhost:8100/firebase-messaging-sw.js` — you should see the service worker JS, not a 404.

### d) Test
1. Log in to either app in Chrome / Edge
2. Browser asks "Allow notifications?" → Allow
3. Check `device_tokens` table: a `web` row appears
4. Tinker on the backend:
   ```php
   php artisan tinker
   $u = App\Models\User::find(<your_user_id>);
   app(App\Services\NotificationService::class)
     ->sendToUser($u, 'Test push', 'Hello from FCM');
   ```
5. Notification appears in the browser

> **Safari note:** web push requires Safari 16+ on macOS. iOS Safari requires Add-to-Home-Screen first. For the broadest browser support, Chrome / Edge / Firefox work out of the box.

---

## 3. Android setup

> **Prerequisite:** Capacitor 8 CLI requires **Node ≥ 22**. Your current Node is 20. Run `nvm install 22 && nvm use 22` first. (If you don't have nvm: https://github.com/nvm-sh/nvm)

### a) Scaffold native Android folders
```bash
cd customer-mobile
npx cap add android
npx cap sync

cd ../driver-mobile
npx cap add android
npx cap sync
```

### b) Drop in `google-services.json`
1. https://console.firebase.google.com → project `dreamcabs-c851f`
2. Project Settings → **Your apps** → Add app → Android
3. Customer app: package name `com.dreamcabs.customer`
4. Driver app: package name `com.dreamcabs.driver`
5. Download `google-services.json` for **each** and place at:
   - `customer-mobile/android/app/google-services.json`
   - `driver-mobile/android/app/google-services.json`

### c) Apply the AndroidManifest.xml patches
Both apps need these permissions added inside `<manifest>` (above `<application>`):
```xml
<!-- Foreground location (Capacitor Geolocation already requests these) -->
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />

<!-- Background location streaming (driver-mobile only) -->
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />

<!-- FCM push notifications (Android 13+ requires runtime POST_NOTIFICATIONS) -->
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

The `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, and `FOREGROUND_SERVICE_LOCATION` lines are **driver-mobile only**. Customer-mobile only needs the foreground location + notifications lines.

### d) Open in Android Studio and run
```bash
cd customer-mobile && npx cap open android
# build and run on device or emulator
```
Same for driver-mobile.

### e) Test push
- Log in on the device → notification permission prompt → Allow → `device_tokens` row appears with `platform=android`
- Trigger a notification (same tinker snippet as web)

---

## 4. iOS setup

> Requires a Mac with Xcode 15+. Cannot be done from Linux.

### a) Scaffold
```bash
cd customer-mobile
npx cap add ios
npx cap sync

cd ../driver-mobile
npx cap add ios
npx cap sync
```

### b) Drop in `GoogleService-Info.plist`
Same Firebase Console → Add app → iOS → bundle IDs:
- Customer: `com.dreamcabs.customer`
- Driver: `com.dreamcabs.driver`

Place each downloaded `GoogleService-Info.plist` at:
- `customer-mobile/ios/App/App/GoogleService-Info.plist`
- `driver-mobile/ios/App/App/GoogleService-Info.plist`

Open the Xcode project (`npx cap open ios`) and **drag** the file into the App target so it gets bundled.

### c) Enable Push Notifications + Background Modes
In Xcode → Signing & Capabilities → `+ Capability`:
- **Push Notifications**
- **Background Modes** → check **Remote notifications**
- Driver only: **Background Modes** → check **Location updates**

### d) Upload APNs key to Firebase
1. https://developer.apple.com → Certificates, IDs & Profiles → Keys → `+` → **Apple Push Notifications service (APNs)** → Continue → Register → Download the `.p8`
2. Firebase Console → Project Settings → Cloud Messaging → **Apple app configuration** → Upload the `.p8` (you'll need your Team ID and Key ID)

### e) `Info.plist` strings (driver-mobile only)
Add these keys for the OS-required permission rationale dialogs:
- `NSLocationWhenInUseUsageDescription` — "DreamCabs uses your location to calculate fares and find nearby drivers."
- `NSLocationAlwaysAndWhenInUseUsageDescription` — "DreamCabs needs background location to share your trip progress with the rider."
- `NSMotionUsageDescription` — "DreamCabs detects motion to improve trip-tracking accuracy."

### f) Test
Same flow — log in, allow notifications, expect a `device_tokens` row with `platform=ios`, then trigger via tinker.

---

## 5. Production checklist

- [ ] `apiUrl` in `environment.prod.ts` points to your production API (currently `https://your-api.example.com/api` — placeholder)
- [ ] `reverbHost` / `reverbPort` / `reverbScheme` in `environment.prod.ts` point to your prod WebSocket node
- [ ] `fcmVapidKey` filled in for both apps
- [ ] `BROADCAST_CONNECTION=reverb` in production `.env`
- [ ] Reverb running behind a TLS terminator (nginx / Cloudflare) — **do not** expose port 8080 directly
- [ ] Production Firebase project (separate from `dreamcabs-c851f` if you want dev/prod isolation) — re-download `google-services.json` and `GoogleService-Info.plist` for each
- [ ] Android: `ACCESS_BACKGROUND_LOCATION` requires a Play Store policy review with a screencast and privacy-policy URL — budget 1–2 weeks
- [ ] iOS: APNs key uploaded to **production** Firebase project (not just dev)

---

## 6. What's wired in code (so you know what's already done)

### Backend
- `backend/database/migrations/2026_05_09_140000_create_device_tokens_table.php`
- `backend/app/Models/DeviceToken.php`
- `backend/app/Services/NotificationService.php` (uses `kreait/firebase-php` Messaging)
- `backend/app/Http/Controllers/DeviceTokensController.php`
- `backend/routes/api.php` — `POST /me/device-tokens`, `DELETE /me/device-tokens/{token}`
- `backend/app/Services/TripStateMachineService.php` — `TripStatusUpdated` re-enabled + per-status FCM trigger
- `backend/app/Http/Controllers/FareNegotiationController.php@customerConfirm` — driver gets a push when their bid wins
- `backend/app/Http/Controllers/SafetyController.php@trigger` — admins get a push on SOS

### Customer-mobile
- `src/app/core/realtime.service.ts` — `subscribeNegotiation` + `subscribeTracking`
- `src/app/core/push.service.ts` — `@capacitor-firebase/messaging` wrapper
- `src/firebase-messaging-sw.js` — web service worker
- `src/app/auth/login/login.page.ts` — registers token after every login
- `src/app/shared/side-menu/side-menu.component.ts` — unregisters on sign-out
- `src/app/pages/trip-active/trip-active.page.*` — live driver pin on map, live status badge

### Driver-mobile
- `src/app/core/realtime.service.ts` — `subscribeNegotiation` + `subscribeTripStatus`
- `src/app/core/push.service.ts` — same plugin wrapper
- `src/app/core/background-location.service.ts` — `@capacitor-community/background-geolocation` (native) with web foreground fallback
- `src/firebase-messaging-sw.js` — web service worker
- `src/app/auth/login/login.page.ts` — registers token after login
- `src/app/pages/more/more.page.ts` — unregisters on sign-out
- `src/app/pages/rides/rides.page.ts` — starts/stops background location on accept; subscribes to status updates

### Plugins installed
- `@capacitor-firebase/messaging` (both apps)
- `@capacitor/push-notifications` (both apps — fallback / iOS native)
- `@capacitor-community/background-geolocation` (driver-mobile)
- `@capacitor/geolocation` (driver-mobile, web fallback)
- `pusher-js` (driver-mobile — was already in customer-mobile)

---

## Web vs native location streaming (P0 caveat)

`driver-mobile/src/app/core/background-location.service.ts` falls back to
`@capacitor/geolocation`'s `watchPosition` on the web target. **This is
foreground-only.** Browsers throttle or suspend `watchPosition` when:

- The tab is backgrounded, the OS sleeps, or the screen locks.
- The user switches to another app (mobile browsers).

For dev / demos this is fine. **Production drivers must run the Capacitor
native build** (Android / iOS), which uses
`@capacitor-community/background-geolocation` and continues streaming with a
foreground-service notification.

If you're testing in a browser and the customer-side map stops updating,
check whether the driver tab is still focused before debugging the realtime stack.
