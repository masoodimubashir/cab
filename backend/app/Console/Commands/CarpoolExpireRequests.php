<?php

namespace App\Console\Commands;

use App\Services\Carpool\CarpoolRequestService;
use App\Services\Carpool\CarpoolSwitch;
use Illuminate\Console\Command;

/** Closes waiting requests whose pickup the car passed long ago (carpool.pending_expire_after_pickup_minutes). */
class CarpoolExpireRequests extends Command
{
    protected $signature = 'carpool:expire-requests';

    protected $description = 'Close waiting carpool requests the car has driven past';

    public function handle(CarpoolRequestService $requests): int
    {
        if (CarpoolSwitch::killed()) {
            return self::SUCCESS;
        }
        $this->info('Requests closed: ' . $requests->expirePassedPickups());

        return self::SUCCESS;
    }
}
