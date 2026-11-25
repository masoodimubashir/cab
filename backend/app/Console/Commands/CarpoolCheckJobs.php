<?php

namespace App\Console\Commands;

use App\Services\Carpool\CarpoolJobStatus;
use App\Services\Carpool\CarpoolSwitch;
use App\Services\NotificationCenter;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;

/**
 * W7 (Admin-Audit.md F-01): tells the admins when the carpool jobs have stopped, instead of waiting for
 * someone to open Carpool > Settings. Runs every 30 minutes; sends one notice, then stays quiet for six
 * hours while the problem lasts. Silent while carpool is switched off.
 */
class CarpoolCheckJobs extends Command
{
    protected $signature = 'carpool:check-jobs';

    protected $description = 'Notify admins when the carpool jobs are late';

    public function handle(NotificationCenter $notes): int
    {
        if (CarpoolSwitch::killed()) {
            return self::SUCCESS;
        }
        $late = collect(CarpoolJobStatus::all())->where('late', true);
        if ($late->isEmpty()) {
            Cache::forget('carpool:jobs-late-notified');

            return self::SUCCESS;
        }
        if (! Cache::add('carpool:jobs-late-notified', 1, now()->addHours(6))) {
            return self::SUCCESS;
        }
        $notes->notifyAdmins(
            'carpool_jobs_late',
            'Carpool jobs are late',
            'These jobs have not run on time: ' . $late->pluck('label')->implode('; ') . '. Carpools that should be cancelled or finished stay as they are. Check that the scheduler is running.',
            ['link' => '/carpool/settings'],
            'alert-triangle',
        );
        $this->warn('Late: ' . $late->pluck('job')->implode(', '));

        return self::SUCCESS;
    }
}
