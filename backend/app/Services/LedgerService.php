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
     * invariant: everything the customer paid must equal what the driver got
     * (transferred or held) plus what the operator retained, net of any refunds
     * and reversals.
     *
     *   captured = to_driver + held + to_operator - refunded - reversed
     *
     * @return array{captured:int,to_driver:int,held:int,to_operator:int,refunded:int,reversed:int,imbalance:int,balanced:bool}
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

        $imbalance = $captured - ($toDriver + $held + $toOperator - $refunded - $reversed);

        return [
            'captured' => $captured,
            'to_driver' => $toDriver,
            'held' => $held,
            'to_operator' => $toOperator,
            'refunded' => $refunded,
            'reversed' => $reversed,
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
}
