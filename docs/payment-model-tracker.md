# DreamCabs — Payment Model (Model B) · Task Tracker

Companion to [payment-model-spec.md](payment-model-spec.md). Work is split into **modules that can be built and tested independently.** Tick a module's acceptance boxes to mark it verified.

**Timeline:** 7–10 working days from sign-off.

## Status legend

`[ ]` not started `[~]` in progress `[x]` done & tested

## Testing rules (IMPORTANT)

- Run tests against **`cab_test`** only — **never `cab_db`** (dev data).
- Command: `DB_PASSWORD='CabDev_2026!' php artisan test`
- Tests use `RefreshDatabase`. **Do not** run `php artisan migrate` for testing.

## Module map & order

| # | Module | Depends on | Status |
|---|---|---|---|
| 1 | Admin config foundations | — | `[x]` |
| 2 | Gateway fee per ride type + Fixed checkout breakdown | — | `[x]` |
| 3 | Cancellation & refund overhaul | — | `[x]` |
| 4 | No-show → operator (all ride types) | 3 | `[x]` |
| 5 | Wallet records & visibility | — | `[x]` |
| 6 | Net settlement engine | 5 | `[x]` |
| 7 | Driver finance screens | 5, 6 | `[x]` |
| 8 | Shuttle shared-extra split | — | `[~]` |

Modules 1, 2, 3, 5, 8 have no dependencies and can run in parallel. 4 follows 3; 6 follows 5; 7 follows 5 + 6.

---

## Module 1 — Admin config foundations `[x]`

**Goal:** expose every operator setting this model needs, so the rest of the work has switches to read.
**Spec:** §3, §7

**Build**
- Global **cash deposit %** editable in Admin — `OperatorSetting.cash_deposit_percent`. ✅ already present.
- **Tips enable/disable** toggle — **built:** `tips_enabled` flag (default OFF) + admin validation + public config + enforced on the Private tip endpoint (403) and the Shuttle/Fixed booking store (tip zeroed).
- **Cash-exposure limit** — `wallet_cash_max_capping` (+ min + `check_driver_debt`). ✅ already present & enforced (DriversController go-online, WalletService).
- **Tolls OFF** — city-level `toll_mode = 'no'` (City Settings, not operator settings). ✅ exists.

**Files:** `OperatorSetting.php`, `AdminOperatorSettingsController.php`, `OperatorPublicController.php`, `TripsController::tip`, `FixedBookingsController::storeSeatHold`, `ShuttleBookingsController::store`, migration `..._add_tips_enabled_to_operator_settings.php`. Tests: `TipsToggleTest.php`.

**Acceptance / tests**
- [x] Changing deposit % changes the deposit charged on a new cash booking. *(pre-existing)*
- [x] Tips **disabled** (default) → Private tip endpoint returns 403; Shuttle/Fixed booking tip is zeroed; public config reports `enabled: false`.
- [x] Tips **enabled** → tip flows through (201 + driver wallet credit).
- [x] Cash-exposure limit persists and is readable by settlement logic. *(pre-existing)*
- [x] Tolls off → no toll added to any ride end. *(City Settings `toll_mode`)*

**Verified (backend, automated):** `TipsToggleTest` + `FixedAndShuttleTippingF7Test` + `OperatorPaymentSettingsTest` → 12 green. Covers: Private tip 403 when off / 201 when on, public `enabled` flag, admin save of `tips_enabled`, Fixed booking tip stored when on / zeroed when off. (Also fixed a stale `role`/status assertion in the pre-existing percentage-tip test.)

**Whole-module verification (`Module1ConfigTest` — 6 green):**
- [x] Shuttle booking tip **zeroed when off** / kept when on.
- [x] Cash-exposure **go-online block** — driver in debt is refused online when `check_driver_debt` on; allowed when off.
- [x] Tolls **OFF at booking** — `toll_mode != 'yes'` → toll = 0; `'yes'` → toll applied.
- Also verified deposit % end-to-end (`CashDepositMathTest` + 3 CashDeposit tests) and toll-ON ride-end extras (`RideEndExtrasTest`).

**Tolls fully off (both ends) — now enforced & tested:**
- [x] Booking-time toll blocked when off (`Module1ConfigTest`).
- [x] Ride-end driver toll dropped when off (`RideEndExtrasTest::test_a_declared_toll_is_dropped_when_tolls_are_off`) — `applyDriverExtras` now gates the declared toll on `toll_mode`.

**Driver-app toll box — now hidden when tolls off:**
- Backend exposes `tolls_enabled` on the driver's trip payload (active-trip, negotiation/loadTrip, and the progress/complete response — via `Trip::tollsEnabled()`).
- Driver app (`rides.page.ts askForExtras`) omits the toll input when `tolls_enabled === false`; waiting still shows. Backend paths verified (14 green); driver-app build is the user's to run.

**Frontend (user-verified manually):** admin "Enable tipping" toggle + customer-app tip hiding confirmed by the user. Migration run on the real DB by the user.

---

## Module 2 — Gateway fee per ride type + Fixed checkout breakdown `[x]`

**Goal:** the payment-gateway fee is borne per the per-ride rule, and Fixed shows it to the customer.
**Spec:** §4

**Build (done)**
- Config `services.payments.gateway_fee.borne_by` — **fixed=customer, private=operator, shuttle=operator** (env-overridable). `GatewayFeeService::customerBears()/operatorBears()`.
- **Fixed** (`FixedSeatHoldService::createRazorpayOrder` + `BookingPaymentService::recordSeatCapture`): rider charged fare + fee; order returns `breakdown` (fare / gateway_fee / total). Customer-borne fee stored in `payments.gateway_fee_amount`.
- **Private** (`PaymentsController::pay`) & **Shuttle** (`ShuttleBookingService::recordSplitCapture`): rider charged the fare only; operator-borne fee stored in new `payments.operator_gateway_fee_amount`.
- **Split** (`PaymentSplitService`): customer-borne fee booked at capture; **operator-borne fee booked at settlement** (so a cancelled/refunded ride books no fee and the ledger balances). The existing `computeSplit` already floors the driver at the fare, so the operator's slice absorbs the operator-borne fee — no core-split change.
- Migration: `..._add_operator_gateway_fee_to_payments.php`.

**Acceptance / tests — all green**
- [x] **Fixed** order = fare + fee, returns the 3-line breakdown; at completion driver paid on fare, **operator whole**, ledger balances (`GatewayFeeFixedTest`, 2).
- [x] **Private** rider pays fare only; operator absorbs fee; driver on fare; refund returns the fare; ledger balances (`GatewayFeeTest`, 14).
- [x] **Shuttle** rider pays fare only; operator absorbs fee; operator take = commission − fee; ledger balances (`GatewayFeeShuttleTest`, 1).
- [x] **Regression:** 71 core payment/settlement/cash/refund tests green (fee-off default path unchanged).

**Cash deposits — now covered (fee applies to the online-charged amount):**
- [x] **Fixed cash** → customer pays **deposit + fee**; driver gets the full deposit; fee ledgered; balances (`GatewayFeeFixedTest`).
- [x] **Shuttle/Private cash** → operator bears it; the fee on the deposit is **recorded on the payment** (`operator_gateway_fee_amount`) for net-settlement but **not** a trip-ledger entry (the deposit is wholly the driver's, so the ledger stays balanced) — `GatewayFeeShuttleTest`, `GatewayFeeTest::private_cash_deposit…`.

**Notes:**
- **Fixed checkout UI:** the customer app render of the fare/fee/total breakdown was completed by the user.
- **Enablement:** the fee is **off by default** (`PAYMENTS_GATEWAY_FEE_ENABLED`); turn it on to charge Fixed riders / have the operator absorb it on Private/Shuttle.
- **Fee figure:** published-rate **estimate** (see `GatewayFeeService`), not Razorpay's exact per-transaction fee — kept as-is by decision.

---

## Module 3 — Cancellation & refund overhaul `[x]`

**Goal:** new refund rules for cancellations, Model B (Route off).
**Spec:** §5.1, §5.2, §5.3

**Client-confirmed rules (TWO levels, keyed on whether the driver had ARRIVED):**
- **Driver's fault** (driver/operator/system cancel) → **100% refund**, all ride types.
- **Customer cancels while driver still on the way** → **Fixed 100%**; **Private/Shuttle `100 − charge%`** (charge = `cancellation_charge_percent`, default 20).
- **Customer cancels after the driver arrived, or no-show** → **0% refund**, all ride types. Kept money → operator.
- **Cash**: only the online deposit is in play — the charge is `charge% of the full fare, capped at the deposit`; refund/keep apply to the deposit only.
- **No middle 50% stage** (client dropped it). Timer/auto-no-show + forfeit routing = **Module 4**.

**Build**
- [x] **Setting:** `cancellation_charge_percent` in **City Settings** (per city, default 20, validated 0–100, copies between cities). `CitySetting` + migration + `AdminCitySettingsController` (validation + copy + `shape()` response). **Frontend input box added** — "Cancellation charge (%)" in the No-show / cancellation subsection of `city-settings.component.ts` (interface + template + save PATCH); type-checks clean.
- [x] **Rulebook:** `AutoRefundService::decideModelB()` — pure, exhaustively tested (`Module3RefundRulesTest`, 8): driver-fault/full, on-way charge (online + cash-capped), after-arrival/no-show 0, Fixed via charge%=0.
- [x] **Private executor:** `AutoRefundService::refundForCancellationModelB()` — Razorpay refund of the computed amount, operator keeps the rest (kept = paid − refunded, visible on the admin money screen with the trip's driver + reason). Idempotent. Wired into `TripStateMachineService` cancel (runs when split is OFF). Tests: `Module3RefundExecutorTest` (4). Route cancel engine unchanged (`AutoRefundEngineTest` + Phase5 R6/R7 still green).
- [x] **Fixed/Shuttle executor:** both cancel through booking rows (`SeatReservation` / `ShuttlePassengerBooking`), so `AutoRefundService::refundBookingModelB()` refunds directly against the booking's Razorpay id (no ledger, no clawback). Wired into `FixedRefundService::autoRefundBooking` (Fixed = 100% before pickup / 0% after — matches the existing seat-release line) and `ShuttleRefundService` (`cancelByCustomer` computes the amount via `decideModelB`; `markCancelled`/`autoRefunded` execute it — **no driver assigned → 100%; driver on the way → `100−charge%`; no-show → 0%**). Under the Route engine both paths are unchanged.

**Acceptance / tests — all green**
- [x] Online Private cancel before arrival → 80% (config honoured); after arrival → 0%; driver-fault → 100%. Cash charge capped at deposit; no-show forfeits deposit. *(`Module3RefundRulesTest` 8, `Module3RefundExecutorTest` 4)*
- [x] Fixed cancel: 100% before the vehicle reaches pickup / 0% after — auto-refunded via Razorpay under Model B. *(`BookingSettlementPhase5Test`, `FixedCashRefundTest`)*
- [x] Shuttle cancel: no driver → 100%; driver on the way → `100−charge%`; no-show → 0%. *(`Module3ShuttleRefundTest` 3, `ShuttleSettlementPhase5Test`)*
- [x] **Regression:** 60 refund/settlement tests green across Route + Model B; the Route cancel engine and its R6/R7 rulebook are unchanged. The two `engine-off …keeps its legacy behaviour` tests were updated to the new auto-refund behaviour (was: manual register).

**Note:** the kept charge/forfeit is visible on the admin money screen as (paid − refunded), with the trip's driver + cancel reason — no separate cancellations list (per the client). Frontend: City Settings *Cancellation charge %* input box is the user's to add.

---

## Module 4 — No-show → operator (all ride types) `[x]` (done — money side was Module 3; this added Private auto-detect + fixed the attribution bug)

**Goal:** every no-show amount lands with the operator, and no-shows are auto-detected.
**Spec:** §5.4 · **Depends on:** Module 3

**Already covered by earlier modules:**
- ✅ **Money → operator (all 3 types):** handled by Module 3 under Model B — a no-show = 0% refund, operator keeps the online payment; a NO_SHOW seat is excluded from the driver's wallet settlement (Module 5 `settleShared`/`settleShuttle` filter out CANCELLED/NO_SHOW). So "forfeit → operator" is met.
- ✅ **Auto-detect (Fixed + Shuttle):** already automatic — `FixedStopAutomationService` + `ShuttleStopAutomationService` mark no-show on wait-timer expiry.

**Build (done)**
- [x] **Fixed the Private no-show attribution bug.** `TripStateMachineService::cancelledBy()` mapped the no-show reason strings **backwards**: `no_show_by:customer` → `BY_DRIVER` (full refund) and `no_show_by:driver` → `BY_CUSTOMER` (charge). Against `TripsController::markNoShow` (line 626/635: `role=customer` = *the customer was the no-show*) that inverted the money — a **customer** no-show refunded the customer in full instead of forfeiting to the operator, and a **driver** no-show wrongly charged the customer. Swapped to the correct mapping (`no_show_by:customer` → `BY_CUSTOMER`, `no_show_by:driver` → `BY_DRIVER`) + corrected the docblock. No existing test pinned it (all cancel tests passed `cancelled_by` explicitly) — now pinned both ways.
- [x] **Private auto-detect sweep.** New `PrivateNoShowService::sweep(Trip)` — a solo driver waiting at `ARRIVED_PICKUP` past the city's `private_no_show_threshold_minutes` (the driver-waits-for-customer field; fallback PricingRule → 5; `0` disables) auto-cancels as a **customer** no-show through the state machine, which runs the Module 3 rulebook (forfeit to operator). Guarded to solo rides only (skips Fixed `route_departure_id` + Shuttle journeys). Wired into the driver's per-trip location stream `TripTrackingController::updateLocation`, so it fires only while the driver is actually present. The manual button still works for ending the wait early; the old per-minute fee (`private_no_show_charge_per_minute`) is intentionally **not** applied under Model B (whole online payment is forfeited).

**Acceptance / tests — all green** *(`Module4PrivateNoShowTest`, 7)*
- [x] Private customer no-show → 0% refund, operator keeps (attribution correct); driver no-show → 100% refund.
- [x] Private no-show auto-marked after the grace timer; no-op before the timer, when the driver hasn't arrived, for shared trips, and when threshold = 0.
- [x] Fixed no-show → operator, driver gets 0 (regression, `BookingSettlementPhase5Test` R7).
- [x] Shuttle no-show → operator (regression, `Module3ShuttleRefundTest`, `ShuttleSettlementPhase5Test`).

---

## Module 5 — Wallet records & visibility `[x]`

**Goal:** keep the wallet; make every movement a visible record for driver + admin — the foundation of Model B settlement (5 → 6 → 7).
**Spec:** §6, §8

**Design decision (client, confirmed):** Razorpay **Route is being removed**. So the wallet becomes the **single settlement ledger** of who owes whom — every online earning a CREDIT, every cash commission a DEBIT, balance = what the operator owes the driver. This work builds that path **alongside** the existing Route path (gated by `services.payments.split_enabled`), so it can be cut over by flipping one flag — no big-bang rewrite.

**Build (done)**
- `CommissionSettlementService::settle()` — when **split is OFF (Model B)**:
  - **Private online** → wallet **CREDIT** = fare − commission (`'Ride earnings'`).
  - **Private cash** → **CREDIT** the online deposit (`'Cash deposit collected'`) + **DEBIT** the commission (`'Cash ride commission'`); net = deposit − commission. With no deposit it's just the commission debit.
  - When **split is ON (Route)** the path is unchanged (driver paid at source; only cash commission hits the wallet).
- `settleShared()` (Fixed) — split OFF, per seat: online seat **CREDIT** (fare − commission); cash seat **CREDIT** deposit + **DEBIT** commission. (Also fixed a latent bug in the old split-off path that over-credited cash seats by the cash the driver already holds.)
- **Shuttle deferred to Module 8:** Shuttle carries no `route_departure_id`, so it reaches the solo path but actually settles per-passenger through `ShuttleBookingService`. The solo path now **skips shuttle** (guarded) rather than book a wrong trip-level entry; shuttle's Model B wallet settlement is handled with the shuttle shared-extra work.
- **Visibility** — already exposed and confirmed: driver `GET /api/drivers/me/wallet` (balance + feed); admin `GET /api/admin/drivers/{driver}/wallet/transactions` (paginated) + `walletBreakdown` (earned vs deposits vs payouts) + `payoutsDue` worklist.

**Acceptance / tests — all green (cab_test)**
- [x] Cash ride → driver wallet debited the commission, a record is created. (`Module5WalletSettlementTest`, `CashCommissionWalletTest`)
- [x] Online ride → driver earning credited, a record is created. (`Module5WalletSettlementTest`)
- [x] Cash-with-deposit → deposit credited + commission debited, net = deposit − commission. (`Module5WalletSettlementTest`, `Module5SharedWalletTest`)
- [x] Fixed shared (online + cash) settle onto the wallet correctly. (`Module5SharedWalletTest`)
- [x] Records visible via the driver API and the admin API (same data, both sides). (`Module5WalletVisibilityTest`)
- [x] **Regression:** 199 money-core tests green under **both** split states (Route path untouched: 27 split-forcing files, incl. GatewayFee*, Phase5, cash-deposit, refund, admin money screens, payout visibility).

**⚠️ Cutover step (yours to run in production, when the client signs off):** set **`PAYMENTS_SPLIT_ENABLED=false`** in `backend/.env` to switch the live system from Route to the Model B wallet path. Until then the app keeps running on Route; the wallet path is built, tested, and dormant. (The Route code is intentionally left in place — rip-out is a later step, after cutover is proven.)

---

## Module 6 — Net settlement engine `[x]`

**Goal:** compute the net position per driver and enforce the exposure limit.
**Spec:** §7 · **Depends on:** Module 5

**Build (done)**
- `NetSettlementService::position(User)` — reads the wallet and states the driver's position: **owed_by_company** (earnings + deposits held, less paid-out), **owed_by_driver** (cash commission debt), **net** (= wallet balance, one running account), plus gross earnings/commission/deposits/paid_out for the finance screens.
- **Persisted records:** `driver_settlements` table + `DriverSettlement` model. A snapshot (owed_by_company / owed_by_driver / net / amount_paid / method / ref) is written each time the operator records a payout (`AdminDriversController::recordPayout`), giving the settlement **history** Module 7 reads.
- **Endpoints:** admin `GET /api/admin/drivers/{driver}/settlement` (position + history); driver `GET /api/drivers/me/settlement` (their own position + history).
- **Exposure limit:** `DriversController::goOnline` now blocks when `balance < wallet_cash_min_capping` (the configured signed floor — 0 = no debt allowed, −500 = up to ₹500 tolerated) instead of the old hard `balance < 0`. Response carries `error_code: driver_debt` + `limit`.

**Acceptance / tests — all green (`Module6NetSettlementTest`, 6)**
- [x] Mixed-ride driver → net = earnings − commission owed, correct sign (positive when owed, negative when owing); a top-up counts as the driver's own float, not earnings.
- [x] Driver owes **more** than the exposure limit → go-online blocked (422 `driver_debt`); owes **within** the limit → allowed.
- [x] Recording a payout snapshots the position (both amounts + net + amount paid) into `driver_settlements`; visible via the admin and driver settlement endpoints.
- [x] **Regression:** Module 1 go-online, admin money screens, payout visibility, Module 5 visibility all green (34 tests) — payout/breakdown behaviour unchanged.

**Migration:** `..._create_driver_settlements_table.php` (run `php artisan migrate` on the real DB yourself at deploy — never against `cab_db` from here).

---

## Module 7 — Driver finance screens `[x]`

**Goal:** the four finance views on top of the wallet/settlement data.
**Spec:** §8 · **Depends on:** Modules 5, 6 · *(frontend + supporting APIs)*

**Design decision:** no third money screen. The four views become **segment tabs on the existing Wallet screen** (the app has no bottom tabs — navigation is the slide-in drawer). Earnings stays the performance/charts screen; Wallet becomes the settlement hub. This avoids overlap between Earnings, Wallet, and a would-be Payouts screen.

**Build (done)**
- **Backend — reconciliation:** `NetSettlementService::reconcile(User)` — the wallet identity (deposits + earnings − commission − paid_out = balance) plus the drift check (wallet payouts vs `driver_settlements` records). Exposed on both settlement endpoints (`/drivers/me/settlement`, `/admin/drivers/{driver}/settlement`). The other three views read existing Module 5–6 APIs.
- **Frontend — Wallet hub** (`driver-mobile/.../pages/wallet/`): `ion-segment` with four tabs —
  - **Owed** — "You're owed ₹X" (or "You owe ₹X" in debt), the earnings/commission/deposits/paid-out breakdown, last payout, and the top-up button.
  - **Settlements** — past payouts (amount / date / method / reference) from the settlement history.
  - **Ledger** — every wallet transaction with an all/credits/debits filter.
  - **Check** — the reconciliation equation + a green "reconciles" / red "mismatch ₹X" verdict.
- **Frontend — Earnings card swap** (`.../pages/earnings/`): the Route "Paid to your bank / On its way / Waiting to be released" card is replaced by a Model B "Owed to you / Last paid" card linking to the Wallet hub. Earnings otherwise unchanged (charts + ride-by-ride stay).

**Acceptance / tests**
- [x] Pending Payout Balance (Owed tab) shows the correct owed/net figure — `NetSettlementService::position`, tested in Module 6.
- [x] Settlement History (Settlements tab) lists past settlements — `driver_settlements`, tested in Module 6.
- [x] Reconciliation (Check tab) matches wallet records to settlements, flags drift — `Module7ReconciliationTest` (2 green: matches + drift).
- [x] Driver Ledger (Ledger tab) shows the full transaction history — `/drivers/me/wallet`.
- [x] Admin can view the same per driver — `/admin/drivers/{driver}/settlement` (position + reconciliation + history).
- Frontend type-checks clean (`tsc --noEmit`, exit 0); **visual/device verification is the user's** (Ionic UI isn't auto-tested here).

**Notes:** the old `wallet-activity.modal.ts` is now unused (the Ledger tab replaces it) — left in place, safe to delete later. No `.env` flip needed for Module 7.

---

## Module 8 — Shuttle shared-extra split `[~]` (half done, half blocked)

**Goal:** shared extra charges are split evenly across the riders who were on board.
**Spec:** §9

### Part A — Shuttle Model B wallet settlement (carried over from Module 5) — **DONE**
Shuttle carries no `route_departure_id`, so it can't use the Fixed (`settleShared`) or solo path. `CommissionSettlementService::settleShuttle()` now settles a completed shuttle **per passenger booking**, the same Model B rules as Private/Fixed:
- online passenger → wallet **CREDIT** (fare − commission) `'Shuttle ride earnings'`
- cash passenger → **CREDIT** the online deposit + **DEBIT** the commission
- under Route (split on) → only a cash passenger's commission hits the wallet; the online split + deposit settle via Route (unchanged).
`settle()` now routes shuttle to this path early (parallel to `settleShared`); the old solo-path shuttle skip is removed.

**Tests — green:** `Module8ShuttleWalletTest` (online credit; cash deposit+commission). Regression: all shuttle Route tests (`GatewayFeeShuttleTest`, `ShuttleSettlementPhase5Test`, `ShuttleCashDepositTest`, `ShuttleCashRefundTest`) + private/fixed suites still green (89 tests across the two regression batches).

### Part B — split shared overage by passenger count — **⚠ BLOCKED (needs shuttle pooling)**
The headline feature can't be built yet: **shuttle pooling isn't implemented.** `ShuttleBookingService::createBooking` gives **every booking its own `ShuttleJourney` and its own trip** (`seats_taken = 1`), and there's no completion-time vehicle-overage recompute. So a shuttle carries **one passenger per trip today** — there is no "N riders on one vehicle" to divide an overage across.

**Needs the client / product to define:** how shuttle pooling works (do riders share a vehicle on a common corridor? how is the vehicle-level time/distance overage measured and attributed?). Once pooling exists, the split (overage ÷ boarded passengers, excluding no-shows, base seat locked) sits cleanly on top of `settleShuttle`. Treat like the Module 3 client blocker.

**Acceptance / tests (Part B — pending pooling)**
- [ ] Overage of ₹X across N boarded passengers → each charged **X ÷ N**.
- [ ] No-show / cancelled seats are **excluded** from the divisor.
- [ ] Base seat price unchanged; only the split extra is added.

---

## Manual / admin verification (not automated)

These need eyes on the running app, not just feature tests:

- [ ] Admin: deposit %, tips toggle, cash-exposure limit all editable and take effect.
- [ ] Fixed checkout: fare + gateway + total renders correctly on the customer app.
- [ ] Driver app: the four finance screens render with live data.
- [ ] Customer app: no wallet payment option anywhere (all three ride types).

---

## Pending client (blockers to close)

- [ ] **§5.3 Fixed cancellation** — Option 1 (keep) vs Option 2 (3-stage by departure time). *(Blocks Modules 3 → 4.)*
- [ ] **Shuttle pooling model (§9 / Module 8 Part B)** — how many riders share one shuttle vehicle/trip, and how the vehicle-level time/distance overage is measured & attributed. *(Blocks the shared-extra split; Part A shuttle wallet settlement is already done.)*
- [ ] **Toll rules** — deferred until defined.
- [ ] **Tip distribution rules** — deferred until Tips are enabled.
