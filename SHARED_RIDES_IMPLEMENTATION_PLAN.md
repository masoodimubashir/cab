# DreamCabs — Service Catalogue & Shared Rides Implementation Plan

> **Goal:** restructure the catalogue into a **two‑axis matrix** — `scope (Local | Outstation) ×
> mode (Private | Fixed | Shuttle)` — so every one of the **6 cells** is a real product. `rental` and
> any other legacy product types are **removed**. **Private (both scopes) reuses the existing metered /
> whole‑cab ride unchanged; only Fixed and Shuttle are new** (shared, per‑seat, reservation‑based).
> Reuse the current schema/plumbing wherever possible and **never change Private‑ride behaviour**. Work
> it phase by phase; each phase is independently shippable and verifiable.
>
> Grounded against the live `cab_db` schema, the fare engine, the trip/dispatch lifecycle, the admin
> frontend, the RBAC layer, and both mobile apps (file:line anchors throughout). Date: 2026‑06‑04.

---

## 0. Service catalogue — the two‑axis matrix (6 products)

Two axes: **scope** ∈ {`local` (inside the city geofence), `outstation` (crosses the geofence,
intercity)} × **mode** ∈ {`private` (whole vehicle), `fixed` (shared, board anywhere on the route),
`shuttle` (shared, designated stops + timetable)}. Every cell is a product:

| mode ↓  /  scope → | **Local** (in‑city) | **Outstation** (intercity) |
|---|---|---|
| **Private** (normal) | Whole vehicle, door‑to‑door in the city. **Metered**. | Whole vehicle, intercity. **Whole‑cab fare**, optional round‑trip / driver allowance. |
| **Fixed** | Shared cab/auto on a fixed in‑city stretch; book a seat, **board anywhere along it**. **Per‑seat**. | Shared **Sumo corridor**, fixed intercity route; book a seat, board anywhere along the way. **Per‑seat**. *(dominant Kashmir pattern)* |
| **Shuttle** | Higher‑capacity van, fixed in‑city loop, **designated stops + timetable**. Reserve a seat, board at a stop. | Scheduled intercity van/bus, **fixed stops + timetable**. Reserve a seat, board at a stop. |

- **Data model = two columns**, not one. `city_ride_products` is keyed `(city_id, scope, mode)` —
  6 rows per city. `routes` (Fixed & Shuttle only) carry `scope` + `mode`; Outstation routes also name
  `origin_city_id` / `dest_city_id`.
- **Private = no new logic.** Both Private cells reuse the existing flows: Private‑Local → local metered
  (`estimateFare` + negotiation); Private‑Outstation → the existing `outstation_packages` (whole‑cab,
  round‑trip, driver allowance). They're product cards over existing behaviour.
- **Only Fixed & Shuttle are new** — shared, per‑seat (`seatFare`), with routes / stops / schedules /
  departures / `seat_reservations`. **Fixed** boards anywhere on the corridor; **Shuttle** uses named
  stops + a timetable.
- **`rental` and any other legacy product types are removed.** The catalogue is exactly these 6 cells.
- The four shared cells are **feature‑flagged off** (`is_active = false`) per city until a route + fare
  is configured; the two Private cells are on by default (today's behaviour).

---

## 1. Architecture decisions (locked & confirmed)

These are the load‑bearing decisions, all confirmed by the client.

0. **Two‑axis catalogue (confirmed).** `scope (local|outstation) × mode (private|fixed|shuttle)` →
   6 products. `city_ride_products` is keyed `(city_id, scope, mode)`; `routes` carry `scope` + `mode`.
   **`rental` and other legacy product types are removed.** Existing rows migrate to `mode=private`
   (local → local/private, outstation → outstation/private). Private (both scopes) reuses the existing
   metered / whole‑cab flow; only Fixed and Shuttle are new. *Locked.*

1. **One reservation table for both shared modes.** `seat_reservations` with a `booking_channel`
   enum (`advance | on_spot | dispatcher`). Per‑route `advance_required` flag decides policy:
   shuttle = advance‑required (walk‑up = last‑minute advance reservation against a departure);
   fixed = advance + on_spot. *Default: yes, one table.*

2. **The vehicle journey is one `trips` row; seats point at it.** A shuttle departure / a forming
   fixed vehicle materialises **one `trips` row** (driver, route, lifecycle, live tracking). Each
   passenger is a `seat_reservations` row with `trip_id → trips.id`. This inherits `trip_assignments`,
   `customer_locations`, `safety_events`, `trip_messages`, `driver_locations` for free. Requires
   making `trips.customer_id` **nullable**. *Default: yes — this is the biggest reuse win and avoids
   a parallel ride universe.*

3. **Per‑seat fares start flat, configured as JSON.** Copy the proven
   `outstation_packages.fare_config` pattern: a `fare_config` JSON blob carries `seat_fare` /
   `min_fare`. Stop‑pair matrix (shuttle) and segment/distance (fixed) are a later, additive phase.
   *Default: flat per‑seat per route for v1.*

4. **Fixed fares are NOT negotiated.** The whole `REQUESTED → NEGOTIATION → CONFIRMED` bid flow is
   bypassed for shared rides — the seat price is fixed and charged at booking. *Default: yes.*

5. **Charge timing.** Seat charged **at booking confirmation** (wallet/payment), consistent with how
   the customer commits to a fixed price. *Default: charge at booking.*

6. **Build order: shared infra → Shuttle end‑to‑end → Fixed on‑spot.** Shuttle is fully
   pre‑scheduled and reuses the existing scheduled‑dispatch worker, so it is the cleaner first vertical
   slice; Fixed adds the harder real‑time “forming vehicle / flag‑down aggregation” problem on top of
   the same data model. *Default: yes.*

> **✅ All confirmed.** Phases 1–3 are built on these decisions; everything else follows from them.

---

## 2. What we reuse vs. what is new

### Reuse (do **not** rebuild)
| Need | Reuse | Evidence |
|------|-------|----------|
| Temporary live customer position | `customer_locations` (trip‑scoped) | `2026_05_10_120000_create_customer_locations_table.php` |
| Per‑seat board pin capture | new `seat_reservations.board_*` columns + snap‑to‑route using existing ray‑cast | `DynamicPricingService::pointInPolygon` |
| Flexible per‑route fare numbers | `fare_config` JSON pattern + sparse merge | `FareEstimationService::fareInput` `:195`; `OutstationPackage` |
| Surge / time‑of‑day scoping | `dynamic_pricing_rules` (polygon + `days_of_week` bitmask + time window + `city_vehicle_type_ids`) | `DynamicPricingService::findApplicable` `:42` |
| Seat capacity | `city_vehicle_types.max_people` (default 4) | `city_vehicle_types` migration |
| Driver match / expanding ring | `DispatchHopJob` (parameterize `kind`) | `DispatchHopJob.php:66` |
| Scheduled dispatch worker | `WakeScheduledTrips` / `dispatch:wake-scheduled` | `WakeScheduledTrips.php:31` |
| Live tracking, messages, SOS, ratings, share link | all key on `trip_id` | trip‑lifecycle map |
| Admin CRUD page shape | copy `admin/vehicles/vehicles.component.ts` + `tm-*` UI | admin‑frontend map |
| Multi‑tab admin hub | copy `admin/rides/rides-shell.component.ts` | admin‑frontend map |
| Permission catalogue | `RbacSeeder::permissionCatalog()` `:203` | rbac map |

### New tables + the catalogue restructure
`routes`, `route_stops` (shuttle), `route_schedules` (shuttle), `route_departures`, `seat_reservations`.
Plus: **restructure `city_ride_products` from `kind` → `scope` + `mode`** (unique `(city_id, scope, mode)`;
migrate local→local/private, outstation→outstation/private; **drop rental**); `routes` carry `scope` +
`mode`; `trips.customer_id` → nullable, `trips.route_id` + `trips.route_departure_id`. (`trips.product_kind`
no longer exists — dropped earlier; a trip's mode is read from `route_departure_id → route.mode`.)

### Assumptions that WILL break private‑ride code if touched naively (guardrails)
These come straight from the gotcha audit — each is addressed in a specific phase:

- `trips.customer_id` is `NOT NULL` and read as “the rider” in `cancel/confirm/tip/no-show/share-link/
  updateCustomerLocation/sos` and every `$trip->customer_id !== $user->id` check. → **Phase 1** nullable +
  **Phase 5** move ownership checks to `seat_reservations`.
- `ratings.trip_id` is **UNIQUE** and `trip_share_links.trip_id` is **UNIQUE** (one per trip). → per‑seat
  ratings handled in **Phase 9**.
- `DispatchHopJob` & `WakeScheduledTrips` **hardcode `kind='local'`** when reading `dispatcher_settings`. →
  **Phase 8** parameterize.
- `ACTIVE_DRIVER_STATUSES` excludes “busy” drivers from new dispatch — a shuttle driver mid‑journey would
  be filtered out and could never pick up more shared riders. → **Phase 8** relax *for shared journeys only*.
- `LOCATION_STREAM_STATUSES` (driver app `rides.page.ts:474`) must mirror backend `ACTIVE_DRIVER_STATUSES`
  or POST `/location` 409s and streaming dies. → keep in sync in **Phase 7/8**.
- `fare_config` sparse‑merges OVER the base rule and **drops nulls** — to zero out `per_km`/`per_min` for a
  flat seat fare you must set them to `0`, not null. → **Phase 2**.
- Permissions are **not enforced at the API layer** today (only `role:admin`). New endpoints need an
  `EnsurePermission` middleware if real authz is wanted. → **Phase 3**.

---

## 3. Data model (new tables — proposed columns)

> Mirror existing conventions: `BIGINT UNSIGNED` FKs, `cascadeOnDelete`/`nullOnDelete` as noted, `fare_config`
> JSON like `outstation_packages`, `days_of_week` SMALLINT bitmask (Sun=1…Sat=64, 127=all) like
> `dynamic_pricing_rules`. Money = `DECIMAL(10,2)`, currency INR.

### `routes` — a corridor (fixed) or a stopped line (shuttle); Fixed & Shuttle only
| Field | Type | Notes |
|-------|------|-------|
| id | BIGINT UNSIGNED PK | |
| city_id | FK cities cascadeOnDelete | owning/operating city |
| origin_city_id / dest_city_id | FK cities NULL | endpoint cities for `scope=outstation`; null for local |
| scope | ENUM('local','outstation') | in‑city stretch vs intercity corridor |
| mode | ENUM('fixed','shuttle') | board‑anywhere vs stops+timetable |
| name | VARCHAR(120) | e.g. “Srinagar → Anantnag” |
| origin_name / dest_name | VARCHAR(160) | display |
| origin_lat/lng, dest_lat/lng | DECIMAL(10,7) | corridor endpoints |
| path_polyline | JSON NULL | `[[lat,lng],…]` corridor geometry (snap + render) |
| corridor_buffer_m | INT default 300 | board‑pin validity radius from polyline |
| city_vehicle_type_id | FK city_vehicle_types NULL | default vehicle class (seat capacity + commission) |
| fare_config | JSON NULL | `{ seat_fare, min_fare, … }` — per‑seat rate card |
| advance_required | BOOL default false | shuttle=true, fixed=false |
| board_anywhere | BOOL default false | fixed=true (drop‑pin), shuttle=false (named stops) |
| is_active | BOOL default true | feature‑flag per route |
| sort_order | SMALLINT UNSIGNED default 0 | |
| timestamps | | |

### `route_stops` — ordered named stops (**shuttle only**)
`id; route_id FK cascadeOnDelete; seq SMALLINT; name VARCHAR(160); lat/lng DECIMAL(10,7); is_pickup BOOL default true; is_drop BOOL default true; timestamps.` Index `(route_id, seq)`.

### `route_schedules` — recurring timetable template (**shuttle only**)
`id; route_id FK cascadeOnDelete; depart_time TIME; days_of_week SMALLINT UNSIGNED default 127; city_vehicle_type_id FK NULL; capacity SMALLINT UNSIGNED NULL (override max_people); is_active BOOL default true; timestamps.`

### `route_departures` — a concrete run (shuttle: per schedule+date; fixed: a forming vehicle)
| Field | Type | Notes |
|-------|------|-------|
| id | BIGINT UNSIGNED PK | |
| route_id | FK routes cascadeOnDelete | |
| route_schedule_id | FK route_schedules NULL nullOnDelete | null for fixed “forming” vehicles |
| trip_id | FK trips NULL nullOnDelete | **the vehicle journey** (created at dispatch) |
| driver_id | FK users NULL | assigned driver |
| city_vehicle_type_id | FK city_vehicle_types NULL | the vehicle class run |
| service_date | DATE | |
| depart_at | TIMESTAMP NULL | scheduled departure (shuttle) |
| capacity | SMALLINT UNSIGNED | seats total |
| seats_taken | SMALLINT UNSIGNED default 0 | maintained transactionally |
| status | ENUM('SCHEDULED','FORMING','DISPATCHED','DEPARTED','COMPLETED','CANCELLED') | |
| timestamps | | |

Index `(route_id, service_date, status)`.

### `seat_reservations` — one passenger’s booking (the per‑rider record)
| Field | Type | Notes |
|-------|------|-------|
| id | BIGINT UNSIGNED PK | |
| route_departure_id | FK route_departures cascadeOnDelete | the run booked |
| trip_id | FK trips NULL nullOnDelete | denormalised vehicle journey |
| route_id | FK routes | convenience |
| customer_id | FK users cascadeOnDelete | **the rider (ownership lives here, not on trips)** |
| seats | SMALLINT UNSIGNED default 1 | seats this booking holds |
| booking_channel | ENUM('advance','on_spot','dispatcher') | |
| board_stop_id | FK route_stops NULL | shuttle pickup stop |
| board_lat/lng | DECIMAL(10,7) NULL | fixed dropped pin |
| board_address | VARCHAR(255) NULL | |
| drop_stop_id | FK route_stops NULL | shuttle drop |
| drop_lat/lng / drop_address | … NULL | fixed drop |
| fare_amount | DECIMAL(10,2) NULL | per‑seat fare charged |
| commission_percent / commission_amount | DECIMAL | per‑seat settlement |
| promo_discount_amount | DECIMAL(10,2) NULL | |
| payment_method | ENUM('cash','razorpay','wallet') NULL | |
| status | ENUM('BOOKED','CONFIRMED','BOARDED','DROPPED','NO_SHOW','CANCELLED','COMPLETED') | per‑seat lifecycle |
| rating_score / rating_comment | … NULL | per‑seat rating (Phase 9) |
| boarded_at / dropped_at / cancelled_at | TIMESTAMP NULL | |
| timestamps | | |

Index `(route_departure_id, status)`, `(customer_id, status)`, `(trip_id)`.

### Existing‑table changes
- **`city_ride_products`: `kind` → `scope` + `mode`** — add `scope ENUM(local,outstation)` + `mode
  ENUM(private,fixed,shuttle)`, backfill (local→local/private, outstation→outstation/private), **delete
  rental + other legacy rows**, drop `kind`, `unique(city_id, scope, mode)`. (New unique added before the
  old is dropped, since `(city_id,kind)` backed the `city_id` FK.)
- `trips.customer_id` → **nullable** (raw `ALTER … MODIFY`, FK + `(customer_id,status)` index kept).
- `trips.route_id` FK routes NULL nullOnDelete; `trips.route_departure_id` FK route_departures NULL nullOnDelete.
- A compat `kind` is **derived** in API responses (`CityRideProduct::getKindAttribute`: private→scope,
  shared→mode) so the current customer app + admin Ride Products page stay green until they move to scope+mode.

---

## 4. Phased build order

Legend: ☐ = step. Each phase ends with **Verify** (how we prove it works given `pdo_sqlite` is absent —
use `php -l`, `php artisan migrate`/`route:list`/`tinker`, a rolled‑back MySQL transaction self‑test, and
`npx ng build --configuration development` for each app).

---

### Phase 1 — Schema & catalogue foundation (backend, additive) — ✅ DONE & verified
**Goal:** all new tables + enum/column changes exist; private behaviour untouched.

- ✅ Migration `2026_06_05_100000`: **restructure `city_ride_products` `kind` → `scope`+`mode`** (backfill local/outstation → private, **drop rental**, `unique(city_id,scope,mode)`, new unique added before old to keep the `city_id` FK covered). `routes` carry `scope`+`mode` (`100100`). `trips.product_kind` was already dropped (`2026_05_23_100200`); a trip's mode is read from `route_departure_id → route.mode`.
- ✅ Migration `2026_06_05_100600`: `trips.customer_id` → nullable (raw `ALTER … MODIFY`, FK + `(customer_id,status)` index preserved); add `trips.route_id`, `trips.route_departure_id` FKs.
- ✅ Migrations `100100`–`100500`: `routes` (scope+mode), `route_stops`, `route_schedules`, `route_departures`, `seat_reservations` (columns from §3).
- ✅ Models: `Route` (scope+mode), `RouteStop`, `RouteSchedule`, `RouteDeparture`, `SeatReservation` (`#[Fillable]` + casts + relations); `Trip` wired with `route()`/`routeDeparture()`/`seatReservations()`/`isShared()`; `CityRideProduct` (scope+mode + compat `kind` accessor).
- ✅ Catalogue: `AdminCityRideProductsController` seeds the **6 cells** (2 Private active, 4 shared inactive); `PricingController::products` + the admin Ride Products page emit/consume scope+mode (+ compat `kind`). **Rental removed.**
- ✅ **Verified:** `php -l` clean; `migrate` up + `migrate:rollback` + re‑migrate all clean (reversible, incl. the FK‑aware unique swap); rolled‑back MySQL self‑tests green — schema chain (route→stop→schedule→departure→seat, NULL‑customer shared `trips` row, `isShared()`) **and** the catalogue rework (6 cells seeded, 2 Private active / 4 shared inactive, rental gone, compat `kind` = private→scope / shared→mode, customer endpoint returns the 2 active Private with scope+mode+kind).

---

### Phase 2 — Per‑seat fare engine (backend) — ✅ DONE & verified
**Goal:** a route’s `fare_config` produces a fixed per‑seat fare that still flows through min_fare / promo /
tax / commission, **without** metered distance/time math.

- ✅ Added `FareEstimationService::seatFare(array $fareConfig, int $seats=1, ?array $dynamicFactors=null, ?CityWidePromotion $promo=null): array` — a **parallel** method (not a refactor of `estimateFare`, so the private path is byte‑for‑byte unchanged) that prices `seat_fare × seats` flat and runs it through the same tail (surge → dynamic factor → `min_fare` floor → reused private `applyPromotion()` → tax). Returns the same breakdown shape + `commission_percent`.
- ✅ Numeric‑safe: `surge_multiplier` defaults to `1`, `seats` clamps to ≥1; metered `per_km`/`per_min` in a config are simply never read (no leakage).
- ✅ Surge policy: v1 leaves `dynamicFactors` null for predictable shared pricing (shuttle locks fare; fixed flat). `fare_config.surge_multiplier` still honoured; the `dynamicFactors` param is the hook for an optional fixed‑mode factor later.
- ✅ Quote endpoint `POST /pricing/seat-estimate` (route_id, seats, optional board/drop) → seat breakdown, two‑pass promo resolution like `estimate()`. Registered (`throttle:booking`).
- ✅ Short‑circuited `recomputeFinal` for shared trips (guard on `route_departure_id`): returns `final_fare` = Σ active seats’ `fare_amount` (cancelled/no‑show excluded), ignores the negotiated floor, no re‑metering.
- ✅ **Verified:** `php -l` clean; route registered; 10‑assertion rolled‑back self‑test green — flat (per_km/per_min ignored), multi‑seat, min_fare floor, tax, in‑config surge, commission passthrough, seats clamp, and the `recomputeFinal` short‑circuit (Σ active seats = 500, floor ignored, `shared_ride` marked).

---

### Phase 3 — Admin: Routes + Stops CRUD — ✅ DONE & verified
**Goal:** an operator can define a corridor/line, its stops, and its seat fare.

- ✅ Backend `Admin/AdminRoutesController` — city‑scoped index/store/update/destroy with **embedded stop management** (a `stops[]` payload, replaced atomically in a transaction) and a `fare_config` allowlist (`seat_fare,min_fare,surge_multiplier,commission_percent,tax_percent`). Mode‑sensible defaults: shuttle→advance_required, fixed→board_anywhere. Routes registered under the `manager.city` group.
- ✅ RBAC: added a **Shared Rides** group to `RbacSeeder::permissionCatalog()` with `routes.manage`, `schedules.manage`, `reservations.view`, `reservations.manage`; granted setup+ops slugs to `admin`, ops slugs (`reservations.*`) to `city_manager`; Super Admin auto‑covered. Re‑seeded (idempotent).
- ✅ Built `EnsurePermission` middleware (`User::hasPermission()`), registered alias `permission` in `bootstrap/app.php`, and gated the routes endpoints with `permission:routes.manage` — the **first** API‑layer permission enforcement (opt‑in per route; existing role‑only endpoints unchanged).
- ✅ Frontend `admin/routes/routes.component.ts` (modeled on `subscriptions.component.ts`): `tm-data-table` + **scope/mode/status** filters + right‑side `tm-drawer` create/edit form (**scope + mode selectors**, **origin/dest city pickers for Outstation**, endpoints + lat/lng, per‑seat fare, vehicle, corridor buffer, policy toggles, a repeatable **stops editor** shown for shuttle) + `tm-modal` delete + `ToastService`; city‑scoped via `CityContextService.cityId$`. The admin **Ride Products** page (`general-settings`) updated to render the 6 scope·mode cells.
- ✅ Wired: route in `app.routes.ts` (before `**`); **Routes** nav item in City Setup gated by `can('routes.manage')` (icon `road`); `TITLES` + `CITY_SCOPED` entries.
- ✅ **Verified:** `php -l` clean; RBAC re‑seed (4/4 slugs, granted to admin not city_manager); 5 endpoints in `route:list`; 15‑assertion rolled‑back controller+middleware test (store/update/destroy, stops cascade + seq, fare_config cleaning, mode defaults, super‑admin passes / non‑manager 403); **`npx ng build` green**.

> Note: polyline editing (drawing the corridor on a map) is deferred to Phase 4/6; the form stores endpoints + corridor buffer, and `path_polyline` stays optional/null for now.

---

### Phase 4 — Admin: Schedules + Departures board (shuttle) — ✅ DONE & verified
**Goal:** define timetables and see/generate concrete daily departures with seat counts.

- ✅ Backend: shuttle **timetable edited inside the route drawer** (`schedules[]` on the route payload — `depart_time`, `days_of_week` bitmask, capacity). `RouteDepartureMaterializer` service + `routes:materialize-departures` command (scheduled daily 02:00) turn active shuttle schedules into dated `route_departures` (idempotent via a unique index `(route_id, route_schedule_id, service_date)`); auto‑runs on save, plus a manual `generate-departures` endpoint. Fixed routes are never materialised (they form at dispatch).
- ✅ Backend: `AdminRouteDeparturesController` — paginated, city‑scoped **departures board** (`GET /departures`, filter route/status/date) + per‑departure **manifest** (`GET /departures/{id}/manifest`); gated `permission:reservations.view` / `schedules.manage`.
- ✅ Frontend: a **timetable editor** in the Routes drawer (time + 7‑day toggles → bitmask + capacity, shuttle only) and a new **Departures** page (board + manifest drawer + "Generate" button), wired into nav/route/title/city‑scope under Operations (`reservations.view`). *(Chose a standalone Departures page over a tabbed Routes hub — simpler, same function.)*
- ✅ **Adversarially reviewed** (4‑lens workflow) and fixed the findings:
  - **HIGH** — timetable edits orphaned booked departures + silently duplicated (fired on *every* save). Fixed: `syncSchedules` now **reconciles schedules by natural key** (`depart_time`,`days_of_week`) so ids are preserved; retired rows drop only their future un‑booked departures and deactivate (keep FK) if booked. Materialize moved **inside the transaction**.
  - **MED** — capacity‑0 trap → 0‑aware fallback clamped to ≥1; stale departures not reconciled → materializer now `updateOrCreate`s future SCHEDULED un‑booked runs (never touches booked/departed); off‑by‑one loop → exact N‑day horizon.
  - **MED (FE)** — departures route filter number/string mismatch → `routeId` kept as string.
- ✅ **Verified:** `php -l` clean; command + 5 routes registered; **23 rolled‑back assertions green** across two suites — materializer (bitmask Mon‑only, idempotency, fixed‑excluded, board/manifest/generate) and the fixes (name‑edit causes no orphan/duplicate, schedule‑id reuse, capacity reconcile on un‑booked / preserved on booked, time‑change keeps booked runs, capacity‑0 clamp); admin **build green**.

---

### Phase 5 — Reservation engine (backend, customer‑facing API) — ✅ DONE & verified
**Goal:** a rider can book a seat (advance or on‑spot), capacity is enforced, the seat is charged, and the
board pin is validated against the corridor.

- ✅ `SeatReservationService::book/cancel/noShow` — booking runs in a transaction that **locks the user row** (serialises wallet debits) **and** the `route_departures` row, checks `seats_taken + seats ≤ capacity`, computes fare via `seatFare()` (+ city‑wide promo), charges the wallet, creates the `CONFIRMED` reservation, increments `seats_taken`. Closed‑departure (DISPATCHED/DEPARTED/COMPLETED/CANCELLED) and channel policy (shuttle = advance, fixed = advance/on‑spot) enforced.
- ✅ Board validation via `GeoService` — shuttle requires a valid pickup `route_stop`; fixed validates the dropped pin against the corridor (polyline → equirectangular point‑to‑segment distance ≤ `corridor_buffer_m`, **fail‑closed**, straight‑chord fallback when no usable polyline).
- ✅ Endpoints (customer): `GET /shared/routes`, `GET /shared/routes/{route}/departures`, `POST /shared/seat-reservations` (**`idempotent`** + `throttle:booking`), `GET /shared/seat-reservations`, `POST /shared/seat-reservations/{id}/cancel`. (`no-show` is driver/admin‑side, wired in Phase 7/8.)
- ✅ Ownership moved off `trips.customer_id`: added `Trip::isParticipant()` (private = the customer; shared = any **active** seat‑holder) and routed `updateCustomerLocation` / `sos` / `messages` guards through it — private behaviour unchanged.
- ✅ Cancellation frees the seat (`seats_taken--`) + full wallet refund (locked re‑check → no double‑refund); no‑show forfeits without cancelling the vehicle.
- ✅ **Adversarially reviewed** (4‑lens workflow); fixed the findings: **HIGH** wallet‑overdraw TOCTOU (per‑user lock), missing `idempotent` (added), concurrent‑cancel double‑refund (lock + re‑check), board‑pin null‑distance fail‑open (fail‑closed + clean‑count gating); **MED** DISPATCHED now closed, `isParticipant` active‑seats only.
- ✅ **Verified:** `php -l` clean; 5 routes + idempotent registered; **32 rolled‑back assertions green** across the engine suite (capacity/overbook, stop & corridor validation, charge/refund, closed departure, `isParticipant`) and the fix suite (user‑lock booking, locked double‑cancel, DISPATCHED reject, malformed‑polyline fail‑closed, NO_SHOW excluded).

> Note: automatic **fixed "forming" departure** creation (so a rider can start a corridor vehicle without a pre‑existing departure) is deferred to **Phase 8** (dispatch); the engine already books against any departure, and fixed board‑pin validation is fully built & tested.

---

### Phase 6 — Customer mobile: shared‑ride booking (Shuttle) — ✅ DONE & verified
**Goal:** the booking screen presents the catalogue; **Private** routes to the **existing metered / whole‑cab
flow** unchanged; **Fixed/Shuttle** go through the new route → departure → seat(s) → confirm (no negotiation)
path. Existing flows byte‑for‑byte unchanged.

- ✅ **Picker hook (tiny, safe):** widened `customer-book` product types to carry `scope`+`mode`+`kind` (the products API now returns all three) + icons for `fixed`/`shuttle`. A new `onSelectProduct(p)` branches: **Private** (local/outstation) stays in the existing flow via `selectProductKind()`; **Fixed/Shuttle** navigate to the dedicated page. The private snap‑to‑first logic is preserved. No other change to the 2000‑line page.
- ✅ **Isolated `SharedBookPage`** (own lazy module/route `/shared-book?city_id&scope&mode`) — keeps the new flow out of the private page entirely. **Shuttle end‑to‑end:** list routes (`GET /shared/routes`) → pick → departures (`GET /shared/routes/{id}/departures`, seats‑remaining filtered) → board/drop stop + seat stepper + live total → **confirm** (`POST /shared/seat-reservations` with an **Idempotency‑Key** header) → success. **No negotiation.**
- ✅ **Fixed:** routes list shown; on‑spot booking surfaces a clear "opens when a vehicle is forming" note (completes in Phase 8 with forming departures).
- ✅ `ApiService.post` extended with optional headers (backward‑compatible) so the booking sends an idempotency key, matching the platform's pay/topup convention.
- ✅ **Verified:** `npx ng build` (customer‑mobile) **green** (shared‑book lazy chunk compiles); frontend↔API contract checked against `SharedRidesController` (book payload + route/departure/reservation response shapes match); private picker path unchanged.

> Note: interactive click‑through QA on a device/emulator is the appropriate final UI check (can't run the Ionic webview headlessly). Live‑tracking of a booked shuttle surfaces once the departure→trip materialises in **Phase 8**.

---

### Phase 7 — Driver mobile: shared‑departure manifest — ✅ DONE & verified
**Goal:** driver runs a shared departure with an N‑passenger pickup manifest, reusing the existing
active‑trip shell.

- ✅ Backend: `SeatReservationService::manifestFor(Trip)` (route name + ordered passengers w/ board point & per‑seat status + ordered stops); `/drivers/me/active-trip` enriched with `is_shared` + manifest; dedicated **`GET /trips/{trip}/manifest`** (driver) for the app to (re)load; per‑seat **`POST .../board`** + **`.../no-show`** (`DriverManifestController`, guarded: trip's driver only, reservation must belong to the trip). `SeatReservationService::board()` added.
- ✅ Driver app: `isSharedDeparture` getter (reads `lastTrip['route_departure_id']`), `sharedManifest` + `ManifestPassenger`/`ManifestStop` types, a **manifest panel** inserted between the legs‑card and secondary‑actions (gated by `isSharedDeparture` — single‑rider trips render unchanged), per‑passenger **Board / No‑show** CTAs, and `maybeRefreshManifest()` hooked into `loadTrip()` and after each per‑seat action.
- ✅ Per‑seat actions hit the new endpoints (not the trip‑level `markCustomerNoShow()`); status pills reflect BOARDED/NO_SHOW/etc.
- ✅ **Verified:** `php -l` clean; 3 manifest routes registered; **9 rolled‑back assertions green** (manifest data shape, route/passengers/stops, board→BOARDED+timestamp, no‑show→NO_SHOW, wrong‑driver 403, refactor parity); driver **build green**.

> Notes: live operation (a driver actually receiving a shared departure) lights up with **Phase 8** dispatch (departure→trip). Numbered per‑stop **map pins** + multi‑waypoint nav were deferred (the list‑based manifest is sufficient for v1; the map enhancement can ride Phase 8). No new trip statuses were added, so `LOCATION_STREAM_STATUSES` stays in sync.

---

### Phase 8 — Dispatch & lifecycle integration — ✅ DONE & verified
**Goal:** a shared departure becomes a real trip and reaches a driver; Fixed booking goes live.

- ✅ **Departure → trip materialisation + dispatch** (`SharedDispatchService::materializeAndDispatch`): row‑locked + idempotent — turns a SCHEDULED shuttle run / FORMING fixed vehicle into a **CONFIRMED `trips` row** (`customer_id=null`, `route_departure_id` set, `final_fare` = Σ seat fares), links the seats, marks the departure DISPATCHED, and **pre‑assigns the nearest eligible driver**. The driver then accepts via the existing `/driver-accept` and runs it with the Phase‑7 manifest. (Deliberately bypasses the private negotiation/expanding‑ring dispatcher — shared rides are pre‑priced — so the private hot path is untouched.)
- ✅ **`routes:dispatch-due`** command (scheduled every minute): dispatches shuttle runs within the alarm window + fixed forming vehicles that are full or past a forming timeout (and cancels empty timed‑out forming rows).
- ✅ **Fixed "forming" vehicles** (`SeatReservationService::formingDepartureFor`, route‑locked) — unblocks Fixed booking: a `route_id` booking joins/creates the open forming vehicle. Customer **Fixed flow is now live** (board‑location → confirm); the placeholder is gone.
- ✅ Per‑seat lifecycle stays on `seat_reservations` (BOOKED→BOARDED→…); the vehicle‑level `trips.status` machine is unchanged.
- ✅ **Adversarially reviewed** (4 lenses); fixed the findings: **HIGH** cross‑system **driver double‑booking** (private busy‑filters omitted `CONFIRMED`) → introduced canonical **`Trip::DRIVER_BUSY_STATUSES`** used at all five busy filters + an **authoritative one‑trip‑per‑driver guard** at both bind points (`/driver-accept` driver‑locked, `confirm()`); **HIGH** rejected shared trip orphaned riders → **shared‑aware `reject()`** resets the departure (re‑dispatchable), frees the seats, cancels the orphan; plus empty‑forming cleanup and rejecting a fixed `route_departure_id`.
- ✅ **Verified:** `php -l` clean; both commands scheduled; **15 rolled‑back assertions green** — materialise/dispatch (driver assigned, seats linked, fare), idempotency, no‑driver/empty‑departure, busy‑driver exclusion, the **accept‑409 double‑booking guard**, shared‑reject re‑dispatch, **and a private‑accept regression check (200→ASSIGNED, no private regression)**; customer **build green**.

> v1 notes: shared dispatch is **auto‑assign‑nearest** (not the push expanding‑ring) — simplest correct path; a rejected shared trip may be re‑offered to the same nearest driver next cycle (multi‑driver cities self‑resolve; a rejection‑memory refinement can come later). Optional hard DB backstops (unique on `trips.route_departure_id`, partial unique on FORMING) were left as documented future hardening since the app‑layer locks already prevent the races.

---

### Phase 9 — Per‑seat settlement, ratings, safety, payments — ✅ DONE & verified
**Goal:** money and feedback are correct per passenger, not per vehicle.

- ✅ **Per‑seat settlement** (`CommissionSettlementService::settle` branches on `route_departure_id`): the money flows the **opposite way** to private — riders **prepaid the platform at booking** (Phase 5), so at COMPLETED the driver is **CREDITED their net earnings** (Σ carried‑seat fares − per‑seat commission), each carried seat is stamped (`commission_amount`, status→COMPLETED), no‑show seats are forfeit (driver earns nothing on them), and the trip's `final_fare`/`commission_*` are set. Honours the operator's `no_commission` mode. (Subscriptions aren't consumed — different model.) Hooks into the existing COMPLETED transition; **private settlement unchanged**.
- ✅ **Per‑seat ratings**: ratings live on `seat_reservations.rating_*` (the `ratings.trip_id` UNIQUE can't hold many riders), via `POST /shared/seat-reservations/{id}/rating` (owner‑only, only after the ride). Two riders rate one shuttle journey with no collision.
- ✅ **Payments**: nothing to route at completion — shared seats are **charged once at booking** (wallet), so there's no post‑trip payment/coupon step; the driver credit above is the only completion‑time money move.
- ✅ **Safety / messages / live‑location**: already covered by `Trip::isParticipant()` (Phase 5) — any active seat‑holder (incl. a late‑joiner) passes the guards; verified in Phase 5.
- ✅ **Verified:** `php -l` clean; rating route registered; **10 rolled‑back assertions green** — driver credited net 128 (160 fares − 32 commission), no‑show excluded, per‑seat commission stamped, seats→COMPLETED; two per‑seat ratings persist; can't rate a no‑show/non‑owned seat; **and a private‑settlement regression check (still debits 20, no change)**.

> Follow‑up: a small "rate your ride" prompt in the customer app (the endpoint is live) — best folded into the Phase 10 polish.

---

### Phase 10 — Feature‑flag rollout + regression — ✅ DONE & verified
**Goal:** ship dark, enable per city, prove private is untouched.

- ✅ **Feature flag**: the 6 products seed per city with the 4 shared cells **inactive**; `PricingController::products` returns only active, so riders never see an unconfigured product. Added an **activation guard** — a Fixed/Shuttle product can't be enabled until an active route of that scope+mode exists (422 otherwise). Review confirmed the guard has **no reachable bypass**.
- ✅ **No backfill needed**: private rows untouched; the customer app sees Local/Outstation via the compat `kind`.
- ✅ **Full end‑to‑end lifecycle proven** (13 assertions): seed → guard blocks/permits activation → book → charge → dispatch → driver accept → progress → COMPLETED → driver credited net → rate.
- ✅ **Readiness review** (4 lenses) = **GO**: private flow **byte‑for‑byte unchanged** (every shared branch gated on `route_departure_id`/`isShared()`; busy‑status change only ever excludes an already‑bound driver), **no null‑customer crashes** on any path a shared trip travels, rollout safety airtight (off‑by‑default, crons idempotent/bounded/no‑op, schedulers never touch private). Fixed the gaps it found: **HIGH** — stranded paid riders when no driver is ever found → **`expireOverdue` safety net** (refund every seat + notify, mirrors the private `WakeScheduledTrips`); **MED** — reject→re‑offer loop → exclude drivers who rejected this departure; rider **dispatch + refund notifications**; **LOW** — post‑dispatch cancel reconciles the trip fare and cancels the empty vehicle (frees the driver).
- ✅ **Verified:** `php -l` clean; `migrate:status` clean; **all three apps build green**; **22 rolled‑back assertions** across the end‑to‑end lifecycle + the readiness fixes (expiry refund + notify, reject‑loop exclusion, empty‑trip teardown).

> Documented post‑launch follow‑ups (not blockers — the money‑stranding net is in place): full per‑status rider notifications (only assigned/refund wired now), admin "cancel‑&‑refund / force‑dispatch" buttons for a stuck departure, an admin‑UI "Shared ride" label where `customer` is null, a customer "finding a driver" reservation state, and a "rate your ride" prompt in the app.

---

## 5. Risk register (top items, with mitigation)
| Risk | Impact | Mitigation / Phase |
|------|--------|--------------------|
| `trips.customer_id` nullable breaks an ownership check we missed | Private rides 500 / auth bypass | Grep every `customer_id !==` usage; route shared guards through `seat_reservations` (P1/P5) |
| Fixed fare double‑charges (seat fare + metered) | Overcharge | Dedicated `seatFare()` branch + short‑circuit `recomputeFinal` (P2) |
| Busy‑driver exclusion relaxed too broadly | Private dispatch sends rides to occupied drivers | Scope the relaxation to the *same shared departure* only (P8) |
| `dispatcher_settings` still read as `kind='local'` | Shared modes silently use wrong dispatch config | Parameterize both call sites (P8) |
| `LOCATION_STREAM_STATUSES` drift | Driver GPS silently stops (409) | Keep allowlist in sync; add a test (P7/P8) |
| Old `kind` consumer breaks on the scope+mode restructure | Customer app / admin Ride Products page render wrong | API responses emit a derived compat `kind` (`CityRideProduct::getKindAttribute`) so current consumers stay green; both move to scope+mode in P6 |
| Permissions not enforced server‑side | New admin endpoints world‑open to any admin token | Add `EnsurePermission` middleware (P3) |

## 6. Open questions (non‑blocking — sensible defaults applied)
The catalogue (§0) and the §1 decisions are confirmed and built (Phases 1–3). These remain only as
later‑phase product choices; the plan proceeds on the default unless you say otherwise:
1. Pilot city + one sample fixed corridor + one sample shuttle line (with stops/timetable) to seed. *(default: ask when we reach a live demo)*
2. Cash seats on a shared vehicle — collected by driver on board, or app‑only (wallet/razorpay)? *(default: app‑only for v1; cash addable later)*
3. Fixed‑mode v1 fare — flat per‑seat for the whole corridor, or short‑hop discount from day one? *(default: flat per‑seat)*

---

*Build top‑to‑bottom. After each phase, stop at **Verify** before starting the next — every phase is a
shippable increment and private rides must stay green throughout.*
