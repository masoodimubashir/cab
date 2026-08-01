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

**Counts:** P0 × 1 · P1 × 4 · P2 × 3 · P3 × 1  _(F2 was reclassified to "not a bug" after tracing — see below)_

**Progress:** F1 ✅ fixed & verified · F2 ✅ investigated → not a code bug · F3 ✅ fixed (layout filter) · F4 ✅ fixed (refund boundary) · F5 ✅ fixed (boarding UX) · F6 ✅ fixed (immediate ledger capture) · F7 ✅ fixed (tipping for Fixed & Shuttle) · F8 ✅ fixed (rating & review for Fixed) · F9 ✅ fixed (map stop picking & nearest-stop snapping) · F10 ✅ audited & verified

**Test-suite state (as of 2026-07-30 re-verification):** the **entire Fixed module is
green** — every `Fixed*` suite plus `BookingSettlementPhase5Test` (86 tests /
610 assertions). This included repairing suites that had never actually executed
against the current schema/auth model:
- F6/F7/F8/F10 — stale `users.role` column (dropped 2026-05-09), later-required
  `vehicle_seat_layout_id`/`ride_type_id`, and missing Sanctum `act-as:*` abilities.
- `FixedFullWalkthroughTest` — boarding is now OTP-gated; the walkthrough now issues
  and sends the boarding code.
- `FixedAdminRecoveryActionsTest` — mirrors the prepayment + enables the split engine
  so an admin cancel auto-refunds (was falling to the manual register).
- `FixedAbcAcceptanceTest` / `FixedRouteVehicleDecouplingTest` — the two legacy
  wallet-settlement cases now pin `split_enabled = false` (they validate the classic
  wallet credit; the split-engine payout path is covered by Phase5).

**Remaining failures are all OUTSIDE the Fixed-only first release** (21 failures, full
`Feature` suite): Shuttle (`ShuttleBookingPhase1Test`, `ShuttleQuoteTest`,
`ShuttleSettlementPhase5Test`), `PrivatePrepaymentTest`, `GatewayFeeTest`,
`DreamCabsApiTest`, `AdminDriverApprovalFlowTest`, `DriverLockedServiceRegistrationTest`.
They predate this work, are untouched by it, and mostly share the same stale-schema
drift.

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

### F2 — Driver "sees no earnings" after a Fixed ride — NOT A CODE BUG (corrected after tracing)

> **Original diagnosis was wrong.** I first blamed a disabled split engine. On tracing the
> full path, the settlement machinery is complete, wired, **already enabled**, and covered by a
> passing 17-test suite. The symptom is a test-flow artifact plus a "which screen" mismatch.

| | |
|---|---|
| **Expected** | Payment → at ride completion, driver's share is settled and visible to the driver. |
| **Observed** | Driver wallet showed nothing after payment. |

**What's actually true**
- `PAYMENTS_SPLIT_ENABLED=true` is **already set** in `.env:83` (Razorpay test keys). The Route split engine is live.
- The full chain exists and is wired: `recordCapture()` at booking → `linkDepartureBookings()` at start (`FixedDriverController.php:276`) → `settleTrip()`/`settleShared()` at completion (`FixedDriverController.php:566` → `CommissionSettlementService`).
- It is proven by `tests/Feature/BookingSettlementPhase5Test.php` — **17 tests, all green**, including the happy path (driver gets ₹96 via Route, ledger balances), unverified-driver held earnings, and no-double-pay.

**Why the driver saw nothing** (two independent reasons)
1. **The ride was never completed.** Settlement — in either mode — only fires at `complete()`. The test flow got stuck at boarding (see F5), so nothing settled.
2. **With Route ON, earnings do NOT go to the wallet.** The legacy wallet credit is deliberately suppressed (`CommissionSettlementService.php:200-214`; `BookingSettlementPhase5Test::test_with_the_engine_on_the_legacy_wallet_credit_is_suppressed`). The share instead goes out as a **Razorpay Route transfer** (verified driver) or parks as a **held earning** (unverified driver). Both surface on the **Earnings** screen (`/drivers/me/earnings` → `net_earnings`, `held`, `pending`), never the Wallet screen.

**Action (no code change)**
1. Complete a Fixed ride end-to-end (unblock F5 first), then check the **Earnings** screen, not Wallet.
2. A test driver with no verified payout account will see the share as a **held earning** ("it's yours — add a payout account"), which is correct, not a bug.
3. If drivers intuitively look in the Wallet for ride money, that's a UX/IA clarity issue worth a follow-up — but not a money-path defect.

**Modules:** (verified working) PaymentSplitService · BookingPaymentService · CommissionSettlementService · DriversController@earnings · BookingSettlementPhase5Test

---

## P1 — High

Real defects that degrade the flow but don't (by themselves) block a launch.

### F3 — Driver is shown vehicles/layouts that aren't his (Ertiga vs. his registered Swift) ✓ FIXED

> **Fixed** in `FixedDriverController`. A shared `effectiveLayoutVehicleTypeId()` resolver now
> narrows both the layout list (`layouts()`) and the open guard (`open()`) to the driver's own
> `vehicle_type_id`, with a safe fallback to the full city list when the driver has no known
> vehicle type or the city has no layout for it (so a mis-configured driver is never locked out).
> The driver app auto-selects when there's one match and shows a static "Your vehicle" confirmation
> instead of a pointless single-option dropdown. 3 new tests added to `FixedDriverSeatLayoutTest`
> (narrowing, foreign-vehicle open rejected, city fallback) — **7/7 green**; driver-app typecheck clean.


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

### F4 — Cancel after ride start returned no refund ✓ FIXED

| | |
|---|---|
| **Was** | Refund eligibility was binary on `departure->trip_id`: full refund only while the departure hadn't dispatched; the instant the driver tapped Start, every passenger dropped to zero refund — even one whose stop the bus was still driving towards — with no explanation surfaced. |
| **Now** | The refund boundary is the vehicle physically reaching **that passenger's own pickup stop** (the same "the bus is at your stop" moment that unlocks a no-show), not the departure starting. A bus that has set off but not yet reached the passenger refunds in **full**; once it enters their pickup radius (or they board) the fare is forfeited. |

> **Fixed** in `backend/app/Services/FixedRefundService.php` + `FixedNoShowPolicy.php`.
> The policy stayed deliberately **all-or-nothing** (owner's call — no percentage
> staircase, no per-city config): the only thing that changed is *where* the line
> sits. `isRefundAllowed()` no longer gates on `trip_id`; it now returns false only
> once the passenger has boarded or `FixedNoShowPolicy::hasReachedPickup()` is true
> (a new shared SSOT reusing the GPS `fixed_stop_arrived_at` / manual
> `fixed_last_reached_stop_seq >= board seq` signals). The customer cancel
> notification + audit event now explain the "bus had reached your stop, no refund
> is due" outcome. No change to the refund engine (`AutoRefundService`) or the
> ledger was needed — the existing paths carry it.

**Who keeps the forfeited fare (owner's rule — Option B).** "Forfeited" here means
the *customer* gets no money back — **not** that the operator pockets the whole
fare. Because the driver still drove out and waited for the passenger, the fare is
divided by the **configured commission split** at ride completion, exactly like a
carried passenger: e.g. on a ₹120 seat the driver keeps **₹96** and the operator
its **₹24** commission. Mechanically the forfeit path (`refundFull = false`) simply
declines the refund and leaves the mirrored `Payment` unsettled, so `settleTrip()`
splits it at completion. This applies to both a no-show and a cancel-after-the-bus-
reached-the-stop.

**Tests** — `FixedBookingPhase4Test` reworked to the new refund boundary
(reached-stop → reject; started-but-not-reached → **full refund**, a new case).
`BookingSettlementPhase5Test`'s two forfeit cases now assert the Option-B outcome
(no customer refund → ₹96/₹24 split at completion, ledger balanced) rather than the
old "operator keeps ₹120". The refund-mock setup gaps were fixed by mirroring the
booking `Payment` row + enabling the split engine. `FixedStopAutomationTest`
updated likewise. The F6/F7/F8/F10 suites — previously red on schema/auth drift
(dropped `users.role` column, missing `vehicle_seat_layout_id`/`ride_type_id`,
`Sanctum` abilities) — were corrected and now actually run. All eight refund/
settlement/feature suites green (**373 assertions**).

**Shuttle** — intentionally **not** changed here. `ShuttleRefundService` is structurally different (trip-state based, no per-passenger stop radius) and already blocks cancellation once `ARRIVED_PICKUP`. Applying the same principle (refund through `EN_ROUTE_PICKUP`, forfeit only on arrival) is a separate, pre-first-release policy change — flagged for a follow-up, not bundled silently. First release is Fixed-only.

**Modules:** FixedRefundService · FixedNoShowPolicy · (ShuttleRefundService — deferred)

---

### F5 — Boarding blocked by two unexplained gates ("Start ride first", then "Reach pickup stop") ✓ FIXED

> **Fixed** in `driver-mobile/fixed-driver.page`. The Board button now stays visible for eligible
> passengers but is **disabled with an up-front reason** until both backend gates are satisfied:
> a new `rideStarted` getter + `boardReady()`/`boardBlockReason()` helpers gate the button and the
> `board()` handler, and `passengerActionHint()` explains the state ("Start the ride to begin
> boarding" → "Board & no-show unlock once you reach the pickup stop" → "Board or mark no-show").
> No more post-tap 422s. (`canBoardPassenger` kept as the visibility check so the affordance never
> vanishes.) Typecheck clean; the screen sits behind driver auth + a live departure so it's not
> browser-verifiable without a full dispatched-vehicle setup.


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

### F6 — Finance ledger entry appears with a delay after payment ✓ FIXED

> **Fixed** in `PaymentSplitService.php` + `BookingPaymentService.php`.
> Previously, prepaid booking payments (`SETTLE_BOOKING`) skipped recording the `TYPE_CAPTURE`
> ledger entry at capture time (waiting until trip completion `complete()`), causing payments
> to be missing from `/admin/ledger` while departures were forming or in progress.
> `applyCapturedSplit()` and `BookingPaymentService::recordCapture()` now record the `TYPE_CAPTURE`
> (and gateway fee) on `ledger_entries` synchronously immediately upon payment confirmation.
> `settleBookingPayment()` guards against duplicate entries via `hasCapture()`, and `linkTrip()`
> backfills `trip_id` on the ledger rows when the vehicle departure is materialised.
> Verified with a new automated suite `FinanceLedgerImmediateCaptureF6Test` (100% green).

---

## P2 — Medium

Missing features the flow expects; not blocking, but visible gaps.

### F7 — Tip option doesn't appear at payment even though operator tipping is enabled ✓ FIXED

> **Fixed** in `customer-mobile/fixed-book` + `shuttle` + backend `FixedSeatHoldService` & `ShuttleBookingService`.
> The Fixed and Shuttle payment/review screens now fetch operator tipping settings from `/api/operator/tipping`
> and render an interactive tip preset selector driven by the operator's admin settings (flat rupees or percentages).
> Selected tips are included in the price breakdown line items (`Driver tip: +₹XX`) and payable total, passed to the backend,
> and saved to `tip_amount` on `fixed_seat_holds`, `seat_reservations`, and `shuttle_passenger_bookings`.
> Verified with automated test `FixedAndShuttleTippingF7Test` (100% green).

---

### F8 — No rating / review prompt after a Fixed ride completes ✓ FIXED

> **Fixed** in `backend/app/Http/Controllers/FixedBookingsController.php` & `customer-mobile/fixed-ride-active`.
> `POST /api/fixed/bookings/{reservation}/rate` now accepts score (1-5) and feedback comment for completed/dropped Fixed rides.
> It updates `SeatReservation`, writes to `ratings`, and updates the driver's aggregate rating (`rating_avg`, `rating_count`).
> The customer mobile app automatically renders an interactive 5-star rating card on `fixed-ride-active` when the ride reaches `DROPPED` / `COMPLETED`, and displays the submitted review once rated.
> Verified with automated test `FixedRideRatingF8Test` (100% green).

---

### F9 — Pickup/drop can only be chosen from the stop list — no map / nearest-stop mapping ✓ FIXED

> **Fixed** in `customer-mobile/fixed-book` (`fixed-book.page.ts`, `fixed-book.page.html`, `fixed-book.page.scss`).
> Customers can now tap any stop marker directly on the interactive map or click/tap anywhere on the map polyline.
> Clicking any position on the map calculates Haversine distance to all active route stops, snaps to the nearest available stop (within 10km), auto-selects it for Boarding or Drop, and displays an informative snapping badge (e.g. `Snapped to Connaught Place (120m away)`).
> Stop marker click events directly update the selected Boarding / Drop stop with toast feedback.

---

## P3 — Low

### F10 — Analytics / reports appear incomplete or inaccurate ✓ FIXED

> **Verified & Audited** in `AdminReportsController`, `AdminAnalyticsController`, and `FinanceController`.
> The audit confirmed that report aggregation pipelines for daily earnings, completed rides, driver invoices, ratings & reviews, finance overview, and money-in itemized ledgers are operating accurately.
> Verified with automated test `AdminAnalyticsAndReportsAuditF10Test` (100% green).

---

## Recommended fix order

Stabilise trust first (what the customer sees), then the money, then the gaps.

1. ~~**F1 — kill the false "driver arrived".**~~ ✅ **DONE** — arrival automation gated to started rides + `fixedLiveStatus` reordered.
2. ~~**F2 — driver earnings.**~~ ✅ **Resolved without code** — settlement already works, is enabled, and is tested green. Re-verify by completing a ride and checking the Earnings screen (see corrected F2).
3. ~~**F5 — boarding UX.**~~ ✅ **DONE** — Board button disabled with an up-front reason until ride-started + pickup-reached; no more post-tap errors.
4. ~~**F3 — driver sees only his vehicle.**~~ ✅ **DONE** — layouts + open guard narrowed to the driver's vehicle type; app auto-confirms the single match.
5. **F4 — cancellation/refund matrix.** Replace the binary rule with staged percentages; show the refund to the customer. (Also fixes the 3 pre-existing refund-mock test failures.)
6. **F6 — ledger timing.** Re-test now that F2 is confirmed working; post synchronously or show a pending state.
7. **F7 / F8 — tips & ratings for Fixed/Shuttle.** Reuse the existing tip config and ratings endpoint.
8. **F9 — map/nearest-stop pick.** Enhancement.
9. **F10 — analytics audit.** Re-run reports after completing real rides — they should now populate from the working settlement data.

---

## What tested clean

Route listing, departure selection, seat selection/locking (the `fixed_seat_holds` + TTL hold engine), and the pay-then-ride-page transition all behaved as designed in the reported test — no changes needed there beyond the status bug F1.

---

*Grounded against `backend/app/Services/*`, `backend/app/Http/Controllers/FixedDriverController.php`, `FixedBookingsController.php`, `config/services.php`, and `customer-mobile/src/app/pages/fixed-ride-active`.*
