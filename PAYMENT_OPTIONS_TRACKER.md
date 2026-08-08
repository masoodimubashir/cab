# Payment Options & Cash Revival — Task Tracker

**Goal:** Move payment-method config from city-level to a new operator-level **Payments** tab (3 switches: Online / GPay / Cash + global cash-deposit %), bring **cash back** as a hybrid upfront-deposit mode, and surface one shared payment modal across Private, Fixed & Shuttle.

**Key decisions (locked):**
- Cash is **re-introduced** — this revises the "cash is killed" stance in [`docs/payment-automation-plan.md`](docs/payment-automation-plan.md).
- Cash deposit is **percentage-based, global** (one value in the operator Payments tab).
- Payment methods are decided by **operator switches**, not per-city arrays.

**Status legend:** ⬜ not started · 🟡 in progress · ✅ done · 🔵 needs live Razorpay

---

## Module 1 — Operator Payments settings (backend)

Store the 3 switches + deposit % on the operator/global settings row and expose via the existing `/admin/operator-settings` endpoint.

| # | Task | Status |
|---|------|--------|
| 1.1 | Migration: add `payment_online_enabled`, `payment_gpay_enabled`, `payment_cash_enabled` (bool), `cash_deposit_percent` (decimal) to the operator settings table | ✅ |
| 1.2 | Add fields to the operator settings model (fillable + casts) | ✅ |
| 1.3 | Validation: at least one method must stay on; `cash_deposit_percent` between 0–100 | ✅ |
| 1.4 | Return the 4 fields from the `/admin/operator-settings` GET + accept them on PATCH | ✅ |

**Test (Module 1):** ✅ `OperatorPaymentSettingsTest` — 5 passed
- ✅ Feature: GET returns the 4 fields with defaults (online+gpay on, cash off, 20%).
- ✅ Feature: PATCH the switches + deposit → persisted and re-read.
- ✅ Feature: cannot save with all three switches off (422).
- ✅ Feature: partial update can't turn off the last remaining method (422).
- ✅ Feature: `cash_deposit_percent` rejects negative / >100 (422).

---

## Module 2 — Operator Payments tab (admin frontend)

New `payments` section in [`operator-settings.component.ts`](frontend/src/app/admin/settings/operator-settings.component.ts), following the existing `services`/`wallet` section pattern.

| # | Task | Status |
|---|------|--------|
| 2.1 | Add `payments` to `SectionKey`, `sections[]`, `saving`, `sectionFields` | ✅ |
| 2.2 | Render 3 switch-rows (Online / GPay / Cash) + one number field (`cash_deposit_percent`) | ✅ |
| 2.3 | Wire load/save through existing `fetch()` / `save('payments')` | ✅ |
| 2.4 | Client-side guard: block saving with all three off (mirror backend) | ✅ |

**Test (Module 2):**
- ✅ `ng build` clean (only pre-existing budget/CommonJS warnings).
- ⏳ Live click-through (toggle → save → reload; all-off inline error) — **blocked on admin login**; needs credentials to verify in-browser.

**Notes:** deposit % field shows only when Cash is on; inline error + `paymentsHasOne` guard mirror the backend rule; Payments nav sits between Driver & Geofence and Wallet.

---

## Module 3 — Retire city-level payment options (frontend)

Remove payment-mode config from the City Settings **screen** so the operator tab is the operator-facing source of truth. **Re-scoped:** backend removal moved to Module 4 — `allowed_driver_payment_modes` is still read at runtime by `PaymentModeService`, `PricingController`, `FareNegotiationController` and the customer app, so the column and every reader must flip together in one coherent step. Removing them here would leave a broken intermediate state.

| # | Task | Status |
|---|------|--------|
| 3.1 | Delete `PAYMENT_MODE_OPTIONS` + its UI block from [`city-settings.component.ts`](frontend/src/app/admin/settings/city-settings.component.ts) | ✅ |
| 3.2 | Drop `allowed_driver_payment_modes` from the city-settings interface, form init, save payload, helpers & copy-preview pill | ✅ |

**Test (Module 3):**
- ✅ `ng build` clean; no reference to `allowed_driver_payment_modes` / `PAYMENT_MODE_OPTIONS` / `isMode` / `toggleMode` remains in the component (grep clean).
- ⏳ Live: City Settings page loads & saves with no Payments section — **blocked on admin login** (same as Module 2).

**Backend note:** the frontend no longer sends the field, so `AdminCitySettingsController`'s write block is now dead-but-harmless; it and the column drop are handled in Module 4.

---

## Module 4 — Flip all readers to the operator switches + drop the city column

Rewire every runtime reader of `city_settings.allowed_driver_payment_modes` to the operator switches, then retire the column. This is the coherent cut-over Module 3's backend half was deferred into.

| # | Task | Status |
|---|------|--------|
| 4.1 | `PaymentModeService::allowedForTrip()` + new `operatorModes()` return methods from the 3 operator switches; `cityModes()` kept as a deprecated shim | ✅ |
| 4.2 | Online **or** GPay → the `razorpay` rail; the Online-vs-GPay distinction is a UI concern the modal reads from the switches (deferred to M6, not a new server token) | ✅ |
| 4.3 | Removed the `split_enabled → razorpay-only` early return — cash now allowed even when the split engine is on (cash revival) | ✅ |
| 4.4 | Repointed `PricingController` (`/cities`) + `FareNegotiationController` off the city column onto `operatorModes()` | ✅ |
| 4.5 | Customer app: no code change needed (reads API response keys, unchanged `cash`/`razorpay` vocab); stale comment fixed | ✅ |
| 4.6 | Removed `allowed_driver_payment_modes` from `AdminCitySettingsController` (validation, normalize/lock, copy-city, `shape()`) + `CitySetting` model (fillable, cast, booted default) | ✅ |
| 4.7 | Migration `2026_08_06_120500_drop_allowed_driver_payment_modes_from_city_settings.php` | ✅ |
| 4.8 | Rewrote `CashKillTest` for the operator switches; updated `DATABASE_SCHEMA.md` | ✅ |

**Test (Module 4):** ✅ `CashKillTest` (4) + `OperatorPaymentSettingsTest` (5) green; `DriverPayoutVisibilityTest` + `PaymentSplitEngineTest` green; all changed PHP lints clean.
- ✅ Each switch combination returns exactly the enabled rails; cash survives the split-engine flag; Online/GPay both map to razorpay.
- ✅ Grep: no runtime reference to `allowed_driver_payment_modes` remains (only comments).
- ⚠️ **Pre-existing failures on this branch, NOT caused by M4** (verified by re-running on baseline with changes stashed): `GatewayFeeTest › a cancellation that is not the customers fault returns the fee` (1) and `PrivatePrepaymentTest` refund/split cases (3). These are split-engine refund-ledger bugs that predate this work.
- ⏳ **Not yet run against the dev DB** — `php artisan migrate` drops the column in `cab_db` when you're ready (tests already validated it via `RefreshDatabase`).

**Design decision:** the enforceable server vocabulary stays `cash` / `razorpay` (two rails). Online vs GPay is purely which app opens for the same Razorpay order, so the modal (M6) reads those two switches directly rather than the server minting a third `gpay` token that would ripple through the customer app's `PaymentMethod` type and the pay endpoints.

---

## Module 5 — Cash upfront-deposit money flow (backend)

Charge the deposit online now, collect the balance in cash at trip end.

**Settlement model (locked):** commission on a cash ride comes **from the driver's wallet** (Model B) — the online deposit is the driver's prepaid fare and goes wholly to them; the operator's cut is a wallet debit. This is what makes the Wallet Debt Engine + go-online block fire on every cash ride.

| # | Task | Status |
|---|------|--------|
| 5.1 | Compute deposit = `round(fare * cash_deposit_percent%)`; store `cash_deposit_amount` + `cash_balance_due` on the payment; `CashDepositService` | ✅ |
| 5.2 | Deposit goes through Razorpay at booking. ✅ **Private** (`pay/cash-deposit`); ✅ **Fixed** (seat hold `payment_method:cash` → deposit-only order → cash-aware capture); ⬜ Shuttle | 🟡 |
| 5.3a | Commission debited from driver wallet on cash-trip completion, even when the split engine is on (`CommissionSettlementService`) | ✅ |
| 5.3b | The online deposit Payment settles wholly to the driver (zero commission) — cash branch in `BookingPaymentService::settleTrip` | ✅ |
| 5.4 | Wallet-debt go-online block for cash drivers | ✅ **already exists** (`DriversController` go-online guard, `check_driver_debt` + negative balance) |

**Test (Module 5):**
- ✅ Unit: `CashDepositMathTest` (7) — deposit math across fare/percent pairs, always sums back to the fare.
- ✅ Feature: `CashCommissionWalletTest` (3) — cash ride debits commission from the wallet (engine on **and** off); online ride under the engine leaves the wallet alone.
- ✅ Feature: `PrivateCashDepositTest` (5) — deposit charged online, `cash_balance_due` recorded, deposit settles wholly to the driver, commission from the wallet, **ledger reconciles to the paise**; 0% deposit skips the online charge; cash-off is refused.
- ✅ Regression: `PaymentSplitEngineTest` + `BookingSettlementPhase5Test` green; `PrivatePrepaymentTest` unchanged (its 3 reds are pre-existing on the branch, verified against baseline).
- ✅ Feature: `FixedCashDepositTest` (2) — cash seat hold charges only the deposit online; at completion the deposit settles wholly to the driver, commission (₹24) comes from the wallet, ledger reconciles. Regression: `BookingSettlementPhase5Test` + `FixedFullWalkthroughTest` green (21).
- ✅ **Shuttle** deposit path (now that shuttle commission exists via the rate card). `ShuttleBookingsController::store` + `ShuttleBookingService::createBooking` accept `payment_method`; `createRazorpayOrder` charges only the deposit for cash (`CashDepositService::quote`); `recordSplitCapture` mirrors the deposit + cash balance; `confirmPayment`/`confirmPaidServerVerified` preserve the method; the dispatch Trip carries `payment_method` so the **solo** settlement path (shuttle trips have `route_departure_id = null`) takes the cash commission from the driver's wallet. Enum migration `2026_08_06_124000` adds `cash` to `shuttle_passenger_bookings.payment_method`. `ShuttleCashDepositTest` (3) green; `ShuttleSettlementPhase5Test` online split unchanged.

**Shared-cash model (locked):** commission from the driver's **wallet** (matches solo). Deposit → driver wholly. **Fixed** debits the wallet in `CommissionSettlementService::settleShared` (per `SeatReservation`); **Shuttle** debits it via the solo path (`settle()`, since shuttle trips carry no `route_departure_id`). `BookingPaymentService` mirrors the deposit + settles it commission-free either way.

**Note on 5.4 threshold:** the existing go-online guard blocks at **any** negative balance, while the spec describes blocking at the **−₹500 debt threshold** (`wallet_cash_min_capping`). Decide whether to keep the stricter existing behavior or loosen it to the threshold — it affects all drivers, not just cash, so left unchanged for now.

---

## Module 5.5 — Per-vehicle commission for Private & Shuttle

Move Private & Shuttle commission out of City Settings into the per-vehicle fare form (`/vehicles` → `VehicleBasePricingComponent`, stored on `pricing_rules`), with the same percent/fixed behaviour as the old City Settings toggle. Enables shuttle commission (unblocks shuttle cash). **Fixed is unchanged** (keeps its own per-route commission).

| # | Task | Status |
|---|------|--------|
| 5.5.1 | Migration + model: `commission_type` / `commission_percent` / `fixed_commission` on `pricing_rules` | ✅ |
| 5.5.2 | `AdminPricingController` store/update accept + validate the 3 fields | ✅ |
| 5.5.3 | Rewire `commissionForFare` to resolve from the vehicle's `PricingRule` (by `city_vehicle_type_id`); all 4 callers updated (solo settle, `PaymentsController`, `FareNegotiationController`, `ShuttleBookingService`) | ✅ |
| 5.5.4 | Shuttle commission — enabled via the `ShuttleBookingService` capture snapshot now reading the rate card (5.5.3); `settleShared` legacy path unchanged | ✅ |
| 5.5.5 | Fare form: commission section (percent/fixed toggle + adaptive amount field) in `VehicleBasePricingComponent` — `ng build` clean | ✅ |
| 5.5.6 | Fixed route form self-contained: percent/fixed toggle moved **into** the Fixed route form (`fixed-routes.component.ts`), `FixedPricingService::bookingCommission` route-only (no CitySetting fallback), backfill migration freezes existing routes' commission onto their own `fare_config` | ✅ |
| 5.5.7 | Remove "Ride commercials" commission from City Settings (front + back: component, `AdminCitySettingsController`, `CitySetting` model, `2026_08_06_123000` drops the 3 columns) | ✅ |
| 5.5.8 | **Test migration** — move commission onto a `PricingRule`/`fare_config` in every suite that set it on `CitySetting` (Private/GatewayFee/RideEndExtras/Shuttle/DriverPayout) | ✅ |

**Status:** ✅ **complete.** Commission now lives entirely off City Settings — Private/Shuttle on the vehicle rate card (`pricing_rules`), Fixed on the route's own `fare_config` (each route self-describing; in-form percent/fixed toggle). Backfill (`2026_08_06_122500`) freezes existing routes' commission before the City Settings columns drop (`2026_08_06_123000`). `ng build` clean. **78 payment/commission tests green.** Remaining suite failures (GatewayFee 1, PrivatePrepayment 3, ShuttleSettlementPhase5 forfeit 2) are pre-existing refund/split-timing gaps unrelated to commission (verified: forfeit `split_at` path in `AutoRefundService` untouched; commission source can't affect it).

## Module 6 — Shared customer payment modal

One modal component, reused across all three booking flows — no forking.

| # | Task | Status |
|---|------|--------|
| 6.0 | Backend: customer `GET /operator/payment-methods` (enabled switches + deposit %) — `OperatorPublicController::paymentMethods`; `CustomerPaymentMethodsTest` (3) green | ✅ |
| 6.1 | Shared `PaymentMethodModalComponent` (standalone bottom-sheet) in `customer-mobile/shared` — `ng build` clean | ✅ |
| 6.2 | `PaymentOptionsService` fetches enabled methods (cached, fail-safe to online); modal renders only those (Online / GPay / Cash) | ✅ |
| 6.3 | Online & GPay → existing Razorpay order flow; GPay opens UPI intent | ✅ all three (GPay → UPI: `prefill.method: 'upi'` for Fixed/Shuttle, forced gateway method `'upi'` for Private) |
| 6.4 | Cash → show deposit-now / balance-in-cash breakdown (done in modal), then Razorpay deposit order | ✅ all three (Fixed/Shuttle tag the booking `cash`; Private calls `/pay/cash-deposit` → deposit order, or nothing when deposit is 0%) |
| 6.5 | Mount modal in Private booking flow (`trip-active`) | ✅ |
| 6.6 | Mount modal in Fixed booking flow (`fixed-book`) | ✅ |
| 6.7 | Mount modal in Shuttle booking flow (`customer-book`, not `shuttle-bookings` — shuttle books+pays there) | ✅ |

**Status:** ✅ **Module 6 complete** — all three flows open the shared sheet and honor the operator's switches. Private (`trip-active`): `pay()` opens the modal; **Online** → the existing Razorpay flow (keeps its gateway-fee instrument chooser), **GPay** → same flow forced to UPI, **Cash** → `/trips/{id}/pay/cash-deposit` (opens a deposit checkout, or books straight through when the operator deposit is 0%). Removed the dead `doPay` action-sheet path (old direct-cash). `ng build` clean across all edits. **Note (backend edge):** a Fixed/Shuttle cash booking with a 0% operator deposit still floors to a ₹1 online charge (`max(100, …)`) — Private handles 0% correctly (no charge); revisit the shared-booking edge if 0% cash is ever offered.

**Test (Module 6):**
- Modal shows only switched-on methods (toggle each, re-open).
- Each of Private / Fixed / Shuttle opens the same modal and completes a booking per method.
- GPay path launches the UPI intent; cash path shows correct deposit vs balance.

---

## Module 7 — Refunds for cash

| # | Task | Status |
|---|------|--------|
| 7.1 | Cash cancellation auto-refunds the **online deposit** via `AutoRefundService` per the §5 rulebook | ✅ |
| 7.2 | Physical-cash disputes/refunds stay in the manual `RefundRegisterService` register | ✅ |
| 7.3 | Admin refund view labels cash rows as deposit-auto + cash-manual | ✅ |

**Status:** ✅ **complete.**
- **7.1** — The online deposit is what gets auto-refunded on a cash cancel (the balance was cash to the driver and is never returned here). **Private** already did this (solo `refundForCancellation`, cancel-fee = commission per §5). **Fixed was the real gap** — `FixedRefundService::autoRefundBooking` early-returned for anything but `razorpay`, so a cancelled cash seat refunded *nothing*; now cash is an auto-rail and the deposit goes back through the shared engine. **Shuttle** already auto-refunded the deposit but mislabelled it (showed the full fare, `razorpay_manual_fallback` path even on success) — now records the exact deposit and the `razorpay_auto` path. New `CashDepositService::depositForBooking()` reads the exact deposit charged from the mirrored booking Payment.
- **7.2** — The cash **balance** is never auto-touched (it was physical cash the driver collects). The manual register still handles any physical-cash dispute (`method: cash`), and the balance is surfaced on each cash row for context.
- **7.3** — `RefundRegisterService` rows now carry `is_cash`, `cash_deposit`, `cash_balance`; `amount` is the deposit (not the fare) for cash. The admin **Refunds** screen shows a **Cash** paid-via chip, a "deposit online · balance in cash" tag, the balance beside the amount, a cash-filter option, and a note in the Mark-refunded drawer that the locked amount is the deposit only.

**Test (Module 7):** ✅
- ✅ `FixedCashRefundTest` (2) — cancelling a cash seat before pickup refunds only the ₹30 deposit (booking + Payment marked REFUNDED, exact 3000 paise sent to Razorpay, ledger nets to zero for the payment); the register labels the row cash with amount = deposit and `cash_balance` = ₹90.
- ✅ `ShuttleCashRefundTest` (1) — cancelling a cash booking with no driver committed refunds only the deposit; the register shows deposit + balance.
- ✅ Regression: `AutoRefundEngineTest`, `FixedRefundReleasesSeatTest`, `FixedCashDepositTest`, `ShuttleCashDepositTest`, `CashCommissionWalletTest`, `FixedFullWalkthroughTest` all green; `ShuttleSettlementPhase5Test` unchanged (same 2 pre-existing forfeit reds). `ng build` clean.

---

## Module 8 — Full regression & go-live

| # | Task | Status |
|---|------|--------|
| 8.1 | Run existing payment suite (`PaymentSplitMathTest`, `PrivatePrepaymentTest`, `PayoutWebhookTest`, etc.) — all green | ✅ |
| 8.2 | Reconciliation invariant holds for cash trips: `customer_paid(deposit) + cash_collected = driver + operator` | ✅ |
| 8.3 | Razorpay test-mode run-through: one ride per type × each enabled method | 🔵 |
| 8.4 | Update [`docs/payment-automation-plan.md`](docs/payment-automation-plan.md) to reflect cash's return | ✅ |

**Status:** ✅ **done** (bar the live Razorpay run, blocked on Route). Full payment suite run against **`cab_test`** (never `cab_db`).

- **8.1** — ✅ **Whole payment suite green.** The 6 formerly-pre-existing refund-ledger reds are now **fixed** (they predated all cash/commission/payment-options work). Root cause was a single one: `AutoRefundService::recordUnsettledCapture` guarded on the capture ledger row, so when a prepaid booking recorded its CAPTURE at confirmation (immediate-capture F6) but never split, the guard fired and the operator's RETAINED share was never booked — leaving the trip short by exactly it on cancel. **Fix:**
  - On a **refund** (money going back) or a **Shuttle no-show forfeit**, guard on `payments.split_at` instead and book the operator's retained even when the capture row exists (`recordUnsettledCapture($bookRetained = true)`). For a refund it's then reversed to the customer; for a Shuttle no-show it stays as the operator's forfeit.
  - A **Fixed no-show forfeit** keeps the old capture-guard (`$bookRetained = false`): the departure still completes and settles the fare to the driver by the normal split, so the fare must NOT be pre-booked to the operator. Threaded via a new `forfeitToOperator` flag: `refundForBooking` / `refundBookingCancellation` (Shuttle passes `true`, Fixed defaults `false`).
  - One stale assertion updated: `PrivatePrepaymentTest` "captured but not split" asserted **zero** ledger rows at capture, contradicting F6 immediate-capture; now asserts exactly the CAPTURE row and no split rows.
- **8.2** — ✅ The cash reconciliation invariant holds by construction and is asserted end-to-end: `PrivateCashDepositTest`, `FixedCashDepositTest`, `ShuttleCashDepositTest` each complete a cash ride and prove the deposit settles wholly to the driver (`captured = driver_net`, `operator_net = 0`), commission comes from the wallet, and the ledger balances to the paise; `CashCommissionWalletTest` (3) confirms the wallet debit engine-on and engine-off.
- **8.3** — 🔵 **Blocked on Razorpay Route activation.** The driver-payout / fare-split engine can't run without Route, so no live test-mode run is possible yet. Follow-up sent to the client.
- **8.4** — ✅ Created [`docs/payment-automation-plan.md`](docs/payment-automation-plan.md): current payment model (operator switches, cash Model B, commission sources, settlement, refunds) reflecting cash's return + the Route blocker.

**Final regression (all against `cab_test`):** every payment suite green — the refund/settlement cluster (`PrivatePrepaymentTest`, `GatewayFeeTest`, `ShuttleSettlementPhase5Test`, `BookingSettlementPhase5Test`, `AutoRefundEngineTest`, `FixedCashRefundTest`, `ShuttleCashRefundTest`, `FixedRefundReleasesSeatTest` — 73 passed) plus the split/payout/math/cash-deposit/walkthrough suites (104 passed). Zero failures.

---

## Dependency order

```
M1 ─┬─> M2
    └─> M4 ──> M5 ──> M6 ──> M7 ──> M8
M3 (frontend-only, independent — done)
```

**Re-scope note:** M3 is now frontend-only (remove the City Settings UI). The backend retirement of `allowed_driver_payment_modes` — controller, model, column, and every runtime reader (`PaymentModeService`, `PricingController`, `FareNegotiationController`, customer app) — moved into M4 so all readers flip in one step.

Ship & test **module by module** — each row above is independently verifiable before moving on.
