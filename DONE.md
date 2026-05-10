# DreamCabs — What's Already Built

> A clone of Uber / Jugnoo-style ride hailing for Android + iOS, with an admin web console.
> This document lists everything that is **already working** today. Written for non-technical
> readers and developers alike — plain English first, tech details in the *for developers*
> notes underneath.

The system has four moving parts:

| Part | What it is | Stack |
|---|---|---|
| **Customer mobile app** | The rider's app — book a ride, pay, rate, track | Ionic + Angular (Android + iOS) |
| **Driver mobile app** | The driver's app — go online, accept rides, navigate, get paid | Ionic + Angular (Android + iOS) |
| **Admin web console** | The operator's back office — pricing, dispatch, analytics, settings | Angular + PrimeNG |
| **Backend API** | The brain that talks to all three | Laravel 11, MySQL, Sanctum auth, Reverb websockets |

---

## 1. Sign-in & accounts

- **Phone OTP login** for customers and drivers (Firebase auth + SMS).
- **Google sign-in** as an alternative to phone OTP.
- **Profile completion** screen (name, email, photo) on first login.
- **Account deletion** flow on demand.
- **Admin login** (email + password) for the web console.
- **Roles** decide what each user can do: *customer*, *driver*, *admin* (a single user can have more than one).
- **Logout & token revoke** on all devices.

> *For developers:* Laravel Sanctum bearer tokens, `users` + `user_roles` tables, `role` and `role_any` middleware. Firebase OTP/Google verification on the backend. See `app/Http/Controllers/Auth/FirebaseAuthController.php`, `AdminAuthController.php`, `AccountController.php`.

## 2. Cities, geofencing & service area

- **Cities CRUD** in the admin (add/edit/disable).
- **Service-area polygon** drawn on a Google map per city.
- Bookings outside the polygon are rejected with a clear message.
- Each city has a center point + zoom for the maps.

> *Devs:* `cities.boundary_polygon` is JSON; `DynamicPricingService::pointInPolygon` (ray-casting) is reused for booking validation, dispatch maps filtering, and dynamic-pricing zone matching.

## 3. Pricing

- **Base pricing rules** per (city × ride type): base fare, per-km, per-min, surge multiplier, min fare, taxes, commission.
- **Tiered distance & time fares** (different rates after thresholds, e.g. ₹15/km up to 5 km then ₹12/km after).
- **Waiting time charges**, pickup distance charges, luggage charges, scheduled-ride premium.
- **Cancellation fees** with thresholds and customer subsidy logic.
- **No-show fees** with threshold minutes.
- **Dynamic pricing rules** — surge or discount tied to time-of-day, day-of-week, date range, region polygon, ride type, vehicle type. Each rule has separate customer-side and driver-side multipliers.
- **Live fare estimation** powering both customer and admin booking flows.

> *Devs:* `pricing_rules` (~44 cols), `dynamic_pricing_rules` with polygon + time windows + day-of-week bitmask, `App\Services\FareEstimationService`, `App\Services\DynamicPricingService`.

## 4. Ride products (Local / Rental / Out Station)

- **Three ride product categories** mapped per city in the admin:
  - **Local** — point-to-point inside the city (everyday cab).
  - **Rental** — hire by the hour/km package (business trips, sightseeing).
  - **Out Station** — intercity (Srinagar → Jammu, etc.), one-way or round-trip.
- Per city, each product can be turned **on/off**, given a **banner image**, **description**, and **info copy**.
- Stored in a way the customer/driver apps can later switch on/off accordingly.

> *Devs:* `city_ride_products` table keyed `(city_id, kind)`, auto-seeded on first GET, image upload to public disk under `city_ride_products/`. Trip schema has `product_kind` enum.

## 5. Ride types (vehicles)

- **Ride type catalogue** (Mini, Sedan, SUV, etc.) used in pricing and trip selection.
- Sortable list, descriptions.

> *Devs:* `ride_types` table; admin CRUD via `AdminPricingController::rideTypes`.

## 6. Customer mobile app

- **Sign-in** via phone OTP or Google.
- **Map-based pickup & drop** selection with Places autocomplete.
- **Live route preview** on the map (Google Directions).
- **Fare estimate** before booking.
- **Custom-fare offer** flow — customer offers a price; nearby drivers bid back.
- **Driver bidding view** — see counter-offers, accept the best one, or auto-accept the nearest.
- **Live trip tracking** — driver's position on the map in real time.
- **Customer location stream** to the driver app while in trip (so the driver sees a live customer dot).
- **In-trip chat** with the driver (typing + moderation hooks).
- **SOS button** on every trip for both customer and driver, with a safety event log.
- **Trip share-link** — the customer can WhatsApp a public live-tracking page to family.
- **Payment** via Cash, UPI deep-link, or scanned-QR.
- **Razorpay UPI flow** with idempotency.
- **Auto-generated invoice** (downloadable as PDF) after every trip.
- **Trip history** with the ability to rate the driver.
- **Background location** when the trip is active (works on locked phone).
- **Push notifications** (Firebase) for trip updates, driver bids, etc.
- **Account deletion** + logout from settings.

> *Devs:* Ionic 7 + Angular standalone components. `customer-mobile/src/app/pages/customer-book/`, `trip-active/`, `trip-history/`, etc. Real-time via Reverb websockets with polling fallback.

## 7. Driver mobile app

- **Sign-in** via phone OTP or Google.
- **Driver registration** flow (vehicle make/model, registration number, etc.).
- **Document uploads** (license, RC, insurance) for admin approval.
- **Go online / offline** toggle.
- **Available trips queue** showing trips the driver can bid on.
- **Bid on customer offers** (counter-offer or accept).
- **Accept / reject** ride requests with timeouts.
- **Trip stages** (en-route → arrived → started → completed) drive the UI.
- **Live navigation** via deep-link to Google Maps or in-app map.
- **In-trip chat** with the customer.
- **SOS button**.
- **No-show flagging** when the customer never arrives.
- **Trip history & earnings**.
- **Background location streaming** (battery-aware) while online.
- **Push notifications** for new ride requests and updates.
- **Payment-method preferences** (cash / UPI / QR — driver-controlled).

> *Devs:* `driver-mobile/src/app/pages/`. Backend controllers: `DriversController`, `RideAssignmentController`, `TripsController` (driver branches).

## 8. Admin web console

The full operator back office.

### Dashboards & lists
- **Dashboard** — at-a-glance KPIs.
- **Users** list with role management.
- **Drivers** — Active / Deactivated / Leaderboard / Performance / Approvals & Documents.
- **Rides** — All Rides table + Map View.
- **Safety events** log (SOS triggers + audit).
- **Reports** (legacy quick reports).

### Operator workflows
- **Manual Dispatch** — operator books a ride on behalf of a customer (phone lookup, city/fleet selection, scheduled or ASAP, multi-stop pickup/destination, payment method, round-trip toggle, fare estimate, book).
- **Maps** — live drivers (free / busy / inactive) plus active tasks (unassigned / assigned), filtered by city polygon.
- **Contact Drivers** — bulk SMS to a CSV-uploaded audience.

### Pricing & geofencing
- **Base Pricing** CRUD per (city × ride type) with all 40+ pricing levers.
- **Dynamic Pricing** rules CRUD with polygon drawing, day/time windows, ride-type/vehicle filters.
- **Geofencing** editor — draw / edit / delete city service-area polygons on Google Maps.
- **Fleets** CRUD per city (driver groupings).

### Settings (combined page with city sidebar + tabs)
- **General Settings** — per-city ride product catalogue (Local / Rental / Out Station with banner, description, info copy, on/off toggle).
- **City Settings** — per-city operational config: feature toggles (chat, region fare, QR booking, OTP), night-time window, theme color & branding (logo / splash / background), OTP messages (Android + iOS), allowed driver payment modes, support contacts, operator metadata.
- **Dispatcher Settings** — per-city × per-product **engine knobs**: hop interval & radius, max hops, scheduled-ride behaviour, booking-window guardrails (lead time, days limit, rides limit, cancel window).

### Analytics
- **Real Time** — gradient KPI cards, 30-second auto-refresh, today/yesterday toggle, multi-city/multi-vehicle filters.
- **Graphs** — Total Rides line, Demand Quality stacked bar, Revenue line, Active Drivers bar.
- **Reports** — searchable list of 9 reports (rides, cancellations, missed, incomplete, driver invoice daily/weekly/monthly, users with ride count) with date-range run + CSV export.

> *Devs:* Angular 17 standalone + PrimeNG. New controllers under `Admin/`: `AdminCitiesController`, `AdminFleetsController`, `AdminManualDispatchController`, `AdminAnalyticsController`, `AdminCityRideProductsController`, `AdminCitySettingsController`, `AdminDispatcherSettingsController`. Combined settings page at `frontend/src/app/admin/settings/settings.component.ts`.

## 9. Trip lifecycle (state machine)

The trip moves through these stages with strict, atomic transitions:

```
REQUESTED → NEGOTIATION → CONFIRMED → ASSIGNED →
EN_ROUTE_PICKUP → ARRIVED_PICKUP →
EN_ROUTE_DROP   → ARRIVED_DROP →
COMPLETED
                                   (CANCELLED branch from any pre-active stage)
```

- **Atomic claim** — drivers can race to grab a trip; the database makes sure only one wins.
- **Atomic confirm** — locking-then-transitioning keeps the offer/driver/fare consistent.
- **Late-cancellation fee** when the customer cancels inside the per-product cancel window.
- **No-show fee** with threshold minutes from the pricing rule.
- **Stale-negotiation cleanup** — trips abandoned in NEGOTIATION are auto-cancelled after a timeout.

> *Devs:* `App\Services\TripStateMachineService`, `TripAssignmentService::claim()` and `confirm()` with `lockForUpdate()`, `negotiations:cleanup` artisan command on a 1-minute cron.

## 10. Real-time / push

- **Websocket events** for negotiation offers, fare locks, trip status updates, location updates, customer location, SOS triggers, trip messages.
- **Firebase push notifications** for driver ride requests, trip events, SOS.
- **Device-token registration** on login + cleanup on logout.
- **Stale token pruning** (daily cron).

> *Devs:* Laravel Reverb (`broadcast()` after `DB::afterCommit`). FCM via `App\Services\NotificationService`. `device_tokens` table + `device-tokens:prune` command.

## 11. Auto-dispatch engine (the "hop loop")

- **Expanding-ring dispatch** — the system pings drivers within a small radius of pickup, waits N seconds, expands the radius, pings again, until a driver accepts or max hops is reached.
- **Manual fallback** — when auto-dispatch is off for a (city × product), the trip stays in the operator's queue for manual dispatch.
- **Scheduled-ride wakeup** — a scheduler runs every minute, finds rides whose pickup time is approaching (per-product alarm window), and pushes them into the dispatch loop.
- **Per-product tuning** — the hop interval, hop radius, max hops, dispatch mode (DELAYED / INSTANT / both) are all per-(city × product) so Rental can run differently from Local or Outstation.
- **Driver targeting** filters out drivers already on a trip, drivers not online, drivers whose last location ping is stale, and drivers outside the current ring.

> *Devs:* `App\Jobs\DispatchHopJob` orchestrates hops, calling into the existing `SendDispatchNotificationsJob` for the FCM fan-out. `App\Console\Commands\WakeScheduledTrips` runs every minute. Settings come from `dispatcher_settings` keyed `(city_id, kind)`.

## 12. Booking-window guardrails

The Dispatcher Settings drive these checks on every booking:

- **Minimum lead time** — can't book a ride starting in less than N minutes.
- **Maximum days ahead** — can't schedule a Local ride more than 1 day out (configurable).
- **Outstation return window** — round-trip return leg has its own days limit.
- **Per-customer rides limit** — the customer can hold at most N pending scheduled rides.
- **Late-cancellation window** — cancelling within N minutes of pickup applies the cancel fee.

> *Devs:* `App\Services\SchedulingPolicyService::validateBooking()` returns string error codes; consumed by `TripsController::store`, `AdminManualDispatchController::book`, and `TripsController::cancel`.

## 13. Negotiation / bidding system

- **Customer offers a fare** for the trip (instead of a fixed quote).
- **Drivers bid** within the negotiation window (counter-offer or accept).
- **Customer picks a winning bid** or auto-accepts the nearest.
- **Atomic locking** prevents two drivers from grabbing the same trip.
- All offers + the locked fare are broadcast in real time.

> *Devs:* `fare_negotiations` + `fare_negotiation_offers` tables. `FareNegotiationController`, `TripAssignmentService`. `FareNegotiationLocked` and `FareNegotiationOfferAdded` events.

## 14. Backend infrastructure

- **Laravel 11 + PHP 8.3** + MySQL.
- **Sanctum** bearer-token authentication.
- **Role middleware** (`role`, `role_any`).
- **Throttling** rules on OTP, booking, location, chat, webhooks.
- **CORS** configured for the mobile + admin origins.
- **Idempotency keys** on payment endpoints (UPI / cash / QR).
- **Request-ID** middleware for log correlation.
- **File storage** on the public disk (avatars, driver documents, banners, splash screens).
- **Cron jobs** registered: `negotiations:cleanup`, `device-tokens:prune`, `dispatch:wake-scheduled`.
- **Razorpay webhook** with throttling.
- **Firebase admin SDK** integrated for OTP + push.

## 15. Customer & driver auxiliary features

- **Trip ratings** — customer rates driver after each trip.
- **Trip messages** — chat thread per trip with admin moderation hooks.
- **Trip share link** — public, tokenized URL for live tracking.
- **Trip invoices** — auto-generated, downloadable.
- **Trip history** for both customer and driver.
- **Customer location** broadcast to the driver app during active trip (so the driver sees the live customer dot).
- **SOS / safety** — both sides can trigger SOS; events recorded for admin review.

---

## Snapshot of database tables we have

```
users, user_roles, personal_access_tokens, device_tokens,
cities, ride_types, fleets,
pricing_rules, dynamic_pricing_rules,
city_ride_products, city_settings, dispatcher_settings,
trips (with product_kind, scheduled_at, is_round_trip, stops, fleet_id, dispatched_by_admin_id, …),
fare_negotiations, fare_negotiation_offers,
driver_locations, customer_locations,
driver_documents, driver_payment_methods,
trip_messages, safety_events, ratings,
payments, invoices, …
```

That's the system as of today. See `TODO.md` for what's still pending.
