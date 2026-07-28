<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Schedule::command('negotiations:cleanup')
    ->everyMinute()
    ->withoutOverlapping()
    ->runInBackground();

Schedule::command('device-tokens:prune')
    ->dailyAt('03:30')
    ->withoutOverlapping()
    ->runInBackground();

Schedule::command('dispatch:wake-scheduled')
    ->everyMinute()
    ->withoutOverlapping()
    ->runInBackground();

Schedule::command('drivers:reap-stale')
    ->everyMinute()
    ->withoutOverlapping()
    ->runInBackground();

Schedule::command('subscriptions:expire')
    ->hourly()
    ->withoutOverlapping()
    ->runInBackground();

Schedule::command('subscriptions:notify-expiring')
    ->hourly()
    ->withoutOverlapping()
    ->runInBackground();


// Dispatch fixed forming vehicles that are due.
Schedule::command('routes:dispatch-due')
    ->everyMinute()
    ->withoutOverlapping()
    ->runInBackground();

// B1: reconcile anything stuck PENDING >15 min against the Razorpay API —
// the safety net for webhooks that never arrived.
Schedule::command('payments:reconcile-pending')
    ->everyTenMinutes()
    ->withoutOverlapping()
    ->runInBackground();

// Payout side of the same safety net: Route transfers with no webhook, shares
// parked for a driver who is verified now, payout accounts still pending KYC,
// and refunds Razorpay rejected. No-op while the split engine is off.
Schedule::command('payments:reconcile-payouts')
    ->everyTenMinutes()
    ->withoutOverlapping()
    ->runInBackground();
