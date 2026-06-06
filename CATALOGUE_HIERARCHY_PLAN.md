# Catalogue Hierarchy — Local/Outstation → Mode (parent + child tables)

Restructure the ride-product catalogue from one flat table into a **parent
(scope) + child (mode)** shape linked by a foreign key, and surface that
hierarchy as a **two-step experience** in both the admin city-settings screen
and the customer app.

- **Step 1 (customer):** Local or Outstation.
- **Step 2 (customer):** Private / Shuttle / Fixed within the chosen scope.

> Confirmed safe: the booking/dispatch/settlement path does **not** read the
> catalogue — it's a display + feature-flag layer only. Splitting it cannot
> break the ride flow. Catalogue is seeded lazily (no city-creation seeder).

---

## Target data model

```
city_ride_scopes                         city_ride_modes
──────────────────────────────           ───────────────────────────────────
id                                       id
city_id        → cities (cascade)        city_ride_scope_id → city_ride_scopes (cascade)
scope  enum(local, outstation)           mode   enum(private, fixed, shuttle)
name           (e.g. "Local")            name           (e.g. "Private")
is_active      master switch per scope   image_path     (mode icon)
sort_order                               is_active      per-mode switch
timestamps                               sort_order
UNIQUE(city_id, scope)                   timestamps
                                         UNIQUE(city_ride_scope_id, mode)
```

Per city: **2 scope rows**, each with **3 mode rows** (6 modes total) — the same
2×3 matrix, now expressed as a real parent→child tree.

**Visibility rule (customer):** a scope shows only if `scope.is_active` **and**
it has ≥1 active mode. Within it, only active modes show.

---

## Blast radius (everything that touches the catalogue)

| File | Role | Change |
|---|---|---|
| `database/migrations/*create_city_ride_products*` etc. | old table | superseded by new migration |
| `app/Models/CityRideProduct.php` | model | replaced by `CityRideScope` + `CityRideMode` |
| `app/Models/City.php` `rideProducts()` | relationship | → `rideScopes()` |
| `app/Http/Controllers/Admin/AdminCityRideProductsController.php` | admin CRUD + activation guard | grouped index + per-scope / per-mode toggles |
| `app/Http/Controllers/PricingController.php` `products()` | customer list | grouped response |
| `routes/api.php` | routes | scope + mode toggle endpoints |
| `frontend/.../settings/general-settings.component.ts` | admin screen | two panels (Local / Outstation) |
| `customer-mobile/.../customer-book.page.ts/html` | customer | two-step picker |

Not touched (verified): TripsController, SchedulingPolicy, SeatReservationService,
SharedDispatchService, CommissionSettlementService — none read the catalogue.
(Routes table keeps its own `scope`/`mode` columns; unrelated to this change.)

---

## Phases (build one at a time, verify, then proceed)

### Phase 0 — Schema + data move (backend, no behaviour change)  ✅ DONE
- Migration: create `city_ride_scopes` + `city_ride_modes`.
- Backfill from `city_ride_products`: per (city, scope) → one scope row (active);
  each product → one mode row carrying `is_active`, `name`, `image_path`, `sort_order`.
- Drop `city_ride_products`. `down()` recreates it and restores rows.
- Models: `CityRideScope` (belongsTo City, hasMany modes), `CityRideMode`
  (belongsTo scope, `kind` + `image_url` compat accessors).
- `City`: `rideScopes()` hasMany; remove `rideProducts()`.
- **Verify:** rolled-back tinker — every city ends with 2 scopes + correct modes,
  `is_active` preserved byte-for-byte; FK cascade on city delete works.

### Phase 1 — Backend API reshape  ✅ DONE
- `AdminCityRideProductsController`:
  - `index(city)` — ensure 2 scopes + 6 modes (firstOrCreate), return **grouped**:
    `{ scopes: [ { id, scope, name, is_active, modes: [ { id, mode, name, kind, image_url, is_active } ] } ] }`.
  - `updateMode(city, mode)` — toggle/edit a mode; **keep the activation guard**
    (enabling fixed/shuttle still requires an active matching Route of that
    city+scope+mode).
  - `updateScope(city, scope)` — toggle the per-scope master switch.
- `PricingController.products(city)` — grouped, only active scopes and within
  them active modes; keep `kind` per mode for the transition.
- Routes: `GET /admin/cities/{city}/ride-products` (grouped), `PATCH …/ride-scopes/{scope}`,
  `PATCH …/ride-modes/{mode}`; customer `GET /pricing/cities/{city}/products` (grouped).
- **Verify:** tinker hits — grouped shapes correct; activation guard still blocks
  shared-without-route (422); `php -l`; `route:list` clean.

### Phase 2 — Admin city-settings screen  ✅ DONE
- `general-settings.component.ts`: replace the flat 6-cell grid with **two panels**
  — *Local* and *Outstation* — each with a scope master toggle + three mode
  switches (Private / Shuttle / Fixed), wired to the new endpoints. Keep the
  "add a route first" guard message.
- **Verify:** `ng build` (frontend) green.

### Phase 3 — Customer two-step booking  ✅ DONE
- `customer-book.page`: **Step 1** show scope cards (only scopes the city has
  active); **Step 2** show that scope's active modes; then continue into the
  existing booking flow (shared → `/shared-book`, private → current flow) driven
  by `(scope, mode)`.
- **Verify:** `ng build` (customer-mobile) green; existing private flow unchanged.

### Phase 4 — Adversarial review + regression  ✅ DONE & verified
- 4-lens review workflow (migration, backend API, customer flow, admin + cross-cutting):
  **9 findings — 3 HIGH, 4 MEDIUM, 2 LOW**.
- Fixed: **HIGH** `down()` lost the scope master switch (now folds
  `scope.is_active && mode.is_active` back into the restored flag); **HIGH** concurrent
  toggles could race the "keep ≥1 bookable" guard (now `updateMode`/`updateScope` run in a
  transaction with a per-city `lockForUpdate` on the scope tier); **HIGH** single-scope
  auto-advance didn't set `selectedProductKind` (highlight broke for an Outstation-only
  city); **MEDIUM** `kind` accessor hardened to resolve the parent scope explicitly;
  **MEDIUM** customer empty-state added; **MEDIUM/LOW** outstation auto-switch now keeps
  `selectedScope` in sync (inline, so it doesn't wipe the service-area banner) + legacy
  `rental` maps to the Outstation scope.
- Not bugs (skipped with rationale): stale-scope in `shapeMode` (only reads the immutable
  `scope` enum); a dead `rental` branch in pre-existing estimate code (out of scope).
- **Verified:** `php -l` clean; `migrate:status` clean; real `down()`/`up()` round-trip
  preserves 8 products / 7 active; locked guards still return 422 (last-bookable,
  route-gated) and 200 on benign edits; `down()` scope-fold proven; both frontends build green.

## Status: ✅ COMPLETE — all 5 phases done, reviewed, and verified.
Customer now books in two steps (scope → mode); the catalogue is a real parent/child
tree (`city_ride_scopes` → `city_ride_modes`); the private ride flow is untouched.

---

## Rollback
Each phase is independently revertable; the Phase 0 migration's `down()` rebuilds
`city_ride_products` and restores its rows, so the whole change can be backed out
with one `migrate:rollback` if needed.
