<?php

namespace App\Console\Commands;

use App\Services\Carpool\CarpoolJobStatus;
use App\Services\Carpool\CarpoolRequestService;
use App\Services\Carpool\CarpoolSwitch;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

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
        try {
            $this->info('Requests closed: ' . $requests->expirePassedPickups());
            CarpoolJobStatus::finished($this->getName());
        } catch (\Throwable $e) {
            Log::error('carpool:expire-requests failed', ['error' => $e->getMessage()]);
            CarpoolJobStatus::finished($this->getName(), $e->getMessage());

            return self::FAILURE;
        }

        return self::SUCCESS;
    }
}
