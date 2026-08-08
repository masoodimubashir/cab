<?php

namespace App\Services;

use App\Models\LedgerEntry;
use App\Models\Payment;
use App\Models\Trip;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Phase 3 — the automatic refund rulebook (§5). Given a cancellation, it decides
 * how much the customer is owed back and executes it: the driver's share is
 * always clawed back for a cancelled ride (a Route transfer reversal, or simply
 * un-earmarking a held row), the operator keeps only the cancel fee, and the
 * customer is refunded via Razorpay. Every movement is written to the ledger.
 *
 * The one rule that drives the money:
 *   - Cancel fee = the trip's commission, applied from the moment of booking.
 *   - Full refund when the ride never really happened for the customer
 *     (no driver, driver/operator cancelled).
 *   - Customer cancels before pickup → refund fare − commission (they eat the fee).
 *   - Customer cancels after the driver arrived / the trip started → no refund;
 *     the split stands.
 *   - Disputes are NOT handled here — they stay in the manual register.
 *
 * All arithmetic is in paise. Idempotent: a second call (double-cancel race,
 * replayed webhook) is a no-op once the refund is recorded. No-op while the
 * split engine is disabled — the legacy manual register handles those.
 */
class AutoRefundService
{
    /** Who triggered the cancellation — drives the rulebook. */
    public const BY_CUSTOMER = 'customer';
    public const BY_DRIVER = 'driver';
    public const BY_OPERATOR = 'operator';
    public const BY_SYSTEM = 'system'; // no driver found / auto-expired

    public function __construct(
        private readonly RazorpayService $razorpay,
        private readonly LedgerService $ledger,
        private readonly HeldEarningsService $heldEarnings,
    ) {}

    /** Is the auto-split/refund engine turned on for this environment? */
    public function enabled(): bool
    {
        return (bool) config('services.payments.split_enabled', false);
    }

    /**
     * Pure rulebook decision. Returns the paise to refund the customer and a
     * human reason. No side effects — unit-tested exhaustively.
     *
     * @return array{refund_paise:int,reason:string}
     */
    public function decide(string $cancelledBy, bool $afterArrival, int $capturedPaise, int $commissionPaise): array
    {
        $capturedPaise = max(0, $capturedPaise);
        $commissionPaise = max(0, min($commissionPaise, $capturedPaise));

        // Not the customer's fault → full refund, whatever the phase.
        if (in_array($cancelledBy, [self::BY_DRIVER, self::BY_OPERATOR, self::BY_SYSTEM], true)) {
            return ['refund_paise' => $capturedPaise, 'reason' => 'full_refund_not_customer_fault'];
        }

        // Customer cancelled after the driver arrived / the ride started: no
        // refund, the split stands.
        if ($afterArrival) {
            return ['refund_paise' => 0, 'reason' => 'no_refund_after_arrival'];
        }

        // Customer cancelled before pickup: refund minus the cancel fee (commission).
        return [
            'refund_paise' => max(0, $capturedPaise - $commissionPaise),
            'reason' => 'refund_minus_cancel_fee',
        ];
    }

    /**
     * Executes the auto-refund for a cancelled solo trip. Finds the captured
     * payment, decides the amount, claws back the driver's share, refunds the
     * customer and records the ledger. Returns the outcome, or null when there's
     * nothing to do (engine off / no captured payment / already refunded).
     *
     * @return array{refunded_paise:int,reversed_paise:int,reason:string,status:string}|null
     */
    public function refundForCancellation(Trip $trip, string $cancelledBy): ?array
    {
        if (! $this->enabled()) {
            return null;
        }

        // A captured payment is SUCCESS, or REFUNDED once a prior (full) refund
        // already ran — we still fetch the latter so a replayed cancel resolves
        // through the idempotency guard rather than silently finding nothing.
        $payment = Payment::query()
            ->where('trip_id', $trip->id)
            ->whereIn('status', ['SUCCESS', 'REFUNDED'])
            ->latest('id')
            ->first();

        // Nothing captured yet (e.g. a ride cancelled before the customer paid),
        // so there's nothing to refund.
        if (! $payment) {
            return null;
        }

        $afterArrival = $this->rideStarted($trip);

        return $this->refundPayment($trip, $payment, $cancelledBy, $afterArrival);
    }

    /**
     * Executes a Fixed/Shuttle seat-release refund (Phase 5, rulebook R6/R7). The
     * caller — which owns the seat-release timing — has already decided the binary
     * outcome: a full refund when the seat went back to inventory in time or the
     * cancel isn't the customer's fault ($refundFull = true), or no refund on a
     * no-show / too-late cancel where the seat was held and lost ($refundFull =
     * false).
     *
     * A Fixed/Shuttle booking is always cancelled BEFORE the trip completes, so its
     * split was never settled and the driver was never paid — the whole captured
     * amount rests with the operator. We record that capture-to-operator on the
     * ledger (so it reconciles) and, on a full refund, return the money to the
     * customer. Idempotent: a double-cancel race or replayed webhook is a no-op
     * once the refund is recorded. No-op while the split engine is disabled.
     *
     * @return array{refunded_paise:int,reversed_paise:int,reason:string,status:string,refund_id:?string}|null
     */
    public function refundBookingCancellation(Payment $payment, bool $refundFull, string $cancelledBy = self::BY_SYSTEM, bool $forfeitToOperator = false): ?array
    {
        if (! $this->enabled()) {
            return null;
        }

        $capturedPaise = self::toPaise($payment->amount);
        $refundPaise = $refundFull ? $capturedPaise : 0;

        // Book the operator's retained share now when we're refunding (it's then
        // reversed to the customer) OR when a no-show forfeits to the operator
        // (Shuttle). A Fixed forfeit passes false: the fare settles to the driver at
        // departure completion instead, so we must not pre-book it to the operator.
        $bookRetained = $refundPaise > 0 || $forfeitToOperator;

        // Claim + record the capture-to-operator atomically. Returns the locked
        // payment to act on, or null when there's nothing to do (already refunded
        // or a refund is in flight).
        $claimed = DB::transaction(function () use ($payment, $capturedPaise, $refundPaise, $bookRetained) {
            /** @var Payment|null $locked */
            $locked = Payment::query()->lockForUpdate()->find($payment->id);
            if (! $locked) {
                return null;
            }

            $alreadyDone = $locked->refund_id !== null || $this->ledger->hasRefund($locked);
            $inFlight = $locked->refund_status === Payment::REFUND_PENDING;
            if ($alreadyDone || $inFlight) {
                return null;
            }

            $this->recordUnsettledCapture($locked, $capturedPaise, $bookRetained);

            // Stake a pending claim on the refund case so a racing cancel backs off.
            if ($refundPaise > 0) {
                $locked->forceFill(['refund_status' => Payment::REFUND_PENDING])->save();
            }

            return $locked;
        });

        if ($claimed === null) {
            return [
                'refunded_paise' => 0,
                'reversed_paise' => 0,
                'reason' => 'already_refunded',
                'status' => 'skipped',
                'refund_id' => $payment->fresh()?->refund_id,
            ];
        }

        // R7 — no refund: the operator keeps the fare as the no-show penalty. The
        // capture-to-operator ledger recorded above is the whole story.
        if ($refundPaise <= 0) {
            return [
                'refunded_paise' => 0,
                'reversed_paise' => 0,
                'reason' => 'no_refund_seat_lost',
                'status' => 'no_refund',
                'refund_id' => null,
            ];
        }

        // R6 / not-the-customer's-fault — full refund. Claw back any driver share
        // that was already settled (normally none for a pre-completion cancel),
        // then return the money to the customer. Fail-soft on the Razorpay call.
        $reversedPaise = $this->reverseDriverShare($claimed);

        try {
            $refund = $this->razorpay->refundPayment(
                (string) $claimed->razorpay_payment_id,
                $refundPaise,
                ['trip_id' => (string) $claimed->trip_id, 'reason' => 'booking_cancelled'],
            );
        } catch (\Throwable $e) {
            $claimed->forceFill(['refund_status' => Payment::REFUND_FAILED])->save();
            Log::error('DreamCabs booking auto-refund failed at Razorpay — needs attention', [
                'payment_id' => $claimed->id,
                'trip_id' => $claimed->trip_id,
                'amount_paise' => $refundPaise,
                'error' => $e->getMessage(),
            ]);

            return [
                'refunded_paise' => 0,
                'reversed_paise' => $reversedPaise,
                'reason' => 'booking_cancelled',
                'status' => 'refund_failed',
                'refund_id' => null,
            ];
        }

        $this->ledger->record(
            LedgerEntry::TYPE_REFUND,
            LedgerEntry::PARTY_CUSTOMER,
            'out',
            $refundPaise,
            $claimed->trip_id,
            $claimed->id,
            $refund['id'],
            ['reason' => 'booking_cancelled', 'cancelled_by' => $cancelledBy],
        );

        $status = ($refund['status'] ?? 'processed') === 'processed'
            ? Payment::REFUND_PROCESSED
            : Payment::REFUND_PENDING;

        $claimed->forceFill([
            'status' => 'REFUNDED',
            'refund_id' => $refund['id'],
            'refund_amount' => $refundPaise / 100,
            'refund_status' => $status,
            'refunded_at' => now(),
        ])->save();

        return [
            'refunded_paise' => $refundPaise,
            'reversed_paise' => $reversedPaise,
            'reason' => 'booking_cancelled',
            'status' => $status === Payment::REFUND_PROCESSED ? 'refunded' : 'refund_pending',
            'refund_id' => (string) $refund['id'],
        ];
    }

    /**
     * Returns the part of a prepayment the ride turned out not to cost. Unlike a
     * cancellation this is not a rulebook decision — the amount is arithmetic
     * (prepaid − final fare) and the ride still happened, so the driver keeps
     * their share of what the ride WAS worth and nothing is clawed back.
     *
     * Deliberately leaves the payment SUCCESS and split_at null: this runs just
     * before settlement, which then divides the fare that actually stands.
     *
     * @return array{refunded_paise:int,status:string,refund_id:?string}|null
     */
    public function refundOverpayment(Payment $payment, int $refundPaise): ?array
    {
        if (! $this->enabled() || $refundPaise <= 0) {
            return null;
        }

        $claimed = DB::transaction(function () use ($payment) {
            /** @var Payment|null $locked */
            $locked = Payment::query()->lockForUpdate()->find($payment->id);
            if (! $locked || $locked->status !== 'SUCCESS') {
                return null;
            }
            // Anything already refunded (or in flight) means this has been
            // handled — a replayed completion must not give the money back twice.
            if ($locked->refund_id !== null || $locked->refund_status === Payment::REFUND_PENDING) {
                return null;
            }
            $locked->forceFill(['refund_status' => Payment::REFUND_PENDING])->save();

            return $locked;
        });

        if ($claimed === null) {
            return ['refunded_paise' => 0, 'status' => 'skipped', 'refund_id' => null];
        }

        try {
            $refund = $this->razorpay->refundPayment(
                (string) $claimed->razorpay_payment_id,
                $refundPaise,
                ['trip_id' => (string) $claimed->trip_id, 'reason' => 'prepaid_above_final_fare'],
            );
        } catch (\Throwable $e) {
            $claimed->forceFill(['refund_status' => Payment::REFUND_FAILED])->save();
            Log::error('DreamCabs overpayment refund failed at Razorpay — customer is owed the difference', [
                'payment_id' => $claimed->id,
                'trip_id' => $claimed->trip_id,
                'amount_paise' => $refundPaise,
                'error' => $e->getMessage(),
            ]);

            return ['refunded_paise' => 0, 'status' => 'refund_failed', 'refund_id' => null];
        }

        $this->ledger->record(
            LedgerEntry::TYPE_REFUND,
            LedgerEntry::PARTY_CUSTOMER,
            'out',
            $refundPaise,
            $claimed->trip_id,
            $claimed->id,
            $refund['id'],
            ['reason' => 'prepaid_above_final_fare'],
        );

        $status = ($refund['status'] ?? 'processed') === 'processed'
            ? Payment::REFUND_PROCESSED
            : Payment::REFUND_PENDING;

        $claimed->forceFill([
            'refund_id' => $refund['id'],
            'refund_amount' => $refundPaise / 100,
            'refund_status' => $status,
            'refunded_at' => now(),
        ])->save();

        return [
            'refunded_paise' => $refundPaise,
            'status' => $status === Payment::REFUND_PROCESSED ? 'refunded' : 'refund_pending',
            'refund_id' => (string) $refund['id'],
        ];
    }

    /**
     * Books a prepayment that was captured but never split to the operator, so a
     * refund on it still reconciles. This is the shape of every cancel that
     * happens BEFORE the ride runs — a Fixed/Shuttle seat, or a Private ride paid
     * at booking: the driver was never paid, so the whole captured amount rests
     * with the operator until (if) it goes back to the customer.
     *
     * Must be called inside the caller's transaction.
     *
     * $bookRetained decides whether the operator takes the whole fare now, and with
     * it the idempotency guard — because the callers want different things:
     *  - true (a refund, or a Shuttle forfeit): guard on payments.split_at. A prepaid
     *    booking records its CAPTURE the moment it's confirmed (for immediate
     *    /admin/ledger visibility) but does NOT split, so the capture can be present
     *    while the operator's retained share is still missing — we must book that
     *    retained here or the trip is left short by exactly it. For a refund the
     *    retained is then reversed out to the customer; for a Shuttle no-show it
     *    stays as the operator's forfeit.
     *  - false (a Fixed forfeit): guard on the capture row (the historical
     *    behaviour). A forfeited Fixed no-show still lets the departure COMPLETE and
     *    settle the fare to the driver by the normal split, so we must NOT pre-book
     *    the whole fare to the operator and stamp split_at — that would forfeit the
     *    driver's earned share and block the completion settlement.
     */
    private function recordUnsettledCapture(Payment $locked, int $capturedPaise, bool $bookRetained = true): void
    {
        if ($bookRetained ? $locked->split_at !== null : $this->ledger->hasCapture($locked)) {
            return;
        }

        // Whatever of the capture was the gateway's cut never rested with the
        // operator, so it's named separately or the trip reads as short by it.
        $feePaise = max(0, min($capturedPaise, self::toPaise($locked->gateway_fee_amount)));
        $farePaise = $capturedPaise - $feePaise;

        // The capture (and its gateway fee) may already be on the ledger from
        // confirmation time — only add them if they're missing, so the capture is
        // never double-counted.
        if (! $this->ledger->hasCapture($locked)) {
            $this->ledger->record(
                LedgerEntry::TYPE_CAPTURE,
                LedgerEntry::PARTY_CUSTOMER,
                'in',
                $capturedPaise,
                $locked->trip_id,
                $locked->id,
                $locked->razorpay_payment_id,
            );
            if ($feePaise > 0) {
                $this->ledger->record(
                    LedgerEntry::TYPE_GATEWAY_FEE,
                    LedgerEntry::PARTY_GATEWAY,
                    'out',
                    $feePaise,
                    $locked->trip_id,
                    $locked->id,
                    $locked->razorpay_payment_id,
                );
            }
        }

        // The whole fare rests with the operator — the driver was never paid for a
        // ride that didn't run. This is the row that goes missing when the capture
        // was already recorded but the split never settled.
        if ($farePaise > 0) {
            $this->ledger->record(
                LedgerEntry::TYPE_RETAINED,
                LedgerEntry::PARTY_OPERATOR,
                'in',
                $farePaise,
                $locked->trip_id,
                $locked->id,
            );
        }

        $locked->forceFill([
            'commission_amount' => $farePaise / 100,
            'driver_amount' => 0,
            'transfer_status' => null,
            'split_at' => now(),
        ])->save();
    }

    /**
     * The refund transaction for one captured payment. Row-locked and guarded on
     * payments.refunded_at so a concurrent cancel can't double-refund (R12).
     *
     * @return array{refunded_paise:int,reversed_paise:int,reason:string,status:string}
     */
    private function refundPayment(Trip $trip, Payment $payment, string $cancelledBy, bool $afterArrival): array
    {
        $capturedPaise = self::toPaise($payment->amount);
        $commissionPaise = self::toPaise($trip->commission_amount);

        $decision = $this->decide($cancelledBy, $afterArrival, $capturedPaise, $commissionPaise);
        $refundPaise = $decision['refund_paise'];

        // Nothing to refund (after-arrival cancel): the split stands untouched.
        if ($refundPaise <= 0) {
            return [
                'refunded_paise' => 0,
                'reversed_paise' => 0,
                'reason' => $decision['reason'],
                'status' => 'no_refund',
            ];
        }

        // Claim the refund exactly once. The row lock serialises a double-cancel
        // race (R12): the first caller stakes a PENDING claim, the second sees it
        // in-flight and backs off. A previously FAILED attempt (no refund id) is
        // still allowed through so the sweeper/admin can retry it (R11).
        $claimed = DB::transaction(function () use ($payment) {
            /** @var Payment|null $locked */
            $locked = Payment::query()->lockForUpdate()->find($payment->id);
            if (! $locked) {
                return null;
            }
            $alreadyDone = $locked->refund_id !== null || $this->ledger->hasRefund($locked);
            $inFlight = $locked->refund_status === Payment::REFUND_PENDING;
            if ($alreadyDone || $inFlight) {
                return null;
            }

            // A ride cancelled after the customer prepaid but before it ran was
            // never split, so nothing is on the ledger yet. Book it to the
            // operator first, or the refund below would have no capture to net
            // against and the trip would never reconcile.
            $this->recordUnsettledCapture($locked, self::toPaise($locked->amount));

            // Stake a claim so a racing transaction backs off.
            $locked->forceFill(['refund_status' => Payment::REFUND_PENDING])->save();

            return $locked;
        });

        if ($claimed === null) {
            return [
                'refunded_paise' => 0,
                'reversed_paise' => 0,
                'reason' => 'already_refunded',
                'status' => 'skipped',
            ];
        }

        // 1) Claw the driver's whole share back first, so the money is available
        //    to fund the refund and the driver keeps nothing for a cancelled ride.
        $reversedPaise = $this->reverseDriverShare($claimed);

        // 2) Refund the customer via Razorpay. Fail-soft: if the API rejects it,
        //    leave the payment marked failed for the sweeper/admin to retry — the
        //    driver clawback already happened, so the money is safe with the operator.
        try {
            $refund = $this->razorpay->refundPayment(
                (string) $claimed->razorpay_payment_id,
                $refundPaise,
                ['trip_id' => (string) $trip->id, 'reason' => $decision['reason']],
            );
        } catch (\Throwable $e) {
            $claimed->forceFill(['refund_status' => Payment::REFUND_FAILED])->save();
            Log::error('DreamCabs auto-refund failed at Razorpay — needs attention', [
                'payment_id' => $claimed->id,
                'trip_id' => $trip->id,
                'amount_paise' => $refundPaise,
                'error' => $e->getMessage(),
            ]);

            return [
                'refunded_paise' => 0,
                'reversed_paise' => $reversedPaise,
                'reason' => $decision['reason'],
                'status' => 'refund_failed',
            ];
        }

        // 3) Record the refund and finalise the payment.
        $this->ledger->record(
            LedgerEntry::TYPE_REFUND,
            LedgerEntry::PARTY_CUSTOMER,
            'out',
            $refundPaise,
            $trip->id,
            $claimed->id,
            $refund['id'],
            ['reason' => $decision['reason'], 'cancelled_by' => $cancelledBy],
        );

        $status = ($refund['status'] ?? 'processed') === 'processed'
            ? Payment::REFUND_PROCESSED
            : Payment::REFUND_PENDING;

        // A full refund closes the payment out; a partial one keeps it SUCCESS
        // but flagged as partially refunded.
        $paymentStatus = $refundPaise >= $capturedPaise ? 'REFUNDED' : $claimed->status;

        $claimed->forceFill([
            'status' => $paymentStatus,
            'refund_id' => $refund['id'],
            'refund_amount' => $refundPaise / 100,
            'refund_status' => $status,
            'refunded_at' => now(),
        ])->save();

        return [
            'refunded_paise' => $refundPaise,
            'reversed_paise' => $reversedPaise,
            'reason' => $decision['reason'],
            'status' => $status === Payment::REFUND_PROCESSED ? 'refunded' : 'refund_pending',
        ];
    }

    /**
     * Claws back the driver's entire share for a cancelled ride: reverse the live
     * Route transfer if one went out, or un-earmark the held row if the share was
     * still parked (R9/K4). Returns paise reversed.
     */
    private function reverseDriverShare(Payment $payment): int
    {
        // Held, never transferred — just un-earmark it (no cash movement).
        if ($payment->held_earning_id !== null || $payment->transfer_status === Payment::TRANSFER_HELD) {
            return $this->heldEarnings->reverseHeldForPayment($payment);
        }

        // A live transfer went out — reverse it at Razorpay.
        $transferId = (string) ($payment->driver_transfer_id ?? '');
        $alreadyTransferred = in_array($payment->transfer_status, [
            Payment::TRANSFER_CREATED,
            Payment::TRANSFER_PROCESSED,
        ], true);

        if ($transferId === '' || ! $alreadyTransferred) {
            return 0; // nothing transferred (e.g. no driver / zero share)
        }

        $driverPaise = self::toPaise($payment->driver_amount);
        $reversal = $this->razorpay->reverseTransfer($transferId, $driverPaise);

        if (! $reversal) {
            // The reversal failed. The customer still gets refunded (below), but
            // the driver is holding money they shouldn't — flag for the sweeper.
            Log::error('DreamCabs transfer reversal failed on cancellation — driver overpaid, needs attention', [
                'payment_id' => $payment->id,
                'transfer_id' => $transferId,
                'amount_paise' => $driverPaise,
            ]);

            return 0;
        }

        $this->ledger->record(
            LedgerEntry::TYPE_REVERSAL,
            LedgerEntry::PARTY_DRIVER,
            'in',
            (int) ($reversal['amount'] ?: $driverPaise),
            $payment->trip_id,
            $payment->id,
            $reversal['id'],
            ['reason' => 'ride_cancelled'],
        );

        $payment->forceFill([
            'transfer_status' => Payment::TRANSFER_REVERSED,
            'reversal_id' => $reversal['id'],
        ])->save();

        return (int) ($reversal['amount'] ?: $driverPaise);
    }

    /**
     * Has the driver arrived / the trip started? Once they have, a customer
     * cancellation is not refundable. Reads the trip's phase stamps so it works
     * whether we're mid-ride or the status has already flipped to CANCELLED.
     */
    private function rideStarted(Trip $trip): bool
    {
        return $trip->arrived_pickup_at !== null
            || $trip->en_route_drop_at !== null
            || $trip->arrived_drop_at !== null
            || in_array($trip->status, ['ARRIVED_PICKUP', 'EN_ROUTE_DROP', 'ARRIVED_DROP', 'COMPLETED'], true);
    }

    private static function toPaise($rupees): int
    {
        return (int) round(((float) ($rupees ?? 0)) * 100);
    }
}
