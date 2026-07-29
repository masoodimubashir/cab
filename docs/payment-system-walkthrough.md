# Payment System — Plain English Walkthrough

## The Common Plumbing (used by all 3 ride types)

**Razorpay is the only gateway.** Since `PAYMENTS_SPLIT_ENABLED=true`, cash is basically dead — everything goes online through Razorpay.

**Auto-capture is ON.** The moment the customer pays, money is grabbed from their card/UPI — not just "held." No 2-step authorize→capture dance.

**Signatures always checked.** Both the front-end callback and the webhook are verified with your secret before any money is trusted.

**Webhooks are idempotent.** If Razorpay fires the same event 3 times (network hiccup), you don't get charged/refunded 3 times — matched by `razorpay_payment_id` + row lock.

**A sweeper runs periodically.** If a payment sits PENDING for 15 min, `ReconcilePendingPayments` asks Razorpay "hey what happened?" and fixes state.

**Gateway fee (new).** OFF by default. When ON, adds ~2% (UPI) or 3% (Amex/international) + 18% GST on top of fare. Fee stays with operator; driver's share ignores it.

**Driver payouts = AUTO via Razorpay Route.** With split ON, driver's share is transferred directly to their linked bank account. If driver's payout account isn't verified yet, share parks in HeldEarning and auto-releases on verification. Manual only for cash-ride commissions or repeated transfer failures.

---

## FIXED RIDES (your first release)

**Booking = seat hold → pay → confirm.** Customer picks seats, holds them for 5 minutes, pays Razorpay, seats become BOOKED. If they don't pay in 5 min, seats free up.

**Fare math.** `seat_fare × seat_count + luggage_surcharge × extra_bags`. Example: 3 seats × ₹250 + 1 extra bag × ₹50 = ₹800.

**Commission is frozen at booking time.** The commission % (say 15%) is snapshotted onto that seat row. Later fare changes don't retroactively change it.

**Subscription overrides commission.** If driver has an active plan with 10%, that beats the vehicle's 15%.

**When money moves to driver.** Only after trip is COMPLETED. Split ON: Razorpay Route transfers driver's share directly. Split OFF: driver's wallet gets credited.

**If Route transfer fails** (driver's Razorpay linked account not verified yet), money parks in `HeldEarning` — nobody loses it, just waits.

**Refunds (cancellation).** Before cutoff: full refund (minus commission). No-show: ₹0 refund, operator keeps it.

**No-show has a 2-min floor.** Driver can't hit "no-show" until 2 min after pickup time — enforced server-side. Prevents itchy-trigger no-shows.

**Refund flow (B5 register).** Razorpay refund API is called automatically first. If it succeeds, booking is marked REFUNDED (customer's bank credited in 5-7 days). If Razorpay API fails, row falls to APPROVED in the manual register — operator sees it in `/admin/refunds` and GPays customer manually. Wallet refunds are instant/auto.

**Refund notifications.** Customer gets a dedicated push for every refund path: "Refund credited" for wallet, "Refund sent (5-7 days)" for razorpay auto success, "Refund is being processed" when the fallback register is used. Admins get an informational ping on auto success and a loud "Refund needs manual action" push when the auto attempt fails.

---

## PRIVATE RIDES

**Two payment moments — you can pay before OR after the ride.** Prepay (safer for operator), or Post-completion (customer just pays when done). Same endpoint handles both.

**Fare = estimated → final.** Booking uses `estimated_fare`; after ride, `final_fare` (may differ due to route/waiting).

**If prepay was higher than final** → excess is auto-refunded to customer before the split runs. Example: prepaid ₹500, actual ₹420, ₹80 comes back.

**If prepay was lower than final** → customer pays the balance at the end via another Razorpay charge. Settled immediately since trip is already done.

**Commission** is estimated up front (so cancellation fees are known) then recomputed on `final_fare` at completion. Toll is NEVER commissionable.

**Refund rules.** Driver/operator cancels = full refund. Customer cancels before pickup = fare minus commission (customer pays the "wasted trip" fee). Customer cancels after driver arrived = ₹0.

**Cash mode exists** as `payCash()` for post-ride manual marking, but with split ON it's essentially unused.

**Wallet + subscription** work the same as Fixed — subscription % beats city %, wallet gets credited only if split is OFF.

---

## SHUTTLE RIDES

**Books like Fixed** — one seat per passenger on a scheduled journey, upfront Razorpay order, auto-capture on payment.

**Commission is currently 0%.** Code has the plumbing (per-seat snapshot ready), but shuttle commission isn't turned on yet — driver gets 100% of fare.

**Payout & refunds mirror Fixed.** Split ON → Route transfer full fare (or HeldEarning). Split OFF → full fare into driver wallet.

**Refund path** uses a dedicated `ShuttleRefundService` following the same "full if before cutoff, zero if no-show" pattern; manual payout via B5 register.

---

## Edge Cases That Apply Across All 3

**Same payment webhook fires twice** → 2nd one is ignored (idempotency via `razorpay_payment_id` uniqueness + row lock).

**Customer's card was charged but webhook never arrived** → sweeper cronjob pulls state from Razorpay after 15 min and reconciles.

**Driver's Route linked account not verified** → their earnings go into `HeldEarning` (money is safe, not lost). Once verified, operator can release.

**Currency is hardcoded INR** — no multi-currency, matches your Kashmir-only scope.

**Failed refund** (Razorpay API down) → marked `FAILED`, operator retries manually from the refund register.

**Wallet top-up** is its own Razorpay order — customer pays ₹500, wallet gets ₹500 credited when webhook confirms.

**Driver wallet is NOT an earnings account** — it's a prepaid float for paying subscriptions/commission. Ride earnings appear as WalletTransaction credits only when split is OFF.

---

## Quick Reference — Money Flow in One Line Each

| Scenario | What happens |
|---|---|
| Customer pays Fixed ₹800 (15% comm) | Razorpay captures ₹800 → split: driver gets ₹680 to Route (or wallet), operator keeps ₹120 |
| Customer cancels Fixed before cutoff | Refund initiated on Razorpay API → recorded in B5 register → operator manually GPays customer |
| Customer no-shows Fixed | ₹0 refund; full ₹800 kept by operator (driver still gets their share on completion) |
| Private prepay ₹500, final ₹420 | ₹80 auto-refunded first, then remaining ₹420 split |
| Private prepay ₹500, final ₹580 | Customer pays ₹80 balance at end via 2nd Razorpay charge |
| Shuttle ₹200 seat | Full ₹200 to driver (no commission yet), operator keeps ₹0 from fare |
| Driver has active ₹99 plan (10% commission) | Overrides vehicle's 15%; only 10% deducted |
| Toll = ₹50 in a ₹500 Private ride | Commission calculated on ₹450, not ₹500 |
| Payment webhook fires 3 times | Only first one processes; other 2 are no-ops |

The system is solid on Fixed (your launch target). Private has the most complex path due to prepay+balance combos. Shuttle is Fixed-lite with commission disabled.
