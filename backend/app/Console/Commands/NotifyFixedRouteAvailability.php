<?php

namespace App\Console\Commands;

use App\Services\FixedRouteAlertService;
use Illuminate\Console\Command;

class NotifyFixedRouteAvailability extends Command
{
    protected $signature = 'fixed:notify-availability';
    protected $description = 'Send one-time alerts for newly available fixed-route departures.';

    public function handle(FixedRouteAlertService $alerts): int
    {
        $this->info('Availability alerts sent: '.$alerts->dispatch());
        return self::SUCCESS;
    }
}
