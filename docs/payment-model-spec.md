# DreamCabs — Payment Model Specification (Model B)

**Status:** Client-confirmed (meeting notes folded in). One item pending client choice — see §5.3.
**Scope:** Private, Fixed, Shuttle.
**Source:** Client confirmations, consolidated and reconciled against the current codebase.

> **Timeline & cost:** Estimated delivery **7–10 working days** from sign-off. **Additional cost for this scope: ₹3,000.**

---

## 1. Payment Flow Model — **Model B (finalised)**

- The **operator collects all payments** (online in full; the online deposit on cash rides).
- **Driver settlement is manual**, handled by the operator (see §7).
- Razorpay **Route is not used** in Model B.

---

## 2. Payment Methods (all ride types)

Three ways to pay, on Private, Fixed, and Shuttle:

1. **GPay in the app**
2. **Full amount online** (Razorpay)
3. **Cash** — a configurable **deposit paid online upfront**, the **rest paid in cash** to the driver at the ride.

---

## 3. Common Rules (all ride types)

| Rule | Decision |
|---|---|
| **Online deposit %** | **Configurable from Admin**, **one global** operator setting (applies to all ride types). |
| **Commission** | **No change.** Existing system stays — percentage-based **or** fixed amount per vehicle. |
| **Tips** | **OFF for now.** Admin must have an **enable/disable toggle**. Distribution rules to be defined when enabled. |
| **Tolls** | **OFF / inactive** until the client defines toll rules. Excluded from all end-of-ride extras for now. |
| **Coupons / discounts** | **Entire discount cost borne by the operator.** |

---

## 4. Payment Gateway Charges (per ride type)

The gateway fee is money coming **in** (≈2% Razorpay takes when the customer pays). Who bears it differs by ride type:

| Ride | Who bears the gateway fee | Notes |
|---|---|---|
| **Fixed** | **Customer** | Checkout must display: **Ride Fare + Payment Gateway Charge + Final Total**. |
| **Private** | **Operator** | — |
| **Shuttle** | **Operator** | — |

---

## 5. Cancellation & Refund Rules

### 5.1 Cash booking (e.g. 20% online + 80% cash)

- On customer cancellation, the **online deposit is non-refundable** (kept by the operator).
- ⚠️ **Change from current build:** today a cash booking auto-refunds the online deposit on a pre-pickup cancel. This must change to **forfeit the deposit**.

### 5.2 Fully online booking — 3-stage refund (Private & Shuttle)

Keyed on **driver progress toward the customer**:

| Stage | Refund | Deduction |
|---|---|---|
| Vehicle has **not left base** | **80%** | 20% |
| Vehicle has **started moving** toward customer | **50%** | 50% |
| Vehicle **reached** customer & customer cancels | **0%** (treated as no-show) | 100% |

- Percentages and the stage boundaries are **configurable**.
- ⚠️ **New work:** today's system is binary (before-arrival = fare − commission; after-arrival = 0). The **middle 50% tier** and the **percentage-based** deductions are new.

### 5.3 Fixed cancellation — **PENDING CLIENT CHOICE (two options)**

**Option 1 — What we have today (all-or-nothing):**

| When the customer cancels | Refund |
|---|---|
| Before the bus reaches their boarding stop | **100%** |
| After the bus reaches their stop, or once boarded | **0%** |

**Option 2 — Proposed 3-stage** (keyed on **time before scheduled departure**):

| When the customer cancels | Refund | Deduction |
|---|---|---|
| Well before departure (e.g. > 30 min) | **80%** | 20% |
| Close to departure (e.g. within 30 min) | **50%** | 50% |
| After departure / didn't board | **0%** | 100% |

*Client to confirm Option 1 or Option 2.*

### 5.4 No-show

- **No-show amount remains with the operator** — for **all ride types**.
- Driver settlement for no-show amounts is handled **manually**.
- ⚠️ **Change from current build:** today **Fixed** no-show settles to the **driver**, and **Private** no-show is a **per-minute fee**. Both change to **operator keeps the amount**.

---

## 6. Cash Handling & Wallet

- **Cash collected from the customer stays with the driver.** Existing reconciliation logic applies.
- **Wallet system stays.** It tracks what the driver owes / is owed.
- **Keep wallet transaction records** (every amount that piles up), **visible to both driver and admin**.
- Only the **Razorpay Route** settlement flavour of wallet logic is dropped — the wallet itself remains.

---

## 7. Model B Settlement

| Item | Decision |
|---|---|
| **Payout frequency** | **Manual**, typically processed **daily**. No fixed automated schedule. |
| **Payout / transfer charges** | **Not applicable.** No Route / no in-app payout gateway. Settlement done **outside the app** (GPay, HDFC, manual). |
| **Net settlement** | Calculate **amount owed by driver** and **amount owed by company**, **net them off**, settle the difference. **Keep records of both amounts AND the net**, visible to driver + admin. |
| **Cash exposure limit** | **Configurable from Admin.** Existing limit-based system is acceptable. |

---

## 8. Driver Finance Screens (required)

Built as **views on the wallet records**:

- Pending Payout Balance screen
- Settlement History screen
- Settlement Reconciliation screen
- Driver Ledger / Transaction History

**Not required:** Razorpay Route settlement driver-wallet logic.

---

## 9. Billing / Fare Logic

| Ride | Fare logic |
|---|---|
| **Fixed** | **Locked price**, fixed at booking, **never changes**. No end-of-ride charges. Existing implementation kept as-is. |
| **Private** | Prepaid, **re-metered at completion (GPS)** — the difference is paid by the customer at ride end. **Toll excluded** for now. |
| **Shuttle** | **Base seat price locked** at booking. **All existing fare fields kept.** If the ride crosses **time/distance thresholds**, the extra charge is calculated for the vehicle and **split by the number of passengers** (each pays an equal share). Divisor = passengers actually on board. |

---

## 10. Rollout Scope

All rules apply to **Private, Fixed, Shuttle** — **except** the payment-gateway-fee bearer, which differs per ride type (§4).

---

## 11. New Work Summary (for estimation)

Items that do **not** exist today and need building:

1. **Cash deposit forfeit** on cancel (reverse current auto-refund of the deposit) — §5.1
2. **3-stage online cancellation** (new 50% tier + configurable percentages) — §5.2 / §5.3
3. **No-show → operator** for Fixed and Private (behaviour change) — §5.4
4. **Per-ride gateway-fee bearer** + **Fixed checkout breakdown** display — §4
5. **Tips admin enable/disable toggle** — §3
6. **Configurable cash-exposure limit** (Admin) — §7
7. **Net-settlement calculation** (owed-by-driver / owed-by-company / net, with records) — §7
8. **Four driver finance screens** (wallet-record views) — §8 *(the largest item)*
9. **Shuttle shared-extra split** by passenger count — §9

---

## 12. Open Items / Pending Client

- **§5.3 — Fixed cancellation:** Option 1 (current all-or-nothing) vs Option 2 (proposed 3-stage by departure time). Both to be sent to the client.
- **Toll rules** — deferred until the client defines them.
- **Tip distribution rules** — deferred until Tips are enabled.
