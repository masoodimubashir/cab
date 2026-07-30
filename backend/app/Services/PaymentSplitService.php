<?php

namespace App\Services;

use App\Models\LedgerEntry;
use App\Models\Payment;
use App\Models\Trip;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * The auto-split engine (Phase 2). Given a captured online payment, it divides
 * the money at the source via Razorpay Route: the driver's share is transferred
 * to their linked account (or parked as a held earning if they're not verified),
 * and the operator's commission simply stays behind. Every movement is written
 * to the append-only ledger.
 *
 * All arithmetic is in paise (integers) so nothing is ever lost or created to
 * rounding across the split.
 */
class PaymentSplitService
{
    public function __construct(
        private readonly RazorpayService $razorpay,
        private readonly LedgerService $ledger,
        private readonly HeldEarningsService $heldEarnings,
    ) {}

    /** Is the auto-split engine turned on for this environment? */
    public function enabled(): bool
    {
        return (bool) config('services.payments.split_enabled', false);
    }

    /**
     * Pure split math. The driver is owed their expected share of the gross fare
     * (fare − commission); the operator keeps whatever the customer actually paid
     * minus that share. So the operator — not the driver — absorbs any coupon
     * discount, and we never transfer more than was captured.
     *
     * @return array{driver_paise:int,operator_paise:int}
     */
    public function computeSplit(int $capturedPaise, int $grossPaise, int $commissionPaise): array
    {
        $capturedPaise = max(0, $capturedPaise);
        $commissionPaise = max(0, min($commissionPaise, $grossPaise));

        $driver = $grossPaise - $commissionPaise;      // driver's full expected share
        if ($driver < 0) {
            $driver = 0;
        }
        if ($driver > $capturedPaise) {
            $driver = $capturedPaise;                    // can't pay out more than we took
        }

        $operator = $capturedPaise - $driver;

        return ['driver_paise' => $driver, 'operator_paise' => $operator];
    }

    /**
     * Applies the split to a freshly-captured solo payment. Idempotent: a second
     * call (duplicate webhook, double client-verify, sweeper race) is a no-op
     * once payments.split_at is set. No-op entirely while the engine is disabled.
     */
    public function applyCapturedSplit(Payment $payment): void
    {
        if (! $this->enabled()) {
            return;
        }

        DB::transaction(function () use ($payment) {
            /** @var Payment|null $locked */
            $locked = Payment::query()->lockForUpdate()->find($payment->id);
            if (! $locked || $locked->status !== 'SUCCESS') {
                return;
            }
            if ($locked->split_at !== null) {
                return; // already split
            }
            if ($locked->settlement_mode === Payment::SETTLE_BOOKING) {
                // Prepaid before the ride ran — Fixed/Shuttle seats, or a Private
                // ride paid at booking. Record the capture on the ledger immediately
                // so the transaction is visible on /admin/ledger without delay.
                $this->recordCaptureOnLedger($locked);
                return;
            }

            $trip = $locked->trip()->first();
            if (! $trip instanceof Trip) {
                // Nothing to split against (e.g. a wallet top-up shouldn't reach
                // here). Stamp split_at so we don't reconsider it every sweep.
                $locked->forceFill(['split_at' => now()])->save();
                return;
            }

            if (! $trip->driver_id) {
                // Money landed but no driver is assigned yet (still searching, or
                // nobody accepted). The operator holds all of it — record the
                // capture so a subsequent auto-refund reconciles, and stamp
                // split_at so we don't reconsider it.
                $capturedPaise = self::toPaise($locked->amount);
                $feePaise = $this->feePaise($locked, $capturedPaise);
                $farePaise = $capturedPaise - $feePaise;
                $this->ledger->record(
                    LedgerEntry::TYPE_CAPTURE,
                    LedgerEntry::PARTY_CUSTOMER,
                    'in',
                    $capturedPaise,
                    $trip->id,
                    $locked->id,
                    $locked->razorpay_payment_id,
                );
                $this->recordGatewayFee($locked, $trip->id, $feePaise);
                if ($farePaise > 0) {
                    $this->ledger->record(
                        LedgerEntry::TYPE_RETAINED,
                        LedgerEntry::PARTY_OPERATOR,
                        'in',
                        $farePaise,
                        $trip->id,
                        $locked->id,
                    );
                }
                $locked->forceFill([
                    'commission_amount' => $farePaise / 100,
                    'driver_amount' => 0,
                    'transfer_status' => null,
                    'split_at' => now(),
                ])->save();
                return;
            }

            $grossPaise = self::toPaise($trip->final_fare);
            $capturedPaise = self::toPaise($locked->amount);
            $commissionPaise = self::toPaise($trip->commission_amount);

            // Razorpay's cut was never the ride's value — the split runs on the
            // fare inside the capture, so the driver's share is unaffected by
            // how the customer chose to pay.
            $feePaise = $this->feePaise($locked, $capturedPaise);
            $split = $this->computeSplit($capturedPaise - $feePaise, $grossPaise, $commissionPaise);
            $driverPaise = $split['driver_paise'];
            $operatorPaise = $split['operator_paise'];

            // 1) Money landed with the operator.
            $this->ledger->record(
                LedgerEntry::TYPE_CAPTURE,
                LedgerEntry::PARTY_CUSTOMER,
                'in',
                $capturedPaise,
                $trip->id,
                $locked->id,
                $locked->razorpay_payment_id,
            );

            // 1b) Straight back out to the gateway.
            $this->recordGatewayFee($locked, $trip->id, $feePaise);

            // 2) Operator retains its commission.
            if ($operatorPaise > 0) {
                $this->ledger->record(
                    LedgerEntry::TYPE_RETAINED,
                    LedgerEntry::PARTY_OPERATOR,
                    'in',
                    $operatorPaise,
                    $trip->id,
                    $locked->id,
                );
            }

            // 3) Driver's share: live transfer if verified, else held.
            $driver = $trip->driver()->first();
            [$transferId, $transferStatus, $heldId] = $this->placeDriverShare($locked, $driver, $trip->id, $driverPaise);

            $locked->forceFill([
                'commission_amount' => $operatorPaise / 100,
                'driver_amount' => $driverPaise / 100,
                'driver_transfer_id' => $transferId,
                'transfer_status' => $transferStatus,
                'held_earning_id' => $heldId,
                'split_at' => now(),
            ])->save();
        });
    }

    /**
     * Settles a Fixed/Shuttle prepay's split at trip completion (Phase 5). Unlike
     * the solo path — which splits at capture because the customer pays after the
     * ride, when the driver is already known — a Fixed/Shuttle customer prepays at
     * booking, before a driver is assigned and before the ride happens. So its
     * Payment row is recorded at capture with no split, and the money is divided
     * here once the trip completes and $driver is known.
     *
     * The figures are passed explicitly (the per-seat/per-passenger fare and its
     * commission snapshot) rather than read off the trip, because one Fixed
     * departure or Shuttle journey carries many independent bookings on a single
     * trip. Idempotent on payments.split_at; no-op while the engine is disabled.
     */
    public function settleBookingPayment(Payment $payment, ?User $driver, int $grossPaise, int $commissionPaise): void
    {
        if (! $this->enabled()) {
            return;
        }

        DB::transaction(function () use ($payment, $driver, $grossPaise, $commissionPaise) {
            /** @var Payment|null $locked */
            $locked = Payment::query()->lockForUpdate()->find($payment->id);
            if (! $locked || $locked->status !== 'SUCCESS' || $locked->split_at !== null) {
                return; // gone, not captured, or already settled
            }

            $capturedPaise = self::toPaise($locked->amount);
            $feePaise = $this->feePaise($locked, $capturedPaise);
            $split = $this->computeSplit($capturedPaise - $feePaise, $grossPaise, $commissionPaise);
            $driverPaise = $driver !== null ? $split['driver_paise'] : 0;
            $operatorPaise = $capturedPaise - $feePaise - $driverPaise;

            // 1) Money landed with the operator (if not already recorded at capture).
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

                // 1b) Straight back out to the gateway.
                $this->recordGatewayFee($locked, (int) $locked->trip_id, $feePaise);
            }

            // 2) Operator retains its commission.
            if ($operatorPaise > 0) {
                $this->ledger->record(
                    LedgerEntry::TYPE_RETAINED,
                    LedgerEntry::PARTY_OPERATOR,
                    'in',
                    $operatorPaise,
                    $locked->trip_id,
                    $locked->id,
                );
            }

            // 3) Driver's share: live transfer if verified, else held.
            [$transferId, $transferStatus, $heldId] = $this->placeDriverShare($locked, $driver, (int) $locked->trip_id, $driverPaise);

            $locked->forceFill([
                'commission_amount' => $operatorPaise / 100,
                'driver_amount' => $driverPaise / 100,
                'driver_transfer_id' => $transferId,
                'transfer_status' => $transferStatus,
                'held_earning_id' => $heldId,
                'split_at' => now(),
            ])->save();
        });
    }

    /**
     * Records the capture (and gateway fee if applicable) on the ledger immediately
     * upon payment confirmation so transactions appear on /admin/ledger without delay.
     * Idempotent via LedgerService::hasCapture.
     */
    public function recordCaptureOnLedger(Payment $payment): void
    {
        if (! $this->enabled() || $this->ledger->hasCapture($payment)) {
            return;
        }

        $capturedPaise = self::toPaise($payment->amount);
        $feePaise = $this->feePaise($payment, $capturedPaise);

        $this->ledger->record(
            LedgerEntry::TYPE_CAPTURE,
            LedgerEntry::PARTY_CUSTOMER,
            'in',
            $capturedPaise,
            $payment->trip_id,
            $payment->id,
            $payment->razorpay_payment_id,
        );

        $this->recordGatewayFee($payment, $payment->trip_id, $feePaise);
    }

    /**
     * Moves the driver's share of a captured payment: a live Route transfer when
     * the driver is verified (recording the TRANSFER on the ledger), otherwise the
     * share is parked as a held earning — either because the driver has no verified
     * payout account (P4) or because a live transfer failed and we don't want to
     * short them (F3). Shared by the solo and booking settlement paths.
     *
     * @return array{0:?string,1:?string,2:?int} [transferId, transferStatus, heldId]
     */
    /**
     * How much of a capture was Razorpay's cut rather than the ride's fare.
     *
     * Read off what was actually stamped on the payment at order time, never
     * recomputed from a rate — the rate can be reconfigured between charging and
     * settling, and the customer was charged the old one. Clamped to the capture
     * so a bad figure can never make the fare negative.
     */
    private function feePaise(Payment $payment, int $capturedPaise): int
    {
        return max(0, min($capturedPaise, self::toPaise($payment->gateway_fee_amount)));
    }

    /**
     * Names the gateway's cut on the ledger. Without this row the trip reads as
     * short by exactly the fee, because the money came in but was never split.
     * Direction is 'out': it left on the way in and reached neither party.
     */
    private function recordGatewayFee(Payment $payment, ?int $tripId, int $feePaise): void
    {
        if ($feePaise <= 0) {
            return;
        }

        $this->ledger->record(
            LedgerEntry::TYPE_GATEWAY_FEE,
            LedgerEntry::PARTY_GATEWAY,
            'out',
            $feePaise,
            $tripId,
            $payment->id,
            $payment->razorpay_payment_id,
        );
    }

    private function placeDriverShare(Payment $locked, ?User $driver, int $tripId, int $driverPaise): array
    {
        if ($driverPaise <= 0 || ! $driver) {
            return [null, null, null];
        }

        if ($driver->hasVerifiedPayoutAccount()) {
            $transfer = $this->razorpay->createTransfer(
                (string) $locked->razorpay_payment_id,
                (string) $driver->razorpay_linked_account_id,
                $driverPaise,
                ['trip_id' => (string) $tripId, 'reason' => 'driver_ride_share'],
            );

            if ($transfer) {
                $transferId = $transfer['id'];
                $transferStatus = $transfer['status'] === 'processed'
                    ? Payment::TRANSFER_PROCESSED
                    : Payment::TRANSFER_CREATED;

                $this->ledger->record(
                    LedgerEntry::TYPE_TRANSFER,
                    LedgerEntry::PARTY_DRIVER,
                    'out',
                    $driverPaise,
                    $tripId,
                    $locked->id,
                    $transferId,
                );

                return [$transferId, $transferStatus, null];
            }

            // F3 — captured but the transfer to the driver failed. The payment
            // stands; park the share so the driver isn't shorted, and alert. The
            // sweeper/verification retries it as a release.
            $held = $this->heldEarnings->park($driver, $tripId, $locked, $driverPaise);
            Log::error('DreamCabs driver transfer failed after capture — share held, needs attention', [
                'payment_id' => $locked->id,
                'trip_id' => $tripId,
                'driver_id' => $driver->id,
                'amount_paise' => $driverPaise,
            ]);

            return [null, Payment::TRANSFER_HELD, $held->id];
        }

        // P4 — driver has no verified payout account; hold the share. Tell them,
        // because they're the only one who can unlock it and the money is
        // otherwise invisible to them.
        $held = $this->heldEarnings->park($driver, $tripId, $locked, $driverPaise);
        $this->notifyShareHeld($driver, $driverPaise);

        return [null, Payment::TRANSFER_HELD, $held->id];
    }

    /**
     * Nudges a driver whose earnings can't be sent yet because they have no
     * verified payout account. Deliberately once per parked share rather than a
     * daily digest: the ride just happened, so this is the moment it makes sense
     * to them. Best-effort — a notification failure must never fail a split.
     */
    private function notifyShareHeld(User $driver, int $amountPaise): void
    {
        try {
            app(NotificationCenter::class)->notifyUserId(
                (int) $driver->id,
                'driver_earnings_held',
                'Your earnings are waiting',
                '₹' . number_format($amountPaise / 100, 2) . " is yours, but we have nowhere to send it. Add your bank or UPI details in Profile and we'll pay it out automatically.",
                ['amount_paise' => $amountPaise, 'reason' => 'no_payout_account'],
                'alert-circle',
            );
        } catch (\Throwable $e) {
            Log::warning('DreamCabs could not notify driver about held earnings', [
                'driver_id' => $driver->id,
                'error' => $e->getMessage(),
            ]);
        }
    }

    private static function toPaise($rupees): int
    {
        return (int) round(((float) ($rupees ?? 0)) * 100);
    }
}
