<?php

namespace App\Http\Controllers;

use App\Models\Payment;
use App\Models\Trip;
use App\Services\CouponService;
use App\Services\InvoiceGeneratorService;
use App\Services\PaymentModeService;
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

    public function payRazorpay(Request $request, Trip $trip, RazorpayService $razorpayService, CouponService $couponService, PaymentModeService $paymentModeService)
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
        if (!in_array('razorpay', $paymentModeService->allowedForTrip($trip), true)) {
            return response()->json(['message' => 'Online payment is not available for this trip.'], 422);
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

        $amountPaise = (int) round($payableAmount * 100);
        if ($amountPaise <= 0) {
            return response()->json(['message' => 'Payable amount must be greater than zero.'], 422);
        }
        $receipt = 'trip_' . $trip->id . '_' . now()->format('YmdHis');

        return DB::transaction(function () use ($trip, $amountPaise, $payableAmount, $couponAssignmentId, $discountAmount, $receipt, $razorpayService) {
            $payment = Payment::query()->where('trip_id', $trip->id)->first();
            if ($payment && $payment->status === 'SUCCESS') {
                return response()->json(['payment' => $payment]);
            }

            $payment = Payment::query()->updateOrCreate(
                ['trip_id' => $trip->id],
                [
                    'method' => 'RAZORPAY',
                    'provider' => 'RAZORPAY',
                    'status' => 'PENDING',
                    'amount' => $payableAmount,
                    'currency' => 'INR',
                    'paid_at' => null,
                    'razorpay_payment_id' => null,
                    'razorpay_order_id' => null,
                    'provider_response' => null,
                    'coupon_assignment_id' => $couponAssignmentId,
                    'discount_amount' => $discountAmount,
                ]
            );

            $order = $razorpayService->createOrder($amountPaise, $receipt);
            $payment->razorpay_order_id = $order['order_id'];
            $payment->save();

            return response()->json([
                'payment' => $payment,
                'razorpay' => [
                    'key_id' => env('RAZORPAY_KEY_ID'),
                    'order_id' => $order['order_id'],
                    'amount_paise' => $order['amount'],
                    'currency' => $order['currency'],
                ],
            ]);
        });
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

        $payment = Payment::query()->where('trip_id', $trip->id)->first();
        if (!$payment) {
            return response()->json(['message' => 'Payment record not found.'], 404);
        }
        if ($payment->razorpay_order_id !== $data['razorpay_order_id']) {
            return response()->json(['message' => 'Order ID mismatch.'], 409);
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

            try {
                app(InvoiceGeneratorService::class)->generateForTrip($trip);
            } catch (\Throwable) {
                // Invoice generation is best-effort; webhook will retry.
            }

            return response()->json(['payment' => $payment]);
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

    public function razorpayWebhook(Request $request, RazorpayService $razorpayService)
    {
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

        $entity = $payload['payload']['payment']['entity'] ?? null;
        if (!$entity || !is_array($entity)) {
            return response()->json(['message' => 'Webhook missing payment entity.'], 400);
        }

        $razorpayPaymentId = $entity['id'] ?? null;
        $razorpayOrderId = $entity['order_id'] ?? null;
        $status = $entity['status'] ?? null;

        if (!$razorpayPaymentId || !$razorpayOrderId) {
            return response()->json(['message' => 'Webhook missing IDs.'], 400);
        }

        $payment = Payment::query()
            ->where('razorpay_payment_id', $razorpayPaymentId)
            ->orWhere('razorpay_order_id', $razorpayOrderId)
            ->first();

        if (!$payment) {
            return response()->json(['message' => 'Payment record not found.'], 404);
        }

        $captured = in_array($status, ['captured', 'success', 'paid'], true);
        $payment->razorpay_payment_id = $razorpayPaymentId;
        $payment->razorpay_order_id = $razorpayOrderId;
        $payment->provider_response = $payload;
        $payment->status = $captured ? 'SUCCESS' : 'FAILED';
        $payment->paid_at = $captured ? now() : null;
        $payment->save();

        Log::info('DreamCabs Razorpay webhook processed', [
            'razorpay_payment_id' => $razorpayPaymentId,
            'razorpay_order_id' => $razorpayOrderId,
            'captured' => $captured,
            'status' => $status,
        ]);

        // Generate invoice on successful payment (best-effort) + burn coupon.
        if ($captured) {
            try {
                $trip = $payment->trip()->first();
                if ($trip) {
                    $this->markCouponRedeemed($payment, $trip);
                    app(InvoiceGeneratorService::class)->generateForTrip($trip);
                }
            } catch (\Throwable) {
                // Avoid failing webhook; invoice can be generated later via API.
            }
        }

        return response()->json(['ok' => true]);
    }
}

