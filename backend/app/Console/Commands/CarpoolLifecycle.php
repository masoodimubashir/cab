<?php

namespace App\Console\Commands;

use App\Services\Carpool\CarpoolRideService;
use App\Services\Carpool\CarpoolSwitch;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;

/**
 * Carpool scheduled jobs (Carpool.md P8): cancel carpools not started by the
 * end of their departure day, complete rides left open past the setting's
 * hours, and apply the plan grace rule. All day rules use India time.
 */
class CarpoolLifecycle extends Command
{
    public const HEARTBEAT_KEY = 'carpool:lifecycle:last_run';

    protected $signature = 'carpool:lifecycle';

    protected $description = 'Cancel missed carpools, auto-complete old rides and apply the plan grace rule';

    public function handle(CarpoolRideService $rides): int
    {
        if (CarpoolSwitch::killed()) {
            return self::SUCCESS;
        }
        Cache::forever(self::HEARTBEAT_KEY, now()->toIso8601String());
        $this->info('Missed departures cancelled: ' . $rides->cancelMissed());
        $this->info('Rides auto-completed: ' . $rides->autoComplete());
        $this->info('Cancelled by the grace rule: ' . $rides->applyGrace());

        return self::SUCCESS;
    }
}
