<?php

namespace App\Http\Controllers;

use App\Models\Payment;
use App\Models\Trip;
use App\Services\CouponService;
use App\Services\GatewayFeeService;
use App\Services\InvoiceGeneratorService;
use App\Services\PaymentModeService;
use App\Services\PaymentReconciliationService;
use App\Services\RazorpayService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class PaymentsController extends Controller
{
    /**
     * Validate a typed coupon against this trip and return the discount it
     * would apply to `final_fare`. Read-only — does not mark the coupon used.
     */
    public function couponPreview(Request $request, Trip $trip, CouponService $couponService)
    {
        $user = $request->user();
        if ($trip->customer_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }
        if ($trip->status !== 'COMPLETED') {
            return response()->json(['message' => 'Trip must be completed before applying a coupon.'], 409);
        }
        if ($trip->final_fare === null || (float) $trip->final_fare <= 0) {
            return response()->json(['message' => 'Final fare not available.'], 422);
        }

        $data = $request->validate([
            'coupon_title' => ['required', 'string', 'max:128'],
        ]);

        $result = $couponService->resolveForUser(
            code: $data['coupon_title'],
            userId: (int) $user->id,
            cityId: (int) $trip->city_id,
            baseAmount: (float) $trip->final_fare,
            cityVehicleTypeId: $trip->city_vehicle_type_id ? (int) $trip->city_vehicle_type_id : null,
            pickupLat: $trip->pickup_lat !== null ? (float) $trip->pickup_lat : null,
            pickupLng: $trip->pickup_lng !== null ? (float) $trip->pickup_lng : null,
            dropLat: $trip->drop_lat !== null ? (float) $trip->drop_lat : null,
            dropLng: $trip->drop_lng !== null ? (float) $trip->drop_lng : null,
        );

        if (!$result['ok']) {
            return response()->json(['error' => $result['error']], 200);
        }

        return response()->json([
            'discount' => $result['discount'],
            'final_amount' => $result['final_amount'],
            'coupon' => [
                'assignment_id' => (int) $result['assignment']->id,
                'title' => (string) $result['assignment']->coupon->title,
            ],
        ]);
    }

    /** Approved phases in which upfront payment is allowed. */
    private const PREPAY_STATUSES = ['PAYMENT_PENDING', 'CONFIRMED', 'ASSIGNED', 'EN_ROUTE_PICKUP', 'ARRIVED_PICKUP'];

    public function payRazorpay(Request $request, Trip $trip, RazorpayService $razorpayService, CouponService $couponService, PaymentModeService $paymentModeService)
    {
        $user = $request->user();
        if ($trip->customer_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        // Driver approval unlocks payment. Later fare increases remain payable at completion.
        if (\App\Models\ShuttleJourney::query()->where('trip_id', $trip->id)->exists()) {
            return response()->json(['message' => 'Pay through your shuttle seat booking.'], 409);
        }
        $prepay = $trip->driver_id && in_array($trip->status, self::PREPAY_STATUSES, true);

        if (!$prepay && $trip->status !== 'COMPLETED') {
            return response()->json([
                'message' => $this->prepaymentsEnabled()
                    ? 'Driver approval is required before payment.'
                    : 'Trip must be completed before payment.',
            ], 409);
        }

        // Prepay charges the agreed fare; after the ride it's the final fare.
        $quotedFare = $prepay
            ? (float) ($trip->final_fare ?? $trip->estimated_fare ?? 0)
            : (float) ($trip->final_fare ?? 0);

        if ($quotedFare <= 0) {
            return response()->json(['message' => 'Final fare not available.'], 422);
        }

        // Server-side guard: only accept a method the city + driver actually
        // allow (same rule the customer screen shows). Never trust the client.
        if (!in_array('razorpay', $paymentModeService->allowedForTrip($trip), true)) {
            return response()->json(['message' => 'Online payment is not available for this trip.'], 422);
        }

        $data = $request->validate([
            'coupon_title' => ['nullable', 'string', 'max:128'],
            // Which method the customer picked in our app. Razorpay fixes an
            // order's amount before checkout opens, so the fee — which differs
            // by method — has to be known here, not at the payment screen.
            'payment_method' => ['nullable', 'string', 'max:32'],
        ]);

        $couponAssignmentId = null;
        $discountAmount = null;
        $payableAmount = $quotedFare;

        if (!empty($data['coupon_title'])) {
            $result = $couponService->resolveForUser(
                code: $data['coupon_title'],
                userId: (int) $user->id,
                cityId: (int) $trip->city_id,
                baseAmount: $quotedFare,
                cityVehicleTypeId: $trip->city_vehicle_type_id ? (int) $trip->city_vehicle_type_id : null,
                pickupLat: $trip->pickup_lat !== null ? (float) $trip->pickup_lat : null,
                pickupLng: $trip->pickup_lng !== null ? (float) $trip->pickup_lng : null,
                dropLat: $trip->drop_lat !== null ? (float) $trip->drop_lat : null,
                dropLng: $trip->drop_lng !== null ? (float) $trip->drop_lng : null,
            );
            if (!$result['ok']) {
                return response()->json(['message' => $result['error']], 422);
            }
            $couponAssignmentId = (int) $result['assignment']->id;
            $discountAmount = (float) $result['discount'];
            $payableAmount = (float) $result['final_amount'];
        }

        // Anything already captured against this trip comes off what's owed, so
        // the post-ride call bills only the shortfall over the prepayment.
        // Fare only — the gateway fee on an earlier capture paid Razorpay, not
        // the ride, so it must not count against what's still owed on the fare.
        $alreadyPaid = (float) Payment::query()
            ->where('trip_id', $trip->id)
            ->whereIn('status', ['SUCCESS', 'REFUNDED'])
            ->sum(DB::raw('amount - COALESCE(gateway_fee_amount, 0)'));
        $payableAmount = round($payableAmount - $alreadyPaid, 2);

        // Who bears the gateway fee depends on the ride mode. This endpoint pays
        // PRIVATE trips, where the OPERATOR bears it: the rider pays only the fare
        // and the fee is booked against the operator at settlement. (Fixed's
        // rider-pays flow lives in its own booking path.) Zero while the fee is off.
        $gatewayFees = app(GatewayFeeService::class);
        $methodGroup = $gatewayFees->isKnownMethod($data['payment_method'] ?? null)
            ? (string) $data['payment_method']
            : null;
        $operatorBearsFee = $gatewayFees->operatorBears('private');
        // Operator-borne uses the default rate (the rider isn't picking a
        // fee-bearing method); customer-borne uses the method they chose.
        $feeAmount = $gatewayFees->feeFor($payableAmount, $operatorBearsFee ? null : $methodGroup);
        $customerFeeAmount = $operatorBearsFee ? 0.0 : $feeAmount;
        $operatorFeeAmount = $operatorBearsFee ? $feeAmount : 0.0;
        $chargeAmount = round($payableAmount + $customerFeeAmount, 2);

        $amountPaise = (int) round($chargeAmount * 100);
        if ($amountPaise <= 0) {
            return response()->json([
                'message' => $alreadyPaid > 0
                    ? 'This trip is already paid in full.'
                    : 'Payable amount must be greater than zero.',
                'already_paid' => $alreadyPaid,
            ], $alreadyPaid > 0 ? 200 : 422);
        }

        $receipt = 'trip_' . $trip->id . '_' . now()->format('YmdHis');

        return DB::transaction(function () use ($trip, $amountPaise, $payableAmount, $chargeAmount, $customerFeeAmount, $operatorFeeAmount, $methodGroup, $couponAssignmentId, $discountAmount, $receipt, $razorpayService, $prepay, $alreadyPaid) {
            $trip = Trip::query()->lockForUpdate()->findOrFail($trip->id);
            abort_unless(($trip->driver_id && in_array($trip->status, self::PREPAY_STATUSES, true)) || $trip->status === 'COMPLETED', 409, 'Trip is no longer payable.');
            $currentPaid = (float) Payment::query()->where('trip_id', $trip->id)->whereIn('status', ['SUCCESS', 'REFUNDED'])
                ->sum(DB::raw('amount - COALESCE(gateway_fee_amount, 0)'));
            abort_unless(round($currentPaid, 2) === round($alreadyPaid, 2), 409, 'Payment changed. Refresh before paying again.');
            // Reuse an abandoned checkout for this trip rather than piling up
            // rows; a settled payment is never touched (there may now be several
            // per trip: the prepayment plus a balance).
            $payment = Payment::query()
                ->where('trip_id', $trip->id)
                ->where('status', 'PENDING')
                ->latest('id')
                ->first();

            $attributes = [
                'trip_id' => $trip->id,
                'method' => 'RAZORPAY',
                'provider' => 'RAZORPAY',
                'status' => 'PENDING',
                // What the customer is charged — fare plus the gateway's cut.
                // The fare inside it is amount − gateway_fee_amount, which is
                // what the split runs on.
                'amount' => $chargeAmount,
                'gateway_fee_amount' => $customerFeeAmount > 0 ? $customerFeeAmount : null,
                'operator_gateway_fee_amount' => $operatorFeeAmount > 0 ? $operatorFeeAmount : null,
                'payment_method_group' => $methodGroup,
                'currency' => 'INR',
                'paid_at' => null,
                'razorpay_payment_id' => null,
                'razorpay_order_id' => null,
                'provider_response' => null,
                'coupon_assignment_id' => $couponAssignmentId,
                'discount_amount' => $discountAmount,
                // Upfront payments wait for completion before settlement.
                'settlement_mode' => $prepay ? Payment::SETTLE_BOOKING : null,
            ];

            if ($payment && $payment->razorpay_order_id) {
                abort_unless($payment->method === 'RAZORPAY' && (float) $payment->amount === $chargeAmount
                    && $payment->payment_method_group === $methodGroup && $payment->coupon_assignment_id == $couponAssignmentId,
                    409, 'An existing payment checkout must be completed before changing payment details.');
                return response()->json(['payment' => $payment, 'prepaid' => (bool) $prepay, 'razorpay' => [
                    'key_id' => env('RAZORPAY_KEY_ID'), 'order_id' => $payment->razorpay_order_id,
                    'amount_paise' => $amountPaise, 'currency' => $payment->currency, 'method' => $methodGroup,
                ]]);
            }
            if ($payment) {
                $payment->forceFill($attributes)->save();
            } else {
                $payment = Payment::query()->create($attributes);
            }

            if ($prepay) {
                // Cancel fees are the commission "from the moment of booking", so
                // the rulebook needs the figure now — long before the completion
                // settlement would normally work it out.
                $this->stampExpectedCommission($trip, $payableAmount);
            }

            $order = $razorpayService->createOrder($amountPaise, $receipt);
            $payment->razorpay_order_id = $order['order_id'];
            $payment->save();

            if ($prepay && $trip->payment_method !== 'razorpay') {
                $trip->forceFill(['payment_method' => 'razorpay'])->save();
            }

            return response()->json([
                'payment' => $payment,
                'prepaid' => $prepay,
                // What the customer is about to be charged, itemised — the app
                // shows this as the fare with a "Payment fee" line beneath it.
                'breakdown' => [
                    'fare' => $payableAmount,
                    'gateway_fee' => $customerFeeAmount,
                    'total' => $chargeAmount,
                    'payment_method' => $methodGroup,
                ],
                'razorpay' => [
                    'key_id' => env('RAZORPAY_KEY_ID'),
                    'order_id' => $order['order_id'],
                    'amount_paise' => $order['amount'],
                    'currency' => $order['currency'],
                    // Checkout is locked to the method the fee was priced for —
                    // switching at the payment screen would charge the wrong fee.
                    'method' => $methodGroup,
                ],
            ]);
        });
    }

    /**
     * GET /payments/methods — the payment methods a customer may choose from,
     * with the fee each attracts. Optionally pass ?fare= to get the exact rupee
     * fee and total per method, which is what the chooser renders.
     *
     * With the fee switched off every method costs nothing extra and the app can
     * skip the chooser entirely.
     */
    public function paymentMethods(Request $request, GatewayFeeService $gatewayFees)
    {
        $data = $request->validate([
            'fare' => ['nullable', 'numeric', 'min:0', 'max:1000000'],
        ]);
        $fare = isset($data['fare']) ? (float) $data['fare'] : null;

        $methods = array_map(function (array $method) use ($gatewayFees, $fare) {
            if ($fare !== null) {
                $method['fee'] = $gatewayFees->feeFor($fare, $method['key']);
                $method['total'] = $gatewayFees->totalFor($fare, $method['key']);
            }

            return $method;
        }, $gatewayFees->methods());

        return response()->json([
            'fee_enabled' => $gatewayFees->enabled(),
            'fare' => $fare,
            'methods' => $methods,
        ]);
    }

    /**
     * Approved private bookings require online payment (or the cash deposit)
     * before confirmation. Settlement still occurs when the ride completes.
     */
    private function prepaymentsEnabled(): bool
    {
        return true;
    }

    /**
     * Works out the operator's cut on the agreed fare and stamps it on the trip
     * at prepay time. Two things need it before the ride ends: the cancellation
     * fee (§5 — the commission, chargeable from the moment of booking) and the
     * split at completion. Never overwrites a figure settlement already wrote.
     */
    private function stampExpectedCommission(Trip $trip, float $fare): void
    {
        if ($trip->commission_amount !== null) {
            return;
        }

        $subPercent = app(\App\Services\SubscriptionService::class)
            ->effectiveCommissionPercentForTrip($trip, -1.0);

        $commission = app(\App\Services\CommissionSettlementService::class)->commissionForFare(
            $trip->city_vehicle_type_id,
            $fare,
            (float) ($trip->toll_amount ?? 0),
            $subPercent,
        );

        $trip->forceFill([
            'commission_percent' => $commission['percent'],
            'commission_amount' => $commission['amount'],
        ])->save();
    }

    public function verifyRazorpay(Request $request, Trip $trip, RazorpayService $razorpayService)
    {
        $user = $request->user();
        if ($trip->customer_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $data = $request->validate([
            'razorpay_payment_id' => 'required|string',
            'razorpay_order_id' => 'required|string',
            'razorpay_signature' => 'required|string',
        ]);

        // Match on the order, not the trip: a prepaid ride can carry a second
        // payment for the balance, so "the trip's payment" is no longer unique.
        $payment = Payment::query()
            ->where('trip_id', $trip->id)
            ->where('razorpay_order_id', $data['razorpay_order_id'])
            ->latest('id')
            ->first();

        if (!$payment) {
            $exists = Payment::query()->where('trip_id', $trip->id)->exists();

            return response()->json([
                'message' => $exists ? 'Order ID mismatch.' : 'Payment record not found.',
            ], $exists ? 409 : 404);
        }
        if (in_array($payment->status, ['SUCCESS', 'REFUNDED'], true)) {
            return response()->json(['payment' => $payment]);
        }

        $valid = $razorpayService->verifyPaymentSignature(
            $data['razorpay_order_id'],
            $data['razorpay_payment_id'],
            $data['razorpay_signature']
        );

        if (!$valid) {
            Payment::query()->whereKey($payment->id)->where('status', 'PENDING')->update(['status' => 'FAILED']);
            Log::warning('DreamCabs Razorpay payment signature invalid', [
                'trip_id' => $trip->id,
                'razorpay_order_id' => $data['razorpay_order_id'],
                'razorpay_payment_id' => $data['razorpay_payment_id'],
            ]);
            return response()->json(['message' => 'Invalid payment signature.'], 400);
        }

        return DB::transaction(function () use ($payment, $data, $trip) {
            $payment = Payment::query()->lockForUpdate()->findOrFail($payment->id);
            if (in_array($payment->status, ['SUCCESS', 'REFUNDED'], true)) {
                return response()->json(['payment' => $payment]);
            }
            $payment->razorpay_payment_id = $data['razorpay_payment_id'];
            $payment->status = 'SUCCESS';
            $payment->paid_at = now();
            $payment->save();

            $this->markCouponRedeemed($payment, $trip);

            app(\App\Services\BookingConfirmationService::class)->confirmIfReady($trip);

            // Auto-split at source (Route): driver share transferred/held,
            // operator keeps commission. Idempotent + no-op while disabled, and
            // a no-op for a prepayment — that one settles at completion instead.
            app(\App\Services\PaymentSplitService::class)->applyCapturedSplit($payment);

            // A balance paid AFTER the ride has nothing left to wait for, so it
            // settles immediately. Idempotent, and skips anything already split.
            if ($trip->status === 'COMPLETED') {
                app(\App\Services\BookingPaymentService::class)->settleTrip($trip);
            }

            try {
                app(InvoiceGeneratorService::class)->generateForTrip($trip);
            } catch (\Throwable) {
                // Invoice generation is best-effort; webhook will retry.
            }

            return response()->json(['payment' => $payment->fresh()]);
        });
    }

    public function payCash(Request $request, Trip $trip, CouponService $couponService, PaymentModeService $paymentModeService)
    {
        $user = $request->user();
        if ($trip->customer_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        if ($trip->status !== 'COMPLETED') {
            return response()->json(['message' => 'Trip must be completed before payment.'], 409);
        }

        if ($trip->final_fare === null || (float) $trip->final_fare <= 0) {
            return response()->json(['message' => 'Final fare not available.'], 422);
        }

        // Server-side guard: only accept a method the city + driver actually
        // allow (same rule the customer screen shows). Never trust the client.
        if (!in_array('cash', $paymentModeService->allowedForTrip($trip), true)) {
            return response()->json(['message' => 'Cash is not available for this trip.'], 422);
        }

        $data = $request->validate([
            'coupon_title' => ['nullable', 'string', 'max:128'],
        ]);

        $couponAssignmentId = null;
        $discountAmount = null;
        $payableAmount = (float) $trip->final_fare;

        if (!empty($data['coupon_title'])) {
            $result = $couponService->resolveForUser(
                code: $data['coupon_title'],
                userId: (int) $user->id,
                cityId: (int) $trip->city_id,
                baseAmount: (float) $trip->final_fare,
                cityVehicleTypeId: $trip->city_vehicle_type_id ? (int) $trip->city_vehicle_type_id : null,
                pickupLat: $trip->pickup_lat !== null ? (float) $trip->pickup_lat : null,
                pickupLng: $trip->pickup_lng !== null ? (float) $trip->pickup_lng : null,
                dropLat: $trip->drop_lat !== null ? (float) $trip->drop_lat : null,
                dropLng: $trip->drop_lng !== null ? (float) $trip->drop_lng : null,
            );
            if (!$result['ok']) {
                return response()->json(['message' => $result['error']], 422);
            }
            $couponAssignmentId = (int) $result['assignment']->id;
            $discountAmount = (float) $result['discount'];
            $payableAmount = (float) $result['final_amount'];
        }

        return DB::transaction(function () use ($trip, $payableAmount, $couponAssignmentId, $discountAmount) {
            Trip::query()->whereKey($trip->id)->lockForUpdate()->firstOrFail();
            $onlinePaid = Payment::query()->where('trip_id', $trip->id)->where('status', 'SUCCESS')
                ->where('provider', 'RAZORPAY')->get()
                ->sum(fn ($p) => max(0, (float) $p->amount - (float) $p->gateway_fee_amount));
            $payment = Payment::query()->updateOrCreate(
                ['trip_id' => $trip->id, 'method' => 'CASH', 'provider' => 'NONE'],
                [
                    'method' => 'CASH',
                    'provider' => 'NONE',
                    'status' => 'SUCCESS',
                    'amount' => max(0, round($payableAmount - $onlinePaid, 2)),
                    'currency' => 'INR',
                    'paid_at' => now(),
                    'coupon_assignment_id' => $couponAssignmentId,
                    'discount_amount' => $discountAmount,
                ]
            );

            $this->markCouponRedeemed($payment, $trip);

            return response()->json(['payment' => $payment]);
        });
    }

    /**
     * Cash hybrid deposit (Private): the customer pays an upfront deposit online
     * at booking and hands the rest to the driver in cash at trip end. The
     * deposit is a real Razorpay charge that settles WHOLLY to the driver at
     * completion (the operator's commission is taken from the driver's wallet,
     * not from this money). A 0% operator deposit means nothing is charged online.
     */
    public function payCashDeposit(Request $request, Trip $trip, RazorpayService $razorpayService, PaymentModeService $paymentModeService)
    {
        $user = $request->user();
        if ($trip->customer_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        // The deposit is collected up front, as soon as the fare is agreed.
        if (!$trip->driver_id || !in_array($trip->status, self::PREPAY_STATUSES, true)
            || \App\Models\ShuttleJourney::query()->where('trip_id', $trip->id)->exists()) {
            return response()->json(['message' => 'This trip is not ready for a deposit yet.'], 409);
        }

        // Server-side guard: cash must actually be an offered method.
        if (!in_array('cash', $paymentModeService->allowedForTrip($trip), true)) {
            return response()->json(['message' => 'Cash is not available for this trip.'], 422);
        }

        return DB::transaction(function () use ($trip, $razorpayService) {
            $trip = Trip::query()->lockForUpdate()->findOrFail($trip->id);
            abort_unless($trip->driver_id && in_array($trip->status, self::PREPAY_STATUSES, true), 409, 'Trip is no longer payable.');
            $fare = (float) ($trip->final_fare ?? $trip->estimated_fare ?? 0);
            if ($fare <= 0) {
                return response()->json(['message' => 'Fare not available yet.'], 422);
            }

            $quote = app(\App\Services\CashDepositService::class)->quote($fare);
            $deposit = $quote['deposit'];
            $balance = $quote['balance'];

            $captured = (float) Payment::query()->where('trip_id', $trip->id)->where('status', 'SUCCESS')
                ->sum(DB::raw('amount - COALESCE(gateway_fee_amount, 0)'));
            $depositPaid = Payment::query()->where('trip_id', $trip->id)->where('status', 'SUCCESS')
                ->where('method', 'CASH')->whereNotNull('cash_deposit_amount')->exists();
            if ($depositPaid || ($captured >= $deposit && $captured > 0)) {
                app(\App\Services\BookingConfirmationService::class)->confirmIfReady($trip);
                return response()->json(['deposit_required' => false, 'cash_balance_due' => max(0, $fare - $captured)]);
            }
            if (Payment::query()->where('trip_id', $trip->id)->where('status', 'PENDING')
                ->where('method', '!=', 'CASH')->whereNotNull('razorpay_order_id')->exists()) {
                return response()->json(['message' => 'Complete the existing online checkout before changing payment method.'], 409);
            }

            // Mark the trip as cash so completion settles it as cash (commission from
            // the wallet, deposit wholly to the driver).
            if (strtolower((string) $trip->payment_method) !== 'cash') {
                $trip->forceFill(['payment_method' => 'cash'])->save();
            }

            // A 0% operator deposit means nothing is collected online — pure cash ride.
            if ($deposit <= 0) {
                app(\App\Services\BookingConfirmationService::class)->confirmIfReady($trip);
                return response()->json([
                    'deposit_required' => false,
                    'cash_balance_due' => $balance,
                    'message' => 'No upfront deposit — pay the driver in cash at trip end.',
                ]);
            }

            $amountPaise = (int) round($deposit * 100);
            $receipt = 'trip_' . $trip->id . '_dep_' . now()->format('YmdHis');

            // Reuse an abandoned deposit checkout for this trip rather than piling
            // up rows; a settled deposit is never touched.
            $payment = Payment::query()
                ->where('trip_id', $trip->id)
                ->where('status', 'PENDING')
                ->whereNotNull('cash_deposit_amount')
                ->latest('id')
                ->first();

            if ($payment && $payment->razorpay_order_id) {
                return response()->json(['payment' => $payment, 'deposit_required' => true,
                    'breakdown' => ['fare' => $fare, 'deposit' => (float) $payment->amount, 'cash_balance_due' => (float) $payment->cash_balance_due],
                    'razorpay' => ['key_id' => env('RAZORPAY_KEY_ID'), 'order_id' => $payment->razorpay_order_id,
                        'amount_paise' => (int) round((float) $payment->amount * 100), 'currency' => $payment->currency],
                ]);
            }

            // Private cash: the operator bears the gateway fee on the deposit. It's
            // recorded on the payment for the operator's net-settlement; it is NOT a
            // trip-ledger entry (the deposit is wholly the driver's).
            $gatewayFees = app(\App\Services\GatewayFeeService::class);
            $operatorFee = $gatewayFees->operatorBears('private') ? $gatewayFees->feeFor($deposit) : 0.0;

            $attributes = [
                'trip_id' => $trip->id,
                'method' => 'CASH',
                'provider' => 'RAZORPAY',
                'status' => 'PENDING',
                'amount' => $deposit,
                'cash_deposit_amount' => $deposit,
                'cash_balance_due' => $balance,
                'operator_gateway_fee_amount' => $operatorFee > 0 ? $operatorFee : null,
                'currency' => 'INR',
                'paid_at' => null,
                'razorpay_payment_id' => null,
                'razorpay_order_id' => null,
                'provider_response' => null,
                // Settles at completion (deposit → driver), like any booking prepay.
                'settlement_mode' => $this->prepaymentsEnabled() ? Payment::SETTLE_BOOKING : null,
            ];

            if ($payment) {
                $payment->forceFill($attributes)->save();
            } else {
                $payment = Payment::query()->create($attributes);
            }

            // Cancel fee = commission from the moment of booking (§5 rulebook),
            // computed on the whole fare since that is what the wallet is charged.
            $this->stampExpectedCommission($trip, $fare);

            $order = $razorpayService->createOrder($amountPaise, $receipt);
            $payment->razorpay_order_id = $order['order_id'];
            $payment->save();

            return response()->json([
                'payment' => $payment,
                'deposit_required' => true,
                'breakdown' => [
                    'fare' => $fare,
                    'deposit' => $deposit,
                    'cash_balance_due' => $balance,
                ],
                'razorpay' => [
                    'key_id' => env('RAZORPAY_KEY_ID'),
                    'order_id' => $order['order_id'],
                    'amount_paise' => $order['amount'],
                    'currency' => $order['currency'],
                ],
            ]);
        });
    }

    /**
     * Burn the coupon assignment linked to a successful Payment: stamps
     * used_at + redeemed_trip_id so the same coupon can't be reused.
     * Best-effort and idempotent — re-calling with an already-used assignment
     * is a no-op.
     */
    private function markCouponRedeemed(Payment $payment, Trip $trip): void
    {
        if (!$payment->coupon_assignment_id) {
            return;
        }
        \App\Models\CouponAssignment::query()
            ->where('id', $payment->coupon_assignment_id)
            ->whereNull('used_at')
            ->update([
                'used_at' => now(),
                'redeemed_trip_id' => $trip->id,
            ]);
    }

    /**
     * B1 — Razorpay's server-to-server callback. Signature-verified against
     * RAZORPAY_WEBHOOK_SECRET (fail-closed while blank), then delegated to
     * PaymentReconciliationService which owns all four payment flows (solo,
     * fixed, shuttle, wallet top-up) plus refund settlement.
     *
     * Unmatched events return 200 on purpose: Razorpay disables webhooks that
     * keep failing, and the scheduled sweeper re-checks anything we missed.
     */
    public function razorpayWebhook(
        Request $request,
        RazorpayService $razorpayService,
        PaymentReconciliationService $reconciler,
        \App\Services\PayoutReconciliationService $payouts,
    ) {
        $signature = (string) $request->header('X-Razorpay-Signature', '');
        $body = $request->getContent();

        $valid = $razorpayService->verifyWebhookSignature($body, $signature);
        if (!$valid) {
            Log::warning('DreamCabs Razorpay webhook signature invalid', []);
            return response()->json(['message' => 'Invalid webhook signature.'], 400);
        }

        $payload = json_decode($body, true);
        if (!is_array($payload)) {
            return response()->json(['message' => 'Invalid webhook payload.'], 400);
        }

        $event = (string) ($payload['event'] ?? '');

        // Refund lifecycle: flips APPROVED → REFUNDED (or logs the failure).
        if (in_array($event, ['refund.processed', 'refund.failed'], true)) {
            $refund = $payload['payload']['refund']['entity'] ?? null;
            if (!is_array($refund) || empty($refund['id'])) {
                return response()->json(['message' => 'Webhook missing refund entity.'], 400);
            }

            $result = $reconciler->applyRefund(
                (string) $refund['id'],
                (string) ($refund['payment_id'] ?? ''),
                (int) ($refund['amount'] ?? 0),
                $event === 'refund.processed',
            );

            Log::info('DreamCabs Razorpay refund webhook processed', [
                'event' => $event,
                'refund_id' => $refund['id'],
            ] + $result);

            return response()->json(['ok' => true] + $result);
        }

        // Route transfer lifecycle: the driver's share either landed or bounced.
        // A bounce re-queues their money for payout — it never disappears.
        if (in_array($event, ['transfer.processed', 'transfer.failed'], true)) {
            $transfer = $payload['payload']['transfer']['entity'] ?? null;
            if (!is_array($transfer) || empty($transfer['id'])) {
                return response()->json(['message' => 'Webhook missing transfer entity.'], 400);
            }

            $result = $payouts->applyTransfer(
                (string) $transfer['id'],
                $event === 'transfer.processed',
                $transfer['error']['description'] ?? ($transfer['failure_reason'] ?? null),
            );

            Log::info('DreamCabs Razorpay transfer webhook processed', [
                'event' => $event,
                'transfer_id' => $transfer['id'],
            ] + $result);

            return response()->json(['ok' => true] + $result);
        }

        // Linked-account lifecycle: activation is what lets us pay a driver at
        // all, so it also releases whatever they had parked waiting for it.
        if (str_starts_with($event, 'account.')) {
            $account = $payload['payload']['account']['entity'] ?? null;
            if (!is_array($account) || empty($account['id'])) {
                return response()->json(['message' => 'Webhook missing account entity.'], 400);
            }

            // Prefer the entity's own status; fall back to the event name
            // ("account.activated" → "activated") when Razorpay omits it.
            $status = (string) ($account['status'] ?? substr($event, strlen('account.')));

            $result = $payouts->applyLinkedAccount((string) $account['id'], $status);

            Log::info('DreamCabs Razorpay linked-account webhook processed', [
                'event' => $event,
                'account_id' => $account['id'],
                'status' => $status,
            ] + $result);

            return response()->json(['ok' => true] + $result);
        }

        // Payment lifecycle (also covers legacy payloads with no event name).
        $entity = $payload['payload']['payment']['entity'] ?? null;
        if (!$entity || !is_array($entity)) {
            // Some other event type we don't handle — acknowledge and move on.
            Log::info('DreamCabs Razorpay webhook ignored (unhandled event)', ['event' => $event]);
            return response()->json(['ok' => true, 'ignored' => true]);
        }

        $razorpayPaymentId = (string) ($entity['id'] ?? '');
        $razorpayOrderId = $entity['order_id'] ?? null;
        $status = (string) ($entity['status'] ?? '');

        if ($razorpayPaymentId === '') {
            return response()->json(['message' => 'Webhook missing payment id.'], 400);
        }

        $captured = $event === 'payment.captured'
            || ($event === '' && in_array($status, ['captured', 'success', 'paid'], true));

        $result = $reconciler->applyPayment(
            $razorpayPaymentId,
            $razorpayOrderId ? (string) $razorpayOrderId : null,
            $captured,
            $payload,
            'webhook',
        );

        Log::info('DreamCabs Razorpay webhook processed', [
            'event' => $event,
            'razorpay_payment_id' => $razorpayPaymentId,
            'razorpay_order_id' => $razorpayOrderId,
            'captured' => $captured,
            'status' => $status,
        ] + $result);

        return response()->json(['ok' => true] + $result);
    }
}
