# Dream Cabs — Operational & Workflow Architecture Audit

> **Audit date:** 2026-07-16 · **Auditor:** pre-production operational review (code-traced, not assumed)
> **Scope:** backend (Laravel 12, PHP 8.3), admin frontend (Angular), customer-mobile (Ionic/Angular + Capacitor), driver-mobile (Ionic/Angular + Capacitor)
> **Companion doc:** [DreamCabs-Financial-Audit.md](DreamCabs-Financial-Audit.md) (money-flow deep dive)
>
> This document is the **operational architecture reference** for the project. Every claim below was traced to a file/line. It is designed to be read by future AI agents and developers; the checklist at the end is meant to be updated as items are fixed.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Overview](#2-system-overview)
3. [Subsystem Audits](#3-subsystem-audits)
   - 3.1 Authentication & Session
   - 3.2 Customer Onboarding
   - 3.3 Driver Onboarding & Documents
   - 3.4 Admin Onboarding & RBAC
   - 3.5 Solo (Private) Ride Lifecycle
   - 3.6 Fare Negotiation & Dispatch
   - 3.7 Scheduled Rides
   - 3.8 Fixed-Route Module
   - 3.9 Shuttle Module
   - 3.10 Payments, Invoices & Refunds
   - 3.11 Driver Wallet, Commission & Subscriptions
   - 3.12 Coupons & Promotions
   - 3.13 Notifications (Push / Email / SMS / In-app / Realtime)
   - 3.14 Location Tracking & Maps
   - 3.15 Safety / SOS
   - 3.16 Ratings & Trip History
   - 3.17 Support
   - 3.18 Background Jobs & Scheduled Tasks
   - 3.19 Admin Operations, Analytics & Reports
4. [Visibility Matrix](#4-visibility-matrix)
5. [Actionability Matrix](#5-actionability-matrix)
6. [Operational Failure Analysis](#6-operational-failure-analysis)
7. [Missing Capabilities Inventory](#7-missing-capabilities-inventory)
8. [Production Blockers](#8-production-blockers)
9. [Recommended Improvements & Roadmap](#9-recommended-improvements--roadmap)
10. [Improvement Checklist (living)](#10-improvement-checklist-living)
11. [Testing Checklist](#11-testing-checklist)
12. [Open Questions](#12-open-questions)
13. [Code Reference Index](#13-code-reference-index)

---

## 1. Executive Summary

Dream Cabs is a Kashmir-focused ride-hailing platform with three ride products (private/negotiated, fixed-route seat booking, shuttle), an operator-run admin panel, driver prepaid-wallet commission economics, and manual online payouts by design.

**The core happy paths are genuinely well built.** The trip state machine is strict and centralized, dispatch is idempotent and race-guarded (generation tokens, row locks, one-trip-per-driver backstop), payments are signature-verified with idempotency-key support, the fixed-route module has a real event timeline and refund states, RBAC with per-city manager scoping is thorough, and self-healing crons cover the most dangerous zombie states (stale negotiations, stale online drivers, overdue scheduled rides, overdue fixed departures with automatic refunds).

**The gap is operations, not features.** The recurring pattern across every subsystem: *the machine runs itself, but when it derails there is almost no way for a human to see it or fix it.*

### Top findings (detailed in §8)

| # | Finding | Severity |
|---|---------|----------|
| B1 | **Admin cannot intervene in a private trip.** `AdminTripsController` is read-only (index/show/latestLocation). No cancel, no reassign, no force-complete, no state override. | 🔴 Blocker |
| B2 | **Trips stuck in `CONFIRMED` never time out.** A driver who is confirmed but never taps Accept blocks himself (he's in `DRIVER_BUSY_STATUSES`) and the customer indefinitely; no cron covers `CONFIRMED`/`ASSIGNED`/in-progress statuses. | 🔴 Blocker |
| B3 | **No audit trail for admin actions.** Approvals, blocks, deletions, pricing changes, settings changes leave no log. Only the fixed module (`FixedBookingEvent`) and wallet rows (`created_by_user_id`) have any provenance. | 🔴 Blocker |
| B4 | **No monitoring/alerting.** `/health` returns `{ok:true}` unconditionally; no Sentry/error tracker; no queue-depth, scheduler-liveness, failed-jobs, or webhook-failure alerting. Silent worker death = silent platform death (dispatch is queue-driven). | 🔴 Blocker |
| B5 | **Uncollected-payment black hole.** A completed trip only gets a `payments` row if the customer taps pay. No "completed but unpaid" queue, no reconciliation report, yet commission is already debited from the driver. | 🔴 Blocker |
| B6 | **Customer refunds go to a wallet the customer cannot see or spend.** Fixed/shared refunds credit `wallet_transactions` for customers, but customer-mobile has no wallet screen and no spend/withdraw path. Refunded money effectively vanishes from the user's perspective. | 🔴 Blocker |
| M1 | Cancellation / no-show fees are computed and stored (`trips.cancellation_fee_amount`) but **never settled** — not charged to anyone, not credited to anyone, not surfaced anywhere. | 🟠 Major |
| M2 | Pending Razorpay refunds (`refund_status='APPROVED'`) have **no retry job and no admin "retry/mark-paid" action** for the fixed module (shuttle has a manual resolve). | 🟠 Major |
| M3 | `driver_locations` grows unbounded (every ping, throttled at 1/s/driver). No pruning, no partitioning. This is the hottest table in dispatch. | 🟠 Major |
| M4 | SOS events have no acknowledge/assign/resolve workflow (status stays `CREATED`), and **emergency contacts are never notified** on SOS despite the feature existing. | 🟠 Major |
| M5 | Razorpay webhook maps every non-captured status (incl. `authorized`) to `FAILED`, and unmatched webhooks 404 silently — no dead-letter. | 🟠 Major |
| M6 | Referral system: schema exists (`referral_settings` migration), zero implementation. Corporate accounts, driver→customer ratings, support ticketing: absent. | 🟡 Scoping |

### Production readiness scores (per subsystem, /10)

| Subsystem | Score | Bottleneck |
|---|---|---|
| Auth & sessions | 7.5 | mock-mode footguns, no session admin |
| Driver onboarding | 7 | good flow; no audit trail of approvals |
| Solo ride lifecycle | 6.5 | stuck-state recovery + admin override missing |
| Dispatch/negotiation | 7 | robust; observability zero |
| Scheduled rides | 7.5 | best-covered subsystem (expiry + wake + notices) |
| Fixed-route module | 7.5 | most mature module; refund retry missing |
| Shuttle module | 6 | manual refunds only, dispatch parity gaps |
| Payments | 6 | collection reconciliation missing |
| Wallet/commission/subscriptions | 7 | solid ledgers; no admin adjustment endpoint |
| Notifications | 6.5 | 4 channels wired; zero delivery observability |
| Tracking & maps | 6.5 | works; unbounded table, no GPS-loss handling |
| Safety/SOS | 4 | alert-only, no workflow, contacts unused |
| Admin ops & RBAC | 6 | great RBAC; missing intervention tools |
| Jobs & cron | 7 | right jobs exist; no failure visibility |
| Observability/monitoring | 1 | effectively nonexistent |
| **Overall platform** | **6/10** | *"Runs well until something goes wrong; then nobody can see or fix it."* |

---

## 2. System Overview

### 2.1 Components

```
customer-mobile (Ionic/Angular/Capacitor)      driver-mobile (Ionic/Angular/Capacitor)
        │  REST + Reverb WS + FCM                      │  REST + Reverb WS + FCM
        ▼                                              ▼
              backend (Laravel 12) ── routes/api.php (514 lines, ~200 endpoints)
   ┌───────────────┬──────────────┬───────────────┬──────────────┐
   │ Controllers   │ 40 Services  │ 2 Queue Jobs  │ 10 Console   │
   │ (31 + 34 adm) │              │ (dispatch)    │ commands     │
   └───────────────┴──────────────┴───────────────┴──────────────┘
        │                │               │               │
      MySQL         Razorpay        MSG91 (SMS)     Firebase (FCM + phone-auth)
   (queue+cache+     (payments,      GoDaddy SMTP    Laravel Reverb (websockets)
    session in DB)    refunds)       (email)         Google Maps/Routes APIs

frontend (Angular admin panel, 49 page components, permission-gated routes)
```

### 2.2 Deployment topology (from `backend/docker-compose.yml`)

- `app` (php-fpm + nginx), `queue` (`php artisan queue:work --tries=3 --timeout=90`), `scheduler` (cron `schedule:run`), MySQL, Reverb.
- `QUEUE_CONNECTION=database`, `CACHE_STORE=database`, `SESSION_DRIVER=database` — **everything shares MySQL**. Correctness across containers is fine (dispatch tokens live in DB cache), but MySQL is a single point of failure and the dispatch loop hits it every hop.

### 2.3 Core domain model (56 models)

- **Trip** — one row per vehicle journey, all products. Status machine below. Carries fare snapshot, toll, tip, commission, no-show/cancellation fields, `is_manual_dispatch`, `scheduled_at`, `route_departure_id` (shared link).
- **FareNegotiation / FareNegotiationOffer** — bid thread per trip (`PENDING`→`ACCEPTED`/`SUPERSEDED`, negotiation `NEGOTIATING`→`LOCKED`).
- **TripAssignment** — per-(trip, driver) accept/reject record; feeds "don't re-offer to rejector".
- **Route / RouteStop / RouteSchedule / RouteDeparture / SeatReservation / FixedSeatHold / FixedBookingEvent / FixedBookingSupportNote** — fixed-route module.
- **ShuttleJourney / ShuttlePassengerBooking** — shuttle module.
- **Driver** (profile: approval, vehicle, online flags, service scope/mode, fleet) · **DriverDocument / Document** (dynamic catalog) · **DriverLocation** (ping stream) · **DriverSubscription / SubscriptionPlan**.
- **WalletTransaction** (append-only, 4 types) · **Payment** (one per trip) · **Invoice** · **WalletTopup**.
- **City / CitySetting / CityRideScope / CityRideMode / CityVehicleType / DispatcherSetting / OperatorSetting / PricingRule / DynamicPricingRule / OutstationPackage** — configuration hierarchy (global operator → city → product/vehicle).
- **User / UserRole / ManagerRole / Permission** — RBAC. **AppNotification / DeviceToken** — notifications. **SafetyEvent / EmergencyContact / TripShareLink / TripMessage / Rating / Coupon / CouponAssignment / Fleet**.

### 2.4 The trip state machine (single source of truth)

`TripStateMachineService::allowedTransitions()` — [TripStateMachineService.php:28](backend/app/Services/TripStateMachineService.php:28)

```
REQUESTED → NEGOTIATION → CONFIRMED → ASSIGNED → EN_ROUTE_PICKUP
   → ARRIVED_PICKUP → EN_ROUTE_DROP → ARRIVED_DROP → COMPLETED
(every non-terminal state → CANCELLED)
```

- Timestamps stamped per transition; `COMPLETED` triggers fare recompute (waiting charges) then commission settlement; `CANCELLED` records reason.
- Broadcast + customer FCM deferred via `DB::afterCommit` (listeners never see rolled-back states) — good.
- `DRIVER_BUSY_STATUSES = CONFIRMED…ARRIVED_DROP` ([Trip.php:90](backend/app/Models/Trip.php:90)) is the shared busy set for **all** dispatchers, which is what makes double-booking impossible — but also what makes a *stuck* trip freeze a driver (see B2).

---

## 3. Subsystem Audits

Each subsystem: purpose → lifecycle → who sees/acts → failure handling → gaps → score.

---

### 3.1 Authentication & Session

**How it works**
- **Mobile (customer + driver):** phone OTP. Two switchable paths:
  1. Firebase phone-auth (`/auth/otp/start|verify`, `FirebaseAuthController`) — verifies Firebase ID token server-side.
  2. Server-side MSG91 SMS OTP (`/auth/otp/sms/start|verify`, `PhoneOtpService`): 6-digit code, DB-stored `phone_otps` with TTL + max 5 attempts, **mock mode** when no MSG91 key (returns `dev_code` in the response).
  Both mint Sanctum tokens. First-time users complete profile via `POST /me/profile`.
- **Admin:** email + password (`POST /admin/login`, `AdminAuthController`), Sanctum token, `role:admin` middleware + per-permission middleware.
- Rate limiting: `throttle:otp` on all OTP endpoints ([AppServiceProvider.php:30](backend/app/Providers/AppServiceProvider.php:30)).
- Logout (`/me/logout`) and account deletion (`DELETE /me/account`) exist.

**Failure & edge cases**
- OTP attempts capped; expiry enforced. Good.
- `dev_code` leak is gated on `Msg91Service::isLive()` — **a misconfigured production env (blank key) silently switches auth to mock mode and returns login codes in API responses.** There is no startup assertion or health signal that SMS is live.
- Admin users have no 2FA, no password-reset flow visible, no session/device management (a stolen token lives until manual deletion).
- No login audit (who logged in, from where, when).

**Visibility/actionability**
- Admin can send OTP on behalf of a user (`/admin/customers/{u}/send-otp`, `/admin/drivers/{d}/send-otp`) — nice support affordance.
- Admin can block/unblock customers and drivers; blocked semantics enforced at login (verify per release).

**Gaps → recommendations**
1. Production boot check: refuse to serve OTP mock mode when `APP_ENV=production` (or scream in logs + health).
2. Admin login audit log + 2FA for `roles_permissions`/`managers`-privileged accounts.
3. Token/device session list + remote revoke (admin + self-serve).

**Score: 7.5/10.** Solid mechanics; missing hardening and audit.

---

### 3.2 Customer Onboarding

- OTP sign-in auto-creates the user; `POST /me/profile` captures name/email/photo. Saved locations, emergency contacts CRUD exist from day one.
- Admin: customer list, CSV import, detail page (rides, cancelled rides, wallet transactions), block/unblock, delete, unsubscribe (push), lookup by driver/ride.
- **Gaps:** no email/phone verification state surfaced; no dedupe on CSV import verified; deletion is hard (`destroy`) with unknown cascade behavior on trips/ledgers — **verify FK behavior before allowing delete in production; prefer soft-delete/anonymize** (financial rows must survive).

**Score: 7/10.**

---

### 3.3 Driver Onboarding & Documents

**Lifecycle** ([DriversController.php:25](backend/app/Http/Controllers/DriversController.php:25))
```
User → POST /drivers/register (idempotent updateOrCreate; grants driver role; approval_status=pending)
     → uploads documents against the dynamic Document catalog (mandatory_register rows gate)
     → admin approves each document (PATCH /admin/drivers/documents/{d}/status)
     → admin approves driver (PATCH /admin/drivers/{d}/approval)
     → driver taps Go Online → gates: approved + all mandatory docs approved
        + optional wallet-debt gate (OperatorSetting.check_driver_debt)
        + service scope/mode chosen → is_online=true
```
- Re-registration preserves an existing `approved` status unless vehicle facts change (resets to `pending`) — thoughtful.
- Admin driver detail: full profile, docs (view/upload/set status), rides, cancelled rides, wallet, block/unblock, activate/deactivate, delete, leaderboard, performance, CSV export.
- Driver app has a dedicated `driver-pending-review` page; catalog reads are authenticated.

**Gaps**
1. **No document expiry** — licenses/permits/insurance have validity dates in the real world; nothing re-checks an approved doc. Recommend: `expires_at` on `driver_documents`, nightly cron to flag/un-approve expiring docs + notify driver & admin.
2. **No approval audit trail** — who approved driver X and when is unrecorded (see B3).
3. No driver-visible rejection *reason* workflow traced on document rejection (status only). Add reason + notification.
4. Fleet assignment exists, but fleet owners have no portal — fleets are admin bookkeeping only. Fine for now; note it.

**Score: 7/10.**

---

### 3.4 Admin Onboarding & RBAC

- **Managers** (admin-side users): CRUD + suspend/unsuspend; **ManagerRole** carries a permission set; **manager.city** middleware (`EnforceManagerCity`) scopes a manager to one city and rejects cross-city requests; `permission:` middleware supports OR-lists (`permission:pricing|rides`).
- Permission catalog is read-only via API; frontend routes are gated with the same permission keys — front/back parity is good.
- **Gaps:** no audit of manager actions (B3); no "last login"/activity view; no permission-change history; the initial super-admin bootstrap path is seeded (verify seed credentials are rotated in production).

**Score: 7.5/10** for the model, dragged by auditability.

---

### 3.5 Solo (Private) Ride Lifecycle

**Purpose:** the flagship product — negotiated-fare private rides, local or outstation, ASAP or scheduled.

**Complete lifecycle (traced)**

1. **Estimate** — `POST /pricing/estimate` (public): pricing rule per CityVehicleType + dynamic pricing zone factors + optional Google route metrics + toll (city-gated).
2. **Book** — `POST /trips` ([TripsController.php:30](backend/app/Http/Controllers/TripsController.php:30)): validates geofence (pickup always, destination if operator toggle), scheduling policy (lead time, horizon, per-customer live-ride caps), resolves vehicle/pricing, creates trip `REQUESTED` → immediately `NEGOTIATION`. Supports **book-for-other** (rider name/phone travel with the trip; driver sees the *rider*, never the booker).
3. **Negotiation & dispatch** — §3.6.
4. **CONFIRMED** — customer confirms a driver offer (`TripAssignmentService::confirm`, row-locked, one-trip-per-driver enforced) or manual-dispatch auto-confirm.
5. **ASSIGNED** — driver taps accept (`/driver-accept`): authoritative busy-check serialized on the driver row ([RideAssignmentController.php:59](backend/app/Http/Controllers/RideAssignmentController.php:59)).
6. **Pickup** — driver progresses `EN_ROUTE_PICKUP` → `ARRIVED_PICKUP`. **Start OTP**: driver requests (`/start-otp`), 6-digit code SMS'd to the *rider's* phone (booker can read it on their live screen via `customerStartOtp`; never exposed to the driver), 10-min TTL, single-use, `hash_equals` compare; `EN_ROUTE_DROP` transition hard-requires it.
7. **Drop & completion** — `ARRIVED_DROP` → `COMPLETED`; completion recomputes final fare (waiting charges from telemetry window), settles commission (§3.11), consumes subscription allowance, notifies the customer to pay & rate.
8. **Payment** — customer-initiated, cash or Razorpay (§3.10). **Tip** — one per trip, absolute ₹, wallet-credited to driver.
9. **Cancellation** — customer may cancel through `EN_ROUTE_PICKUP`, gated by a **driver-proximity block** (per-city radius; fails open on unknown position) and a **late-cancel fee** inside the scheduling cancel window (fee stored, never charged — M1).
10. **No-show** — both directions ([TripsController.php:616](backend/app/Http/Controllers/TripsController.php:616)): driver flags customer no-show from `ARRIVED_PICKUP`; customer flags driver no-show from `ASSIGNED`/`EN_ROUTE_PICKUP`; per-city grace minutes + per-minute fee → `cancellation_fee_amount` + `no_show_by`, then CANCELLED. **Fee is never settled** (M1).

**State machine:** see §2.4. Transitions are all server-side, driver progress restricted to the assigned driver, customer actions to the owner. Terminal states are final (no reopen — see gaps).

**Visibility & actionability**

| | Customer | Driver | Admin |
|---|---|---|---|
| See state | ✅ live screen + WS + FCM + history | ✅ active-trip screen + available feed | ✅ trips list w/ filters, ride detail, latest location |
| Act | ✅ cancel/no-show/pay/tip/rate/SOS/share-link/chat | ✅ accept/reject/progress/no-show/SOS/chat | ❌ **read-only** (B1) |
| Recover when stuck | ❌ | ❌ | ❌ (B1/B2) |

**Failure analysis**
- *Driver app dies at `EN_ROUTE_DROP`:* trip stays in-progress forever. Customer can't cancel (status past the cancellable set). Admin can't cancel (B1). Driver reaper flips `is_online` but **not** the trip. Driver is permanently "busy" → cannot earn. **This is the single worst stuck-state in the platform.**
- *Driver confirmed, never accepts:* trip parks in `CONFIRMED`; no cron covers it (`negotiations:cleanup` only touches `NEGOTIATION`). Customer *can* cancel, but nothing prompts them; the driver is busy-blocked meanwhile (B2).
- *Two drivers accept simultaneously:* prevented — `confirm()` row-locks the trip; `driver-accept` serializes on the driver row. ✅
- *Duplicate booking taps:* `throttle:booking` only; no idempotency on `POST /trips` → double trips possible; both will dispatch. Add Idempotency-Key support (middleware already exists) to trip creation.
- *SMS gateway down at pickup:* start OTP unreachable → ride cannot legally start. Mitigation exists (booker sees the code in-app) **only if the booker realizes it**. Consider showing the OTP to the customer proactively when SMS fails, or allow admin to read it.
- *Reverb down:* `TripStatusUpdated` broadcast in `afterCommit` is **not** try/caught (unlike NotificationCenter broadcasts) — a Reverb outage can 500 driver-progress calls *after* the state already changed, making the driver app think the action failed and retry into 409s. Wrap it.

**Recommendations (priority order)**
1. Admin trip actions: cancel-with-reason, force-complete, reassign (unbind driver + relaunch dispatch), manual state override — all audit-logged (fixes B1).
2. `trips:reap-stuck` cron: `CONFIRMED` older than N min → unbind driver, back to `NEGOTIATION` re-dispatch or cancel+notify; in-progress trips with no driver ping for 30+ min → flag to an admin "attention" queue (fixes B2).
3. Settle no-show/cancellation fees or delete the fields (M1) — decide, wire to wallet, show in admin.
4. Idempotency on `POST /trips`; wrap status broadcast in try/catch.

**Score: 6.5/10** — excellent happy path, no safety net.

---

### 3.6 Fare Negotiation & Dispatch

**Purpose:** connect an open trip to a driver at an agreed price, via (a) broadcast bidding, (b) customer-picked driver, or (c) admin manual dispatch.

**Mechanics (traced)**
- One `FareNegotiation` per trip; offers from both roles; per-actor supersede rules keep multi-driver bidding fair ([FareNegotiationController.php:262](backend/app/Http/Controllers/FareNegotiationController.php:262)).
- **Negotiation floor:** city-configured percent below estimate; enforced server-side both directions. Reverse bidding (driver counter) can be disabled per vehicle; shuttle is accept-only.
- **Expanding-ring dispatcher** (`DispatchHopJob`): per-(city, scope) `DispatcherSetting` tunes hop radius/interval/max hops + acceptance window; generation token in DB cache guarantees one live chain per trip (re-offer supersedes); ping-once cache doubles as the driver acceptance-window clock; discovery mode powers the customer's driver-picker map without notifying drivers; manual-dispatch cities skip the notify path entirely.
- **Acceptance window:** a pinged driver acting after `driver_accept_window_sec` is rejected — prevents zombie claims.
- **Manual dispatch:** admin books on behalf of a customer (`AdminManualDispatchController`), driver ACCEPT auto-confirms (no live customer to confirm).

**Gaps**
1. **Zero dispatch observability.** Hop progress is `Log::info` lines. Admin cannot see: trips currently searching, hop count, drivers pinged/rejected, searches that exhausted with no driver. Recommend a "Dispatch monitor" panel fed by `DispatchRingExpanded` + a `dispatch_attempts` table.
2. **Search exhaustion is silent.** `max_hops` reached → job simply stops; the customer app is left on its own timer; nobody is notified; the trip waits for `negotiations:cleanup` (default 10 min) to cancel it. Notify customer + surface to admin at exhaustion.
3. Driver has no rejection-reason capture; no per-driver acceptance-rate metric feeding dispatch (fairness/priority is purely distance).
4. `available` feed caps at 20 trips with no pagination — acceptable now, note for scale.

**Score: 7/10** — mechanically robust, operationally blind.

---

### 3.7 Scheduled Rides

**The best-defended subsystem.** `WakeScheduledTrips` (every minute) ([WakeScheduledTrips.php](backend/app/Console/Commands/WakeScheduledTrips.php)):
- **Expire pass:** REQUESTED/NEGOTIATION scheduled trips >120 min past pickup → cancelled + customer & admin notified (worker-outage-proof).
- **Wake pass:** at `scheduled_at − scheduler_alarm_min`, honors per-city dispatch mode (INSTANT / DELAYED / INSTANT_AND_DELAYED / manual / only-preassigned), single-fire marker (`scheduled_dispatch_started_at`), catch-up window widened to 2h.
- In-app + admin notifications at every stage: booked, driver assigned, searching, cancelled, expired.
- Customer + driver both have dedicated scheduled-rides screens.

**Gaps:** admin sees scheduled rides only through the generic trips list + notifications — no dedicated "upcoming scheduled rides" board with driver-assignment status and a manual assign action (the `dispatch_only_assigned_scheduled` mode *implies* pre-assignment, but there is **no endpoint to pre-assign a driver to a scheduled trip** — the mode is a dead switch unless manual dispatch is used end-to-end). Driver reminder near pickup time (e.g., 30 min before) is missing.

**Score: 7.5/10.**

---

### 3.8 Fixed-Route Module

**Purpose:** pre-priced seat booking on operator-defined routes with stops, departures, per-seat boarding.

**Lifecycle (traced through `FixedSeatHoldService`, `FixedDepartureService`, `SharedDispatchService`, `FixedDriverController`, `FixedRefundService`)**

```
Customer: browse routes → departures → seat hold (HELD, 5-min expiry, row-locked capacity)
        → Razorpay order → confirm payment (signature-verified; coupon re-validated inside the lock)
        → SeatReservation CONFIRMED (fare + commission snapshotted per seat)
Driver:  opens a vehicle on a route (FORMING departure) or runs a scheduled one
Cron:    routes:dispatch-due (1 min) — full or form-timeout FORMING departures
        → SharedDispatchService.materializeAndDispatch: row-locked, idempotent;
          creates trip CONFIRMED, pre-assigns nearest eligible driver (≤25 km, fresh ping,
          skips prior rejectors), links seats, notifies driver + riders
        → hard-expire (60 min): cancel + auto-refund every paid seat + notify (riders never stranded)
Driver:  accept via /driver-accept → manifest → per-seat boarding OTP (SMS) → board/drop/no-show
        → stop automation from location pings (FixedStopAutomationService) → complete
Settle:  per-seat commission (subscription-aware), driver credited gross − commission (§3.11)
Refunds: customer cancel ≥30 min before departure → wallet or Razorpay refund; else rejected;
         driver reject → departure reset to FORMING/SCHEDULED, seats detached, orphan trip cancelled
Admin:   departures board, bookings list w/ filters, booking timeline (FixedBookingEvent),
         support notes, admin cancel booking, support-action (incl. refund status updates),
         close/open bookings, cancel departure
```

**This module is the maturity benchmark** — it has the event timeline, support notes, and admin recovery actions every other subsystem lacks. Tests cover it (`FixedFullWalkthroughTest`, recovery-actions tests).

**Gaps**
1. **Pending refunds die quietly (M2).** Razorpay refund failure → `refund_status='APPROVED'`, `refund_pending=true`, logged — then nothing. No retry job, no admin retry button (admin *can* filter by refund_status and mark statuses via support-action, but must notice unaided). Add: `refunds:retry-pending` cron + admin "pending refunds" queue with count badge.
2. **Expired seat holds are only reaped lazily** — no cron deletes/expires `HELD` rows past `expires_at`; capacity math must always subtract them correctly (it checks expiry in queries, verified) but the table accumulates junk.
3. Driver rejection loops: nearest-driver excludes prior rejectors, but if **all** nearby drivers reject, the departure silently retries every minute until hard-expire refunds everyone. Admin never hears about a departure that can't find a driver until it's dead. Alert on N consecutive failed dispatch cycles.
4. No seat-map/manifest visibility for the customer (they see their own booking + live status only — acceptable, note).

**Score: 7.5/10.**

---

### 3.9 Shuttle Module

- Customer quote → booking → Razorpay → `ensureDispatchTrip` creates/attaches a trip; drivers in shuttle service-mode see/accept (prepaid — counter disabled); `ShuttleJourney` mirrors trip status via `syncShuttleJourney`.
- Refunds are **manual only**: cancel marks `refund_status='APPROVED'`; admin resolves via `/admin/.../shuttle-bookings/{b}/resolve-refund` recording reference + amount (matches the "operator pays outside the app" model).
- Stop automation exists (`ShuttleStopAutomationService`).
- Commission: **not charged** on shuttle (driver credited full carried fares) — explicitly "until shuttle commission is enabled" ([CommissionSettlementService.php:107](backend/app/Services/CommissionSettlementService.php:107)). Confirm this is intended for launch; it's a revenue hole if forgotten.
- **Gaps:** no auto-refund path at all (fixed module has one); no shuttle-specific admin timeline like FixedBookingEvent; quote/booking flows have fewer tests.

**Score: 6/10.**

---

### 3.10 Payments, Invoices & Refunds

**Trip payments** ([PaymentsController.php](backend/app/Http/Controllers/PaymentsController.php))
- One `Payment` row per trip (`updateOrCreate` on trip_id). Razorpay: order → client checkout → `verify` (signature-checked) or webhook (signature-checked). Cash: customer self-declares → instant `SUCCESS`. Coupons resolved server-side and burned idempotently on success. Invoices generated best-effort on success (webhook retries). Idempotency-Key middleware on all pay endpoints (optional header). Payment-mode policy enforced server-side (city cap ∩ driver-effective — PaymentModeService as SSOT).

**Failure analysis & gaps**
1. **B5 — collection black hole.** Payment is entirely customer-initiated. A completed trip where the customer closes the app has **no payment row at all** — it isn't `FAILED`, it's *absent*. No report/queue of completed-unpaid trips; the driver has meanwhile paid commission. Required: "uncollected payments" admin report + driver-side "mark received in cash" fallback + aging alerts.
2. **M5 — webhook semantics.** Any status outside `captured|success|paid` (e.g. `authorized`, `refunded` events) forces `status='FAILED'` and nulls `paid_at` — a late `payment.authorized` webhook arriving after a success verify would *downgrade* a paid record (order of arrival dependent; verify Razorpay event subscription config). Unmatched webhooks → 404, unlogged payload discarded — add a webhook event log table (dead-letter) + event-type whitelist.
3. **Cash trust:** `payCash` requires no driver confirmation — customer can mark cash "paid" without paying; driver has no dispute path. At minimum, notify the driver on cash-paid and let them flag a mismatch.
4. No refunds for **solo** trips at all (only fixed/shuttle modules have refund machinery). If an operator needs to refund a Razorpay trip payment, there is no tool — direct dashboard use only, unrecorded.
5. Driver wallet top-up (Razorpay) is verify-based with idempotency — good; but there's no top-up reconciliation against Razorpay settlement reports.

**Score: 6/10.**

---

### 3.11 Driver Wallet, Commission & Subscriptions

**Design (correct per product intent — see memory/financial audit):** the driver wallet is a **prepaid float** (top-ups fund commission + subscriptions), not an earnings account; online fares are paid out manually by the operator.

- `WalletTransaction` — append-only ledger, 4 types, balance = SUM(credits) − SUM(debits) ([WalletService.php:46](backend/app/Services/WalletService.php:46)). Caps (`capViolation`) apply only to *manual* moves so owed money is never trapped. `created_by_user_id` gives partial provenance.
- **Commission** ([CommissionSettlementService.php](backend/app/Services/CommissionSettlementService.php)): solo = city percent **or** flat fixed, toll excluded, subscription percent overrides (sentinel −1 distinguishes "no sub" from 0%), cut capped at commissionable fare; fixed = per-seat snapshotted commission (subscription-aware) with driver credited net; shuttle = no commission (flagged §3.9).
- **Subscriptions** (`SubscriptionService`, 604 lines): plans per city (time/ride/earnings-metered), wallet-debited purchase (serialized on a driver lock, affordability asserted), one active + one queued, auto-renew (`renewOrExpire`), lazy expiry on read **plus** hourly `subscriptions:expire` and `subscriptions:notify-expiring`. Admin CRUD + admin unsubscribe. Tests exist (`SubscriptionAutoRenewTest`).

**Gaps**
1. **No admin wallet adjustment endpoint.** Admin can *view* transactions only ([routes/api.php:256](backend/routes/api.php:256)). Every dispute correction ("commission charged on a disputed ride") requires DB surgery. `capViolation` even documents an "admin credit-debit" flow that doesn't exist. Add credit/debit with mandatory reason + audit, permission-gated.
2. **Balance integrity:** full-table SUM per read; no snapshot/running-balance column, no periodic ledger-vs-derived reconciliation job. Fine at current scale; add a reconciliation report before scale.
3. **Negative float visibility:** commission debits can push balance negative; `check_driver_debt` blocks the *next* go-online (if enabled), but there is no admin "drivers in debt" report or driver push warning at threshold.
4. Wallet top-up entry points exist in driver app; **no statement export** (driver or admin) for payout-day reconciliation with the manual GPay process — this is the operator's most frequent real-world task. High-value, low-cost addition.

**Score: 7/10.**

---

### 3.12 Coupons & Promotions

- City-scoped coupon CRUD, assignment to users (`give`), assignment listing; `CouponService.resolveForUser` validates geo/vehicle/expiry/usage; preview endpoints on both trip and fixed flows; burn is idempotent, stamped with `redeemed_trip_id`.
- **Gaps:** no bulk-issue campaigns (CSV/all-city), no auto-apply promotions, no per-coupon redemption analytics beyond the assignment list, **no referral program** despite the orphaned `referral_settings` migration (M6 — delete the migration or build the feature).

**Score: 6.5/10.**

---

### 3.13 Notifications

**Channels wired (traced through `NotificationCenter` → 4 fan-outs):**
1. **In-app inbox** (`app_notifications` + unread count + read endpoints; screens exist in all three clients) — the durable record; created first, so a channel failure never loses the message.
2. **Reverb broadcast** (`AppNotificationCreated`, try/caught).
3. **FCM push** (`NotificationService`; respects `push_unsubscribed`; try/caught; stale-token pruning cron).
4. **Operator channels** (`OperatorNotificationDeliveryService`): email (GoDaddy SMTP; skips `@otp.local` placeholder emails) + SMS (MSG91; type-whitelisted per audience, operator toggles) — try/caught, log-only failure.

Operator-customizable message templates for ride-accept + cancellation with token rendering ([TripStateMachineService.php:134](backend/app/Services/TripStateMachineService.php:134)).

**Gaps**
1. **No delivery observability.** Failures are `Log::warning` only — no failed-notification table, no retry, no admin "delivery health" panel (e.g., FCM auth broken = 100% silent push loss; memory notes push needed a rebuild+login to recover — exactly the class of outage that would go unnoticed).
2. Some flows bypass NotificationCenter and call `NotificationService` (FCM) directly (e.g., driver "you got the trip", SOS admin alerts) — those produce **no inbox record**; a driver who misses the push has no in-app trace of the SOS/win. Route everything through NotificationCenter.
3. No user notification preferences beyond unsubscribe-all (`push_unsubscribed`); no quiet hours; no per-type opt-out.
4. Admin broadcast tooling exists only for drivers (`contact-drivers` audience/CSV/send) — no customer campaign equivalent.

**Score: 6.5/10.**

---

### 3.14 Location Tracking & Maps

- Driver presence pings: `POST /drivers/location` (throttled `throttle:location`), writes `driver_locations`, bumps `last_online_at` heartbeat (feeds the stale reaper), and **drives fixed/shuttle stop automation** as a side effect — clever reuse.
- Trip-scoped pings: `POST /trips/{t}/location` (driver) + customer counterpart feed live maps both directions; latest-location endpoint for admin; public **trip share link** (`/trip-share/{token}`) for guardians.
- Admin: live ops map (`maps`, `live_operations` permission), dispatch snapshot.
- Freshness windows (5 min) consistently applied in every dispatcher/candidate query. Geofence checks on booking + driver candidacy (polygon; degenerate polygons treated as unbounded).

**Gaps**
1. **M3 — `driver_locations` unbounded.** Highest-write table; every dispatch query does `MAX(id) GROUP BY driver_id` sub-selects over it. Add: nightly prune (keep e.g. 7 days + trip-linked rows), or a `driver_latest_locations` upsert table for the hot path.
2. **GPS-loss handling is implicit only** (driver drops out of candidate sets; proximity cancel-gate fails open). No rider-facing "driver signal lost" state, no admin stale-signal flag on active trips.
3. Route/distance for final fare relies on telemetry sums — GPS gaps under-bill; no minimum-distance sanity check against the estimate. (Financial audit territory; flagged for completeness.)

**Score: 6.5/10.**

---

### 3.15 Safety / SOS

- `POST /trips/{t}/sos` (customer or driver, active trips only) → `SafetyEvent` (status `CREATED`) + `Log::warning` + Reverb broadcast + FCM to **every admin**. Admin has a safety-events list page (`safety` permission). Trip share links + emergency contacts CRUD exist.

**Gaps (M4) — this subsystem is an alarm bell with no fire brigade:**
1. No lifecycle: no acknowledge → assigned → resolved states, no assignee, no resolution notes, no SLA timer. `adminIndex` is a read-only list.
2. **Emergency contacts are stored but never used** — SOS does not SMS/notify them, and there's no share-link auto-send.
3. FCM-to-all-admins is the only alert path; if push is broken (see §3.13) an SOS can go completely unseen. In-app inbox record for admins is *not* created (direct `NotificationService` call). At minimum route through NotificationCenter; ideally add an escalation (SMS to an on-call number via the already-live MSG91).
4. No post-SOS actions bound to the event: call buttons, trip freeze, driver suspension shortcut.

**Score: 4/10 — highest-liability gap in the platform relative to effort to fix.**

---

### 3.16 Ratings & Trip History

- Customer→driver rating (1–5 + comment) post-completion; driver aggregate (`rating_avg/count`) shown in candidate lists; trip history endpoints both roles; admin sees ratings in ride detail (verify) and driver leaderboard/performance.
- **Gaps:** no driver→customer rating (industry standard for driver safety/fairness); no rating moderation/dispute; one-sided reputational risk. Trip messages have admin moderation (`PATCH /admin/messages/{m}/moderation`) — good precedent to extend.

**Score: 6/10.**

---

### 3.17 Support

- Per-city official support contacts (read API + admin settings); support pages in both apps; fixed-module support notes + timeline + support-action; customer↔driver in-trip chat (throttled, admin-moderatable).
- **Gaps:** no ticketing (issue → status → resolution) for anything outside the fixed module; no complaint category taxonomy; no linkage from a trip detail to "issues raised". A minimal `support_tickets` table + admin queue would close most of it.

**Score: 5/10.**

---

### 3.18 Background Jobs & Scheduled Tasks

**Queue jobs:** `DispatchHopJob` (tries=1 — a crashed hop kills the chain until the next customer action; acceptable given the every-minute crons don't cover mid-search trips — note), `SendDispatchNotificationsJob` (FCM fan-out off the hop path).

**Cron (all `withoutOverlapping` + `runInBackground`)** ([routes/console.php](backend/routes/console.php)):

| Schedule | Command | Function |
|---|---|---|
| every min | `negotiations:cleanup` | cancel NEGOTIATION > 10 min |
| every min | `dispatch:wake-scheduled` | scheduled-ride wake + expire |
| every min | `drivers:reap-stale` | is_online=false past heartbeat window |
| every min | `routes:dispatch-due` | fixed departures dispatch + hard-expire/refund |
| hourly | `subscriptions:expire` / `subscriptions:notify-expiring` | tidy + warn |
| daily 03:30 | `device-tokens:prune` | stale FCM tokens |

**Gaps**
1. No coverage for stuck `CONFIRMED+` trips (B2), pending refunds (M2), expired seat holds, `driver_locations` growth (M3), old idempotency cache rows (DB cache), `phone_otps` cleanup.
2. **No failure visibility:** `failed_jobs` table exists but nothing watches it; a scheduler container death is undetectable from `/health`; no heartbeat metric ("last successful run per command").
3. Simulation commands (`SimulateTrip`, `SimulateNearbyDrivers`, `CabDev`) live in the production artisan namespace — gate them to non-production environments.

**Score: 7/10** for what exists; the missing jobs are counted in their subsystems.

---

### 3.19 Admin Operations, Analytics & Reports

- **Dashboard** (KPIs), **real-time analytics**, **graphs**, **keyed report registry** with execute + CSV export, driver leaderboard/performance/insights, dispatch snapshot, live map, manual dispatch console, notifications inbox, full config workspaces (cities, catalogue hierarchy, pricing, dynamic pricing zones, dispatcher settings, operator settings incl. templates & channel toggles, app assets, fleets, documents catalog).
- This is a genuinely broad panel — 49 page components, permission-parity with the API.

**Gaps** — the panel is **configuration-and-review** heavy, **operations** light:
1. No *action queues*: pending refunds, unpaid completed trips, stuck trips, exhausted searches, expiring documents, SOS workflow, drivers-in-debt. Ops staff must hunt instead of being fed work.
2. No audit-log viewer (nothing to view — B3).
3. Reports registry: verify coverage of reconciliation-grade reports (payments vs completed trips; commission ledger vs trips; refunds issued). If absent, add — the financial audit depends on them.

**Score: 6/10.**

---

## 4. Visibility Matrix

✅ full · 🟡 partial · ❌ none

| Workflow | Customer sees | Driver sees | Admin sees |
|---|---|---|---|
| Booking/negotiation state | ✅ live | ✅ available feed + selected-for-you | 🟡 trips list (no live search state) |
| Dispatch search progress | ✅ ring broadcasts | 🟡 push only | ❌ (no dispatch monitor) |
| Active trip + location | ✅ | ✅ | ✅ (latest location) |
| Start-OTP state | ✅ (booker) | 🟡 (sent/failed unclear) | ❌ |
| Completion & fare breakdown | ✅ | ✅ | ✅ ride detail |
| Payment status | ✅ | 🟡 (cash unknown; no paid notice) | 🟡 (no unpaid queue) |
| Wallet (driver) | n/a | ✅ | ✅ (view only) |
| Wallet (customer refunds) | ❌ **no screen** | n/a | ✅ (view only) |
| Subscription state | n/a | ✅ | ✅ |
| Scheduled ride pipeline | ✅ | ✅ | 🟡 (notifications, no board) |
| Fixed booking + live status | ✅ | ✅ manifest | ✅ + timeline |
| Fixed refund pending | 🟡 (status field) | n/a | 🟡 (filter, no queue/alert) |
| Shuttle booking | ✅ | ✅ | ✅ |
| SOS events | 🟡 (fired) | 🟡 | 🟡 list, no workflow |
| Notification delivery health | ❌ | ❌ | ❌ |
| Cron/job/queue health | — | — | ❌ |
| Admin action history | — | — | ❌ (no audit log) |
| Driver document expiry | ❌ | ❌ | ❌ (no expiry model) |

## 5. Actionability Matrix

| Workflow | Customer can act | Driver can act | Admin can intervene |
|---|---|---|---|
| Cancel pre-pickup | ✅ (proximity-gated) | 🟡 reject only pre-accept | ❌ (B1) |
| Stuck in-progress trip | ❌ | ❌ (if app lost) | ❌ (B1/B2) |
| No-show | ✅ flag driver | ✅ flag customer | ❌ (fee never settles — M1) |
| Reassign driver | ❌ (rebook) | — | ❌ |
| Refund solo trip | ❌ | — | ❌ (no tool) |
| Refund fixed booking | ✅ (window) | — | ✅ cancel + support-action |
| Refund shuttle | ✅ request | — | ✅ manual resolve |
| Retry failed Razorpay refund | — | — | ❌ (M2) |
| Adjust wallet | — | 🟡 top-up only | ❌ (view only) |
| Driver approval/block | — | re-register | ✅ full |
| Customer block | — | — | ✅ |
| SOS response | fire | fire | ❌ beyond looking |
| Dispatch config | — | — | ✅ per city/product |
| Manual booking | — | — | ✅ manual dispatch |
| Broadcast messaging | — | — | 🟡 drivers only |

---

## 6. Operational Failure Analysis

**Server/worker crash**
- Web down: everything down; no status page. Queue worker down: **auto-dispatch silently stops** (hops never run) — customers see infinite "searching"; `negotiations:cleanup` (scheduler container) eventually cancels at 10 min. Scheduler down too: nothing expires/wakes/reaps — platform rots invisibly. → Health endpoint must check DB + queue lag + last-cron-run; external uptime alerting (B4).

**Network / app crash mid-flow**
- Booking double-tap → duplicate trips (no idempotency on `POST /trips`).
- Driver app death mid-trip → permanent stuck trip (§3.5). Customer app death → trip completes; payment never happens (B5); scheduled notifications still delivered to inbox.
- Reverb outage → live screens degrade to polling (clients do poll key endpoints); un-caught `TripStatusUpdated` broadcast can 500 progress calls (§3.5).

**GPS unavailable**
- Driver invisible to dispatch after 5-min staleness (correct); cancel-proximity gate fails open (customer-favoring, correct); waiting-charge/fare telemetry under-counts (unhandled); no UI signal anywhere.

**Notification channel failure**
- Every channel is individually try/caught with the inbox as durable fallback — **except** flows calling FCM directly (driver trip-win, SOS admin alert) which then have *no* durable record (§3.13, §3.15).

**Conflicting/duplicate actions**
- Two drivers accept: safe (locks). Customer confirms while driver cancels: state machine 409s cleanly. Double pay: Payment unique per trip + status check + idempotency middleware. Double top-up verify: idempotent. Seat oversell: row-locked capacity + hold expiry checks. Double webhook: idempotent-ish but see M5 downgrade risk. Concurrent fixed departure edits: `assertAdminDepartureUpdateIsSafe` + locks. **Verdict: concurrency is the codebase's strength.**

**Data consistency risks**
- `trips.final_fare` recompute at completion can silently diverge from the negotiated fare (floor is respected, waiting charges added) — customer sees a number they didn't agree to with no itemized consent step.
- Commission settle runs inside the completion transition; if `settle()` throws, the transition… (`transition` saves first, then settles outside its own try) → trip COMPLETED but commission unsettled, and **no retry** — add a `commission_settled_at` marker + sweep job.
- Hard-deletes of users/drivers with financial history (§3.2).

---

## 7. Missing Capabilities Inventory

*What a production ride-hailing operation needs that the codebase does not have:*

**Ops tooling** — admin trip intervention (B1); stuck-trip reaper (B2); action queues (refunds pending, unpaid trips, exhausted searches, debt drivers, expiring docs); dispatch monitor; SOS workflow; admin wallet adjustments; solo-trip refund tool; scheduled-rides board + pre-assign endpoint; audit-log viewer.
**Reliability** — real health checks; error tracker (Sentry); cron heartbeat monitoring; failed-jobs alerting; webhook dead-letter log; notification delivery ledger + retry; commission-settle retry; DB backup/restore runbook (nothing in repo).
**Data lifecycle** — driver_locations pruning; phone_otps/seat-hold/cache cleanup; soft-delete policy for financially-linked entities; document expiry model.
**Product-level absences (decide, don't drift)** — referral program (dead schema); corporate accounts; driver→customer ratings; customer wallet UI/spend path (B6) or refund-to-source instead; support ticketing; customer campaign messaging; driver payout statement export; heatmaps/incentives; multi-language (Kashmir: Urdu/Kashmiri) — all UI appears English-only.

---

## 8. Production Blockers

Must fix before real-money, real-passenger launch:

1. **B1 + B2 — Trip recovery.** Admin cancel/force-complete/reassign endpoints (audited) + `trips:reap-stuck` cron. *Complexity: M (3–5 days).*
2. **B4 — Minimum observability.** Deep `/health` (DB, queue lag, last cron run), Sentry (backend + both apps), failed-jobs + webhook alerts. *Complexity: S–M (2–4 days).*
3. **B5 — Payment collection loop.** Unpaid-completed report + driver cash-confirm + aging notification. *Complexity: M.*
4. **B6 — Customer refund money path.** Either build customer wallet UI + spend-at-checkout, or switch refunds to refund-to-source (Razorpay refund like the fixed module) everywhere. *Complexity: M.*
5. **B3 — Audit log.** One `audit_logs` table + middleware/trait on all admin mutations + viewer page. *Complexity: M.*
6. **M4 — SOS workflow + emergency-contact notification.** Given live SMS exists, this is days, and it is liability-grade. *Complexity: S–M.*
7. **Mock-mode production guard** (§3.1). *Complexity: XS (hours).*

---

## 9. Recommended Improvements & Roadmap

**Phase 0 — before launch (≈2–3 weeks):** the seven blockers above.

**Phase 1 — first month of operations:**
M1 fee settlement decision · M2 refund retry job + queue UI · M3 location pruning + latest-location table · M5 webhook event log + status-mapping fix · admin wallet adjustments · dispatch monitor + exhaustion alerts · notification delivery ledger · document expiry · idempotent `POST /trips` · route SOS/trip-win through NotificationCenter · scheduled-rides admin board.

**Phase 2 — scale & polish:**
support ticketing · driver→customer ratings · payout statement exports + reconciliation reports · customer campaigns · shuttle auto-refund + commission decision · referral (build or delete schema) · driver debt report + push warnings · multi-language · balance-snapshot + ledger reconciliation job · rate driver acceptance metrics into dispatch.

---

## 10. Improvement Checklist (living)

*Update statuses here as work lands.*

### P0 — Blockers
- [ ] Admin trip actions: cancel / force-complete / reassign (+ audit) (B1)
- [ ] `trips:reap-stuck` cron for CONFIRMED/in-progress zombies (B2)
- [ ] `audit_logs` table + admin-mutation logging + viewer (B3)
- [ ] Deep health check + Sentry + failed-jobs/webhook alerting (B4)
- [ ] Unpaid-completed-trips report + driver cash confirmation (B5)
- [ ] Customer refund path: wallet UI+spend **or** refund-to-source (B6)
- [ ] SOS: ack/resolve workflow + emergency-contact SMS + inbox record (M4)
- [ ] Refuse OTP/SMS mock mode in production env

### P1 — Major
- [ ] Settle or remove cancellation/no-show fees (M1)
- [ ] `refunds:retry-pending` cron + admin pending-refunds queue (M2)
- [ ] `driver_locations` pruning + hot latest-location table (M3)
- [ ] Webhook event log (dead-letter) + fix authorized→FAILED mapping (M5)
- [ ] Admin wallet credit/debit endpoint with reason (permission-gated)
- [ ] Solo-trip refund tool (Razorpay, recorded)
- [ ] Dispatch monitor + search-exhaustion notifications (customer + admin)
- [ ] Notification delivery ledger + retry; route all sends via NotificationCenter
- [ ] Idempotency-Key on `POST /trips`; try/catch `TripStatusUpdated` broadcast
- [ ] Commission `settled_at` marker + sweep job
- [ ] Driver document expiry model + nightly check
- [ ] Scheduled-rides admin board + driver pre-assign endpoint
- [ ] Seat-hold / phone_otps / cache-row cleanup crons
- [ ] Gate Simulate*/CabDev commands to non-production

### P2 — Improvements
- [ ] Support ticketing (tickets + admin queue + trip linkage)
- [ ] Driver→customer ratings
- [ ] Payout/wallet statement exports (driver + admin)
- [ ] Reconciliation reports (payments↔trips, commission↔ledger, refunds)
- [ ] Customer broadcast campaigns
- [ ] Shuttle auto-refund; shuttle commission decision
- [ ] Referral: implement or drop `referral_settings` schema
- [ ] Drivers-in-debt report + threshold push warnings
- [ ] Admin 2FA + login audit + session management
- [ ] Wallet balance snapshot + ledger reconciliation job
- [ ] Multi-language (Urdu/Kashmiri)
- [ ] Soft-delete/anonymize users & drivers with financial history

---

## 11. Testing Checklist

Current: 16 test files, strongest around fixed module + subscriptions. Before launch, add coverage for:

- [ ] Full solo lifecycle incl. no-show both directions, proximity-gated cancel, OTP start gate
- [ ] Stuck-state reapers (once built): CONFIRMED timeout, in-progress stale
- [ ] Dispatch: generation-token supersede, acceptance window expiry, exhaustion behavior
- [ ] Payments: cash + razorpay + coupon + webhook out-of-order events + duplicate verify
- [ ] Refund matrix: fixed (wallet/razorpay/failed-razorpay), shuttle manual, hard-expire mass refund
- [ ] Commission: percent / fixed / subscription-override / toll-exclusion / shared per-seat
- [ ] Wallet caps: manual vs system moves; go-online debt gate
- [ ] Scheduled: DELAYED vs INSTANT vs INSTANT_AND_DELAYED; expiry notices
- [ ] RBAC: manager city scoping on every city-scoped route; permission OR-lists
- [ ] Concurrency: double-accept, double-pay, seat oversell, double top-up (load-ish tests)
- [ ] Mock-mode guards (no dev_code in production)

---

## 12. Open Questions

1. **Shuttle commission** — deliberately off at launch, or forgotten? (§3.9)
2. **Cancellation/no-show fees** — should they debit customer wallet / credit driver, or be display-only? Fields exist, money never moves. (M1)
3. **Customer refunds** — is the customer wallet meant to become spendable, or should refunds go to source? (B6)
4. **`dispatch_only_assigned_scheduled`** — how is a driver supposed to be pre-assigned? No endpoint exists. Dead switch or missing feature?
5. **Referral schema** — build or delete?
6. **User deletion** — what is the intended retention policy for trips/payments of deleted users? Current hard-delete path needs a decision.
7. **DB backups** — where do they run? Nothing in the repo defines them.
8. **Razorpay webhook subscription** — which events is the dashboard configured to send? (`authorized` would corrupt records today — M5.)

---

## 13. Code Reference Index

| Area | Key files |
|---|---|
| State machine | [backend/app/Services/TripStateMachineService.php](backend/app/Services/TripStateMachineService.php) |
| Trip constants/busy set | [backend/app/Models/Trip.php:71](backend/app/Models/Trip.php:71) |
| Booking | [backend/app/Http/Controllers/TripsController.php](backend/app/Http/Controllers/TripsController.php) |
| Negotiation | [backend/app/Http/Controllers/FareNegotiationController.php](backend/app/Http/Controllers/FareNegotiationController.php), [backend/app/Services/TripAssignmentService.php](backend/app/Services/TripAssignmentService.php) |
| Auto-dispatch | [backend/app/Jobs/DispatchHopJob.php](backend/app/Jobs/DispatchHopJob.php), [backend/app/Jobs/SendDispatchNotificationsJob.php](backend/app/Jobs/SendDispatchNotificationsJob.php) |
| Accept/reject | [backend/app/Http/Controllers/RideAssignmentController.php](backend/app/Http/Controllers/RideAssignmentController.php) |
| Scheduled rides | [backend/app/Console/Commands/WakeScheduledTrips.php](backend/app/Console/Commands/WakeScheduledTrips.php), [backend/app/Services/SchedulingPolicyService.php](backend/app/Services/SchedulingPolicyService.php) |
| Fixed module | [backend/app/Services/FixedSeatHoldService.php](backend/app/Services/FixedSeatHoldService.php), [backend/app/Services/FixedDepartureService.php](backend/app/Services/FixedDepartureService.php), [backend/app/Services/FixedRefundService.php](backend/app/Services/FixedRefundService.php), [backend/app/Services/SharedDispatchService.php](backend/app/Services/SharedDispatchService.php), [backend/app/Http/Controllers/FixedDriverController.php](backend/app/Http/Controllers/FixedDriverController.php) |
| Shuttle | [backend/app/Services/ShuttleBookingService.php](backend/app/Services/ShuttleBookingService.php), [backend/app/Services/ShuttleRefundService.php](backend/app/Services/ShuttleRefundService.php) |
| Payments | [backend/app/Http/Controllers/PaymentsController.php](backend/app/Http/Controllers/PaymentsController.php), [backend/app/Services/RazorpayService.php](backend/app/Services/RazorpayService.php), [backend/app/Http/Middleware/IdempotencyKey.php](backend/app/Http/Middleware/IdempotencyKey.php) |
| Wallet/commission/subs | [backend/app/Services/WalletService.php](backend/app/Services/WalletService.php), [backend/app/Services/CommissionSettlementService.php](backend/app/Services/CommissionSettlementService.php), [backend/app/Services/SubscriptionService.php](backend/app/Services/SubscriptionService.php) |
| Notifications | [backend/app/Services/NotificationCenter.php](backend/app/Services/NotificationCenter.php), [backend/app/Services/OperatorNotificationDeliveryService.php](backend/app/Services/OperatorNotificationDeliveryService.php), [backend/app/Services/NotificationService.php](backend/app/Services/NotificationService.php) |
| Auth/OTP | [backend/app/Services/PhoneOtpService.php](backend/app/Services/PhoneOtpService.php), [backend/app/Services/Msg91Service.php](backend/app/Services/Msg91Service.php), [backend/app/Http/Controllers/Auth](backend/app/Http/Controllers/Auth) |
| Driver onboarding | [backend/app/Http/Controllers/DriversController.php](backend/app/Http/Controllers/DriversController.php) |
| Safety | [backend/app/Http/Controllers/SafetyController.php](backend/app/Http/Controllers/SafetyController.php) |
| RBAC | [backend/app/Http/Middleware/EnsurePermission.php](backend/app/Http/Middleware/EnsurePermission.php), [backend/app/Http/Middleware/EnforceManagerCity.php](backend/app/Http/Middleware/EnforceManagerCity.php) |
| Cron registry | [backend/routes/console.php](backend/routes/console.php) |
| API surface | [backend/routes/api.php](backend/routes/api.php) |
| Admin routes (frontend) | [frontend/src/app/app.routes.ts](frontend/src/app/app.routes.ts) |
| Deployment | [backend/docker-compose.yml](backend/docker-compose.yml), [backend/deploy](backend/deploy) |

---

*End of audit. Keep §10 updated as items land; re-score subsystems quarterly or after each phase.*
