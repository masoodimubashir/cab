<?php

namespace App\Console\Commands;

use App\Services\PayoutReconciliationService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * The payout-side sweeper — the safety net under the Route webhooks, and the
 * thing that makes stuck money eventually unstick without anyone reading a log.
 * Every run:
 *
 *   - asks Razorpay about transfers still `created` (webhook never arrived),
 *   - pays out shares parked for a driver who has since been verified,
 *   - re-checks payout accounts still pending KYC,
 *   - retries refunds Razorpay rejected.
 *
 * Inert while the split engine is disabled. Works even with a blank
 * RAZORPAY_WEBHOOK_SECRET: it authenticates with the normal API key pair.
 */
class ReconcilePayouts extends Command
{
    protected $signature = 'payments:reconcile-payouts
        {--stale-minutes=30 : Only touch records unchanged for at least this long}
        {--lookback-hours=168 : Ignore records older than this}
        {--batch=50 : Max records per pass}';

    protected $description = 'Reconcile Route transfers, held driver earnings, payout accounts and failed refunds against the Razorpay API';

    public function handle(PayoutReconciliationService $payouts): int
    {
        if (! $payouts->enabled()) {
            $this->info('Payout reconciliation: split engine disabled, nothing to do.');

            return self::SUCCESS;
        }

        $stats = $payouts->sweepPayouts(
            max(1, (int) $this->option('stale-minutes')),
            max(1, (int) $this->option('lookback-hours')),
            max(1, (int) $this->option('batch')),
        );

        $summary = collect($stats)->map(fn ($v, $k) => "$k=$v")->implode(' ');
        $this->info('Payout reconciliation: ' . $summary);

        // Only log when something actually moved — this runs every 10 minutes.
        if (collect($stats)->sum() > 0) {
            Log::info('DreamCabs payout reconciliation sweep', $stats);
        }

        return self::SUCCESS;
    }
}
