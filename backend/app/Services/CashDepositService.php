<?php

namespace App\Services;

use App\Models\OperatorSetting;
use App\Models\Payment;

/**
 * Cash hybrid-deposit math (Operator Settings → Payments → Cash).
 *
 * A cash ride collects an upfront deposit online at booking — a percentage of
 * the fare set by the operator — and the driver collects the rest in cash at
 * trip end. This service owns the split so every ride type computes it the same
 * way; it holds no money-movement logic, only the arithmetic.
 */
class CashDepositService
{
    /** The operator's configured cash deposit percentage (0–100). */
    public function depositPercent(): float
    {
        $pct = (float) (OperatorSetting::instance()->cash_deposit_percent ?? 0);

        return max(0.0, min(100.0, $pct));
    }

    /** Whether cash is an offered payment method at all. */
    public function cashEnabled(): bool
    {
        return (bool) OperatorSetting::instance()->payment_cash_enabled;
    }

    /**
     * Split a fare into the online upfront deposit and the cash balance owed to
     * the driver at trip end. Rupee-rounded; the two always sum back to the fare
     * so nothing is created or lost.
     *
     * @return array{deposit: float, balance: float, percent: float}
     */
    public function quote(float $fare, ?float $percent = null): array
    {
        $fare = max(0.0, round($fare, 2));
        $percent = $percent ?? $this->depositPercent();
        $percent = max(0.0, min(100.0, $percent));

        $deposit = round($fare * $percent / 100, 2);
        // Never let rounding push the deposit past the fare, and derive the
        // balance by subtraction so deposit + balance === fare exactly.
        $deposit = min($deposit, $fare);
        $balance = round($fare - $deposit, 2);

        return [
            'deposit' => $deposit,
            'balance' => $balance,
            'percent' => round($percent, 2),
        ];
    }

    /**
     * The online deposit actually charged for a cash booking, read from its
     * mirrored booking Payment (keyed by the Razorpay payment id). This is the
     * exact amount a cancellation can return online — the cash balance was
     * never collected here, it was to be paid to the driver at trip end. Falls
     * back to a fresh quote on the fare when nothing was mirrored (e.g. the
     * split engine was off at booking).
     */
    public function depositForBooking(?string $razorpayPaymentId, float $fare): float
    {
        $razorpayPaymentId = trim((string) $razorpayPaymentId);
        if ($razorpayPaymentId !== '') {
            $payment = Payment::query()
                ->where('razorpay_payment_id', $razorpayPaymentId)
                ->where('settlement_mode', Payment::SETTLE_BOOKING)
                ->latest('id')
                ->first();
            if ($payment && $payment->cash_deposit_amount !== null) {
                return (float) $payment->cash_deposit_amount;
            }
        }

        return $this->quote($fare)['deposit'];
    }
}
