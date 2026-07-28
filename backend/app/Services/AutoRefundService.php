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
    public function refundBookingCancellation(Payment $payment, bool $refundFull, string $cancelledBy = self::BY_SYSTEM): ?array
    {
        if (! $this->enabled()) {
            return null;
        }

        $capturedPaise = self::toPaise($payment->amount);
        $refundPaise = $refundFull ? $capturedPaise : 0;

        // Claim + record the capture-to-operator atomically. Returns the locked
        // payment to act on, or null when there's nothing to do (already refunded
        // or a refund is in flight).
        $claimed = DB::transaction(function () use ($payment, $capturedPaise, $refundPaise) {
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

            // A cancelled-before-ride booking never pays the driver, so the whole
            // captured amount rests with the operator until (if) it's refunded.
            // Record it once — idempotent on the presence of a capture row — so the
            // ledger reconciles whether or not a refund follows.
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
                if ($capturedPaise > 0) {
                    $this->ledger->record(
                        LedgerEntry::TYPE_RETAINED,
                        LedgerEntry::PARTY_OPERATOR,
                        'in',
                        $capturedPaise,
                        $locked->trip_id,
                        $locked->id,
                    );
                }
                $locked->forceFill([
                    'commission_amount' => $capturedPaise / 100,
                    'driver_amount' => 0,
                    'transfer_status' => null,
                    'split_at' => $locked->split_at ?? now(),
                ])->save();
            }

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
