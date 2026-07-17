# DreamCabs Financial Systems Audit

**Date:** 16 Jul 2026
**Scope:** backend + customer app + driver app + admin panel
**Method:** full code trace of every money-moving path
**Currency:** INR · Razorpay gateway (test keys)

---

## §0 Production-readiness scorecard

Scores answer one question: *if real money started flowing tomorrow, how safely would this area handle it?*

| Area | Score | Summary |
|---|---|---|
| 1 · Transactions & logging | **6/10** | Solid ledgers & snapshots; three silent money leaks |
| 2 · Customer refunds | **5.5/10** | Fixed = automated; shuttle = manual; no refunds table, no pending-refund queue |
| 3 · Commission & payouts | **4/10** | Commission engine is good; payout side has **no record-keeping at all** |
| **Overall — real-money readiness** | **5/10** | 6 blockers to clear first (§9) |

---

## §1 Critical findings first

Everything else in this report is context. These six are the items where money or truth is actually lost today.

### 🔴 B1 — The Razorpay webhook is dead, and there is no recovery path for stuck payments

`RAZORPAY_WEBHOOK_SECRET` is blank in `.env`. `RazorpayService::verifyWebhookSignature()` returns `false` when the secret is empty, so **every** webhook Razorpay sends is rejected with HTTP 400. Payment confirmation therefore depends 100% on the mobile app calling `/pay/razorpay/verify` after checkout.

**Failure scenario:** customer pays → money captured by Razorpay → app crashes / network drops before `verify` is called → the `payments` row stays `PENDING` forever. The money is in the Dreams account but the system says unpaid. No cron re-checks pending payments against the gateway. The same gap exists for fixed-booking seat-hold confirmation and driver wallet top-up verification.

**Fix:** set the webhook secret in the Razorpay dashboard and `.env`; add a scheduled job that sweeps `PENDING` payments/holds/top-ups older than ~15 min and reconciles them against the Razorpay Orders API.

### 🔴 B2 — Tips are credited to the driver without ever collecting money from the customer

`TripsController::tip()` writes a wallet **credit** to the driver for the tip amount — but no payment is taken. On an online-paid ride the Razorpay payment already happened *before* the tip, so the tip is never charged: the company pays the tip out of its own pocket. On a cash ride the customer typically hands the tip in cash — and the driver *additionally* receives the same amount as a wallet credit: **double payment**.

**Fix:** either collect tips through a second Razorpay charge before crediting, or (simpler) record cash-ride tips as informational only (no wallet credit) and drop/disable online tipping until it can be charged.

### 🔴 B3 — Manual payouts have nowhere to be recorded, so driver wallet balances drift from reality forever

Fixed-ride and shuttle earnings are **credited into the driver's wallet ledger** (`CommissionSettlementService::settleShared()`). The operator then pays the driver by GPay/bank *outside the app* — by design. But there is **no endpoint, no admin screen, no ledger entry type** to record that payout as a debit. Admin wallet routes are read-only. Result: every manual payout makes the in-app balance more wrong, permanently. Reconciliation (§8) is mathematically impossible in this state.

**Fix:** add an admin "record payout" action that writes a wallet `debit` (reason "Payout — GPay ref XXXX", `created_by_user_id` = admin) so the ledger mirrors reality. This is a small feature — one endpoint, one modal on the driver detail page.

### 🔴 B4 — Cancellation / no-show fees are recorded but never collected from anyone

`trips.cancellation_fee_amount` is set on late cancellations of scheduled rides and on no-shows (per-minute waiting fee). That's where it ends: no payment row, no wallet movement, no invoice line, not surfaced to the customer, the driver, or the admin. It's a number that pretends a fee happened.

**Fix:** decide the policy (charge to customer's next ride? waive?) and either wire the collection or remove the field so reports don't count phantom revenue.

### 🟠 B5 — Two refund architectures for the same product family, and no queue for the stuck ones

**Fixed** bookings refund automatically via the Razorpay API; when the API call fails, status parks at `APPROVED` ("owed but not sent") with **no retry, no admin dashboard, no alert** — it will sit there silently until a customer complains. **Shuttle** bookings use the opposite philosophy: refunds are always manual (`APPROVED` → admin clicks resolve-refund with a reference). Neither is wrong alone; having both confuses operators and support scripts, and the fixed `APPROVED` orphans are a real liability.

**Fix:** one "Refunds" admin view across modules filtered by status (Pending/Approved/Refunded/Rejected) + a retry button for fixed `APPROVED` rows. Optionally converge the two architectures (§6).

### 🟠 B6 — There is no unified transactions view; the "payments" table only knows about solo rides

Solo rides write to `payments`. Fixed bookings keep their Razorpay refs on `seat_reservations`; shuttle bookings on `shuttle_passenger_bookings`; wallet top-ups on `wallet_topups`. Four disconnected records of "money came in", each with different field names and status enums. No admin screen shows all money movements in one place, and no single query can answer "what did we collect yesterday?"

**Fix (cheap):** an admin "Transactions" report that UNIONs the four sources. **Fix (proper):** a `ledger_entries` table every module writes through — see §6.

---

## §2 The money map — every flow between Customer, Driver and Company

Verified against code, not documentation. C = customer, D = driver, Co = company.

| # | Flow | Direction | Trigger | Stored in | Unique IDs | Auto / Manual |
|---|---|---|---|---|---|---|
| F1 | Solo ride fare — cash | C → D (hand to hand) | Customer taps "Pay cash" after completion | `payments` (method CASH, SUCCESS) | payments.id, trip_id | Auto record, cash physical |
| F2 | Solo ride fare — online | C → Co | Razorpay order → checkout → signature verify | `payments` + provider_response | razorpay_order_id, razorpay_payment_id | Automatic |
| F3 | Solo commission | D → Co (wallet debit) | Trip completion → `CommissionSettlementService` | `wallet_transactions` + snapshot on `trips.commission_*` | wallet_transactions.id, engagement_id=trip | Automatic |
| F4 | Fixed seat fare (prepaid) | C → Co | Seat hold → Razorpay order → confirm | `seat_reservations` (payment_reference, payment_status) | reservation.id, payment_reference | Automatic |
| F5 | Fixed driver earnings | Co → D (wallet credit) | Ride completion → per-seat settle | `wallet_transactions` ("Fixed ride earnings") + per-seat commission snapshot | wallet_transactions.id, engagement_id=trip | Automatic |
| F6 | Fixed refund | Co → C (Razorpay reversal) | Eligible cancel → refund API | `seat_reservations.refund_*` + `fixed_booking_events` | refund_reference (rfnd_…) | Automatic |
| F7 | Shuttle fare / refund | C → Co / Co → C | Prepay; refund resolved by admin | `shuttle_passenger_bookings` | razorpay_payment_id, refund_reference | **Refund manual** |
| F8 | Driver wallet top-up | D → Co | Razorpay order → verify | `wallet_topups` + `wallet_transactions` credit | wallet_topups.id, razorpay ids | Automatic |
| F9 | Subscription purchase | D → Co (wallet debit) | Driver buys plan | `driver_subscriptions` (amount_paid, commission_percent, meters) + wallet debit | driver_subscriptions.id | Automatic |
| F10 | Coupon discount | Co absorbs | Applied at payment; burned once | `coupon_assignments.used_at, redeemed_trip_id`; discount on payment/booking rows | coupon_assignment_id | Automatic, idempotent |
| F11 | Tip | **Co → D (should be C → D)** | Customer adds tip post-ride | `trips.tip_amount` + wallet credit | engagement_id=trip | **Broken — see B2** |
| F12 | Driver payout (earnings) | Co → D (GPay/bank) | Operator decides | **Nowhere** | — | **Manual, unrecorded — B3** |
| F13 | Cancellation / no-show fee | — | Late cancel / no-show | `trips.cancellation_fee_amount` only | trip.id | **Recorded, never collected — B4** |

### What's genuinely well built

- **The wallet is a real ledger.** `wallet_transactions` is append-only; balance is always derived by summing (credit + cashback + driver_added_cash − debit). No cached balance column to drift. Every row carries reason, engagement (trip) link, and who created it.
- **Commission is snapshotted, not recomputed.** `trips.commission_percent/amount` and per-seat `seat_reservations.commission_*` freeze the rate that applied at settlement time — changing a plan or city rate later cannot rewrite history. Subscription override precedence (sub % beats city percent/fixed) is explicit, with a sentinel to distinguish "no sub" from a real 0% plan.
- **Payment endpoints are idempotent** (middleware) and signature-verified; duplicate verify calls return the existing SUCCESS row instead of double-processing. Coupon burn is a guarded single UPDATE (`whereNull('used_at')`) — unreusable by construction.
- **Fixed bookings have a proper event log** (`fixed_booking_events`: who, what, when, metadata) — an admin can reconstruct a fixed booking months later, including support notes.
- **Settlement math is defensive:** commission is capped at the fare, tolls are excluded from the commissionable base, cancelled/no-show seats are excluded from driver credit.

---

## §3 State lifecycles & what triggers each transition

### Solo ride payment (`payments.status`)

```
(created on pay attempt) PENDING ──app verify, signature OK──▶ SUCCESS ──▶ invoice PDF + coupon burn
        PENDING ──signature invalid──▶ FAILED
        PENDING ──app never calls verify──▶ stuck PENDING forever (B1 — webhook dead, no sweeper)
```

### Fixed booking (`seat_reservations.status` × `refund_status`)

```
hold (fixed_seat_holds, TTL) ──payment confirm──▶ BOOKED/CONFIRMED ──boarding code verified──▶ BOARDED ──stop reached──▶ DROPPED/COMPLETED
BOOKED ──customer cancels in window──▶ CANCELLED + refund API ──processed──▶ refund REFUNDED
                                                        └──API fails──▶ refund APPROVED (orphan — B5)
BOOKED ──driver no-show mark──▶ NO_SHOW + refund REJECTED
BOOKED ──admin/system cancel (incl. driver-missed-stop automation)──▶ CANCELLED + full refund path
```

### Shuttle booking

```
PAYMENT_PENDING ──pay──▶ CONFIRMED ──board──▶ BOARDED ──▶ DROPPED
CONFIRMED ──cancel (customer/trip)──▶ CANCELLED + refund APPROVED ──admin resolve-refund (manual, with reference)──▶ REFUNDED
CONFIRMED/BOARDED ──no-show──▶ NO_SHOW + refund REJECTED
```

### Driver wallet money

```
top-up:       wallet_topups PENDING ──verify──▶ PAID + ledger credit
earn:         fixed/shuttle completion ──▶ ledger credit
commission:   solo completion ──▶ ledger debit
subscription: purchase ──▶ ledger debit + driver_subscriptions row (meters: rides_used / earnings_accrued)
payout:       no state exists (B3)
```

---

## §4 Visibility & actionability matrix

Stored ≠ usable. ✓ yes · ◐ partial · ✗ no.

| Event | Logged? | Customer view | Driver view | Admin view | Actionable? | Gap / needed improvement |
|---|---|---|---|---|---|---|
| Solo online payment | ✓ | ◐ trip shows paid; invoice PDF exists but no receipts list | ◐ fare on trip | ◐ trip detail; no payments browser | ◐ | Admin payments list w/ status filter; customer receipts screen |
| Stuck PENDING payment | ✓ row exists | ✗ looks unpaid | ✗ | ✗ nobody is alerted | ✗ | **B1** — sweeper job + admin pending-payments queue |
| Fixed booking payment | ✓ | ✓ booking card: method, status, txn ref | ◐ manifest shows payment badge | ✓ booking + timeline | ✓ | — |
| Fixed refund (auto) | ✓ + event log | ✓ refund status, reference, amount in app | — | ✓ per booking | ◐ | No cross-booking refunds dashboard |
| Fixed refund stuck at APPROVED | ✓ | ◐ shows "approved… pending" forever | — | ✗ no queue, no alert | ✗ no retry button | **B5** — pending-refund queue + retry |
| Shuttle refund (manual) | ✓ | ◐ status visible | — | ✓ resolve-refund action exists | ✓ | Notify customer when resolved |
| Commission per ride | ✓ snapshot + ledger | — | ◐ wallet ledger shows debit; no per-ride % breakdown screen | ◐ driver wallet txns visible | ✓ | Driver-app "my commission" per-ride view |
| Fixed/shuttle earnings credit | ✓ ledger | — | ✓ wallet history | ✓ admin driver wallet | ✓ | — |
| Driver payout (GPay) | ✗ | — | ✗ | ✗ | ✗ | **B3** — record-payout action + payout history |
| Tip | ✓ | ◐ confirmation toast only | ✓ wallet credit | ◐ in wallet txns | — | **B2** — collection is broken regardless of visibility |
| Cancellation fee | ◐ field only | ✗ | ✗ | ◐ analytics column | ✗ | **B4** |
| Coupon redemption | ✓ burn + refs | ◐ discount at pay time; no coupon history | — | ✓ promotions admin | ✓ | Customer "my coupons — used" list |
| Wallet top-up | ✓ two tables | — | ✓ | ✓ read-only | ✓ | — |
| Subscription charge | ✓ | — | ✓ plans screen + wallet debit | ✓ subscriptions admin | ✓ | — |
| Admin wallet adjustment | — | — | — | ✗ no write endpoint at all | ✗ | Needed for disputes/corrections (with reason + audit) |

---

## §5 Source of truth & duplication

| Value | Single source of truth | Duplicated where | Consistency risk |
|---|---|---|---|
| Driver wallet balance | `SUM(wallet_transactions)` | Nowhere (derived) | **None — best design in the codebase** |
| Solo fare paid | `payments.amount` | trips.final_fare (pre-discount) | Low — discount lives only on payment row; reports must pick the right one |
| Commission owed | `trips.commission_amount` (snapshot) | wallet debit row | Low — written in same settlement pass |
| Fixed refund state | `seat_reservations.refund_status` | event log entries | Razorpay is the real truth; if refund settles later, DB stays "APPROVED" (webhook doesn't listen for refund events) |
| Payment success (online) | Razorpay | `payments.status` | **High while webhook is dead (B1)** — the mirror can silently disagree with the source |
| Subscription meters | `driver_subscriptions.rides_used / earnings_accrued` | — | Low — consumed in the same settle transaction |

---

## §6 Refund system — review of the proposed design

The proposal: a dedicated Refunds table, auto-created records, admin dashboard with Pending / Processing / Completed / Failed / Rejected, customer-visible history. Assessment: **directionally right — recommended with adjustments.**

### What already exists (don't rebuild it)

- Refund state machine per booking (`NONE / REQUESTED / APPROVED / REJECTED / REFUNDED`) with reference and amount columns — on both fixed and shuttle rows.
- Automatic gateway refunds for fixed bookings, wallet-credit refunds for wallet payments, full event log for fixed.
- Customer-side refund status already shown in the fixed bookings screen.

### What to build (the actual gaps)

- **A cross-module refunds view for admin** — one screen unioning fixed + shuttle (+ future solo) refunds, filterable by status. This is the highest-value piece of the proposal. A dedicated `refunds` table is the clean way to feed it, created whenever `refund_status` leaves `NONE`, holding: booking type+id, customer_id, amount, reason, gateway payment id, refund reference, status, timestamps, acted-by.
- **Retry & alerting for orphaned APPROVED refunds** — scheduled job retries the Razorpay call, admin gets a badge count. This converts B5 from a silent liability into a worklist.
- **Refund-event webhook handling** — Razorpay sends `refund.processed`/`refund.failed`; once B1 is fixed, consume these to flip APPROVED → REFUNDED without polling.
- **Customer notification on completion** — notify when status flips to REFUNDED (in-app + push via existing NotificationCenter; email under the operator toggle).

> A support-ticketing workflow is **not** recommended at this scale — it adds process without adding money-safety. An approval workflow is also unnecessary for fixed bookings (rules are deterministic); keep manual resolution only where it already exists (shuttle) or make shuttle automatic to match fixed — either way, converge on one philosophy.

---

## §7 Commission, earnings & payouts — review of the proposed design

The proposal: per-driver admin view with every completed ride, plan at the time, commission %, driver/company split, payout status and history, plus totals. Assessment: **the data model already supports 80% of this; the payout layer is the missing 20% — and it's the part that matters.**

### Already answered by existing data

| Question | Where the answer lives today |
|---|---|
| How is the driver's share calculated? | Solo: fare − city commission (percent or flat), subscription % override wins; toll excluded. Fixed: per-seat fare − snapshotted commission. Shuttle: full fare (commission not yet enabled). All automatic. |
| Where are commission calcs stored? | `trips.commission_percent / commission_amount`; `seat_reservations.commission_*` |
| Does the plan at ride time apply, not today's plan? | **Yes** — snapshot at settlement; historical rides are immune to plan changes |
| How does admin know what a driver earned? | Driver Invoice reports (daily/weekly/monthly) + admin driver wallet ledger + driver profile balance |
| Payout history? | **Does not exist anywhere (B3)** |

### Recommended payout architecture (fits the manual-GPay reality)

- **Keep payouts manual** — that's the agreed operating model. Automate the *record*, not the transfer.
- **"Record payout" action** on the admin driver page: amount (default = current positive balance), method (GPay/bank/cash), external reference, note → writes a wallet debit with `created_by_user_id`. The ledger then always equals what the company actually owes the driver. Payout history = filtered ledger view; zero new tables needed.
- **Owed-to-drivers dashboard**: one query — all drivers with positive derived balance, sorted descending. This is the operator's weekly worklist.
- Optionally split "prepaid float" from "earnings" visually (both live in one ledger; a reason-based filter is enough — don't split the ledger itself).

---

## §8 Cross-cutting checks

### Failure recovery

- **Server crash mid-settlement:** settlement runs in DB transactions — wallet row + snapshot commit together. Safe.
- **Gateway callback never arrives:** unhandled — B1. Verify-call-dependent everywhere.
- **Refund succeeds at gateway but DB update fails:** for fixed refunds the API call happens *inside* the cancel transaction; a DB failure after a successful gateway call would roll back the booking while the money left. Rare but real; the refunds-table + webhook design (§6) closes it.
- **Double-spend attempts:** idempotency middleware on all pay/confirm endpoints, row locks (`lockForUpdate`) on cancels/settlements, capacity guards. Good.

### Audit trail

- Fixed bookings: **excellent** — full event timeline with actor, admin support notes.
- Wallet: **good** — immutable rows with creator.
- Solo trips: timestamps only — no event log of who did what (e.g. which admin dispatched, why cancelled beyond one reason string).
- Deletions: users are soft-deleted with reason-prefixed audit ('[DELETED] …'); financial rows are never deleted. Good.

### Notifications on money events

- Sent today: fixed cancel/refund status (customer), trip status, subscription expiry/renewal (driver), booking receipts by email under operator toggles.
- Missing: refund *completed* confirmation, payout received (driver), stuck-payment alert (admin), commission summary (driver, periodic).

### Reconciliation — can every rupee be accounted for?

**Not today.** The target identity is:

```
Σ customer payments  =  company revenue (commissions + fees)
                     + driver payouts
                     + refunds returned
                     + discounts absorbed
                     + gateway fees
```

Three terms are unknowable in the current system: **driver payouts** (unrecorded — B3), **gateway fees** (never imported from Razorpay settlements), and part of **customer payments** (stuck PENDING rows — B1). Tips actively break the identity from the company side (B2). Fixing B1–B4 makes reconciliation possible; a monthly report comparing the Razorpay settlement export against DB sums would then close the loop.

### Security & permissions

- Ownership checks verified on every financial endpoint sampled: trips (`customer_id` match), fixed bookings (customer scope + `guardDriverReservation` for drivers), shuttle, wallet (self-only routes). **No cross-user data exposure found.**
- Admin financial routes sit behind permission middleware (`permission:drivers/reports/analytics`) with city-scoped managers locked to their city. Good.
- Razorpay secrets server-side only; signature verification on both checkout and (once enabled) webhooks; amounts always computed server-side, never trusted from the client. Good.
- Boarding-code hash hidden from all API responses; codes never visible to admin. By design.
- Watch item: webhook route is public by necessity — once the secret is set it's fine; while blank it's fail-closed (rejects everything), which is at least safe.

### Missing dashboards a real operation would need

- **Money-in overview** — daily collections across solo/fixed/shuttle/top-ups vs. Razorpay settlement.
- **Refunds queue** (§6) and **Owed-to-drivers** (§7) — the two operational worklists.
- **Exceptions board** — stuck payments, orphaned refunds, negative wallets beyond floor, expired-but-unrenewed subscriptions.
- **Coupon spend report** — total discount absorbed per campaign (data exists, report doesn't).

---

## §9 Verdict

**If this app launched tomorrow with real payments**, the foundations would mostly hold — ledger design, commission snapshots, idempotency, and endpoint security are genuinely solid. What would break is not a crash but a slow bleed: tips paid from company pocket, payouts drifting the ledgers, stuck payments and orphaned refunds accumulating with nobody alerted, and a books-vs-bank gap that grows every week and can never be closed retroactively.

Fix these six, in this order, before real money:

1. **Enable the Razorpay webhook + pending-payment sweeper** (B1) — one config value + one scheduled job. Highest risk-per-line-of-code in the system.
2. **Stop the tip leak** (B2) — disable online tip crediting until tips are actually charged; make cash tips informational.
3. **Record-payout action + owed-to-drivers view** (B3) — restores ledger truth; prerequisite for all reconciliation.
4. **Resolve the cancellation-fee ghost** (B4) — collect it or delete it.
5. **Refunds queue with retry** (B5) — turns silent liabilities into a visible worklist.
6. **Unified transactions report** (B6) — makes "what did we collect yesterday?" answerable in one click.

Estimated effort: items 1–4 are each under a day; 5 and 6 are one to two days each. None require schema redesign — the data model is already good enough; it's the operational layer (visibility, recovery, recording) that's missing.
