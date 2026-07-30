<?php

namespace App\Services;

use App\Models\Payment;
use App\Models\SeatReservation;
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
     * duplicate webhook / double client-verify returns the existing row).
     *
     * $tripId is genuinely null for a Fixed booking: the customer pays while the
     * departure is still forming, and the trip only exists once a driver is
     * dispatched — {@see linkTrip()} backfills it there. Returns null while the
     * engine is disabled or when there's no payment id to key against.
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
        if ($razorpayPaymentId === '') {
            return null;
        }

        return DB::transaction(function () use ($tripId, $razorpayPaymentId, $fareAmount, $commissionAmount, $currency) {
            $existing = Payment::query()
                ->where('razorpay_payment_id', $razorpayPaymentId)
                ->lockForUpdate()
                ->first();
            if ($existing) {
                $this->split->recordCaptureOnLedger($existing);
                return $existing;
            }

            $payment = Payment::query()->create([
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

            $this->split->recordCaptureOnLedger($payment);

            return $payment;
        });
    }

    /**
     * Attaches already-mirrored prepayments to the trip that will actually run
     * them. Fixed passengers pay into a forming departure, so their Payment rows
     * start with no trip; the moment a driver is dispatched and the Trip exists,
     * this stamps it on so the completion hook can find and settle them, and so
     * the trip's ledger reconciles. Only ever fills a blank — an already-linked
     * payment is left alone.
     *
     * @param  iterable<string|null>  $razorpayPaymentIds  the bookings' payment references
     */
    public function linkTrip(Trip $trip, iterable $razorpayPaymentIds): void
    {
        if (! $this->split->enabled()) {
            return;
        }

        $ids = [];
        foreach ($razorpayPaymentIds as $id) {
            $id = trim((string) $id);
            if ($id !== '') {
                $ids[] = $id;
            }
        }
        if ($ids === []) {
            return;
        }

        $uniqueIds = array_unique($ids);

        $payments = Payment::query()
            ->whereIn('razorpay_payment_id', $uniqueIds)
            ->where('settlement_mode', Payment::SETTLE_BOOKING)
            ->whereNull('trip_id')
            ->get(['id']);

        if ($payments->isNotEmpty()) {
            $paymentIds = $payments->pluck('id')->all();

            Payment::query()
                ->whereIn('id', $paymentIds)
                ->update(['trip_id' => $trip->id]);

            \App\Models\LedgerEntry::query()
                ->whereIn('payment_id', $paymentIds)
                ->whereNull('trip_id')
                ->update(['trip_id' => $trip->id]);
        }
    }

    /**
     * {@see linkTrip()} for a whole fixed departure — every seat still live on it
     * when the vehicle journey is materialised. Both dispatch paths (the automatic
     * dispatcher and a driver starting the departure themselves) call this.
     */
    public function linkDepartureBookings(Trip $trip, ?int $routeDepartureId): void
    {
        if (! $this->split->enabled() || $routeDepartureId === null) {
            return;
        }

        $this->linkTrip($trip, SeatReservation::query()
            ->where('route_departure_id', $routeDepartureId)
            ->whereIn('status', SeatReservation::ACTIVE_STATUSES)
            ->pluck('payment_reference'));
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
            ->orderBy('id')
            ->get();

        if ($payments->isEmpty()) {
            return;
        }

        // A shared journey carries many independent bookings on one trip, so each
        // payment settles against its own seat fare and commission snapshot.
        if ($trip->route_departure_id !== null) {
            foreach ($payments as $payment) {
                // The seat's fare, not the charge: a customer-borne gateway fee
                // rides inside `amount` and belongs to Razorpay, not the seat.
                $this->split->settleBookingPayment(
                    $payment,
                    $driver,
                    self::farePaise($payment),
                    self::toPaise($payment->commission_amount),
                );
            }

            return;
        }

        $this->settleSoloPrepayments($trip, $driver, $payments);
    }

    /**
     * A private ride is ONE fare that may have been captured more than once — the
     * prepayment at booking, plus a balance if the final fare came in higher. So
     * the trip's fare and commission are spread across the captures rather than
     * read off each payment: each takes as much of the fare as it actually paid,
     * and the commission is apportioned to match, with the last capture absorbing
     * the rounding so not a paise is invented or dropped.
     *
     * When the ride came in CHEAPER than the prepayment, the fare runs out before
     * the captures do: the surplus is already on its way back to the customer
     * (see refundOverpayment) and simply stays with the operator here, which is
     * what makes the trip still reconcile.
     *
     * @param  \Illuminate\Support\Collection<int,Payment>  $payments
     */
    private function settleSoloPrepayments(Trip $trip, ?User $driver, $payments): void
    {
        $capturedTotal = (int) $payments->sum(fn (Payment $p) => self::farePaise($p));
        if ($capturedTotal <= 0) {
            return;
        }

        // The ride is worth its final fare — deliberately NOT capped at what was
        // captured. If the rider never settled a balance, the driver is still
        // owed their share of the full fare; computeSplit then pays them as much
        // of it as exists and the operator's commission absorbs the shortfall.
        // Capping here instead would quietly take that hit out of the driver.
        $fareTotal = max(0, self::toPaise($trip->final_fare));
        $commissionTotal = max(0, min(self::toPaise($trip->commission_amount), $fareTotal));

        // A balance paid after the ride settles on its own, later, so whatever
        // the prepayment already claimed has to come off the totals first —
        // otherwise the second capture would hand the driver a second full share.
        [$usedGross, $usedCommission] = $this->alreadyAllocated($trip);

        $fareLeft = max(0, $fareTotal - $usedGross);
        $commissionLeft = max(0, $commissionTotal - $usedCommission);
        $last = $payments->count() - 1;

        foreach ($payments->values() as $i => $payment) {
            // The last capture takes whatever fare is left, so nothing goes
            // unallocated when the captures don't cover the whole fare.
            $grossShare = $i === $last ? $fareLeft : min(self::farePaise($payment), $fareLeft);

            $commissionShare = $i === $last
                ? $commissionLeft
                : (int) round($commissionTotal * $grossShare / max(1, $fareTotal));
            $commissionShare = min($commissionShare, $commissionLeft, $grossShare);

            $fareLeft -= $grossShare;
            $commissionLeft -= $commissionShare;

            $this->split->settleBookingPayment($payment, $driver, $grossShare, $commissionShare);
        }
    }

    /**
     * How much of this trip's fare and commission earlier captures have already
     * taken. Read off what settlement actually stamped rather than recomputed,
     * so the two can never drift.
     *
     * @return array{0:int,1:int} [grossPaise, commissionPaise]
     */
    private function alreadyAllocated(Trip $trip): array
    {
        $settled = Payment::query()
            ->where('trip_id', $trip->id)
            ->where('settlement_mode', Payment::SETTLE_BOOKING)
            ->whereNotNull('split_at')
            ->get(['driver_amount', 'commission_amount']);

        $commission = 0;
        $gross = 0;
        foreach ($settled as $payment) {
            $driverPaise = self::toPaise($payment->driver_amount);
            $commissionPaise = self::toPaise($payment->commission_amount);
            $commission += $commissionPaise;
            $gross += $driverPaise + $commissionPaise;
        }

        return [$gross, $commission];
    }

    /**
     * Gives back whatever the customer prepaid over the ride's actual final fare
     * — a shorter route, waiting time that never happened, a fare corrected down.
     * Runs at completion, BEFORE the split, so the driver's share is worked out
     * on the fare that stands rather than on the larger sum we happened to hold.
     * Private rides only: a shared journey has no single trip-level fare.
     */
    public function refundOverpayment(Trip $trip): ?array
    {
        if (! $this->split->enabled() || $trip->route_departure_id !== null) {
            return null;
        }

        $finalPaise = self::toPaise($trip->final_fare);
        if ($finalPaise <= 0) {
            return null; // no settled fare to compare against
        }

        $payments = Payment::query()
            ->where('trip_id', $trip->id)
            ->where('settlement_mode', Payment::SETTLE_BOOKING)
            ->where('status', 'SUCCESS')
            ->whereNull('split_at')
            ->orderBy('id')
            ->get();

        // Compare fare against fare: the gateway fee isn't an overpayment of the
        // ride, so it must not inflate the excess we hand back.
        $capturedTotal = (int) $payments->sum(fn (Payment $p) => self::farePaise($p));
        $excess = $capturedTotal - $finalPaise;
        if ($excess <= 0 || $payments->isEmpty()) {
            return null;
        }

        // Take it off the last capture — the one most likely to still be
        // refundable in full at Razorpay.
        return $this->refunds->refundOverpayment($payments->last(), $excess);
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

    /**
     * The ride's share of a capture — what the customer paid, less whatever of
     * it was the payment gateway's cut. With the fee switched off this is just
     * the captured amount.
     */
    private static function farePaise(Payment $payment): int
    {
        $captured = self::toPaise($payment->amount);
        $fee = max(0, min($captured, self::toPaise($payment->gateway_fee_amount)));

        return $captured - $fee;
    }
}
