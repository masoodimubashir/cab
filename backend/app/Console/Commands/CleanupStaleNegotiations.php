<?php

namespace App\Console\Commands;

use App\Models\Trip;
use App\Services\TripStateMachineService;
use Illuminate\Console\Command;

class CleanupStaleNegotiations extends Command
{
    protected $signature = 'negotiations:cleanup
                            {--minutes=10 : Cancel negotiations older than this many minutes}';

    protected $description = 'Cancel trips stuck in NEGOTIATION longer than the threshold (customer abandoned the app, server-side timeout).';

    public function handle(TripStateMachineService $stateMachine): int
    {
        $minutes = (int) $this->option('minutes');
        $cutoff = now()->subMinutes($minutes);

        $count = 0;
        Trip::query()
            ->where('status', 'NEGOTIATION')
            ->where('created_at', '<', $cutoff)
            ->cursor()
            ->each(function (Trip $trip) use ($stateMachine, &$count) {
                try {
                    $stateMachine->transition($trip, 'CANCELLED', [
                        'cancelled_reason' => 'negotiation_timeout',
                    ]);
                    $count++;
                } catch (\Throwable $e) {
                    $this->error("Trip #{$trip->id}: {$e->getMessage()}");
                }
            });

        $this->info("Cancelled {$count} stale negotiation(s) older than {$minutes} minute(s).");
        return self::SUCCESS;
    }
}
