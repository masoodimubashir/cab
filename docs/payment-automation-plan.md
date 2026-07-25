# DreamCabs — Fully Automatic Payment System

**Status:** Approved design, ready to build
**Author:** Planning doc for the dev team
**Scope:** Private, Fixed and Shuttle rides — one shared money engine
**Last updated:** 2026-07-25

---

## 1. What we're building (plain English)

Today the money is a mess of two opposite flows:

- **Private rides:** the customer pays the driver *after* the ride (cash, or a Razorpay charge). The driver keeps the whole fare, and the platform later **claws back** its commission by debiting the driver's prepaid wallet float. If the driver's wallet runs dry, commission collection breaks.
- **Fixed / Shuttle:** the customer prepays the *platform* online at booking, and the platform later **credits** the driver their share into the wallet.

We are replacing all of it with **one model, used everywhere:**

> The customer always pays **online, upfront, into the operator's Razorpay account.** Razorpay automatically splits the money: the driver's share goes straight to the driver's own bank/UPI, and the operator's commission stays with the operator. Failed payments never leave the customer's account. Refunds are automatic and rule-driven. Cash is gone.

Example: fare is ₹100, commission is 10%. Customer pays ₹100. Driver receives ₹90 in their bank. Operator keeps ₹10. Nobody touches a wallet, nobody chases anybody for money.

---

## 2. The core mechanism: Razorpay Route

You **cannot** have both "customer pays the driver directly" *and* "automatic commission split." For an automatic split, the money must land in **one account you control first**, then be divided. That account is the operator's Razorpay account, and the tool that does the splitting is **Razorpay Route**.

How Route works:

1. Each driver is registered once as a **Razorpay Linked Account** (needs PAN + bank/UPI — this is the "driver KYC").
2. Customer pays the operator's Razorpay account as normal.
3. At capture, we attach **transfers**: ₹90 → driver's linked account, ₹10 stays with the operator.
4. Razorpay moves the driver's ₹90 to their real bank on Razorpay's settlement schedule. No manual payout, ever.

Razorpay's own processing fee is deducted by Razorpay per their pricing — we don't hand-calculate it. If you want the customer to bear it, add it as a line item at checkout (see §6).

> **Prerequisite — start this now, it's not code:** Razorpay Route must be **activated on the operator's Razorpay account** (a business/KYC step with Razorpay that can take days to weeks). Nothing below works live until that's approved. Get it in motion in parallel with development.

---

## 3. Driver KYC — where it lives and how "skippable" works

KYC = collecting the driver's PAN + bank/UPI and creating their Razorpay linked account.

- **At signup (driver app):** add a KYC step that is **skippable**. If the driver skips, show the warning: *"If you skip this, you won't be able to receive money for your rides. You can add it later."*
- **Later, in the app:** the existing `driver-mobile/.../payment-methods` page (currently a dead cash/Razorpay toggle) is **repurposed into a "Payout account" page** where the driver adds PAN + bank/UPI whenever they're ready.
- **Admin approval (`driver-approval-actions.pane.ts`):** add **"Payout account verified"** as one more checklist item next to the document checks.

**Held earnings (the important bit):** a driver with no verified payout account can still *take rides*. Their share is **held** (parked) on each completed ride instead of being lost. The moment their payout account is verified, all held earnings are **auto-released** to them. In the app they see a nudge: *"₹1,240 is waiting — add your bank details to collect it."* This is the one remaining job of the old wallet concept.

---

## 4. What changes vs. what dies

| Area | Today | After |
|---|---|---|
| Cash | Supported (`PaymentModeService` city ∩ driver rulebook) | **Killed.** Online-only. |
| Private ride timing | Pay **after** completion | **Prepay/hold at booking**, like Fixed/Shuttle |
| Commission collection | Clawed back from driver wallet (`CommissionSettlementService` debit) | **Split at source** via Route — driver never receives the commission portion |
| Driver payout | Manual: operator sends GPay/bank, records it (`drivers-payouts.tab.ts`) | **Automatic** via Route settlement |
| Refunds | Manual: operator sends money, marks it (`RefundRegisterService`) | **Automatic & rule-driven**; only disputes stay manual |
| Driver `payment-methods` page | Cash/Razorpay toggle | **Payout account** (PAN + bank/UPI) |
| Admin payouts tab | Manual worklist | **Status monitor** (auto-paid / pending / failed) |
| Admin refunds register | Manual worklist | **Monitor** + manual **only** for disputes |

---

## 5. The refund rulebook (approved)

All automatic unless marked manual. **Cancellation fee = the commission amount**, applied from the moment of booking (no free grace window).

| Situation | Outcome |
|---|---|
| No driver found (nobody accepts) | **Full auto refund** — service never happened |
| Driver / operator cancels | **Full auto refund** — not the customer's fault |
| Customer cancels **before** pickup | **Refund minus commission** (the cancel fee) |
| Customer cancels **after** driver arrived / trip started | **No refund** |
| Fixed/Shuttle seat released in time | **Full auto refund** — seat goes back to inventory |
| Fixed/Shuttle no-show / too-late cancel | **No refund** — seat was held and lost |
| Overcharge / dispute after the ride | **Manual** — a human decides |

Mechanically: a refund reverses the customer's original payment. If the driver's split already transferred, the refund is funded by **reversing the transfer** (Route supports transfer reversal) so the driver isn't paid for a cancelled ride. Full/partial amounts follow the table.

---

## 6. Money math at checkout

For a ₹100 fare with 10% commission:

```
Fare (what the ride costs)                     ₹100.00
Razorpay convenience fee (optional line item)  ₹  X.XX   ← only if you pass it to the customer
------------------------------------------------------
Customer pays                                  ₹100.00 (+X)

On capture, Route transfers:
  → Driver linked account                       ₹90.00
  → Operator (retained)                          ₹10.00  (commission)
```

Commission source is **per-city config** (already exists on `CitySetting`: `commission_type` = `fixed` | `percent`, `fixed_commission` ₹, `commission_percent` %). Subscription overrides still win (see `CommissionSettlementService`). The **cancel fee reuses this exact number** — one source of truth.

---

## 7. Backend changes

### 7.1 Data model (migrations)

- **`users`** (drivers): `razorpay_linked_account_id` (string, nullable), `payout_account_status` (enum: `none|pending|verified|rejected`), `payout_bank_last4`, `payout_upi`, `payout_verified_at`.
- **`payments`** (or the existing payment/order table): ensure it stores `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`, `status` (`PENDING|CAPTURED|FAILED|REFUNDED|PARTIALLY_REFUNDED`), `amount_paise`, `commission_paise`, `driver_transfer_id`, `transfer_status`, `idempotency_key`.
- **`held_earnings`** (new): `driver_id`, `trip_id`, `amount`, `status` (`held|released|reversed`), `released_at`. For rides completed before KYC.
- **`ledger_entries`** (new, append-only): every money movement (capture, transfer, retained commission, refund, reversal, held, release) as an immutable row for reconciliation. `type`, `direction`, `amount_paise`, `party` (customer/driver/operator), `trip_id`, `razorpay_ref`, `created_at`. **No updates, no deletes.**

### 7.2 New / reworked services

- **`PayoutAccountService`** (new): create/refresh a driver's Razorpay linked account from PAN + bank/UPI; poll/receive verification status; expose `isVerified(driver)`.
- **`PaymentSplitService`** (new): given a trip + fare + commission, build the Route `transfers[]` payload (driver linked account vs. operator retained). If driver unverified → route the driver's share to `held_earnings` instead of a live transfer.
- **`AutoRefundService`** (new): implements §5. Input = a cancellation/settlement event; output = refund amount + optional transfer reversal, executed via `RazorpayService`. Writes to `ledger_entries`. Disputes are excluded (stay in the manual register).
- **`HeldEarningsService`** (new): park a driver's share, and on KYC-verified, release all held rows via Route transfers.
- **`RazorpayService`** (extend): add `createLinkedAccount()`, `createTransfer()`, `reverseTransfer()`, `fetchTransfer()`, `fetchLinkedAccount()`. It already has orders, refunds, signature + webhook verification, order/refund fetch.
- **`CommissionSettlementService`** (rewrite): stop debiting the driver wallet. Instead compute the split and hand it to `PaymentSplitService` at capture time. Keep the subscription-override logic — it's good.
- **`PaymentModeService`** (delete or reduce to a no-op returning `['RAZORPAY']`): with cash gone there's no rulebook left.
- **`RefundRegisterService`** (reduce): keep it for **disputes only** (manual, human-decided). Auto-refunds are recorded in `ledger_entries` and shown as a monitor.

### 7.3 Controllers / endpoints

- **`PaymentsController`** (rework into the shared engine):
  - `POST /payments/order` — create a Razorpay order for **any** ride type (Private/Fixed/Shuttle), amount = fare (+ optional fee). Idempotent per booking.
  - `POST /payments/verify` — verify signature, mark `CAPTURED`, trigger `PaymentSplitService` (live transfer or held), write ledger.
  - `POST /payments/webhook` — the **source of truth**. Handle `payment.captured`, `payment.failed`, `refund.processed`, `refund.failed`, `transfer.processed`, `transfer.failed`, `account.activated` (linked account verified → release held earnings). Idempotent on Razorpay event id.
  - **Remove** `payCash`.
- **`DriverPayoutController`** (new): `GET/PATCH /me/driver/payout-account` (PAN + bank/UPI), `GET /me/driver/held-earnings`.
- **Fixed/Shuttle controllers**: repoint their order-creation at the shared `/payments/order` engine; delete the parallel Razorpay-only code paths (`createSeatHoldRazorpayOrder`, `ShuttleBookingService::createRazorpayOrder`, etc.). Seat-hold state machine stays; only the money call changes.
- **Admin:** `GET /admin/payouts/monitor` (auto-paid/pending/failed), `GET /admin/ledger`, keep `GET /admin/refunds` but scope it to disputes.

### 7.4 Webhook & sweeper hardening

- The webhook is authoritative; the client `verify` call is a fast-path only. Every state must be reachable from the webhook alone (customer closes the app mid-payment).
- Keep the scheduled **`ReconcilePendingPayments`** sweeper: for any `PENDING` order older than N minutes, `fetchOrder` / `fetchOrderPayments` and settle. Extend it to also reconcile **stuck transfers** and **stuck refunds**.
- **Idempotency everywhere:** dedupe on Razorpay event id + our idempotency key so a replayed webhook or a double client-verify never double-transfers or double-refunds.

---

## 8. Driver app (Ionic) changes

- **Signup:** add skippable KYC step + the skip warning (§3).
- **Repurpose `payment-methods.page.ts` → Payout account page:** form for PAN + bank/UPI, calls `PATCH /me/driver/payout-account`, shows verification status.
- **Held earnings banner:** "₹X waiting — add your bank details to collect it," visible until verified.
- **Remove** all cash UI and the cash/Razorpay toggle.
- **Earnings screen:** show per-ride *net* (after commission) since the split is now at source.

---

## 9. Admin app (Angular) changes

- **`driver-approval-actions.pane.ts`:** add "Payout account verified" to the approval checklist.
- **`drivers-payouts.tab.ts`:** downgrade from manual worklist to a **status monitor** (auto-paid / pending / failed, with the Razorpay transfer reference).
- **Refunds view:** becomes a monitor for auto-refunds + a manual queue for **disputes only**.
- **City Settings:** surface commission config clearly (it already exists) and label it as "also the cancellation fee."
- **New: Ledger / reconciliation view** reading `/admin/ledger` — the single source of truth for "where did every rupee go."

---

## 10. Build order (phased, de-risked)

Ship the core on **Private only**, prove it, then roll Fixed & Shuttle onto the same engine.

1. **Phase 1 — Payout accounts + KYC** (backend `PayoutAccountService`, driver app page + signup step, admin checklist). ~1.5–2 wks.
2. **Phase 2 — Shared payment engine + auto-split + prepay-at-booking (Private first)** (`PaymentsController` rework, `PaymentSplitService`, `RazorpayService` transfers, ledger). ~2–3 wks.
3. **Phase 3 — Auto-refund rulebook + transfer reversal + held-earnings release** (`AutoRefundService`, `HeldEarningsService`). ~1–1.5 wks.
4. **Phase 4 — Kill cash + rebuild admin payout/refund views into monitors.** ~1 wk.
5. **Phase 5 — Roll Fixed & Shuttle onto the shared engine; ledger/reconciliation hardening.** ~1 wk.
6. **Phase 6 — Full test pass (see §11), Razorpay run-throughs, UAT.** ~1.5–2 wks.

**Total ~7–10 weeks solo; ~5–7 weeks with two devs** splitting backend/frontend. Razorpay Route activation and per-driver KYC turnaround run in parallel and are outside coding time.

---

## 11. End-to-end test plan (success, failure, every edge case)

This is money code — the test matrix is the deliverable, not an afterthought. Use Razorpay **test mode** (test keys, test VPAs/cards) for automated + manual runs, then a small **live** smoke set with real ₹1 transfers before go-live.

### 11.1 Test layers

- **Unit** — split math, commission/cancel-fee math, rulebook decisions, idempotency keys.
- **Integration** — controller → service → DB → (mocked Razorpay) with a `RazorpayService` fake that can be scripted to succeed/fail/delay and to fire webhooks.
- **Webhook simulation** — POST signed and *unsigned* webhook bodies; replay, reorder, and duplicate events.
- **End-to-end (staging)** — real Razorpay test mode across all three ride types on device/emulator.
- **Reconciliation** — after each scenario, assert the `ledger_entries` sum to zero imbalance (customer paid = driver + operator + refunded + held).

### 11.2 Payment — success paths

| # | Scenario | Expected |
|---|---|---|
| P1 | Private prepay, driver verified | Order → captured → split ₹90/₹10 → driver transfer created → ledger balanced |
| P2 | Fixed seat prepay, driver verified | Same split, per-seat commission snapshot honored |
| P3 | Shuttle prepay, driver verified | Same split |
| P4 | Driver **unverified** at completion | Driver share → `held_earnings` (status `held`), operator keeps commission, no live transfer |
| P5 | Customer closes app after paying (no client verify) | **Webhook alone** captures + splits — state identical to P1 |
| P6 | Optional Razorpay fee passed to customer | Customer charged fare+fee; split still ₹90/₹10 of the **fare**; fee reconciled |
| P7 | Subscription override (0% commission) | Driver gets full fare, operator gets ₹0, split reflects it |
| P8 | Flat fixed commission (₹ not %) | Split uses flat amount; never exceeds fare |

### 11.3 Payment — failure paths

| # | Scenario | Expected |
|---|---|---|
| F1 | Card/UPI declined | Order `FAILED`, **no money moved**, booking not confirmed, seat released, customer told |
| F2 | Customer abandons at checkout | Order stays `PENDING`, sweeper closes it, seat released, no charge |
| F3 | Payment captured but **transfer to driver fails** | Payment stands; transfer retried; if still failing → parked as held + admin alert; customer **not** affected |
| F4 | Razorpay signature mismatch on verify | Reject, `FAILED`, no state change |
| F5 | Tampered/unsigned webhook | Rejected by signature check, ignored |
| F6 | Duplicate webhook (same event id) | Processed **once**; no double transfer/refund (idempotency) |
| F7 | Out-of-order webhooks (`captured` after `refunded`) | Final state consistent; late event doesn't resurrect a refunded payment |
| F8 | Razorpay/network down at order creation | Graceful error, booking not confirmed, retryable, no phantom charge |
| F9 | Double client-verify (user taps twice) | One capture, one split |

### 11.4 Refund / cancellation — the rulebook (§5)

| # | Scenario | Expected |
|---|---|---|
| R1 | No driver found | Full auto refund; if any transfer existed, reversed; ledger balanced |
| R2 | Driver cancels | Full auto refund; driver transfer reversed |
| R3 | Operator cancels | Full auto refund |
| R4 | Customer cancels before pickup | Refund = fare − commission (cancel fee); operator keeps the fee; driver share reversed |
| R5 | Customer cancels after driver arrived/started | **No refund**; split stands |
| R6 | Fixed/Shuttle seat released in time | Full auto refund; seat returns to inventory |
| R7 | Fixed/Shuttle no-show / too-late | No refund |
| R8 | Overcharge/dispute | **Not automatic** — lands in manual dispute queue |
| R9 | Refund on a still-held (unverified driver) ride | Reverse the held amount, not a live transfer |
| R10 | Partial refund then reconcile | Amounts correct; `PARTIALLY_REFUNDED`; ledger balanced |
| R11 | Refund webhook `refund.failed` | Marked failed, retried, admin alerted, customer not left in limbo |
| R12 | Double-cancel race (customer + operator same instant) | One refund only (locking/idempotency) |

### 11.5 KYC / held-earnings edge cases

| # | Scenario | Expected |
|---|---|---|
| K1 | Skip KYC at signup, take rides, then verify | All held earnings auto-release via transfers on `account.activated`; banner clears |
| K2 | KYC rejected by Razorpay | Status `rejected`, driver prompted to fix, earnings stay held (not lost) |
| K3 | Verify mid-trip | Earnings from that point split live; prior held ones released |
| K4 | Held earnings + a refund on one of those rides | Refund reverses the held row, not a phantom transfer |
| K5 | Driver never verifies | Earnings remain held indefinitely, visible, never silently dropped |

### 11.6 Concurrency / integrity

| # | Scenario | Expected |
|---|---|---|
| C1 | Two customers grab the last Fixed seat, both pay | One confirmed, other auto-refunded; no oversell |
| C2 | Webhook + sweeper settle the same order simultaneously | Settled once (row lock / idempotency) |
| C3 | Reconciliation invariant | For every trip: `customer_paid = driver_received + operator_kept + refunded + held` (assert in a nightly job + test) |
| C4 | Currency/paise rounding | No rupee lost/created across split + refund; totals reconcile to the paise |

### 11.7 Go-live gate

- All P/F/R/K/C scenarios green in test mode.
- Live smoke: one real ₹1 ride per type, real split to a real test-driver bank, one real ₹1 refund with reversal — all reconcile.
- Razorpay Route activated; webhook endpoint verified in the Razorpay dashboard.

---

## 12. Open items to confirm before Phase 2

- Does the customer bear the Razorpay fee, or does the operator absorb it? (Affects §6 line item only.)
- Settlement timing for driver transfers — Razorpay default schedule, or on-demand? (Affects "when driver sees money," not the design.)
- Minimum KYC fields Razorpay Route requires for your business category (confirm with Razorpay during activation).
