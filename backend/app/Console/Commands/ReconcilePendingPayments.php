<?php

namespace App\Console\Commands;

use App\Services\PaymentReconciliationService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * B1 sweeper — the safety net under the webhook. Every run asks Razorpay's
 * Orders API about anything still PENDING after 15 minutes (solo payments,
 * wallet top-ups, fixed seat holds, shuttle bookings) plus fixed refunds we
 * created that Razorpay hasn't confirmed, and fixes our records to match
 * what actually happened to the money.
 *
 * Works even while RAZORPAY_WEBHOOK_SECRET is blank: it authenticates with
 * the normal API key pair, not the webhook secret.
 */
class ReconcilePendingPayments extends Command
{
    protected $signature = 'payments:reconcile-pending
        {--stale-minutes=15 : Only touch records unchanged for at least this long}
        {--lookback-hours=48 : Ignore records older than this}';

    protected $description = 'Reconcile PENDING Razorpay payments/top-ups/holds/bookings and unsettled refunds against the Razorpay API';

    public function handle(PaymentReconciliationService $reconciler): int
    {
        $stats = $reconciler->reconcilePending(
            max(1, (int) $this->option('stale-minutes')),
            max(1, (int) $this->option('lookback-hours')),
        );

        $summary = collect($stats)->map(fn ($v, $k) => "$k=$v")->implode(' ');
        $this->info('Payment reconciliation: ' . $summary);

        if (($stats['checked'] ?? 0) > 0) {
            Log::info('DreamCabs payment reconciliation sweep', $stats);
        }

        return self::SUCCESS;
    }
}
