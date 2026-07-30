# DreamCabs — Fixed Route / Shuttle QA Audit

**Scope:** backend · driver-mobile · customer-mobile
**Date:** 2026-07-30
**Method:** source trace of the reported end-to-end test (not generic advice)
**Branch:** `master` (line numbers reflect the working tree at audit time and may drift)

Every finding is traced to the actual code path, with file:line, expected vs. current
behaviour, and a concrete fix.

**Legend**
- ✓ **Verified in code** — the exact defect is traced to the line shown.
- ⚠ **Needs reproduction** — the symptom is real but the root cause needs a runtime/queue repro; the most likely cause and where to look are named.

**Counts:** P0 × 2 · P1 × 4 · P2 × 3 · P3 × 1

---

## P0 — Critical (fix before launch)

These break trust in the product: a false status the customer sees, and money that never reaches the driver.

### F1 — Customer sees "Driver has already reached your location" immediately after paying ✓

| | |
|---|---|
| **Expected** | After payment, before the driver starts the ride, the customer sees only *Booking confirmed* / *Driver assigned*. "Arrived / waiting" appears only once the vehicle is dispatched **and** physically at the pickup stop. |
| **Current** | The status flips to *"The vehicle is waiting at your pickup stop."* while the departure is still `FORMING` (ride not started, nobody boarded). |

**Root cause** — Two independent bugs compound:
1. The arrival automation runs for `FORMING` departures. A driver typically opens the vehicle *at the origin stop*, so their GPS ping is already inside the 150 m stop geofence → `markDriverArrived()` stamps `fixed_no_show_after_at`, even though the ride hasn't started.
2. `fixedLiveStatus()` interprets that timestamp as "driver arrived" *before* it checks whether the ride has actually started.

**Where**
- `backend/app/Services/FixedStopAutomationService.php:27` — `whereIn('status', ['FORMING','DISPATCHED','DEPARTED'])` includes FORMING.
- `backend/app/Services/FixedStopAutomationService.php:74,108` — `markDriverArrived()` sets `fixed_no_show_after_at` on geofence hit, no started-gate.
- `backend/app/Services/FixedBookingService.php:227-230` — the `fixed_no_show_after_at` → "Driver arrived" branch is evaluated *above* the departure-started branch at `:239`.

**Fix (backend)**
1. In `processDriverLocation()`, drop `FORMING` from the status filter — arrival/no-show automation should only run once the departure is `DISPATCHED`/`DEPARTED`. (Keep the "approaching" alert if desired, but not "arrived".)
2. Guard `markDriverArrived()`: ignore the origin stop while the ride hasn't left, so a vehicle forming at the origin never trips "arrived".
3. In `fixedLiveStatus()`, move the `routeDeparture->status IN (DISPATCHED,DEPARTED)` gate *above* the `fixed_no_show_after_at` block, and require the departure to be started before returning the "Driver arrived" key.

**Modules:** FixedStopAutomationService · FixedBookingService · customer-mobile/fixed-ride-active

---

### F2 — Customer payments never reach driver wallet / earnings / revenue screens ✓

| | |
|---|---|
| **Expected** | Payment success → ledger entry → driver's share credited (wallet or held-earning) → visible in driver earnings and settlement. |
| **Current** | Nothing is credited to the driver for a Fixed booking. The split/settlement path is a no-op. |

**Root cause** — The booking-split engine is **disabled by default** and Fixed reservations carry no `trip_id` at payment time, so the settlement mirror short-circuits.

**Where**
- `backend/config/services.php:54` — `'split_enabled' => env('PAYMENTS_SPLIT_ENABLED', false)` (defaults off).
- `backend/app/Services/BookingPaymentService.php:51` — `if (! $this->split->enabled()) return null;` — `recordCapture()` no-ops.
- `backend/app/Services/FixedSeatHoldService.php:275-280` — confirm calls `recordCapture($reservation->trip_id, …)` but a Fixed reservation's `trip_id` is `null`; the code comment itself notes "No-op while the split engine is disabled."

**Fix (backend)**
1. Turn on `PAYMENTS_SPLIT_ENABLED=true` in the target env — but only after steps 2–3, or you post captures with no settlement.
2. Wire Fixed settlement through the *route-departure* path (it already exists — `PaymentSplitService::settleBookingPayment` via `route_departure_id`, see `BookingPaymentService.php:163-175`). Confirm it fires at `complete()` in `FixedDriverController.php:537`.
3. Verify the chain end-to-end: `Payment` (settlement_mode=booking) → `LedgerEntry` → `HeldEarning`/`WalletTransaction` → driver earnings API. Add a feature test that asserts a driver balance delta after a Fixed completion.

**Modules:** PaymentSplitService · BookingPaymentService · FixedSeatHoldService · LedgerService · WalletService · HeldEarningsService

---

## P1 — High

Real defects that degrade the flow but don't (by themselves) block a launch.

### F3 — Driver is shown vehicles/layouts that aren't his (Ertiga vs. his registered Swift) ✓

| | |
|---|---|
| **Expected** | Driver sees only the vehicle(s) assigned/approved to his account; auto-select when there's exactly one. |
| **Current** | The "choose layout" list shows every active seat layout in the city, so unrelated vehicles appear and the driver must cancel & reselect. |

**Root cause** — A documented deferral: the layout list is scoped to the *city*, not the driver's vehicle. The code comment says narrowing by the driver's vehicle-type is deferred to "M7+ when the driver profile carries a trustworthy `vehicle_type_id`."

**Where** — `backend/app/Http/Controllers/FixedDriverController.php:110-132` (`layouts()`), note at `:104-108`.

**Fix**
- Filter `layouts()` by the driver's approved vehicle / `vehicle_type_id` (join through the driver's fleet/vehicle assignment). Fall back to city-wide only if the driver has no resolvable vehicle.
- Driver app: if the filtered list has one entry, auto-select it and skip the picker.
- Validate the assignment server-side in `open()` so a direct API call can't open a foreign layout.

**Modules:** FixedDriverController · Driver profile/vehicle_type_id · driver-mobile

---

### F4 — Cancel after ride start returns no refund, and there is no graduated cancellation matrix ✓

| | |
|---|---|
| **Expected** | A defined matrix by stage (before payment / after payment before boarding / after boarding / after ride start / after completion) with explicit refund %, wallet, driver-earning, operator-earning and ledger impact — and the customer is told the outcome. |
| **Current** | Refund eligibility is binary: full refund only while the departure hasn't dispatched; once the ride starts, zero refund and no explanation surfaced to the customer. |

**Root cause** — `isRefundAllowed()` returns `true` only when `departure->trip_id === null` (i.e. not yet dispatched). No percentage tiers, no post-boarding stage.

**Where** — `backend/app/Services/FixedRefundService.php:376-379` (`isRefundAllowed`); `:21-75` (`cancelByCustomer`).

**Proposed cancellation matrix** (config-driven per city/operator; fill the %s to policy):

| Stage | Refund % | Wallet | Driver earning | Operator earning | Ledger |
|---|---|---|---|---|---|
| Before payment | n/a | — | — | — | none |
| After payment, before boarding | e.g. 100% | credit/refund | none | none | reversal |
| After boarding | e.g. 0–50% | partial | retain share | retain fee | partial reversal |
| After ride started | e.g. 0% | none | full | full | none |
| After completion | n/a | — | settled | settled | settled |

**Fix**
- Replace the boolean with a policy that returns a refund fraction per stage, then pass that fraction into `applyRefundIfNeeded()`.
- Surface the computed refund line to the customer at cancel time (the notify path already carries `refund_status`/`refund_path` — populate the amount too).
- Add tests for each cell of the matrix, including wallet vs. Razorpay refund path and the ledger reversal.

**Modules:** FixedRefundService · ShuttleRefundService · AutoRefundService · customer-mobile/cancel UX

---

### F5 — Boarding blocked by two unexplained gates ("Start ride first", then "Reach pickup stop") ✓

| | |
|---|---|
| **Expected** | The driver understands, before tapping, what's required — the button is disabled with a clear reason, and at the origin the "reach stop" check passes automatically. |
| **Current** | Two guards fire as errors *after* the tap: board requires the departure to be `DISPATCHED`/`DEPARTED` ("Start the fixed ride before boarding passengers"), then a geofence requires the driver within the stop radius ("Reach the passenger pickup stop before boarding"). |

**Root cause** — These are by-design state-machine + geofence guards, but the driver UI doesn't reflect them, so they read as failures. At the origin the geofence should already pass; if it doesn't, the driver's ping is stale/out of radius.

**Where** — `backend/app/Http/Controllers/FixedDriverController.php:433` (started-gate), `:437` + `:664` (`ensureStopReachedForAction`).

**Fix (mostly driver-mobile UX)**
- Disable "Board passenger" until the ride is started; show a "Start ride to begin boarding" hint instead of a post-tap error.
- Show live proximity to the next stop (you already compute `fixed_last_reached_stop_seq`); enable per-passenger board only when their board stop is reached.
- Confirm the driver location ping cadence keeps the geofence fresh at the origin.

**Modules:** FixedDriverController · driver-mobile/boarding screen

---

### F6 — Finance ledger entry appears with a delay after payment ⚠

| | |
|---|---|
| **Expected** | The transaction posts to `/finance/ledger` immediately on capture. |
| **Current** | Entry is absent at first, appears later. |

**Likely cause** — Two candidates to confirm at runtime:
(a) with the split engine off (F2), the ledger row the operator eventually saw comes from a different/legacy path that runs on a schedule or reconciliation sweep, not on capture;
(b) posting is queued and the worker/cron drains it late.
Check `PaymentReconciliationService` / `PaymentSplitService` and whether ledger writes are dispatched to a queue vs. written synchronously in `LedgerService::record`.

**Where** — `backend/app/Services/LedgerService.php:18` (`record`), `PaymentReconciliationService.php`, queue config.

**Fix** — Reproduce with the queue worker and scheduler on/off to localise the delay, then post the ledger entry synchronously on capture (or ensure the queue drains promptly and the UI reflects a "pending" state until it does).

**Modules:** LedgerService · PaymentReconciliationService · queue/scheduler

---

## P2 — Medium

Missing features the flow expects; not blocking, but visible gaps.

### F7 — Tip option doesn't appear at payment even though operator tipping is enabled ✓

**Root cause** — Tip UI is implemented only for on-demand trips (`customer-book`, `trip-active`). The Fixed and Shuttle review/payment screens never render a tip selector, so the operator's tip config (`backend/app/Models/OperatorSetting.php:11-17`, `customer_tip_value_*`, `tip_in_percentage`) is never read there.

**Fix** — Render a tip selector on the Fixed/Shuttle "Review & pay" step driven by the operator settings API, and include the chosen tip in the payment payload and fare breakdown.

**Modules:** customer-mobile/fixed·shuttle review · OperatorSetting · payment payload

---

### F8 — No rating / review prompt after a Fixed ride completes ✓

**Root cause** — A `Rating` model and `RatingsController` exist, but no rating prompt is wired to Fixed completion — neither the driver completion path nor the customer's fixed-ride screen surfaces it. No rating reference in `FixedDriverController` / `FixedManifestService`; rating is trip-only.

**Fix** — On `DROPPED`/`COMPLETED`, show a rating modal in customer-mobile that posts to the existing ratings endpoint with the reservation/driver; feed driver analytics.

**Modules:** RatingsController · customer-mobile/fixed-ride-active

---

### F9 — Pickup/drop can only be chosen from the stop list — no map / nearest-stop mapping ✓

**Enhancement** — Let the customer either pick a stop from the route or drop a pin on the map; snap the pin to the nearest route stop. The geo helpers already exist in the app (`distanceKm`, nearest-stop math) and server-side (`metersBetween` in the automation service).

**Fix** — Add a map-pick mode to the Fixed "Stops" step; compute nearest stop client- or server-side and confirm it with the customer before continuing.

**Modules:** customer-mobile/fixed step 3

---

## P3 — Low

### F10 — Analytics / reports appear incomplete or inaccurate ⚠

**Status** — Not reproduced this pass — needs a dedicated data audit with specific numbers.

**Note:** several report gaps (driver revenue, settlement, occupancy) are likely downstream of F2 — with the split engine off there are no driver-side money rows to aggregate, so fix F2 first and re-check before auditing the report queries themselves.

**Fix** — After F2 lands, re-run each report (revenue, driver, route, occupancy, boarding, cancellation, wallet, settlement) and record concrete expected-vs-actual per metric, filter, and date range; only then chase individual aggregation bugs.

**Modules:** Admin reports · depends on F2

---

## Recommended fix order

Stabilise trust first (what the customer sees), then the money, then the gaps.

1. **F1 — kill the false "driver arrived".** Small, contained, high trust impact. Gate arrival automation + reorder `fixedLiveStatus`.
2. **F2 — driver earnings/ledger/wallet.** Enable + wire the split engine for Fixed via the route-departure path; add a settlement test. Unblocks F6 and F10.
3. **F3 — driver sees only his vehicle.** Filter layouts by the driver's vehicle; auto-select when one.
4. **F4 — cancellation/refund matrix.** Replace the binary rule with staged percentages; show the refund to the customer.
5. **F5 — boarding UX.** Reflect the state-machine + geofence gates in the driver UI instead of post-tap errors.
6. **F6 — ledger timing.** Re-test once F2 lands; post synchronously or show pending state.
7. **F7 / F8 — tips & ratings for Fixed/Shuttle.** Reuse the existing tip config and ratings endpoint.
8. **F9 — map/nearest-stop pick.** Enhancement.
9. **F10 — analytics audit.** Dedicated pass after F2.

---

## What tested clean

Route listing, departure selection, seat selection/locking (the `fixed_seat_holds` + TTL hold engine), and the pay-then-ride-page transition all behaved as designed in the reported test — no changes needed there beyond the status bug F1.

---

*Grounded against `backend/app/Services/*`, `backend/app/Http/Controllers/FixedDriverController.php`, `FixedBookingsController.php`, `config/services.php`, and `customer-mobile/src/app/pages/fixed-ride-active`.*
