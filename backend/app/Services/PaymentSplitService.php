<?php

namespace App\Services;

use App\Models\LedgerEntry;
use App\Models\Payment;
use App\Models\Trip;
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
                $this->ledger->record(
                    LedgerEntry::TYPE_CAPTURE,
                    LedgerEntry::PARTY_CUSTOMER,
                    'in',
                    $capturedPaise,
                    $trip->id,
                    $locked->id,
                    $locked->razorpay_payment_id,
                );
                if ($capturedPaise > 0) {
                    $this->ledger->record(
                        LedgerEntry::TYPE_RETAINED,
                        LedgerEntry::PARTY_OPERATOR,
                        'in',
                        $capturedPaise,
                        $trip->id,
                        $locked->id,
                    );
                }
                $locked->forceFill([
                    'commission_amount' => $capturedPaise / 100,
                    'driver_amount' => 0,
                    'transfer_status' => null,
                    'split_at' => now(),
                ])->save();
                return;
            }

            $grossPaise = self::toPaise($trip->final_fare);
            $capturedPaise = self::toPaise($locked->amount);
            $commissionPaise = self::toPaise($trip->commission_amount);

            $split = $this->computeSplit($capturedPaise, $grossPaise, $commissionPaise);
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
            $transferStatus = Payment::TRANSFER_HELD;
            $transferId = null;
            $heldId = null;

            if ($driverPaise > 0 && $driver && $driver->hasVerifiedPayoutAccount()) {
                $transfer = $this->razorpay->createTransfer(
                    (string) $locked->razorpay_payment_id,
                    (string) $driver->razorpay_linked_account_id,
                    $driverPaise,
                    ['trip_id' => (string) $trip->id, 'reason' => 'driver_ride_share'],
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
                        $trip->id,
                        $locked->id,
                        $transferId,
                    );
                } else {
                    // F3 — captured but the transfer to the driver failed. The
                    // payment stands; park the share so the driver isn't shorted,
                    // and alert. The sweeper/verification retries it as a release.
                    $held = $this->heldEarnings->park($driver, $trip->id, $locked, $driverPaise);
                    $heldId = $held->id;
                    Log::error('DreamCabs driver transfer failed after capture — share held, needs attention', [
                        'payment_id' => $locked->id,
                        'trip_id' => $trip->id,
                        'driver_id' => $driver->id,
                        'amount_paise' => $driverPaise,
                    ]);
                }
            } elseif ($driverPaise > 0 && $driver) {
                // P4 — driver has no verified payout account; hold the share.
                $held = $this->heldEarnings->park($driver, $trip->id, $locked, $driverPaise);
                $heldId = $held->id;
            }

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

    private static function toPaise($rupees): int
    {
        return (int) round(((float) ($rupees ?? 0)) * 100);
    }
}
