<?php

namespace App\Http\Controllers;

use App\Models\Payment;
use App\Models\Trip;
use App\Services\InvoiceGeneratorService;
use App\Services\RazorpayService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class PaymentsController extends Controller
{
    public function payUpi(Request $request, Trip $trip, RazorpayService $razorpayService)
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

        $amountPaise = (int) round(((float) $trip->final_fare) * 100);
        $receipt = 'trip_' . $trip->id . '_' . now()->format('YmdHis');

        return DB::transaction(function () use ($trip, $amountPaise, $receipt, $razorpayService) {
            $payment = Payment::query()->where('trip_id', $trip->id)->first();
            if ($payment && $payment->status === 'SUCCESS') {
                return response()->json(['payment' => $payment]);
            }

            $payment = Payment::query()->updateOrCreate(
                ['trip_id' => $trip->id],
                [
                    'method' => 'UPI',
                    'provider' => 'RAZORPAY',
                    'status' => 'PENDING',
                    'amount' => (float) $trip->final_fare,
                    'currency' => 'INR',
                    'paid_at' => null,
                    'razorpay_payment_id' => null,
                    'razorpay_order_id' => null,
                    'provider_response' => null,
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

    public function verifyUpi(Request $request, Trip $trip, RazorpayService $razorpayService)
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

            try {
                app(InvoiceGeneratorService::class)->generateForTrip($trip);
            } catch (\Throwable) {
                // Invoice generation is best-effort; webhook will retry.
            }

            return response()->json(['payment' => $payment]);
        });
    }

    public function payCash(Request $request, Trip $trip)
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

        $payment = Payment::query()->updateOrCreate(
            ['trip_id' => $trip->id],
            [
                'method' => 'CASH',
                'provider' => 'NONE',
                'status' => 'SUCCESS',
                'amount' => (float) $trip->final_fare,
                'currency' => 'INR',
                'paid_at' => now(),
            ]
        );

        return response()->json(['payment' => $payment]);
    }

    public function payQr(Request $request, Trip $trip)
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

        $payment = Payment::query()->updateOrCreate(
            ['trip_id' => $trip->id],
            [
                'method' => 'QR',
                'provider' => 'NONE',
                'status' => 'SUCCESS',
                'amount' => (float) $trip->final_fare,
                'currency' => 'INR',
                'paid_at' => now(),
            ]
        );

        return response()->json(['payment' => $payment]);
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

        // Generate invoice on successful payment (best-effort).
        if ($captured) {
            try {
                $trip = $payment->trip()->first();
                if ($trip) {
                    app(InvoiceGeneratorService::class)->generateForTrip($trip);
                }
            } catch (\Throwable) {
                // Avoid failing webhook; invoice can be generated later via API.
            }
        }

        return response()->json(['ok' => true]);
    }
}

