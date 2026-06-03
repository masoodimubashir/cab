# Scheduled Rides + Notifications — What was built

**Date:** 2026-06-03

This delivers an end-to-end **"book a ride for later"** feature across all three apps, a brand-new **in-app notifications** system (customer / driver / admin), and finishes wiring the **Dispatcher → Scheduled rides** settings so every switch on that screen now actually does something.

---

## 1. The customer can now book for later

On the booking screen's **fare step** there's a **Ride now / Schedule** switch. Pick **Schedule**, choose a date + time on the calendar, set your fare, and tap **Schedule ride**. You get a confirmation and the ride lands in your new **Scheduled rides** list. Near pickup time the system automatically finds you a driver (see the dispatch modes below).

- **Customer menu → Scheduled rides** — upcoming pre-booked trips (next first), with status (Awaiting driver / Confirmed) and a **Cancel** button.
- **Customer menu → Notifications** — every update about your rides, with unread highlighting + "Mark all read".

## 2. The driver sees their scheduled work

- **Driver drawer → Scheduled rides** — upcoming booked trips assigned to them (read-only summary; the live ride still appears under **Rides** once it starts).
- **Driver drawer → Notifications** — same inbox, tapping a ride-update opens that ride.

## 3. The admin sees + manages scheduled rides

- **Rides** now has two tabs: **All Rides** and **Scheduled** (deep-linkable via `?tab=scheduled`). The Scheduled tab reuses the existing filtered table (phone, status, ride type, vehicle type, date range, pagination), sorted by pickup time. When a scheduled ride goes live it **also** appears in the normal ongoing buckets — nothing is hidden.
- **Notifications** (new left-nav item) — an in-panel feed of scheduled-ride events (booked / assigned / cancelled / expired).

---

## 4. The Dispatcher → Scheduled-rides settings now ALL work

Per (city, product) the operator controls:

| Setting | What it now does |
|---|---|
| **Scheduling available** | Master on/off for pre-booking (already worked; rejects future bookings when off). |
| **Auto-fire at alarm time** | Master switch for auto-dispatching scheduled rides. Off = fully manual (the worker won't touch them). |
| **Dispatch only pre-assigned** | When on, the worker only auto-dispatches scheduled rides that already have a chosen driver. |
| **Schedule dispatch mode** *(was dead — now wired)* | **Delayed** = dispatch near pickup (at the alarm). **Instant** = dispatch the moment it's booked. **Instant & Delayed** = dispatch at booking *and* re-try at the alarm if still unassigned. |
| **Scheduler alarm (min before pickup)** | How many minutes before pickup the "Delayed" search begins. |

**How the timing decision is made (single source of truth):** `SchedulingPolicyService::shouldDispatchOnBooking()` decides booking-time dispatch; `WakeScheduledTrips` decides alarm-time dispatch. A `scheduled_dispatch_started_at` marker guarantees the worker fires **once**, never every minute.

---

## 5. Bug #5 fixed — scheduled rides can no longer be stranded

Previously, if the background worker was down for more than **5 minutes** and a ride's pickup time passed in that gap, the ride was **never dispatched and silently vanished**.

Now `WakeScheduledTrips` runs two passes every minute:
1. **Catch-up (2 hours):** a ride overdue by up to 2h still gets a driver when the worker recovers — a late driver beats no driver.
2. **Expire:** a ride overdue beyond 2h is auto-cancelled with a clear reason, and the **customer + admins are notified** — never silent.

---

## 6. Notifications system (built from scratch)

There was no in-app notification store before (only raw FCM push). Added:

- **`app_notifications` table** + `AppNotification` model (named `app_*` so it never clashes with Laravel's built-in `notifications` table on `User`).
- **`NotificationCenter` service** — writes the in-app row **and** best-effort FCM push (`notify`, `notifyUserId`, `notifyAdmins`). Push failures never block the in-app record.
- **`/me/notifications`** endpoints (role-agnostic): list, unread-count, mark-one-read, mark-all-read.

**Events that notify** (customer / driver / admin as appropriate):
| Event | Customer | Driver | Admin |
|---|---|---|---|
| Scheduled ride **booked** | ✅ | — | ✅ |
| Driver **assigned/confirmed** | ✅ | ✅ | ✅ |
| Alarm fired → **searching** | ✅ | — | — |
| Ride **cancelled** by customer | — | ✅ (if assigned) | ✅ |
| Ride **expired** (no driver) | ✅ | — | ✅ |

---

## Files changed / added

**Backend**
- `database/migrations/2026_06_03_120000_create_app_notifications_table.php` *(new)*
- `database/migrations/2026_06_03_120100_add_scheduled_dispatch_started_at_to_trips_table.php` *(new)*
- `app/Models/AppNotification.php` *(new)*, `app/Models/Trip.php` (marker field)
- `app/Services/NotificationCenter.php` *(new)*, `app/Services/SchedulingPolicyService.php` (mode helpers)
- `app/Http/Controllers/NotificationsController.php` *(new)*
- `app/Console/Commands/WakeScheduledTrips.php` (bug #5 + modes + notifications)
- `app/Http/Controllers/TripsController.php` (scheduled list endpoints, booking + cancel notifications, `scheduled_at`)
- `app/Http/Controllers/FareNegotiationController.php` (booking-time dispatch gating + assigned notifications)
- `app/Http/Controllers/Admin/AdminManualDispatchController.php` (gating + notifications)
- `app/Http/Controllers/Admin/AdminTripsController.php` (real `scheduled` category)
- `routes/api.php` (notifications + scheduled-list routes)

**Customer app** — `pages/scheduled-rides/*` *(new)*, `pages/notifications/*` *(new)*, `customer-book.page.*` (schedule picker), `customer-tabs-routing.module.ts`, `side-menu.component.html`.

**Driver app** — `pages/scheduled-rides/*` *(new)*, `pages/notifications/*` *(new)*, `tabs-routing.module.ts`, `app-routing.module.ts`, `dashboard.page.ts` (drawer items).

**Admin app** — `admin/rides/rides-shell.component.ts` *(new)*, `admin/notifications/notifications.component.ts` *(new)*, `app.routes.ts`, `app.component.ts` (nav + title).

---

## Verification

- Backend: `php -l` clean on every changed file; both migrations ran; `php artisan route:list` confirms the new routes.
- Customer / Driver / Admin: `ng build --configuration development` — all exit 0.

## Known follow-ups (not in scope here)

- **Driver pre-assignment UI** — "Dispatch only pre-assigned" is honoured, but there's no admin screen yet to hand-pick a driver for a scheduled ride (so that gate currently means "don't auto-dispatch" until such a flow exists).
- The 2h expire window is a constant in `WakeScheduledTrips`; promote to a setting if operators want it tunable.
- Tier-2 #7 (driver acceptance window) and #8 (dedup/double-dispatch) remain open.
