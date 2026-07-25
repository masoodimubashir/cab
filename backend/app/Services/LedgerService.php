<?php

namespace App\Services;

use App\Models\LedgerEntry;
use App\Models\Payment;

/**
 * Writes and reads the append-only money ledger. Every rupee that moves gets
 * exactly one immutable row here, in paise, so we can always answer "where did
 * the money go?" and assert the reconciliation invariant per trip.
 */
class LedgerService
{
    /**
     * Appends one immutable ledger row. Never updates or deletes.
     */
    public function record(
        string $type,
        string $party,
        string $direction,
        int $amountPaise,
        ?int $tripId = null,
        ?int $paymentId = null,
        ?string $razorpayRef = null,
        array $meta = [],
    ): LedgerEntry {
        return LedgerEntry::query()->create([
            'trip_id' => $tripId,
            'payment_id' => $paymentId,
            'type' => $type,
            'party' => $party,
            'direction' => $direction,
            'amount_paise' => max(0, $amountPaise),
            'razorpay_ref' => $razorpayRef,
            'meta' => $meta ?: null,
        ]);
    }

    /**
     * Rolls a trip's ledger up into party totals (paise) and checks the
     * reconciliation invariant. Every paise the customer paid must still be
     * accounted for as allocated to exactly one party — driver, operator, or
     * refunded back to the customer — with nothing created or lost:
     *
     *   captured = driver_net + operator_net + refunded
     *
     * A refund is an internal redistribution: the driver's share is clawed back
     * (a transfer reversal, or un-earmarking a held row) and/or the operator
     * gives back part of its commission, and that money flows to the customer.
     * So the raw capture identity (to_driver + held + to_operator = captured)
     * always holds, and `balanced` checks exactly that; the net columns show
     * where the money actually ended up after refunds.
     *
     *   driver_net   = transfers + held - reversed   (driver's money, paid or owed)
     *   operator_net = captured - driver_net - refunded   (what the operator keeps)
     *
     * @return array{captured:int,to_driver:int,held:int,to_operator:int,refunded:int,reversed:int,driver_net:int,operator_net:int,imbalance:int,balanced:bool}
     */
    public function tripBalance(int $tripId): array
    {
        $rows = LedgerEntry::query()->where('trip_id', $tripId)->get();

        $captured = 0;
        $toDriver = 0;
        $held = 0;
        $toOperator = 0;
        $refunded = 0;
        $reversed = 0;

        foreach ($rows as $row) {
            $amt = (int) $row->amount_paise;
            match ($row->type) {
                LedgerEntry::TYPE_CAPTURE => $captured += $amt,
                LedgerEntry::TYPE_TRANSFER => $toDriver += $amt,
                LedgerEntry::TYPE_HELD => $held += $amt,
                LedgerEntry::TYPE_RELEASE => null, // release just moves held → paid, no net change
                LedgerEntry::TYPE_RETAINED => $toOperator += $amt,
                LedgerEntry::TYPE_REFUND => $refunded += $amt,
                LedgerEntry::TYPE_REVERSAL => $reversed += $amt,
                default => null,
            };
        }

        // What the driver is left with (paid or still held) once clawbacks are
        // applied, and what the operator keeps as the residual.
        $driverNet = $toDriver + $held - $reversed;
        $operatorNet = $captured - $driverNet - $refunded;

        // The capture identity is the true conservation check: the split at
        // capture never invents or drops a paise. Refunds net out of it.
        $imbalance = $captured - ($toDriver + $held + $toOperator);

        return [
            'captured' => $captured,
            'to_driver' => $toDriver,
            'held' => $held,
            'to_operator' => $toOperator,
            'refunded' => $refunded,
            'reversed' => $reversed,
            'driver_net' => $driverNet,
            'operator_net' => $operatorNet,
            'imbalance' => $imbalance,
            'balanced' => $imbalance === 0,
        ];
    }

    /**
     * Convenience: has this payment already been recorded as captured? Used as a
     * belt-and-braces idempotency check alongside payments.split_at.
     */
    public function hasCapture(Payment $payment): bool
    {
        return LedgerEntry::query()
            ->where('payment_id', $payment->id)
            ->where('type', LedgerEntry::TYPE_CAPTURE)
            ->exists();
    }

    /**
     * Convenience: has this payment already been refunded on the ledger? A
     * belt-and-braces idempotency check alongside payments.refunded_at so a
     * replayed webhook or double-cancel never issues a second refund.
     */
    public function hasRefund(Payment $payment): bool
    {
        return LedgerEntry::query()
            ->where('payment_id', $payment->id)
            ->where('type', LedgerEntry::TYPE_REFUND)
            ->exists();
    }
}
