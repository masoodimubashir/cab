<?php

namespace Tests\Feature\Carpool;

use App\Services\Carpool\CarpoolRequestService;
use App\Services\Carpool\RouteGeometry;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Tests\TestCase;

/**
 * Hardening slice S3: the numbers that were typed into code now live in config/carpool.php
 * (each with an env override). This pins every default to the value the code used before,
 * and checks that the code really reads the config.
 */
class CarpoolConfigTest extends TestCase
{
    public function test_every_default_is_the_value_the_code_used_before_the_move(): void
    {
        $expected = [
            'timezone' => 'Asia/Kolkata',
            'publish_horizon_days' => 30,
            'plan_warning_days' => 3,
            'plan_push_hours' => 24,
            'document_warning_days' => 7,
            'pickup_max_distance_m' => 300,
            'message_max_chars' => 1000,
            'messages_per_minute' => 20,
            'code_max_attempts' => 3,
            'code_lock_minutes' => 5,
            'plan_grace_days' => 1,
            'start_early_minutes' => 60,
            'pending_expire_after_pickup_minutes' => 15,
            'rating_min_count' => 3,
            'heartbeat_stale_hours' => 3,
            'seats_min' => 1,
            'seats_max' => 6,
            'route_max_points' => 500,
            'route_endpoint_max_m' => 2000,
            'route_min_m' => 1000,
            'route_max_m' => 1500000,
            'min_ride_m' => 300.0,
            'changed_notice_hours' => 24,
            'photo_max_kb' => 4096,
            'car_photo_max_kb' => 6144,
            'rate_limit_write_per_minute' => 20,
            'rate_limit_search_per_minute' => 60,
            'delay_minutes' => 10,
            'settings_cache_seconds' => 300,
        ];
        foreach ($expected as $key => $value) {
            $this->assertSame($value, config("carpool.{$key}"), "carpool.{$key}");
        }
        $this->assertSame(
            [
                'enabled' => false, 'search_distance_m' => 2000, 'auto_complete_hours' => 12, 'chat_retention_days' => 1,
                'publish_horizon_days' => 30, 'start_early_minutes' => 60, 'pending_expire_minutes' => 15,
                'plan_grace_days' => 1, 'missed_departure_days' => 0,
                'plan_warning_days' => 3, // admin setting since 2026-11-25, same value as before
                'plan_push_hours' => 24, // W4: the shared push used 24 hours before
                'document_warning_days' => 7, // S11
                'report_retention_days' => 180,
            ],
            config('carpool.defaults')
        );
        // The price cap was removed on purpose (D-05).
        $this->assertNull(config('carpool.price_max'));
    }

    public function test_the_rate_limiters_read_their_numbers_from_the_config(): void
    {
        $request = Request::create('/api/carpool/search', 'GET');

        $this->assertSame(20, RateLimiter::limiter('carpool-write')($request)[0]->maxAttempts);
        $this->assertSame(60, RateLimiter::limiter('carpool-search')($request)[0]->maxAttempts);

        config(['carpool.rate_limit_write_per_minute' => 7, 'carpool.rate_limit_search_per_minute' => 11]);

        $this->assertSame(7, RateLimiter::limiter('carpool-write')($request)[0]->maxAttempts);
        $this->assertSame(11, RateLimiter::limiter('carpool-search')($request)[0]->maxAttempts);
    }

    public function test_the_shortest_ride_follows_the_config_everywhere(): void
    {
        $this->assertSame(300.0, CarpoolRequestService::minRideM());
        config(['carpool.min_ride_m' => 750]);
        $this->assertSame(750.0, CarpoolRequestService::minRideM());

        // RouteGeometry::match given that number (as every service does): a straight 10 km line,
        // pickup near the start, drop 500 m further on, both exactly on the line (50 m tolerance). It fits a 300 m minimum but not a 750 m one.
        $line = [];
        for ($i = 0; $i <= 100; $i++) {
            $line[] = [34.07 + 0.09 * $i / 100, 74.77];
        }
        $geo = RouteGeometry::of($line);
        $pickup = [34.0750, 74.77];
        $drop = [34.0750 + 500 / 111320, 74.77];

        config(['carpool.min_ride_m' => 300]);
        $this->assertNotNull($geo->match($pickup[0], $pickup[1], $drop[0], $drop[1], 50.0, CarpoolRequestService::minRideM()));
        config(['carpool.min_ride_m' => 750]);
        $this->assertNull($geo->match($pickup[0], $pickup[1], $drop[0], $drop[1], 50.0, CarpoolRequestService::minRideM()));
    }
}
