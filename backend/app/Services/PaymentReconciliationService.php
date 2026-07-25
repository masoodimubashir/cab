<?php

namespace App\Services;

use App\Exceptions\ReservationException;
use App\Models\CouponAssignment;
use App\Models\FixedSeatHold;
use App\Models\Payment;
use App\Models\SeatReservation;
use App\Models\ShuttlePassengerBooking;
use App\Models\WalletTopup;
use App\Models\WalletTransaction;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * B1 — single brain for "Razorpay says X happened to this payment; make our
 * database agree". Fed from two directions:
 *
 *   1. The Razorpay webhook (payment.captured / payment.failed /
 *      refund.processed / refund.failed) via PaymentsController.
 *   2. The scheduled sweeper (payments:reconcile-pending) that asks the
 *      Razorpay Orders API about anything still PENDING after 15 minutes —
 *      the safety net for lost webhooks.
 *
 * A Razorpay order belongs to exactly one of four flows, each with its own
 * table: solo-ride `payments`, fixed `fixed_seat_holds`, shuttle
 * `shuttle_passenger_bookings`, driver `wallet_topups`. This service finds
 * the owner and applies the same success path the in-app verify endpoint
 * would have taken. Every path is idempotent (status guards + row locks), so
 * webhook, sweeper, and app verify can race safely.
 */
class PaymentReconciliationService
{
    public function __construct(
        private readonly RazorpayService $razorpay,
        private readonly FixedSeatHoldService $fixedHolds,
        private readonly ShuttleBookingService $shuttleBookings,
        private readonly WalletService $wallet,
    ) {}

    /* ------------------------------------------------------------------ */
    /* Payment events (captured / failed)                                  */
    /* ------------------------------------------------------------------ */

    /**
     * Applies a payment outcome to whichever record owns the order.
     *
     * @return array{matched:?string,action:string}
     */
    public function applyPayment(string $razorpayPaymentId, ?string $razorpayOrderId, bool $captured, ?array $rawPayload = null, string $source = 'webhook'): array
    {
        // 1) Solo ride payment
        $payment = Payment::query()
            ->where('razorpay_payment_id', $razorpayPaymentId)
            ->when($razorpayOrderId, fn ($q) => $q->orWhere('razorpay_order_id', $razorpayOrderId))
            ->first();
        if ($payment) {
            return ['matched' => 'solo', 'action' => $this->applySolo($payment, $razorpayPaymentId, $razorpayOrderId, $captured, $rawPayload)];
        }

        // 2) Driver wallet top-up
        $topup = WalletTopup::query()
            ->where('razorpay_payment_id', $razorpayPaymentId)
            ->when($razorpayOrderId, fn ($q) => $q->orWhere('razorpay_order_id', $razorpayOrderId))
            ->first();
        if ($topup) {
            return ['matched' => 'topup', 'action' => $this->applyTopup($topup, $razorpayPaymentId, $captured)];
        }

        // 3) Fixed seat hold
        $hold = FixedSeatHold::query()
            ->where('razorpay_payment_id', $razorpayPaymentId)
            ->when($razorpayOrderId, fn ($q) => $q->orWhere('razorpay_order_id', $razorpayOrderId))
            ->first();
        if ($hold) {
            return ['matched' => 'fixed', 'action' => $this->applyFixed($hold, $razorpayPaymentId, $captured, $source)];
        }

        // 4) Shuttle booking
        $shuttle = ShuttlePassengerBooking::query()
            ->where('razorpay_payment_id', $razorpayPaymentId)
            ->when($razorpayOrderId, fn ($q) => $q->orWhere('razorpay_order_id', $razorpayOrderId))
            ->first();
        if ($shuttle) {
            return ['matched' => 'shuttle', 'action' => $this->applyShuttle($shuttle, $razorpayPaymentId, $captured, $source)];
        }

        Log::warning('DreamCabs payment reconciliation: no record owns this Razorpay payment', [
            'razorpay_payment_id' => $razorpayPaymentId,
            'razorpay_order_id' => $razorpayOrderId,
            'captured' => $captured,
            'source' => $source,
        ]);

        return ['matched' => null, 'action' => 'unmatched'];
    }

    private function applySolo(Payment $payment, string $paymentId, ?string $orderId, bool $captured, ?array $raw): string
    {
        return DB::transaction(function () use ($payment, $paymentId, $orderId, $captured, $raw) {
            $locked = Payment::query()->lockForUpdate()->find($payment->id);
            if (!$locked) {
                return 'gone';
            }

            // Never downgrade a settled payment: a late "failed attempt"
            // webhook must not clobber a SUCCESS from a retried checkout.
            if (in_array($locked->status, ['SUCCESS', 'REFUNDED'], true)) {
                return 'already_settled';
            }

            if ($paymentId !== '') {
                $locked->razorpay_payment_id = $paymentId;
            }
            if ($orderId) {
                $locked->razorpay_order_id = $orderId;
            }
            if ($raw) {
                $locked->provider_response = $raw;
            }
            $locked->status = $captured ? 'SUCCESS' : 'FAILED';
            $locked->paid_at = $captured ? now() : null;
            $locked->save();

            if ($captured) {
                $trip = $locked->trip()->first();
                if ($trip) {
                    $this->markCouponRedeemed($locked, $trip->id);
                    // Auto-split at source (Route). Idempotent via payments.split_at,
                    // so a webhook + sweeper + client-verify race splits only once.
                    app(PaymentSplitService::class)->applyCapturedSplit($locked);
                    try {
                        app(InvoiceGeneratorService::class)->generateForTrip($trip);
                    } catch (\Throwable) {
                        // Invoice is best-effort; it can be generated later.
                    }
                }
            }

            return $captured ? 'marked_success' : 'marked_failed';
        });
    }

    private function applyTopup(WalletTopup $topup, string $paymentId, bool $captured): string
    {
        return DB::transaction(function () use ($topup, $paymentId, $captured) {
            $locked = WalletTopup::query()->lockForUpdate()->find($topup->id);
            if (!$locked || $locked->status === WalletTopup::STATUS_SUCCESS) {
                return 'already_settled';
            }

            if (!$captured) {
                $locked->status = WalletTopup::STATUS_FAILED;
                $locked->save();

                return 'marked_failed';
            }

            $locked->razorpay_payment_id = $paymentId;
            $locked->status = WalletTopup::STATUS_SUCCESS;
            $locked->paid_at = now();
            $locked->save();

            // Mirrors verifyTopupRazorpay: no cap re-check — the money is
            // already captured, so the wallet must be credited.
            $user = $locked->user()->first();
            if ($user) {
                $this->wallet->recordTransaction(
                    $user,
                    WalletTransaction::TYPE_CREDIT,
                    (float) $locked->amount,
                    'Wallet top-up (Razorpay)',
                    null,
                    null,
                );
            }

            return 'credited';
        });
    }

    private function applyFixed(FixedSeatHold $hold, string $paymentId, bool $captured, string $source): string
    {
        if (!$captured) {
            // A failed attempt doesn't kill the order — the customer can retry
            // inside the same checkout. The hold's own expiry handles seats.
            return 'ignored_failed_attempt';
        }

        try {
            $this->fixedHolds->confirmPaidHold($hold, $paymentId, $source);

            return 'confirmed';
        } catch (ReservationException $e) {
            // Money captured but the booking can't be honoured (seats gone,
            // departure closed, coupon burned…) → give the money straight back.
            return $this->refundUnfulfillableFixed($hold, $paymentId, $e->getMessage());
        }
    }

    private function refundUnfulfillableFixed(FixedSeatHold $hold, string $paymentId, string $why): string
    {
        $hold->refresh();
        if ($hold->status === 'CONFIRMED') {
            return 'already_settled';
        }
        // FAILED + a refund reference in payment_reference marks "auto-refunded".
        if ($hold->status === 'FAILED' && str_starts_with((string) $hold->payment_reference, 'rfnd_')) {
            return 'already_refunded';
        }

        try {
            $amountPaise = max(1, (int) round(((float) $hold->amount) * 100));
            $refund = $this->razorpay->refundPayment($paymentId, $amountPaise, [
                'module' => 'fixed',
                'fixed_seat_hold_id' => (string) $hold->id,
                'reason' => 'auto_refund_unfulfillable_booking',
            ]);

            $hold->update([
                'status' => 'FAILED',
                'razorpay_payment_id' => $paymentId,
                'payment_reference' => $refund['id'],
            ]);

            Log::warning('DreamCabs fixed booking auto-refunded: payment captured but booking unfulfillable', [
                'fixed_seat_hold_id' => $hold->id,
                'razorpay_payment_id' => $paymentId,
                'refund_id' => $refund['id'],
                'reason' => $why,
            ]);

            return 'refunded';
        } catch (\Throwable $e) {
            $hold->update([
                'status' => 'FAILED',
                'razorpay_payment_id' => $paymentId,
            ]);

            Log::error('DreamCabs fixed booking captured payment could NOT be auto-refunded — needs manual refund in Razorpay dashboard', [
                'fixed_seat_hold_id' => $hold->id,
                'razorpay_payment_id' => $paymentId,
                'booking_error' => $why,
                'refund_error' => $e->getMessage(),
            ]);

            return 'refund_failed';
        }
    }

    private function applyShuttle(ShuttlePassengerBooking $booking, string $paymentId, bool $captured, string $source): string
    {
        if (!$captured) {
            return 'ignored_failed_attempt';
        }

        try {
            $this->shuttleBookings->confirmPaidServerVerified($booking, $paymentId, $source);

            return 'confirmed';
        } catch (ReservationException $e) {
            // Booking was cancelled/expired while the money was in flight →
            // refund the captured payment and record it on the booking.
            return $this->refundUnfulfillableShuttle($booking, $paymentId, $e->getMessage());
        }
    }

    private function refundUnfulfillableShuttle(ShuttlePassengerBooking $booking, string $paymentId, string $why): string
    {
        $booking->refresh();
        if ($booking->payment_status === 'PAID') {
            return 'already_settled';
        }
        if ($booking->refund_status === 'REFUNDED' || $booking->payment_status === 'REFUNDED') {
            return 'already_refunded';
        }

        try {
            $amountPaise = max(1, (int) round(((float) $booking->fare_amount) * 100));
            $refund = $this->razorpay->refundPayment($paymentId, $amountPaise, [
                'module' => 'shuttle',
                'shuttle_booking_id' => (string) $booking->id,
                'reason' => 'auto_refund_unfulfillable_booking',
            ]);

            $booking->update([
                'razorpay_payment_id' => $paymentId,
                'payment_status' => 'REFUNDED',
                'refund_status' => 'REFUNDED',
                'refund_reference' => $refund['id'],
                'refund_amount' => ((int) $refund['amount']) / 100,
                'refund_method' => 'razorpay',
                'refunded_at' => now(),
            ]);

            Log::warning('DreamCabs shuttle booking auto-refunded: payment captured but booking unfulfillable', [
                'shuttle_booking_id' => $booking->id,
                'razorpay_payment_id' => $paymentId,
                'refund_id' => $refund['id'],
                'reason' => $why,
            ]);

            return 'refunded';
        } catch (\Throwable $e) {
            $booking->update([
                'razorpay_payment_id' => $paymentId,
                'refund_status' => 'APPROVED',
            ]);

            Log::error('DreamCabs shuttle captured payment could NOT be auto-refunded — needs manual refund in Razorpay dashboard', [
                'shuttle_booking_id' => $booking->id,
                'razorpay_payment_id' => $paymentId,
                'booking_error' => $why,
                'refund_error' => $e->getMessage(),
            ]);

            return 'refund_failed';
        }
    }

    /* ------------------------------------------------------------------ */
    /* Refund events (processed / failed)                                  */
    /* ------------------------------------------------------------------ */

    /**
     * Applies a refund outcome. Matches by our stored refund reference first,
     * then by the refunded payment id (covers refunds created manually in the
     * Razorpay dashboard).
     *
     * @return array{matched:?string,action:string}
     */
    public function applyRefund(string $refundId, string $paymentId, int $amountPaise, bool $processed): array
    {
        // Fixed bookings
        $reservation = SeatReservation::query()
            ->where('refund_reference', $refundId)
            ->orWhere(function ($q) use ($paymentId) {
                $q->where('payment_reference', $paymentId)
                    ->whereIn('refund_status', ['REQUESTED', 'APPROVED']);
            })
            ->first();
        if ($reservation) {
            if ($processed) {
                $reservation->update([
                    'refund_status' => 'REFUNDED',
                    'payment_status' => 'REFUNDED',
                    'refund_reference' => $refundId,
                    'refund_amount' => $amountPaise / 100,
                    'refund_method' => 'razorpay',
                    'refunded_at' => $reservation->refunded_at ?? now(),
                ]);

                return ['matched' => 'fixed', 'action' => 'marked_refunded'];
            }

            Log::error('DreamCabs fixed booking refund FAILED at Razorpay — needs attention', [
                'seat_reservation_id' => $reservation->id,
                'refund_id' => $refundId,
            ]);

            return ['matched' => 'fixed', 'action' => 'refund_failed_logged'];
        }

        // Shuttle bookings
        $shuttle = ShuttlePassengerBooking::query()
            ->where('refund_reference', $refundId)
            ->orWhere(function ($q) use ($paymentId) {
                $q->where('razorpay_payment_id', $paymentId)
                    ->whereIn('refund_status', ['REQUESTED', 'APPROVED']);
            })
            ->first();
        if ($shuttle) {
            if ($processed) {
                $shuttle->update([
                    'refund_status' => 'REFUNDED',
                    'payment_status' => 'REFUNDED',
                    'refund_reference' => $refundId,
                    'refund_amount' => $amountPaise / 100,
                    'refund_method' => 'razorpay',
                    'refunded_at' => $shuttle->refunded_at ?? now(),
                ]);

                return ['matched' => 'shuttle', 'action' => 'marked_refunded'];
            }

            Log::error('DreamCabs shuttle refund FAILED at Razorpay — needs attention', [
                'shuttle_booking_id' => $shuttle->id,
                'refund_id' => $refundId,
            ]);

            return ['matched' => 'shuttle', 'action' => 'refund_failed_logged'];
        }

        // Solo ride payments (e.g. refund issued manually from the dashboard)
        $payment = Payment::query()->where('razorpay_payment_id', $paymentId)->first();
        if ($payment) {
            if ($processed) {
                $payment->status = 'REFUNDED';
                $payment->save();

                return ['matched' => 'solo', 'action' => 'marked_refunded'];
            }

            return ['matched' => 'solo', 'action' => 'refund_failed_logged'];
        }

        Log::warning('DreamCabs refund reconciliation: no record owns this Razorpay refund', [
            'refund_id' => $refundId,
            'razorpay_payment_id' => $paymentId,
            'processed' => $processed,
        ]);

        return ['matched' => null, 'action' => 'unmatched'];
    }

    /* ------------------------------------------------------------------ */
    /* Sweeper                                                             */
    /* ------------------------------------------------------------------ */

    /**
     * Reconciles everything stuck PENDING for more than $staleMinutes against
     * the Razorpay Orders API. Looks back at most $lookbackHours so ancient
     * rows aren't re-queried forever. Returns counters for the command output.
     *
     * @return array<string,int>
     */
    public function reconcilePending(int $staleMinutes = 15, int $lookbackHours = 48, int $batch = 50): array
    {
        $cutoff = now()->subMinutes($staleMinutes);
        $floor = now()->subHours($lookbackHours);
        $stats = [
            'checked' => 0, 'confirmed' => 0, 'credited' => 0,
            'marked_failed' => 0, 'refunded' => 0, 'refunds_settled' => 0, 'untouched' => 0,
        ];

        // 1) Solo ride payments stuck PENDING
        Payment::query()
            ->where('provider', 'RAZORPAY')
            ->where('status', 'PENDING')
            ->whereNotNull('razorpay_order_id')
            ->whereBetween('updated_at', [$floor, $cutoff])
            ->orderBy('id')
            ->limit($batch)
            ->get()
            ->each(function (Payment $payment) use (&$stats) {
                $stats['checked']++;
                $this->sweepOrder(
                    (string) $payment->razorpay_order_id,
                    fn (string $paymentId) => $this->applySolo($payment, $paymentId, $payment->razorpay_order_id, true, null),
                    fn () => $this->applySolo($payment, (string) ($payment->razorpay_payment_id ?: ''), $payment->razorpay_order_id, false, null),
                    $payment->created_at,
                    $stats,
                );
            });

        // 2) Wallet top-ups stuck PENDING
        WalletTopup::query()
            ->where('status', WalletTopup::STATUS_PENDING)
            ->whereNotNull('razorpay_order_id')
            ->whereBetween('updated_at', [$floor, $cutoff])
            ->orderBy('id')
            ->limit($batch)
            ->get()
            ->each(function (WalletTopup $topup) use (&$stats) {
                $stats['checked']++;
                $this->sweepOrder(
                    (string) $topup->razorpay_order_id,
                    fn (string $paymentId) => $this->applyTopup($topup, $paymentId, true),
                    fn () => $this->applyTopup($topup, '', false),
                    $topup->created_at,
                    $stats,
                );
            });

        // 3) Fixed seat holds that died unconfirmed but might hold captured money
        FixedSeatHold::query()
            ->whereIn('status', ['HELD', 'EXPIRED'])
            ->whereNotNull('razorpay_order_id')
            ->whereBetween('updated_at', [$floor, $cutoff])
            ->orderBy('id')
            ->limit($batch)
            ->get()
            ->each(function (FixedSeatHold $hold) use (&$stats) {
                $stats['checked']++;
                $this->sweepOrder(
                    (string) $hold->razorpay_order_id,
                    fn (string $paymentId) => $this->applyFixed($hold, $paymentId, true, 'sweeper'),
                    null, // unpaid holds expire on their own; nothing to fail
                    $hold->created_at,
                    $stats,
                );
            });

        // 4) Shuttle bookings whose checkout never came back
        ShuttlePassengerBooking::query()
            ->where('payment_status', 'ORDER_CREATED')
            ->where('status', 'PAYMENT_PENDING')
            ->whereNotNull('razorpay_order_id')
            ->whereBetween('updated_at', [$floor, $cutoff])
            ->orderBy('id')
            ->limit($batch)
            ->get()
            ->each(function (ShuttlePassengerBooking $booking) use (&$stats) {
                $stats['checked']++;
                $this->sweepOrder(
                    (string) $booking->razorpay_order_id,
                    fn (string $paymentId) => $this->applyShuttle($booking, $paymentId, true, 'sweeper'),
                    null, // customer can still retry; admin cancel handles the rest
                    $booking->created_at,
                    $stats,
                );
            });

        // 5) Fixed refunds we created that Razorpay hasn't confirmed yet
        SeatReservation::query()
            ->where('refund_status', 'APPROVED')
            ->whereNotNull('refund_reference')
            ->where('refund_reference', 'LIKE', 'rfnd_%')
            ->whereBetween('updated_at', [$floor, $cutoff])
            ->orderBy('id')
            ->limit($batch)
            ->get()
            ->each(function (SeatReservation $reservation) use (&$stats) {
                $stats['checked']++;
                $refund = $this->razorpay->fetchRefund((string) $reservation->refund_reference);
                if (!$refund) {
                    $stats['untouched']++;

                    return;
                }
                if (strtolower($refund['status']) === 'processed') {
                    $this->applyRefund($refund['id'], $refund['payment_id'], $refund['amount'], true);
                    $stats['refunds_settled']++;
                } else {
                    $stats['untouched']++;
                }
            });

        return $stats;
    }

    /**
     * Shared sweep step: look the order up at Razorpay, promote it if any
     * attempt was captured, mark it failed if it's old and clearly dead.
     */
    private function sweepOrder(string $orderId, \Closure $onCaptured, ?\Closure $onDead, $createdAt, array &$stats): void
    {
        $captured = null;
        foreach ($this->razorpay->fetchOrderPayments($orderId) as $attempt) {
            if ($attempt['status'] === 'captured') {
                $captured = $attempt;
                break;
            }
        }

        if ($captured) {
            $action = $onCaptured((string) $captured['id']);
            match ($action) {
                'confirmed' => $stats['confirmed']++,
                'credited' => $stats['credited']++,
                'marked_success' => $stats['confirmed']++,
                'refunded', 'refund_failed' => $stats['refunded']++,
                default => $stats['untouched']++,
            };

            return;
        }

        // No captured payment. Only declare death after 24h — before that the
        // customer might still complete checkout on a retried attempt.
        $isDead = $createdAt && $createdAt->lt(now()->subHours(24));
        if ($isDead && $onDead) {
            $onDead();
            $stats['marked_failed']++;

            return;
        }

        $stats['untouched']++;
    }

    /**
     * Same coupon burn the verify endpoint performs: stamp the assignment
     * used so the coupon can't be reused. Idempotent.
     */
    private function markCouponRedeemed(Payment $payment, int $tripId): void
    {
        if (!$payment->coupon_assignment_id) {
            return;
        }

        CouponAssignment::query()
            ->where('id', $payment->coupon_assignment_id)
            ->whereNull('used_at')
            ->update([
                'used_at' => now(),
                'redeemed_trip_id' => $tripId,
            ]);
    }
}
