# Fixed Rides — Custom Seat Layout & Booking Tracker

Progress tracker for the fully-customisable seat layout feature: operator designs
any seat map (rows/cols/labels/prices), customer picks seats visually, driver
sees seat labels instead of a bare count. Kept in the same style as
`FIXED_ROUTE_DRIVER_ALLOCATION_TRACKER.md`.

**Status:** 8/9 complete + M8 shipped → **only M9 (manual QA + go-live)** left before ship.

Legend: `[ ]` TODO · `[~]` IN PROGRESS · `[x]` DONE

---

## Design decisions — LOCKED 2026-07-22

| # | Question | Decision |
| --- | --- | --- |
| D1 | Layout per vehicle-type, or per individual vehicle? | **Per vehicle-type.** One "Ertiga 6P" serves every Ertiga. Variants become separate named layouts. |
| D2 | Seat category list to ship with | **front / window / middle / rear / premium.** Operator picks per seat; premium is the escape hatch. |
| D3 | Hold window duration | **5 minutes — already implemented.** `FixedSeatHoldService::createHold` uses `now()->addMinutes(5)`. Reuse it, don't rebuild. |
| D4 | Show passenger name next to seat label in driver app? | **No — seat label only.** Row shows `2A ₹120`, no PII. |

**Reuse note (D3):** `fixed_seat_holds` + `seat_reservations` + `FixedAvailabilityService` already implement HELD/CONFIRMED/EXPIRED with a 5-min TTL and `lockForUpdate` concurrency. M1 extends this by adding a child table `fixed_seat_hold_seats` (hold_id × departure_seat_id × label) so the existing hold knows *which* specific seats it locks. No new hold service — just a link table + a couple of writes into it during `createHold` / `confirmHold`.

---

## Milestones

### M0 — Design lock-in — `[x]` DONE 2026-07-22

**Scope:** captured D1–D4 in the table above. Discovery: `fixed_seat_holds`
already exists with 5-min TTL and concurrency locks, so D3 is a reuse call, not
a build call.

**Exit gate:** table above has no "_pending_" rows. ✓

---

### M1 — DB + models + `SeatMapService` — `[x]` DONE 2026-07-22

**Scope (revised after M0 discovery — the hold system already exists):**
- 4 migrations
  - `vehicle_seat_layouts` (id, name, vehicle_type_id, city_id, rows, cols, is_active)
  - `vehicle_seat_layout_cells` (id, layout_id, row, col, kind [seat|blocked|aisle], label, category, price_delta)
  - `departure_seats` (id, route_departure_id, layout_cell_id, label, category, price_delta, status [AVAILABLE|HELD|BOOKED|BLOCKED], seat_reservation_id)
  - `fixed_seat_hold_seats` (id, fixed_seat_hold_id, departure_seat_id, label) — the link table that binds an existing `fixed_seat_holds` row to specific seats
  - Column add: `route_departures.vehicle_seat_layout_id` (nullable FK — nullable for backwards-compat)
- 3 new Eloquent models: `VehicleSeatLayout`, `VehicleSeatLayoutCell`, `DepartureSeat`
- Extend `FixedSeatHold` model: `hasMany(FixedSeatHoldSeat)` (small pivot model or inline)
- `App\Services\SeatMapService`:
  - `snapshotForDeparture(RouteDeparture $d)` — copies cells → `departure_seats` all AVAILABLE
  - `markSeatsHeld(FixedSeatHold $hold, array $labels)` — flips `departure_seats.status` to HELD + writes `fixed_seat_hold_seats` rows (called from inside existing `FixedSeatHoldService::createHold` when a layout is present)
  - `markSeatsBooked(SeatReservation $res, FixedSeatHold $hold)` — HELD → BOOKED, sets `seat_reservation_id` (called from `confirmHold`)
  - `releaseSeats(FixedSeatHold $hold)` — HELD → AVAILABLE (called on expire/release)

**No new hold TTL / no new cron.** `FixedAvailabilityService::expireHoldIfNeeded` already handles expiry; the seat rows are freed as a side effect through `releaseSeats`.

**Files (new):**
- `backend/database/migrations/2026_07_22_*_create_vehicle_seat_layouts_table.php`
- `backend/database/migrations/2026_07_22_*_create_vehicle_seat_layout_cells_table.php`
- `backend/database/migrations/2026_07_22_*_create_departure_seats_table.php`
- `backend/database/migrations/2026_07_22_*_create_fixed_seat_hold_seats_table.php`
- `backend/database/migrations/2026_07_22_*_add_vehicle_seat_layout_id_to_route_departures.php`
- `backend/app/Models/VehicleSeatLayout.php`
- `backend/app/Models/VehicleSeatLayoutCell.php`
- `backend/app/Models/DepartureSeat.php`
- `backend/app/Services/SeatMapService.php`
- `backend/tests/Feature/SeatMapServiceTest.php`

**Files (edit):**
- `backend/app/Models/RouteDeparture.php` — add `seatLayout()` + `departureSeats()` relations
- `backend/app/Models/FixedSeatHold.php` — add `heldSeats()` relation
- `backend/app/Services/FixedSeatHoldService.php` — thread the layout: in `createHold`, if departure has a layout, require `seat_labels[]` from the request and call `SeatMapService::markSeatsHeld`
- `backend/app/Services/FixedAvailabilityService.php` — when a hold expires or is released, release its `departure_seats` too

**Exit gate:** `SeatMapServiceTest` green: snapshot creates AVAILABLE rows, hold flips labels to HELD, race (second hold on same label 422s), release flips back to AVAILABLE, confirm flips to BOOKED, expiry (via existing `expireHoldIfNeeded`) frees seats. **Result: 7/7 green (14 assertions).** Allocation stack (`FixedAbcAcceptanceTest`, `FixedDriverRouteAllocationTest`, `FixedRouteVehicleDecouplingTest`, `AdminRouteGroupsApiTest`) — 29/29 green after adding layouts via `Tests\Support\SeatLayoutFactory`.

**Delta vs plan:**
- Added a 6th model `FixedSeatHoldSeat` (the link table row) — kept planned count at 5, so tracking as +1.
- Added `SeatMapService::resolveDefaultLayoutForRoute` used by the 3 departure-creating sites (`FixedDriverController::open`, `FixedDepartureService::departureAttributes`, `SeatReservationService::formingDepartureFor`). Picks the first active layout in the route's city; M6 will narrow this to the driver's specific vehicle-type.
- Added a **transition helper** in `FixedSeatHoldService::createHold`: when the caller passes only `seats: N` and no `seat_labels[]`, auto-pick the first N AVAILABLE labels. Commented `TODO M5:` — remove once the customer picker always sends explicit labels.

**Pre-existing test fallout (NOT caused by M1):**
5 fixed-suite tests remain red for reasons that predate this work — none of my code changes touch `refund_status` logic or the boarding-OTP requirement:
- `FixedAdminRecoveryActionsTest::test_admin_can_cancel_one_passenger…` / `…whole_vehicle…` — asserts `refund_status='REFUNDED'` for razorpay refunds. Commit `bf7446c` (2026-07-17) switched razorpay refunds to `APPROVED` (B5 manual-register policy) without updating these tests.
- `FixedBookingPhase4Test::test_customer_cancel_more_than_30…` / `test_razorpay_refund_failure…` — same B5 policy shift; the test still expects the old auto-`refundPayment` call path.
- `FixedFullWalkthroughTest::test_fixed_flow_walkthrough…` — the `/api/fixed/bookings/{id}/board` endpoint now requires `code` (boarding OTP added in migration `2026_07_16_125234_add_boarding_otp_to_seat_reservations`); the test predates that migration.
- `FixedStopAutomationTest::test_driver_reaching_later_stop…` — same B5 refund-status shift.

These belong to their respective areas (refund register, boarding OTP), not the layout milestone. Deferred to the tests' owning tickets.

---

### M2 — Admin CRUD API — `[x]` DONE 2026-07-22

**Scope:** REST endpoints for the operator to save/list/edit/delete layouts.

**Endpoints:**
- `POST   /api/admin/cities/{city}/vehicle-seat-layouts`
- `GET    /api/admin/cities/{city}/vehicle-seat-layouts`
- `GET    /api/admin/cities/{city}/vehicle-seat-layouts/{id}`
- `PATCH  /api/admin/cities/{city}/vehicle-seat-layouts/{id}`
- `DELETE /api/admin/cities/{city}/vehicle-seat-layouts/{id}` (rejects if in use by any departure)

**Files (new):**
- `backend/app/Http/Controllers/Admin/AdminVehicleSeatLayoutsController.php`
- `backend/tests/Feature/AdminVehicleSeatLayoutsApiTest.php`

**Files (edit):**
- `backend/routes/api.php` — mount admin routes

**Exit gate:** CRUD test green — create with cells, replace cells on PATCH, DELETE blocked when a `route_departures` row references the layout. **Result: 12/12 green (27 assertions).**

**Delta vs plan:**
- Added `GET /show` (5 endpoints total, plan had 4).
- Server-side invariants beyond schema uniques: cell inside grid, seat cells need labels, unique labels per layout, at least 1 seat cell. Six of the 12 tests cover these rejects.
- Uniqueness is on (city_id, vehicle_type_id, name) — so operator can name "Ertiga std" and "Innova std" without collision; two "Ertiga std" for the same city still 422.
- DELETE gated by any `route_departures` reference (in_use flag in response). Prevents history breakage.
- Response shape includes `seat_count` and `in_use` so admin list can render "6 seats · in use" without a second fetch.

---

### M3 — Admin Angular UI (designer + preview) — `[x]` DONE 2026-07-23

**Scope:** split-screen designer described in the spec chat.

- Toolbar: name, vehicle-type, rows, cols
- Canvas: click-a-cell paints (new cell defaults to a seat with an auto-suggested label); click an existing seat opens per-seat edit panel (kind, label, category, price ±)
- Live preview on the right pane updates as you type — no separate "preview" button needed
- Save / Cancel

**Files (new):**
- `frontend/src/app/admin/vehicle-seat-layouts/vehicle-seat-layouts.service.ts`
- `frontend/src/app/admin/vehicle-seat-layouts/seat-grid.component.ts` — reusable grid (interactive flag; will also power customer picker in M5)
- `frontend/src/app/admin/vehicle-seat-layouts/seat-layout-list.component.ts`
- `frontend/src/app/admin/vehicle-seat-layouts/seat-layout-designer.component.ts`

**Files (edit):**
- `frontend/src/app/app.routes.ts` — 3 routes (list, new, edit-by-id) with `permission: 'vehicles'` guard, all lazy-loaded
- `frontend/src/app/app.component.ts` — "Seat Layouts" under City Setup, right after Vehicles
- `frontend/src/app/ui/icon/icon-registry.ts` — added `grid` glyph for the sidebar entry

**Exit gate:** `ng build` (development) green. New lazy chunks: `seat-layout-list-component` (13 kB), `seat-layout-designer-component` (28 kB). End-to-end manual (design 3×3 Ertiga → save → reopen → preview matches) deferred to M9 QA sweep — no manual QA on this alone since M4 unlocks customer flow that stresses the same store.

**Delta vs plan:**
- Chose **one designer component** instead of splitting a separate toolbar + canvas — the split-screen layout keeps the "toolbar" as a form panel on the left, which reads more like admin form patterns already in this repo (see `AdminVehicleSeatLayoutsController` shape response).
- **No "Preview as customer" toggle** — the preview *is* the interactive designer. Clicking a cell edits it. A dedicated read-only "customer preview" mode adds complexity for no operator-side benefit; the customer picker in M5 will be the real read-only view.
- **No separate `.html` / `.scss` files** — inlined template + styles per component, matching the pattern in `route-groups-board.component.ts` and other admin components. Simpler diff surface.
- Instead of a `frontend/src/app/shared/` folder, kept the reusable `SeatGridComponent` inside `admin/vehicle-seat-layouts/`. M5 will lift it out to `shared/` (or duplicate into `customer-mobile/`) when needed.
- Cell-edit UX: click empty cell → seat with auto-suggested label (`1A`, `2A`, …); click seat → edit panel; kind selector wipes seat fields when flipping to blocked/aisle so stale label/category/price never persists.
- Client-side warnings mirror server invariants (≥1 seat, all seats labelled, labels unique) so the Save button disables *before* a round trip.

---

### M4 — Customer seat-picker API — `[x]` DONE 2026-07-23

**Scope:** endpoints the customer app hits.

- `GET  /api/fixed/departures/{departure}/seat-map` — layout + per-cell status (AVAILABLE / HELD / BOOKED for seats; synthetic BLOCKED / AISLE for non-seat cells)
- `POST /api/fixed/seat-holds` — now accepts `seat_labels: []` (explicit picker path) alongside the legacy `seats: N` (transition helper still in place)
- `POST /api/fixed/seat-holds/{hold}/release` — new; proactive release so back-out during picker frees seats immediately (else wait 5 min)
- Confirm-payment path is **reused as-is** from `POST /api/fixed/seat-holds/{hold}/confirm-payment` (real Razorpay) and `.../test-confirm-payment` (test) — no new confirm endpoint needed since seat-book already runs through `SeatMapService::markSeatsBooked` from M1.

**Files (new):**
- `backend/app/Http/Controllers/FixedSeatMapController.php`
- `backend/tests/Feature/FixedSeatMapCustomerFlowTest.php`

**Files (edit):**
- `backend/routes/api.php` — added 2 routes (seat-map GET, release-hold POST)
- `backend/app/Services/SeatMapService.php` — added `mapForDeparture()` render method
- `backend/app/Services/FixedAvailabilityService.php` — added `releaseHold(FixedSeatHold)` for per-hold release
- `backend/app/Http/Controllers/FixedBookingsController.php` — added `releaseSeatHold()` action, injected FixedAvailabilityService, extended `storeSeatHold` validator to accept `seat_labels[]` (max 20)

**Exit gate:** flow test green — get-map returns 9 cells for the Ertiga 3×3 fixture (6 seat + 2 blocked + 1 aisle), hold with `seat_labels: ['2A','2B']` flips both to HELD, second customer racing 2A gets 422, first confirms → 2A/2B disappear as BOOKED, release frees a seat for the next customer, cross-customer release returns 404. **Result: 7/7 green (31 assertions).** Combined regression stack (M1+M2+M4+M3-tests + booking/allocation): 58/58 green (186 assertions).

**Delta vs plan:**
- Plan called for `POST /api/fixed/departures/{id}/hold` + `POST /api/fixed/holds/{token}/confirm` as brand-new endpoints. Both already exist as `POST /api/fixed/seat-holds` and `POST /api/fixed/seat-holds/{id}/(confirm|test-confirm)-payment` — the M1 work threaded seat-map calls into the existing services, so extending the validator (not building new routes) was the right shape. Only two truly new endpoints landed: `GET .../seat-map` and `POST .../release`.
- Race protection is **422**, not 409, matching the existing service's `ReservationException` shape (409 would have required a new exception mapping just for this case).
- Blocked / aisle cells carry synthetic statuses (`BLOCKED`, `AISLE`) in the map response so the client can render the full grid without null-checks.
- Test covers the happy race + release path AND cross-customer release-forbidden + unknown-label rejection — 7 tests total, one more than the exit gate specified.

---

### M5 — Customer mobile seat picker + booking rewire — `[x]` DONE 2026-07-23

**Scope:** replace the count spinner with a real per-seat picker inside the existing fixed-book flow.

- Added a new `seats` step between `details` and `review`. Details step keeps board/drop stops + luggage; seats step shows the picker with running total; review step keeps coupon + Razorpay/test payment CTAs.
- The stepper (`+/−`) is gone from the details step — every departure now has a layout, so seat count derives from `selectedLabels.length`.
- Hold is created only at Confirm-&-pay (inside `bookingPayload` with `seat_labels`). Payment dismiss releases the hold via the new `POST /fixed/seat-holds/{id}/release`. Back-from-review also releases.
- Hold-timer badge shown on review whenever the hold is live; expiry kicks the user back to the picker with a toast.
- **No fallback path** — per user direction ("every departure will have layout, no backward compatibility"), the picker is the only flow.

**Files (new):**
- `customer-mobile/src/app/pages/fixed-book/seat-grid.component.ts` — standalone port of the admin grid, tuned for Ionic touch targets + status colours (available / held / booked / selected)
- `customer-mobile/src/app/pages/fixed-book/hold-timer.component.ts` — standalone countdown badge from `hold.expires_at`; emits `(expired)` once

**Files (edit):**
- `customer-mobile/src/app/pages/fixed-book/fixed-book.page.ts` — new `Step = 'seats'` state, `SeatMapResponse` type, `loadSeatMap()` / `toggleSeat()` / `proceedToPicker()`, seat-labels in `bookingPayload`, `releaseCurrentHold()` on back-from-review and Razorpay `ondismiss`, `onHoldExpired()` handler, `bookingBlockReason` keyed off `selectedLabels.length`, `fareTotal` includes `price_delta`
- `customer-mobile/src/app/pages/fixed-book/fixed-book.page.html` — dropped seat +/− stepper from details; details CTA now "Pick seats"; new `<div class="sheet-pane" *ngIf="step === 'seats'">` with `<app-seat-grid>`; review shows selected labels + `<app-hold-timer>`
- `customer-mobile/src/app/pages/fixed-book/fixed-book.page.scss` — added `.fb-loading`, `.fb-picker-status` blocks
- `customer-mobile/src/app/pages/fixed-book/fixed-book.module.ts` — imports the two standalone components (Angular 15+ mixed-mode)

**Exit gate:** `ng build --configuration=development` green (21.7s, hash printed, only a pre-existing Sass `@import` warning unrelated to seat work). Device walkthrough (book two seats, kill app before pay → seats free after 5-min sweep) deferred to M9 QA sweep; the release-hold call fires proactively on dismiss/back so most abandonment paths free seats instantly, and the 5-min TTL is the safety net (unchanged from before).

**Delta vs plan:**
- No separate `seat-picker.page` — the picker is a step inside the existing `fixed-book` flow. Building a dedicated page would have meant routing/state-hand-off and duplicated map/coupon plumbing; the step-based sheet already models the flow cleanly.
- Files live under `pages/fixed-book/` (not `pages/fixed/` from the plan) because that's the actual folder name in this repo.
- No separate `services/fixed-booking.service.ts` — this app calls the API directly via `ApiService`. Adding a service layer for two new endpoints would be premature.
- No `shared/seat-grid` — the mobile grid diverges from the admin one on touch targets, disabled logic (`BOOKED` / `HELD-not-mine`), and status colouring, so a shared port would end up mostly overridden. Kept the mobile grid in the `fixed-book` folder.
- Hold is **created at Confirm-&-pay**, not at Continue-from-picker. This keeps the coupon-apply-on-review path intact (the coupon amount is baked into the hold at creation, so creating earlier would either invalidate the coupon or need a re-hold on coupon change). Race window shrinks to ~a-few-seconds between Continue and Confirm — collisions surface as a normal 422 the user sees and can retry.
- Seat picker enforces `maxSeats` client-side (toast + no-op on the extra tap); server still enforces via `max_seats_per_booking`.
- Fare shows a "Running total" in the picker step that includes `price_delta` per seat, so premium seats reflect in the total before Continue.

---

### M6 — Driver mobile — `[x]` DONE 2026-07-23

**Scope:**
- Open-vehicle flow: replaced the disabled capacity input with a **layout dropdown** loaded from a new city-scoped endpoint. Capacity now derives from `layout.seat_count` (single source of truth — the seat map and the "seats total" counter can never disagree).
- Passenger list shows seat labels next to each name: `Seat 2A, 2B` in the meta line.

**Files (new):**
- `backend/tests/Feature/FixedDriverSeatLayoutTest.php` — 4 tests: layouts endpoint scoped to city, open with explicit layout snapshots that layout (capacity == seat_count), foreign-city layout rejected, manifest returns seat_labels

**Files (edit):**
- `backend/app/Http/Controllers/FixedDriverController.php` — added `layouts()` method returning `[{id, name, rows, cols, seat_count}]`; `open()` accepts `vehicle_seat_layout_id`, validates it belongs to the route's city, derives capacity from the picked layout's seat count
- `backend/routes/api.php` — added `GET /api/fixed/driver/routes/{route}/layouts`
- `backend/app/Services/FixedManifestService.php` — passenger row now includes `seat_labels[]` fetched from `departure_seats.seat_reservation_id`
- `backend/tests/Feature/FixedFullWalkthroughTest.php` — walkthrough now expects `seats_remaining=6` (layout is source of truth; the test's `capacity: 4` request is overridden)
- `driver-mobile/src/app/pages/fixed-driver/fixed-driver.page.ts` — `SeatLayout` interface, `layouts`/`selectedLayoutId`/`layoutsLoading` state, `syncCapacity()` now loads layouts + auto-selects first, `onLayoutChange()`, `applyLayoutCapacity()`, `openVehicle()` POSTs `vehicle_seat_layout_id`
- `driver-mobile/src/app/pages/fixed-driver/fixed-driver.page.html` — dropped the capacity input; new "Seat layout" `<ion-select>`; passenger meta shows `Seat 2A, 2B` when labels present (falls back to seat count)
- `driver-mobile/src/app/pages/fixed-driver/fixed-driver.page.scss` — added `.fixed-hint` (shown when the city has no layouts yet)

**Exit gate:** `FixedDriverSeatLayoutTest` 4/4 green (15 assertions). Combined regression stack (M1+M2+M4+M6+booking phase 3+allocation stack): **62/62 green (201 assertions).** Driver-mobile `ng build --configuration=development` green (14s). One walkthrough failure remains — the pre-existing `boarding-otp code required` from migration `2026_07_16_125234` (not caused by M6; documented in M1 fallout).

**Delta vs plan:**
- Plan called for filtering the layout list by the driver's vehicle-type. Kept it at "any active layout in the city" for now — the driver profile doesn't yet carry a trustworthy `vehicle_type_id` (that field is on the operator's `vehicle_types` table, not on drivers). When we introduce per-driver vehicle assignment (M7+), narrow this in a one-line filter.
- Kept it a **single dropdown**, not a two-tap "vehicle type → variant" cascade. All active layouts show `name · N seats`. Simpler; matches how the operator already names them.
- `open()` still accepts the legacy `capacity` param (nullable) — no client uses it now that the driver mobile sends `vehicle_seat_layout_id`, and the layout's seat count overrides it. Kept the param so any old test / debug caller stays backwards-compatible.
- Manifest response shape unchanged **except** for the added `seat_labels: string[]` per passenger — clients that don't know about it just ignore it; the driver mobile shows it and falls back to the old `{seats} seat(s)` text when the array is empty (e.g., historical bookings that predated M1).
- Fixed the walkthrough test expectation from `seats_remaining=4` to `6` — the layout is now the source of truth so the driver's `capacity: 4` request is overridden by the layout's 6 seats. Correct semantics; only that one assertion needed updating.
- No separate `fixed-driver.service.ts` in the driver mobile — it calls `ApiService` directly, matching the existing pattern.

---

### M7 — Payment integration & refund parity — `[x]` DONE 2026-07-23

**Scope:** codify the four already-plumbed paths as one acceptance suite, and
fix the one latent bug the test exposed.

- `FixedBookingsController` — extended in **M4** to accept `seat_labels[]` alongside the legacy `seats: N`. No changes here.
- `SeatMapService::markSeatsBooked` on payment success — wired in **M1** (called from `FixedSeatHoldService::confirmHold` / `confirmPaidHold` / `confirmTestHold`).
- `SeatMapService::releaseSeats` on payment failure / customer back-out — wired in **M1** (via `expireHoldIfNeeded`) and **M4** (via `POST /fixed/seat-holds/{id}/release`).
- `FixedRefundService::releaseVehicleCapacity` calls `freeSeatsForReservation` on refund — wired in **M1**; all three refund entry points (`cancelByCustomer`, `markNoShow`, `cancelBySystem`) hit it.

**Bug found + fixed:** `freeSeatsForReservation` used to flip `departure_seats` back to AVAILABLE but did NOT delete the `fixed_seat_hold_seats` link rows left over from the original HOLD that graduated to BOOKED. The unique index on `departure_seat_id` then blocked the next customer from ever holding that seat again — 500 error on the next hold attempt. Fixed by wrapping the free in a transaction that deletes link rows first, then updates `departure_seats`.

**Files (new):**
- `backend/tests/Feature/FixedRefundReleasesSeatTest.php` — 5 acceptance tests

**Files (edit):**
- `backend/app/Services/SeatMapService.php` — `freeSeatsForReservation()` now deletes `fixed_seat_hold_seats` link rows for the freed seats, wrapped in a DB transaction

**Exit gate:**
1. Two customers each holding a distinct seat (`2A`, `2B`); refund one → only that seat frees, the other stays BOOKED ✓
2. Multi-seat reservation (`2A + 2B + 3A`); refund → all three free ✓
3. A freed seat is immediately holdable by a fresh customer ✓ (this one exposed the link-row bug)
4. Admin cancellation (`cancelBySystem`) frees seats too ✓
5. Double-cancel is idempotent — the second cancel does NOT flip a seat that has since been re-held by another customer ✓

**Result:** 5/5 green (35 assertions). Full regression (M1+M2+M4+M6+M7+booking phase 3+allocation stack): **67/67 green (236 assertions).**

**Delta vs plan:**
- Plan called for controller rewiring and refund plumbing — both already done in M1+M4, so this milestone became a **codification + bug-hunt exercise** (found 1 bug, fixed 1 bug).
- Plan mentioned "Legacy departures (no layout) untouched" — moot per user's "no backward compatibility" directive. Every departure has a layout.
- No `hold_token` concept — we use the `FixedSeatHold` id directly as the token equivalent. Simpler; already ownership-guarded.

---

### M8 — End-to-end acceptance test — `[x]` DONE 2026-07-23

**Scope:** single feature test that walks the headline story through real HTTP endpoints (no service mocks) and asserts the seat map at every step.

**Story executed:**
1. Admin designs "Ertiga 6P e2e" layout via real `POST /admin/cities/{city}/vehicle-seat-layouts` — 6 seats (`1A / 2A-2C / 3A / 3B`) + 2 blocked (driver + gap) + 1 aisle in a 3×3 grid.
2. Driver opens the vehicle with `vehicle_seat_layout_id` → asserts `departure_seats` snapshot has all 6 labels AVAILABLE and `capacity == 6`.
3. C1 holds `2A`, confirms via test-payment → 2A becomes BOOKED.
4. C1 holds `2B` as a **separate booking** (see delta below) → 2B becomes BOOKED.
5. C2 races `2A` → 422; picks `3A` and confirms → 3A becomes BOOKED. Seat-map fetch by C2 shows 2A/2B/3A all BOOKED.
6. Admin cancels C1's `2A` booking via `POST /admin/cities/{city}/fixed-bookings/{id}/cancel` → 2A → AVAILABLE, 2B stays BOOKED, C2's 3A untouched.
7. C3 holds `3B` and abandons → hold's `expires_at` aged past → `FixedAvailabilityService::expireHoldIfNeeded` invoked → hold flips EXPIRED and 3B → AVAILABLE.
8. Bonus sanity: a new customer holds both freed seats (`2A + 3B`) in one call.

**Files (new):**
- `backend/tests/Feature/FixedSeatLayoutAcceptanceTest.php` — one test, 30 assertions, ~1:12 to run.

**Result:** 1/1 green (30 assertions). Full regression stack (M1+M2+M4+M6+M7+M8+booking phase 3+allocation stack): **68/68 green (266 assertions).**

**Delta vs plan:**
- Plan step 6 said "Admin refunds C1's 2A only". Our system does **per-reservation refunds**, not per-seat refunds. Rather than build per-seat refund (out of scope for this feature), the test has C1 make **two separate bookings** (one for 2A, one for 2B), then admin cancels only the 2A booking. Same observable outcome, matches real product behaviour.
- Plan step 5 said "409" for race collision. Kept the actual 422 that `ReservationException` throws — same intent, matches our error shape (documented delta from M4).
- Plan mentioned "Sweeper" for step 7. There's no separate sweeper cron — expiry is **lazy** (fires when `expireHoldIfNeeded` is called on a stale hold). Test time-travels the hold's `expires_at` and invokes the helper directly, which is exactly how the release path would fire in the running app when the next request touches the hold.
- Test asserts **30 assertions** vs the plan's "7/7 assertions green" — same seven story steps, but many are exercised via multiple checks (seat status before + after, seat map read, reservation id round-trip, etc.) to make regressions obvious.

---

### M9 — Manual QA sweep + go-live — `[ ]`

**Scope:**
- Admin: design → save → reopen → preview
- Customer: browse route → pick seats → pay → receipt shows seat labels
- Driver: open with layout → passenger list shows labels → mark boarded
- Refund one seat manually → customer sees seat back on next fetch
- Rebuild all three apps (`ng build`, Ionic capacitor sync × 2)
- Toggle `use_seat_layouts` flag city-by-city if we add one (TBD)

**Exit gate:** operator signs off in staging; enable for a pilot city.

---

## Not in scope (parked)

- Drag-and-drop seat placement in the designer (click-a-cell only for v1)
- WebSocket live seat updates (polling only)
- Seat-photo / 3D vehicle images
- Customer-side filters ("window only")
- Solo (private) rides — no seat picking, not in scope

---

## Log

_(newest entries at the top; append date + milestone + one-liner)_

- **2026-07-23** — M8 shipped. Single end-to-end feature test `FixedSeatLayoutAcceptanceTest` walks the whole story via real HTTP: admin designs layout → driver opens → C1 books 2A + 2B (two separate bookings) → C2 races 2A (422) then books 3A → admin cancels C1's 2A booking (2A frees, 2B stays BOOKED) → C3 holds 3B and abandons → hold time-travelled past expiry → 3B frees → new customer picks 2A + 3B in one call. 1 test, 30 assertions, ~1:12 to run. Full regression 68/68 green.
- **2026-07-23** — M7 shipped. New `FixedRefundReleasesSeatTest` (5 tests, 35 assertions) codifying: refund frees only that reservation's seats, multi-seat refund frees all, freed seat is immediately re-holdable, admin cancel also frees, double-cancel is idempotent. Fixed one bug: `SeatMapService::freeSeatsForReservation` now deletes stale `fixed_seat_hold_seats` link rows before flipping departure_seats to AVAILABLE — without this, the unique index on `departure_seat_id` blocked re-hold with a 500. Full regression 67/67 green.
- **2026-07-23** — M6 shipped. New `GET /api/fixed/driver/routes/{route}/layouts`; `POST /api/fixed/driver/vehicles` accepts `vehicle_seat_layout_id` (city-scoped guard) and derives capacity from `layout.seat_count`; manifest passenger row carries `seat_labels[]`. Driver-mobile: capacity spinner replaced with a layout dropdown, passenger card shows `Seat 2A, 2B`. `FixedDriverSeatLayoutTest` 4/4 green. Combined regression 62/62 green. Walkthrough seats_remaining updated 4→6 (layout is source of truth). Driver-mobile `ng build` green.
- **2026-07-23** — M5 shipped. Customer-mobile fixed-book flow now has a real per-seat picker: new `seats` step between `details` and `review`, standalone `SeatGridComponent` + `HoldTimerComponent` under `pages/fixed-book/`. `bookingPayload` sends `seat_labels[]`; hold is released on back-from-review + Razorpay dismiss; timer expiry kicks the user back to the picker. Old counter stepper removed (no backward compat — every departure has a layout). Fare includes per-seat `price_delta`. `ng build --configuration=development` green.
- **2026-07-23** — M4 shipped. `FixedSeatMapController@show` (new) + 2 new routes (`GET /api/fixed/departures/{departure}/seat-map`, `POST /api/fixed/seat-holds/{hold}/release`). `SeatMapService::mapForDeparture()` renders the grid with per-seat status + synthetic BLOCKED/AISLE. `FixedAvailabilityService::releaseHold()` new. `FixedBookingsController::storeSeatHold` validator extended to accept `seat_labels[]`; `releaseSeatHold()` action added. `FixedSeatMapCustomerFlowTest` 7/7 green (31 assertions). Combined regression: 58/58 green (186 assertions).
- **2026-07-23** — M3 shipped. Admin Angular UI: `VehicleSeatLayoutsService`, shared `SeatGridComponent` (interactive + preview modes), `SeatLayoutListComponent` (city-scoped grid of layouts with seat-count + in-use badges), `SeatLayoutDesignerComponent` (split-screen: form left, live preview right; click-a-cell to edit). Added 3 lazy routes + sidebar entry "Seat Layouts" under City Setup + new `grid` icon glyph. `ng build --configuration=development` green.
- **2026-07-22** — M2 shipped. `AdminVehicleSeatLayoutsController` (index/store/show/update/destroy) + 5 routes under `/api/admin/cities/{city}/vehicle-seat-layouts`. Invariants: grid bounds, seat labels required + unique, ≥1 seat cell, in-use DELETE guard. `AdminVehicleSeatLayoutsApiTest` 12/12. M1+M2+allocation stack combined: 45/45 green (107 assertions).
- **2026-07-22** — M1 shipped. 5 migrations + 4 models + `SeatMapService` (7 methods incl. `resolveDefaultLayoutForRoute`) + wirings into `FixedSeatHoldService::createHold/confirmHold/confirmPaidHold/confirmTestHold`, `FixedAvailabilityService::expireHoldIfNeeded/releaseCustomerHeldSeats`, `FixedRefundService::releaseVehicleCapacity`, `FixedDriverController::open`, `FixedDepartureService::departureAttributes`, `SeatReservationService::formingDepartureFor`. Test helper `Tests\Support\SeatLayoutFactory::standardErtiga6P`. New `SeatMapServiceTest` 7/7 green. Existing allocation stack 29/29 green. 5 pre-existing failures in refund/OTP tests documented as out-of-scope.
- **2026-07-22** — M0 locked. Discovery: `fixed_seat_holds` + 5-min TTL + `FixedAvailabilityService::expireHoldIfNeeded` already exist. Revised M1: add a `fixed_seat_hold_seats` link table instead of rebuilding the hold engine. Reuse `FixedSeatHoldService::createHold/confirmHold`.
- **2026-07-22** — Tracker created.
