<?php

namespace App\Services;

use App\Models\HeldEarning;
use App\Models\LedgerEntry;
use App\Models\Payment;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Parks a driver's share when they can't be paid yet (payout account not
 * verified) and releases all of it via Route transfers the moment they verify.
 * The one remaining job of the old wallet concept: nothing is ever lost.
 */
class HeldEarningsService
{
    public function __construct(
        private readonly RazorpayService $razorpay,
        private readonly LedgerService $ledger,
    ) {}

    /**
     * Parks a driver's share for a captured ride and writes the ledger row.
     * Returns the held row so the payment can reference it.
     */
    public function park(User $driver, ?int $tripId, Payment $payment, int $amountPaise): HeldEarning
    {
        $held = HeldEarning::query()->create([
            'driver_id' => $driver->id,
            'trip_id' => $tripId,
            'payment_id' => $payment->id,
            'amount_paise' => max(0, $amountPaise),
            'status' => HeldEarning::STATUS_HELD,
        ]);

        $this->ledger->record(
            LedgerEntry::TYPE_HELD,
            LedgerEntry::PARTY_DRIVER,
            'out',
            $amountPaise,
            $tripId,
            $payment->id,
            null,
            ['held_earning_id' => $held->id],
        );

        return $held;
    }

    /** Total paise a driver still has parked. */
    public function heldTotalPaise(int $driverId): int
    {
        return (int) HeldEarning::query()
            ->where('driver_id', $driverId)
            ->where('status', HeldEarning::STATUS_HELD)
            ->sum('amount_paise');
    }

    /**
     * Releases every held row for a now-verified driver via Route transfers.
     * Each row is settled independently and idempotently: a transfer failure on
     * one row leaves it held for the next run, never blocking the others.
     *
     * @return array{released:int,failed:int,amount_paise:int}
     */
    public function releaseAllForDriver(User $driver): array
    {
        $linkedAccountId = (string) ($driver->razorpay_linked_account_id ?? '');
        if (! $driver->hasVerifiedPayoutAccount() || $linkedAccountId === '') {
            return ['released' => 0, 'failed' => 0, 'amount_paise' => 0];
        }

        $released = 0;
        $failed = 0;
        $amount = 0;

        HeldEarning::query()
            ->where('driver_id', $driver->id)
            ->where('status', HeldEarning::STATUS_HELD)
            ->orderBy('id')
            ->get()
            ->each(function (HeldEarning $held) use ($driver, $linkedAccountId, &$released, &$failed, &$amount) {
                $outcome = $this->releaseOne($held, $driver, $linkedAccountId);
                if ($outcome) {
                    $released++;
                    $amount += (int) $held->amount_paise;
                } else {
                    $failed++;
                }
            });

        return ['released' => $released, 'failed' => $failed, 'amount_paise' => $amount];
    }

    /**
     * Releases a single held row. Row-locked and status-guarded so a concurrent
     * release (webhook + sweeper) can't double-pay.
     */
    private function releaseOne(HeldEarning $held, User $driver, string $linkedAccountId): bool
    {
        $lockedId = DB::transaction(function () use ($held) {
            $locked = HeldEarning::query()->lockForUpdate()->find($held->id);
            if (! $locked || $locked->status !== HeldEarning::STATUS_HELD) {
                return null; // already released/reversed
            }
            return $locked->id;
        });

        if ($lockedId === null) {
            return false;
        }

        $paymentId = (string) optional($held->payment()->first())->razorpay_payment_id;
        if ($paymentId === '') {
            Log::warning('DreamCabs held earning has no source payment to transfer against', [
                'held_earning_id' => $held->id,
            ]);
            return false;
        }

        $transfer = $this->razorpay->createTransfer(
            $paymentId,
            $linkedAccountId,
            (int) $held->amount_paise,
            ['reason' => 'held_earnings_release', 'held_earning_id' => (string) $held->id],
        );

        if (! $transfer) {
            Log::warning('DreamCabs held earning release transfer failed — will retry', [
                'held_earning_id' => $held->id,
                'driver_id' => $driver->id,
            ]);
            return false;
        }

        DB::transaction(function () use ($held, $transfer) {
            $locked = HeldEarning::query()->lockForUpdate()->find($held->id);
            if (! $locked || $locked->status !== HeldEarning::STATUS_HELD) {
                return;
            }
            $locked->update([
                'status' => HeldEarning::STATUS_RELEASED,
                'transfer_id' => $transfer['id'],
                'released_at' => now(),
            ]);

            // The held row was already counted as "out" to the driver; the
            // release just realises it as a transfer, so it's net-neutral on the
            // reconciliation invariant (TYPE_RELEASE is not summed).
            $this->ledger->record(
                LedgerEntry::TYPE_RELEASE,
                LedgerEntry::PARTY_DRIVER,
                'out',
                (int) $locked->amount_paise,
                $locked->trip_id,
                $locked->payment_id,
                $transfer['id'],
                ['held_earning_id' => $locked->id],
            );
        });

        return true;
    }
}
