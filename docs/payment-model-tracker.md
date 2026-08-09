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
| 2 | Gateway fee per ride type + Fixed checkout breakdown | — | `[ ]` |
| 3 | Cancellation & refund overhaul | — | `[ ]` |
| 4 | No-show → operator (all ride types) | 3 | `[ ]` |
| 5 | Wallet records & visibility | — | `[ ]` |
| 6 | Net settlement engine | 5 | `[ ]` |
| 7 | Driver finance screens | 5, 6 | `[ ]` |
| 8 | Shuttle shared-extra split | — | `[ ]` |

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

## Module 2 — Gateway fee per ride type + Fixed checkout breakdown `[ ]`

**Goal:** the payment-gateway fee is borne per the per-ride rule, and Fixed shows it to the customer.
**Spec:** §4

**Build**
- Config: gateway-fee bearer per ride type — **Fixed = customer**, **Private/Shuttle = operator**.
- **Fixed checkout**: compute gateway fee (≈2%), add to total, display **Ride Fare + Gateway Charge + Final Total**.
- **Private/Shuttle**: operator absorbs — fee booked to operator, not added to the customer.

**Acceptance / tests**
- [ ] Fixed booking total = fare + gateway fee; breakdown returned to the client app.
- [ ] Private booking total = fare (no fee added to customer); fee booked to operator in the ledger.
- [ ] Shuttle booking total = fare (no fee added); fee booked to operator.

---

## Module 3 — Cancellation & refund overhaul `[ ]`

**Goal:** new refund rules for cash + online; Fixed per the client's chosen option.
**Spec:** §5.1, §5.2, §5.3

**Build**
- **Cash**: deposit **forfeited** on cancel — remove the current auto-refund of the deposit.
- **Online (Private & Shuttle)**: 3-stage refund **80 / 50 / 0**, keyed on driver progress (`ASSIGNED` → not left base; `EN_ROUTE_PICKUP` → moving; `ARRIVED_PICKUP` → arrived/no-show). Percentages **configurable**.
- **Fixed**: implement the chosen option (⚠️ **pending client** — §5.3). Default: keep **Option 1** until confirmed.

**Acceptance / tests**
- [ ] Cash cancel → deposit kept, refund = 0.
- [ ] Online cancel, not left base → refund 80%.
- [ ] Online cancel, moving to customer → refund 50%.
- [ ] Online cancel, driver arrived → refund 0%.
- [ ] Configurable percentages honoured (change config → refund changes).
- [ ] Fixed cancel behaves per the confirmed option.

---

## Module 4 — No-show → operator (all ride types) `[ ]`

**Goal:** every no-show amount lands with the operator.
**Spec:** §5.4 · **Depends on:** Module 3

**Build**
- **Fixed** no-show forfeits to **operator** (was: driver).
- **Private** no-show: replace the per-minute fee with **full forfeit to operator** (0% refund).
- **Shuttle** no-show: already to operator — verify (regression).

**Acceptance / tests**
- [ ] Fixed no-show → amount books to operator, driver gets 0.
- [ ] Private no-show → 0% refund, amount to operator.
- [ ] Shuttle no-show → to operator (regression, unchanged).

---

## Module 5 — Wallet records & visibility `[ ]`

**Goal:** keep the wallet; make every movement a visible record for driver + admin.
**Spec:** §6, §8

**Build**
- Ensure every **commission debit** / **earning credit** writes a wallet transaction record.
- Expose wallet transaction history to the **driver app** and to **admin**.

**Acceptance / tests**
- [ ] Cash ride → driver wallet debited the commission, a record is created.
- [ ] Online ride → driver earning credited, a record is created.
- [ ] Records visible via the driver API and the admin API (same data, both sides).

---

## Module 6 — Net settlement engine `[ ]`

**Goal:** compute the net position per driver and enforce the exposure limit.
**Spec:** §7 · **Depends on:** Module 5

**Build**
- Per driver, compute: **owed by driver** (cash commission held), **owed by company** (earnings), and the **net**.
- Persist records of **both amounts + the net**.
- Enforce the **cash-exposure limit** (Module 1): block go-online when the driver owes more than the limit.

**Acceptance / tests**
- [ ] Mixed-ride driver → net = earnings − commission owed, with the correct sign.
- [ ] Driver owes more than the exposure limit → go-online is blocked.
- [ ] Settlement record shows both amounts and the net.

---

## Module 7 — Driver finance screens `[ ]`

**Goal:** the four finance views on top of the wallet/settlement data.
**Spec:** §8 · **Depends on:** Modules 5, 6 · *(frontend + supporting APIs)*

**Build**
- Pending Payout Balance screen
- Settlement History screen
- Settlement Reconciliation screen
- Driver Ledger / Transaction History

**Acceptance / tests**
- [ ] Pending Payout Balance shows the correct owed/net figure.
- [ ] Settlement History lists past settlements.
- [ ] Reconciliation matches wallet records to settlements (no drift).
- [ ] Driver Ledger shows the full transaction history.
- [ ] Admin can view the same per driver.

---

## Module 8 — Shuttle shared-extra split `[ ]`

**Goal:** shared extra charges are split evenly across the riders who were on board.
**Spec:** §9

**Build**
- On shuttle completion, if **time/distance thresholds** are exceeded, compute the vehicle overage and **split it by the number of passengers on board**.
- Charge each rider their equal share — **cash**: added to their balance; **online**: collected as a shortfall.
- Base seat price stays **locked**; only the overage is shared.

**Acceptance / tests**
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

- [ ] **§5.3 Fixed cancellation** — Option 1 (keep) vs Option 2 (3-stage by departure time).
- [ ] **Toll rules** — deferred until defined.
- [ ] **Tip distribution rules** — deferred until Tips are enabled.
