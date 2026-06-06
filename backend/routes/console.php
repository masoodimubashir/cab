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

// Roll shuttle timetables forward into concrete dated departures (idempotent).
Schedule::command('routes:materialize-departures --days=14')
    ->dailyAt('02:00')
    ->withoutOverlapping()
    ->runInBackground();

// Dispatch shared-ride departures that are due (shuttle alarm + fixed forming).
Schedule::command('routes:dispatch-due')
    ->everyMinute()
    ->withoutOverlapping()
    ->runInBackground();
