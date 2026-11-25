<?php

namespace App\Services\Carpool;

use Illuminate\Support\Facades\Cache;

/**
 * Each carpool job records when it last finished and its last error, so Carpool > Settings
 * can show whether the jobs are running (Admin-Audit.md F-01, F-03).
 */
class CarpoolJobStatus
{
    /** job command => [label, expected interval in minutes] */
    public const JOBS = [
        'carpool:lifecycle' => ['Missed departures, auto-complete and the plan rule', 60],
        'carpool:expire-requests' => ['Waiting requests that ran out of time', 5],
        'carpool:prune-chats' => ['Deleting old chats and report text', 60],
    ];

    private static function key(string $job): string
    {
        return 'carpool:job:' . $job;
    }

    public static function finished(string $job, ?string $error = null): void
    {
        Cache::forever(self::key($job), [
            'finished_at' => now()->toIso8601String(),
            'error' => $error !== null ? mb_substr($error, 0, 300) : null,
        ]);
    }

    /** @return list<array{job: string, label: string, finished_at: ?string, error: ?string, late: bool}> */
    public static function all(): array
    {
        $out = [];
        foreach (self::JOBS as $job => [$label, $every]) {
            $s = Cache::get(self::key($job));
            $at = $s['finished_at'] ?? null;
            // Late when nothing has run for twice the interval plus 30 minutes of slack.
            $late = ! $at || now()->subMinutes($every * 2 + 30)->greaterThan(\Illuminate\Support\Carbon::parse($at));
            $out[] = ['job' => $job, 'label' => $label, 'finished_at' => $at, 'error' => $s['error'] ?? null, 'late' => $late];
        }

        return $out;
    }
}
