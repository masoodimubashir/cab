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

    /**
     * Phases the customer may pay in BEFORE the ride runs. The fare is agreed at
     * CONFIRMED, so that's the earliest point there's an amount to charge.
     */
    private const PREPAY_STATUSES = ['CONFIRMED', 'ASSIGNED', 'EN_ROUTE_PICKUP', 'ARRIVED_PICKUP'];

    public function payRazorpay(Request $request, Trip $trip, RazorpayService $razorpayService, CouponService $couponService, PaymentModeService $paymentModeService)
    {
        $user = $request->user();
        if ($trip->customer_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        // Under the automatic model the customer pays up front, as soon as the
        // fare is agreed — the ride is prepaid, not billed afterwards. The
        // post-completion charge stays available for the balance when the final
        // fare came in above the estimate (waiting time, tolls, a changed route),
        // and remains the ONLY path while the engine is off.
        $prepay = $this->prepaymentsEnabled() && in_array($trip->status, self::PREPAY_STATUSES, true);

        if (!$prepay && $trip->status !== 'COMPLETED') {
            return response()->json([
                'message' => $this->prepaymentsEnabled()
                    ? 'This trip is not ready for payment yet.'
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

        // The gateway's cut rides on top of the fare, so the customer covers it
        // and commission stays whole. Zero while the fee is switched off.
        $gatewayFees = app(GatewayFeeService::class);
        $methodGroup = $gatewayFees->isKnownMethod($data['payment_method'] ?? null)
            ? (string) $data['payment_method']
            : null;
        $gatewayFeeAmount = $gatewayFees->feeFor($payableAmount, $methodGroup);
        $chargeAmount = round($payableAmount + $gatewayFeeAmount, 2);

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

        return DB::transaction(function () use ($trip, $amountPaise, $payableAmount, $chargeAmount, $gatewayFeeAmount, $methodGroup, $couponAssignmentId, $discountAmount, $receipt, $razorpayService, $prepay) {
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
                'gateway_fee_amount' => $gatewayFeeAmount > 0 ? $gatewayFeeAmount : null,
                'payment_method_group' => $methodGroup,
                'currency' => 'INR',
                'paid_at' => null,
                'razorpay_payment_id' => null,
                'razorpay_order_id' => null,
                'provider_response' => null,
                'coupon_assignment_id' => $couponAssignmentId,
                'discount_amount' => $discountAmount,
                // Every online payment on a private ride settles through the
                // booking engine once the engine is on — a prepayment because the
                // ride hasn't happened yet, and a post-ride balance because it is
                // the SECOND capture against ONE fare and must be divided against
                // what the prepayment already took, not against the whole fare
                // again. Null keeps the legacy split-at-capture path.
                'settlement_mode' => $this->prepaymentsEnabled() ? Payment::SETTLE_BOOKING : null,
            ];

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

            return response()->json([
                'payment' => $payment,
                'prepaid' => $prepay,
                // What the customer is about to be charged, itemised — the app
                // shows this as the fare with a "Payment fee" line beneath it.
                'breakdown' => [
                    'fare' => $payableAmount,
                    'gateway_fee' => $gatewayFeeAmount,
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

    /** Is the customer expected to pay up front on a private ride? */
    private function prepaymentsEnabled(): bool
    {
        return (bool) config('services.payments.split_enabled', false);
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
            $trip->city_id,
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
        if ($payment->status === 'SUCCESS') {
            return response()->json(['payment' => $payment]);
        }

        $valid = $razorpayService->verifyPaymentSignature(
            $data['razorpay_order_id'],
            $data['razorpay_payment_id'],
            $data['razorpay_signature']
        );

        if (!$valid) {
            $payment->status = 'FAILED';
            $payment->save();
            Log::warning('DreamCabs Razorpay payment signature invalid', [
                'trip_id' => $trip->id,
                'razorpay_order_id' => $data['razorpay_order_id'],
                'razorpay_payment_id' => $data['razorpay_payment_id'],
            ]);
            return response()->json(['message' => 'Invalid payment signature.'], 400);
        }

        return DB::transaction(function () use ($payment, $data, $trip) {
            $payment->razorpay_payment_id = $data['razorpay_payment_id'];
            $payment->status = 'SUCCESS';
            $payment->paid_at = now();
            $payment->save();

            $this->markCouponRedeemed($payment, $trip);

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
            $payment = Payment::query()->updateOrCreate(
                ['trip_id' => $trip->id],
                [
                    'method' => 'CASH',
                    'provider' => 'NONE',
                    'status' => 'SUCCESS',
                    'amount' => $payableAmount,
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

