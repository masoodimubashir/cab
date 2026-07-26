<?php

namespace App\Services;

use App\Models\Payment;
use App\Models\Trip;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Phase 5 — the bridge that rolls Fixed & Shuttle prepayments onto the shared
 * money engine. Fixed/Shuttle customers pay online at booking, into their own
 * booking rows (SeatReservation / ShuttlePassengerBooking), long before a driver
 * is assigned and the ride happens. This service mirrors each such capture as a
 * Payment row (settlement_mode = 'booking') so the split engine and the ledger
 * can treat it exactly like a solo ride:
 *
 *   - recordCapture()      at booking confirmation — mirror the money, no split yet
 *   - settleTrip()         at trip completion — split every booking payment now
 *                          that the driver is known and the ride happened
 *   - refundForBooking()   on a seat-release cancel — run the R6/R7 rulebook
 *
 * Everything is flag-gated: when the split engine is off this is inert and the
 * legacy wallet/manual booking-refund paths stay in charge.
 */
class BookingPaymentService
{
    public function __construct(
        private readonly PaymentSplitService $split,
        private readonly AutoRefundService $refunds,
    ) {}

    /**
     * Mirrors a confirmed Fixed/Shuttle prepayment as a Payment row so the shared
     * engine owns it from here on. Idempotent on the Razorpay payment id (a
     * duplicate webhook / double client-verify returns the existing row). Returns
     * null while the engine is disabled or when there's nothing to key against.
     */
    public function recordCapture(
        ?int $tripId,
        string $razorpayPaymentId,
        float $fareAmount,
        float $commissionAmount,
        string $currency = 'INR',
    ): ?Payment {
        if (! $this->split->enabled()) {
            return null;
        }
        $razorpayPaymentId = trim($razorpayPaymentId);
        if ($tripId === null || $razorpayPaymentId === '') {
            return null;
        }

        return DB::transaction(function () use ($tripId, $razorpayPaymentId, $fareAmount, $commissionAmount, $currency) {
            $existing = Payment::query()
                ->where('razorpay_payment_id', $razorpayPaymentId)
                ->lockForUpdate()
                ->first();
            if ($existing) {
                return $existing;
            }

            return Payment::query()->create([
                'trip_id' => $tripId,
                'method' => 'RAZORPAY',
                'provider' => 'RAZORPAY',
                'status' => 'SUCCESS',
                'amount' => round($fareAmount, 2),
                'currency' => $currency ?: 'INR',
                'razorpay_payment_id' => $razorpayPaymentId,
                'commission_amount' => round(max(0.0, $commissionAmount), 2),
                'paid_at' => now(),
                'settlement_mode' => Payment::SETTLE_BOOKING,
            ]);
        });
    }

    /**
     * Settles every unsettled booking payment on a completed trip: now that the
     * driver is known and the ride happened, divide each seat/passenger fare into
     * the driver's share (live transfer or held) and the operator's commission.
     * One Fixed departure / Shuttle journey carries many bookings on a single
     * trip, so this walks them all. Idempotent per payment via payments.split_at.
     */
    public function settleTrip(Trip $trip): void
    {
        if (! $this->split->enabled()) {
            return;
        }

        $driver = $trip->driver_id ? $trip->driver()->first() : null;

        $payments = Payment::query()
            ->where('trip_id', $trip->id)
            ->where('settlement_mode', Payment::SETTLE_BOOKING)
            ->where('status', 'SUCCESS')
            ->whereNull('split_at')
            ->get();

        foreach ($payments as $payment) {
            $grossPaise = self::toPaise($payment->amount);
            $commissionPaise = self::toPaise($payment->commission_amount);
            $this->split->settleBookingPayment($payment, $driver, $grossPaise, $commissionPaise);
        }
    }

    /**
     * Runs the seat-release refund rulebook (R6/R7) for one Fixed/Shuttle booking,
     * found by its Razorpay payment id. $refundFull is the caller's decision — it
     * owns the seat-release timing: true when the seat went back in time or the
     * cancel isn't the customer's fault, false on a no-show / too-late cancel.
     * Returns null while the engine is disabled or when no mirrored payment exists.
     */
    public function refundForBooking(string $razorpayPaymentId, bool $refundFull, string $cancelledBy = AutoRefundService::BY_SYSTEM): ?array
    {
        if (! $this->refunds->enabled()) {
            return null;
        }
        $razorpayPaymentId = trim($razorpayPaymentId);
        if ($razorpayPaymentId === '') {
            return null;
        }

        $payment = Payment::query()
            ->where('razorpay_payment_id', $razorpayPaymentId)
            ->where('settlement_mode', Payment::SETTLE_BOOKING)
            ->latest('id')
            ->first();

        if (! $payment) {
            return null;
        }

        return $this->refunds->refundBookingCancellation($payment, $refundFull, $cancelledBy);
    }

    private static function toPaise($rupees): int
    {
        return (int) round(((float) ($rupees ?? 0)) * 100);
    }
}
