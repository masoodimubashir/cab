# Payment Automation — Current Model (cash revived)

_Single-page reference for how money moves. This supersedes the earlier
"cash is killed / cashless" stance: **cash is back**, as a hybrid upfront-deposit
mode. See [`PAYMENT_OPTIONS_TRACKER.md`](../PAYMENT_OPTIONS_TRACKER.md) for the
module-by-module build log._

## Payment methods (operator-controlled)

Methods are decided by **operator switches** (Operator Settings → Payments), not
per-city arrays:

| Switch | Rail | Notes |
|--------|------|-------|
| Online | `razorpay` | Card / netbanking / UPI via Razorpay checkout |
| GPay | `razorpay` | Same Razorpay order, opens the UPI intent (`prefill.method: upi`) |
| Cash | `cash` | Hybrid upfront deposit — see below |

The enforceable server vocabulary is two rails: `razorpay` and `cash`. "Online vs
GPay" is purely which app opens for the same Razorpay order — the customer modal
reads the two switches directly. At least one method must always stay enabled.

## Cash — hybrid deposit (Model B)

A cash ride collects a **percentage deposit online at booking** (one global
`cash_deposit_percent` in the operator Payments tab); the driver collects the
**balance in cash** at trip end. `CashDepositService` owns the arithmetic
(`deposit + balance === fare`, rupee-rounded).

Settlement (locked):

- The online **deposit settles WHOLLY to the driver** — it is their prepaid fare.
- The operator's **commission is debited from the driver's wallet** at completion
  (`CommissionSettlementService`), never retained from the deposit.
- This is what makes the Wallet Debt Engine + go-online block fire on cash rides.

Ledger invariant per trip: `captured(online) = driver_net + operator_net + refunded`.
Since only the deposit is online and it all goes to the driver, a completed cash
trip reconciles to `captured = driver_net`, `operator_net = 0` (commission moved
through the wallet, off the trip ledger). The physical cash balance never flows
through the engine.

## Commission source

Commission no longer lives on City Settings:

- **Private / Shuttle** — the vehicle rate card (`pricing_rules`: `commission_type`,
  `commission_percent` / `fixed_commission`).
- **Fixed** — the route's own `fare_config` (in-form percent/fixed toggle; each
  route self-describing).

## Settlement mode

Prepayments use `settlement_mode = 'booking'` (`Payment::SETTLE_BOOKING`): the
capture is mirrored onto the shared engine at booking and the split settles at
trip completion (Fixed/Shuttle per seat/passenger; Private + Shuttle solo via the
`settle()` path, since shuttle trips carry no `route_departure_id`).

## Refunds

- **Online (razorpay) cancellations** — auto-refunded via `AutoRefundService` per
  the §5 rulebook (full refund when it isn't the customer's fault; fare − commission
  cancel-fee when the customer cancels before pickup; nothing after arrival).
- **Cash cancellations** — the **online deposit** is auto-refunded (the only money
  that went online). The cash **balance** was never collected here, so nothing is
  returned for it; a physical-cash dispute is a **manual** matter in the refund
  register (`RefundRegisterService`, `method: cash`).
- **Admin refund register** — labels cash rows as a deposit refund, shows the cash
  balance for context, and locks the mark-refunded amount to the deposit.

## Refund-ledger reconciliation (fixed)

A cancel/refund path used to leave the trip ledger short by the operator's share.
Root cause: `AutoRefundService::recordUnsettledCapture` guarded on the capture
ledger row, so when a prepaid booking recorded its CAPTURE at confirmation
(immediate-capture, for admin visibility) but never split, the guard fired and the
operator's RETAINED share was never booked — the refund then had nothing to net
against.

Fix:

- On a **refund**, or a **Shuttle no-show forfeit**, `recordUnsettledCapture` guards
  on `payments.split_at` and books the operator's retained even when the capture
  row exists. For a refund it's reversed out to the customer; for a Shuttle no-show
  it stays as the operator's forfeit.
- A **Fixed no-show forfeit** keeps the capture-guard: the departure still completes
  and settles the fare to the driver by the normal split, so the fare is not
  pre-booked to the operator. Selected by a `forfeitToOperator` flag threaded through
  `refundForBooking` / `refundBookingCancellation` (Shuttle `true`, Fixed `false`).

The whole payment suite is green against `cab_test`.

## Live testing (blocked)

End-to-end Razorpay test-mode run-through (one ride per type × each enabled method)
requires **Razorpay Route** to be activated on the account — the driver-payout /
fare-split engine can't run without it. Blocked pending Route enablement.
