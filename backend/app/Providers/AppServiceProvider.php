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
        // Broadcasting routes are wired in bootstrap/app.php via ->withBroadcasting()
        // so the channels file loads with the right middleware. Don't call
        // Broadcast::routes() again here — once the route is registered it can't
        // be redefined, and a duplicate call silently no-ops.

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
            // Shared bucket across /drivers/location (10s presence),
            // /trips/{id}/location (5s trip), and /trips/{id}/customer-location
            // (5s customer). Steady-state on an active trip is ~18 req/min per
            // user; the bump to 300/min covers brief GPS bursts, hot-reloads
            // during dev, and a parallel customer stream without blocking.
            // TripTrackingController already enforces a 5s server-side minimum
            // before persisting, so this only guards against outright spam.
            $userId = optional($request->user())->id;
            $key = 'location:' . ($userId ?: $request->ip());
            return [Limit::perMinute(300)->by((string) $key)];
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
