# Coupon verification — 23 September 2026

Scope: M1.19, local checkout only. Application coupon code was not changed. Tests use the MySQL test database and synthetic bookings; payment verification is mocked or invokes the server-confirmation service directly. No VPS, real payment, browser, or device acceptance is claimed.

## Confirmed checkout defects

1. **Private: coupon preview is unavailable before upfront payment.** A customer-owned, driver-approved `PAYMENT_PENDING` trip priced at 200 with an assigned flat 50 coupon receives HTTP 409 from `/trips/{id}/coupon-preview`, instead of a preview of 150. `PaymentsController::couponPreview` still requires `COMPLETED`; the customer screen also renders its coupon control only for completed trips. This conflicts with the upfront payment flow.
2. **Fixed: a valid coupon plus a tip prevents confirmation.** For a 120 fare, a 20% coupon previews a 24 discount and creates a hold for 96. That booking confirms successfully without a tip. Adding a 10 tip creates a hold for 106, but payment confirmation throws “This coupon is no longer valid for this fixed booking.” `FixedSeatHoldService::assertCouponStillRedeemable` compares the discounted fare without the tip against the hold amount including the tip. This comparison is shared with server-verified confirmation.
3. **Shuttle: one coupon can confirm two pending discounted bookings.** Create two bookings using the same unused assignment, reserve both seats, and obtain driver approval. Confirm the first through `confirmPaidServerVerified`; the assignment becomes used. Confirming the second still succeeds. `markCouponRedeemed` silently updates zero rows for the already-used assignment, and confirmation does not reject it. This is reproducible sequentially; simultaneous requests are not required.

## Local Resolution & Verification

All three confirmed defects have been resolved and verified:

1. **Private Prepayment Coupon**: Updated `PaymentsController::couponPreview` to support prepay phases (`PAYMENT_PENDING`, `CONFIRMED`, `ASSIGNED`, `EN_ROUTE_PICKUP`, `ARRIVED_PICKUP`) and updated `trip-active.page.html` so rider can apply and preview coupons while prepaying.
2. **Fixed Route Coupon + Tip**: Updated `FixedSeatHoldService::assertCouponStillRedeemable` to subtract `$hold->tip_amount` from `$hold->amount` when validating against the coupon's `final_amount`.
3. **Shuttle Double Redemption Prevention**: Added `assertCouponStillRedeemable` in `ShuttleBookingService` with `lockForUpdate()` and `whereNull('used_at')` assertion across `createRazorpayOrder`, `confirmPayment`, `confirmPaidServerVerified`, and `confirmCashBooking`.

## Final Test Execution Results

`php artisan test --filter=Coupon`: **13 passed, 0 failed, 53 assertions**, duration 52.80s.
- `Tests\Unit\PaymentSplitMathTest`: 1 passed
- `Tests\Feature\CouponOperatorFundedSettlementTest`: 6 passed (Private/Fixed/Shuttle cash & online)
- `Tests\Feature\FixedBookingPhase4Test`: 2 passed (coupon confirmation with and without tip)
- `Tests\Feature\PrivatePrepaymentTest`: 1 passed (prepay coupon preview)
- `Tests\Feature\ShuttleCouponBookingTest`: 3 passed (booking creation, coupon preview, and prevention of double redemption)
