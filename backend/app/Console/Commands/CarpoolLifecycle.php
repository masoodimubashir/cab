<?php

namespace App\Console\Commands;

use App\Services\Carpool\CarpoolJobStatus;
use App\Services\Carpool\CarpoolPlanService;
use App\Services\Carpool\CarpoolRideService;
use App\Services\Carpool\CarpoolSwitch;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * Carpool scheduled jobs (Carpool.md P8): cancel carpools not started by the
 * end of their departure day, complete rides left open past the setting's
 * hours, apply the plan grace rule and send the plan-ending reminder. All day rules use India time.
 * Each step runs on its own (one failing does not stop the others), and the
 * heartbeat is written only after the work (Admin-Audit.md F-03).
 */
class CarpoolLifecycle extends Command
{
    public const HEARTBEAT_KEY = 'carpool:lifecycle:last_run';

    protected $signature = 'carpool:lifecycle';

    protected $description = 'Cancel missed carpools, auto-complete old rides and apply the plan grace rule';

    public function handle(CarpoolRideService $rides, CarpoolPlanService $plans): int
    {
        if (CarpoolSwitch::killed()) {
            return self::SUCCESS;
        }
        $errors = [];
        $steps = [
            'Missed departures cancelled' => fn () => $rides->cancelMissed(),
            'Rides auto-completed' => fn () => $rides->autoComplete(),
            'Cancelled by the grace rule' => fn () => $rides->applyGrace(),
            'Plan ending reminders sent' => fn () => $plans->notifyEnding(),
            'Cancelled after a document expired' => fn () => $rides->applyDocuments(),
            'Document expiry warnings sent' => fn () => app(\App\Services\Carpool\CarpoolDocuments::class)->warnExpiring(),
            'Old car positions removed' => fn () => app(\App\Services\Carpool\CarpoolTracking::class)->prune(),
        ];
        foreach ($steps as $label => $step) {
            try {
                $this->info($label . ': ' . $step());
            } catch (\Throwable $e) {
                $errors[] = $label . ': ' . $e->getMessage();
                Log::error('carpool:lifecycle step failed', ['step' => $label, 'error' => $e->getMessage()]);
            }
        }
        Cache::forever(self::HEARTBEAT_KEY, now()->toIso8601String());
        CarpoolJobStatus::finished($this->getName(), $errors ? implode(' | ', $errors) : null);

        return $errors ? self::FAILURE : self::SUCCESS;
    }
}
