# City Settings — Audit & Prioritized Fix List

**Scope:** the admin **City Settings** shell (`frontend/src/app/admin/settings/settings.component.ts`) and its three tabs — **Ride Products**, **City Settings**, **Dispatcher** — traced end-to-end into the customer app, driver app, and dispatch engine.

**Date:** 2026-06-03

---

## What the three tabs actually control

| Tab you see | What it really controls | Frontend | Backend controller | Model |
|---|---|---|---|---|
| **Ride Products** | The Local / Rental / Outstation "chips" a rider taps when booking (name, picture, on/off, order) | `general-settings.component.ts` | `AdminCityRideProductsController.php` | `CityRideProduct` |
| **City Settings** | Per-city switches, support phone numbers, allowed payment types | `city-settings.component.ts` | `AdminCitySettingsController.php` | `CitySetting` |
| **Dispatcher** | The "expanding circle" driver-search engine + scheduled-ride rules | `dispatcher-settings.component.ts` | `AdminDispatcherSettingsController.php` | `DispatcherSetting` |

> **One root cause to know up front:** the app **abandoned the "product type" (Local/Rental/Outstation) concept internally** but left its UI everywhere. That's why the Ride Products chips are cosmetic, the Dispatcher's Rental/Outstation rows are dead, and every trip is filed as `local`. See **Tier 3** below — it's the single biggest decision on this page.

---

## 🔴 TIER 1 — Fix first (small effort, prevents silent failures)

Cheap to fix; each one currently breaks or risks a *core* flow with no error shown.

| # | Fix | Why it matters | Effort | Where |
|---|---|---|---|---|
| ~~**1**~~ ✅ **DONE** | ~~**Manual-dispatch "find drivers" bug**~~ | **Fixed (2026-06-03):** `DispatchHopJob.php` now lets the discovery search run regardless of the `automatic_dispatcher_type` toggle, so the customer's driver search works in manual-dispatch cities too. The discovery search is also now wired into the find-driver step. | done | `DispatchHopJob.php` (discovery guard) |
| ~~**2**~~ ✅ **DONE** | ~~**"All products off" lockout guard**~~ | **Fixed (2026-06-03):** `AdminCityRideProductsController::update` now blocks deactivating the *last* active ride product (422 + clear message); the admin screen shows the message and reverts the toggle. At least one product always stays active. | done | `AdminCityRideProductsController::update` + `general-settings.component.ts` |
| ~~**3**~~ ✅ **DONE** | ~~**Lock payment modes to Cash/Razorpay**~~ | **Fixed (2026-06-03):** `AdminCitySettingsController::update` now upper-cases and accepts only `CASH`/`RAZORPAY` (rejects anything else instead of silently dropping it) and requires at least one. Admin screen shows the reason on rejection. | done | `AdminCitySettingsController::update` + `city-settings.component.ts` |
| ~~**4**~~ ✅ **DONE** | ~~**Vehicle-type filter in auto-dispatch**~~ | **Fixed (2026-06-03):** `DispatchHopJob` now matches the requested vehicle type (skipped for "All") + the city-priced check, mirroring `nearbyDrivers`. Customer app gained a ride-type selector (All + each type) on the find-driver step that re-prices + re-runs the filtered search. | done | `DispatchHopJob` + `customer-book.page.*` |

### If you only do three things this week
1. ✅ ~~**#1** manual-dispatch find-drivers~~ — **DONE** (fixed in the ride-flow rework).
2. ✅ ~~**#2** all-products-off guard~~ — **DONE**.
3. ✅ ~~**#3** lock payment modes~~ — **DONE**.

---

## 🟠 TIER 2 — Important reliability (medium effort)

Real bugs, but they bite under specific conditions rather than every ride.

| # | Fix | Why it matters | Effort | Where |
|---|---|---|---|---|
| ~~**5**~~ ✅ **DONE** | ~~**Overdue scheduled rides get stranded**~~ | **Fixed (2026-06-03):** `WakeScheduledTrips` now uses a **2-hour catch-up window** (not 5 min) so a ride still gets a driver after a deploy/outage, plus an **expire pass** that auto-cancels rides overdue beyond the window and **notifies the customer + admins** — no more silent abandonment. | done | `WakeScheduledTrips.php` (catch-up + expire pass) |
| ~~**6**~~ ✅ **DONE** | ~~**Hidden 0.5 km radius floor**~~ | **Fixed (2026-06-03):** `DispatchHopJob` now honours the configured request/hop radius (only falls back to 0.5 km when the config is blank/zero), so a sub-500 m radius actually takes effect. | done | `DispatchHopJob` (radius) |
| ~~**7**~~ ✅ **DONE** | ~~**No driver acceptance window**~~ | **Fixed (2026-06-03):** new **Driver accept window (sec)** dispatcher setting (default 30, 0 = off). Each ping is timestamped per (trip, driver) in cache; a driver who taps accept after the window gets a clear "expired" 409. Manual/select-driver flows are unaffected. | done | `dispatcher_settings` + `DispatchHopJob` + `FareNegotiationController::driverAction` |
| ~~**8**~~ ✅ **DONE** | ~~**Duplicate pings + double-dispatch**~~ | **Fixed (2026-06-03):** each driver is pinged **once** (only when newly reached by the ring), and a per-trip **generation token** makes any older/duplicate search chain self-abort so only one runs at a time. | done | `DispatchHopJob` (ping dedup + `startChain` gen token) |

---

## 🔵 TIER 3 — The one big strategic decision

| # | Decision | Why it's separate |
|---|---|---|
| **9** | **Decide the fate of "product type" (Local / Rental / Outstation)** | This single root cause makes the **Ride Products chips cosmetic**, the **Dispatcher Rental/Outstation rows dead**, and files **every trip as `local`**. Either **(a) wire it up** — store the product on each trip, read it in pricing + dispatch (bigger, multi-file) — **or (b) strip Rental/Outstation** out of both screens so the panel stops showing dead knobs (quick, makes the panel honest). |

**Highest-value decision on the page** — but it's a *business* decision, not a mechanical fix, which is why it's its own tier. Several Tier 4 items depend on which way this goes.

---

## ⚪ TIER 4 — Cleanup & honesty (low effort, low risk)

Nothing's broken, but the panel currently shows switches that do nothing — it "lies" to the operator.

| # | Fix | Where |
|---|---|---|
| 10 | **Dead City Settings switches** — 🔧 **3 of 4 done (2026-06-03):** ✅ **"Vehicle make & model"** (gates the make/model line on the rider's trip screen; default ON), ✅ **"Region-specific fare"** (shows the area rule's name + factor as an "Area fare" line in the rider's fare breakdown; default OFF, also gated per-rule by the rule's *is visible*), and ✅ **"Login OTP message" (Android/iOS)** — now used by the new **server-side MSG91 OTP** login path (`PhoneOtpService` reads the template). **Left:** ⬜ in-app chat toggle. | `city-settings.component.ts` + backend consumers |
| ~~11~~ ✅ **DONE** | ~~**Remove the dead `schedule_dispatch_instantly` selector**~~ — **built the feature instead (2026-06-03):** the mode now drives dispatch timing — **Delayed** (fire at alarm), **Instant** (dispatch at booking), **Instant & Delayed** (both, with the alarm as a safety re-fire). | `SchedulingPolicyService` + `WakeScheduledTrips` + booking controllers |
| 12 | **Fix the orphaned `emergency_no` field** (make it editable+used, or delete it) | `AdminCitySettingsController::shape()` |
| 13 | **Ride Products: add reorder control + "remove banner" button** | `general-settings.component.ts` |
| 14 | **Stop writing to the DB on page-load (GET)** — Ride Products & Dispatcher controllers re-insert rows on every visit | the two `index()` methods |
| 15 | **Delete misleading code comments** left from the retired product-type concept | `customer-book.page.ts:135, 386` |

---

# Detailed findings by tab

## 1) Ride Products tab

**Works end-to-end:** display **name**, banner **picture**, **on/off** toggle (disabling hides the chip in that city), and chip **order** (honored by the app).

**Missing / half-built:**
- No reorder control in the UI (order is respected but locked to the seeded order).
- No "remove banner" button (can replace, can't clear).
- **Product type is cosmetic only** — picking "Rental" vs "Local" changes what the rider sees but the server files every trip as `local` (leftover `product_kind` column on `trips` is never written).

**Bugs:**
- 🟠 Nothing stops turning all three products off → customer can't book at all.
- 🟡 Page load does unnecessary DB writes (re-creates the 3 rows each visit).
- 🟡 Misleading leftover code comments.

---

## 2) City Settings tab

Shows **11 editable things but only ~5 do anything.**

**Works end-to-end:**
- **Allowed payment modes (Cash / Razorpay)** — the real one. Rider's options = city-allowed ∩ driver-accepted.
- **Support contacts** — police no., driver support no., customer support no., support email (shown live in both apps' Support/Emergency screens).

**Dead switches (look functional, change nothing):**
- 🪦 In-app chat toggle
- ✅ ~~🪦 "Show region-specific fare"~~ **Wired (2026-06-03)** — surfaces the area rule's name + factor as an "Area fare" line in the rider's fare breakdown (default OFF; per-rule *is visible* also required).
- ✅ ~~🪦 "Show vehicle make & model"~~ **Wired (2026-06-03)** — gates the make/model line on the rider's trip screen (default ON; plate always shown).
- ✅ ~~🪦 Login OTP message (Android + iOS) — login is Firebase; the one SMS path uses a hardcoded message~~ **Wired (2026-06-03)** — new **server-side MSG91 OTP** login path generates + verifies the code on the server and uses this template. Toggle the app's `useServerOtp` flag to switch from Firebase. (Firebase path kept as fallback.)
- 🪦 `emergency_no` — orphaned: in DB but not editable on the screen and not read by the apps (they use the police number)

**Bugs:**
- 🟠 Payment modes not validated — saves junk that apps silently ignore (stored value drifts from intent).
- 🟡 Dead switches mislead the operator (flip "chat off", chat stays on).

---

## 3) Dispatcher tab

Controls two engines: the **expanding-circle driver search** and the **scheduled-ride rules**.

**Works end-to-end (for the *Local* product only):**
- Auto-dispatch on/off, hop interval, hop radius, starting radius, max hops.
- Scheduling rules: availability, min lead time, days ahead, max pending pre-bookings/customer, cancel window, "wake X min before pickup" alarm.
- Per-vehicle overrides take priority correctly.

**Big problem:** 🔴 **Rental and Outstation rows do nothing** — every dispatch consumer is hardcoded to read only the **Local** row (`DispatchHopJob.php:53`, `FareNegotiationController.php:138`, `WakeScheduledTrips.php:40`, `SchedulingPolicyService.php:89`).

**Other dead/missing:**
- ✅ ~~🪦 "Schedule dispatch mode" (Instant/Delayed/Both) — completely dead, never read.~~ **Wired up (2026-06-03)** — now controls when a scheduled ride dispatches (Delayed/Instant/Instant&Delayed).
- ✅ ~~❌ No driver acceptance window.~~ **Added (2026-06-03)** — "Driver accept window (sec)" setting + per-ping expiry.
- ✅ ~~❌ No vehicle-type filter in auto-dispatch (bike requests pinged to car drivers).~~ **Fixed earlier (Tier-1 #4).**

**Serious bugs:**
- 🔴 Manual-dispatch cities → "find drivers" silently returns nothing (`DispatchHopJob.php:54`).
- ✅ ~~🟠 Saved radius < 500 m ignored (hidden 0.5 km floor).~~ **Fixed (2026-06-03)** — configured radius honoured.
- ✅ ~~🟠 Overdue scheduled rides permanently stranded if worker down >5 min (`WakeScheduledTrips.php:36`).~~ **Fixed (2026-06-03)** — 2h catch-up window + auto-expire with notifications.
- ✅ ~~🟡 Same driver re-pinged every circle expansion (no dedup).~~ **Fixed (2026-06-03)** — pinged once (newly-reached only).
- ✅ ~~🟡 Possible double-dispatch (no lock).~~ **Fixed (2026-06-03)** — per-trip generation token.

---

*Generated from a read-only code audit. No files were modified during the audit.*
