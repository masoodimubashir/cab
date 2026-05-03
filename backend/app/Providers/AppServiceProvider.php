<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        RateLimiter::for('otp', function (Request $request) {
            $key = 'otp:' . ($request->ip() ?? 'unknown');
            return [Limit::perMinute(5)->by($key)];
        });

        RateLimiter::for('booking', function (Request $request) {
            $userId = optional($request->user())->id;
            $key = 'booking:' . ($userId ?: $request->ip());
            return [Limit::perMinute(15)->by((string) $key)];
        });

        RateLimiter::for('location', function (Request $request) {
            $userId = optional($request->user())->id;
            $key = 'location:' . ($userId ?: $request->ip());
            return [Limit::perMinute(60)->by((string) $key)];
        });

        RateLimiter::for('chat', function (Request $request) {
            $userId = optional($request->user())->id;
            $key = 'chat:' . ($userId ?: $request->ip());
            return [Limit::perMinute(30)->by((string) $key)];
        });

        RateLimiter::for('webhooks', function (Request $request) {
            return [Limit::perMinute(120)->by('webhook:' . ($request->ip() ?? 'unknown'))];
        });
    }
}
