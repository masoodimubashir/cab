<?php

namespace App\Console\Commands;

use App\Services\SubscriptionService;
use Illuminate\Console\Command;

/**
 * Sweeps active driver subscriptions that have run past their expiry date or
 * used up their ride/earnings allowance and flips them to "expired".
 *
 * activeFor() already expires lazily on read, so correctness doesn't depend on
 * this; it keeps the data tidy for reporting and stops stale "active" rows from
 * lingering for drivers who haven't opened the app.
 */
class ExpireSubscriptions extends Command
{
    protected $signature = 'subscriptions:expire';

    protected $description = 'Expire driver subscriptions that have passed their date or used up their allowance.';

    public function handle(SubscriptionService $subscriptions): int
    {
        $count = $subscriptions->expireDue();

        if ($count > 0) {
            $this->info("Expired {$count} subscription(s).");
        }

        return self::SUCCESS;
    }
}
