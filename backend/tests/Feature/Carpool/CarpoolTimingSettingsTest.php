<?php

namespace Tests\Feature\Carpool;

use App\Models\Carpool\CarpoolSetting;
use App\Models\User;
use App\Services\Carpool\CarpoolClock;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Hardening slice S4: five timing values moved from config onto the carpool_settings row.
 * The defaults must reproduce the old behaviour, and the single reader must follow the row.
 */
class CarpoolTimingSettingsTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_fresh_settings_row_has_the_values_the_code_used_before(): void
    {
        $s = CarpoolSetting::current();

        $this->assertSame(30, $s->publish_horizon_days);
        $this->assertSame(60, $s->start_early_minutes);
        $this->assertSame(15, $s->pending_expire_minutes);
        $this->assertSame(1, $s->plan_grace_days);
        $this->assertSame(0, $s->missed_departure_days);
        // The four settings that existed before are untouched.
        $this->assertFalse($s->enabled);
        $this->assertSame(2000, $s->search_distance_m);
        $this->assertSame(12, $s->auto_complete_hours);
        $this->assertSame(1, $s->chat_retention_days);
    }

    public function test_the_reader_follows_the_row_and_a_save_shows_at_once(): void
    {
        $this->assertSame(30, CarpoolSetting::number('publish_horizon_days'));
        CarpoolSetting::current()->update(['publish_horizon_days' => 45, 'start_early_minutes' => 20, 'pending_expire_minutes' => 40, 'plan_grace_days' => 3]);

        $this->assertSame(45, CarpoolSetting::number('publish_horizon_days'));
        $this->assertSame(20, CarpoolSetting::number('start_early_minutes'));
        $this->assertSame(40, CarpoolSetting::number('pending_expire_minutes'));
        $this->assertSame(3, CarpoolSetting::number('plan_grace_days'));
    }

    public function test_a_cached_row_from_before_the_migration_falls_back_to_the_config(): void
    {
        // What the cache holds on a server that has not picked up the new columns yet.
        Cache::put('carpool.settings', [
            'id' => 1, 'enabled' => 1, 'search_distance_m' => 2000, 'auto_complete_hours' => 12, 'chat_retention_days' => 1,
        ], 300);

        $this->assertSame(30, CarpoolSetting::number('publish_horizon_days'));
        $this->assertSame(60, CarpoolSetting::number('start_early_minutes'));
        $this->assertSame(15, CarpoolSetting::number('pending_expire_minutes'));
        $this->assertSame(1, CarpoolSetting::number('plan_grace_days'));
        $this->assertSame(0, CarpoolSetting::missedDepartureDays());

        config(['carpool.publish_horizon_days' => 21]);
        $this->assertSame(21, CarpoolSetting::number('publish_horizon_days'));
    }

    public function test_missed_departure_days_is_zero_for_end_of_day_or_one_for_the_next_day(): void
    {
        $this->assertSame(0, CarpoolSetting::missedDepartureDays());
        CarpoolSetting::current()->update(['missed_departure_days' => 1]);
        $this->assertSame(1, CarpoolSetting::missedDepartureDays());
        CarpoolSetting::current()->update(['missed_departure_days' => 0]);
        $this->assertSame(0, CarpoolSetting::missedDepartureDays());
    }

    public function test_the_publish_horizon_follows_the_setting_in_the_clock_and_in_config(): void
    {
        CarpoolSetting::current()->update(['enabled' => true]);
        Sanctum::actingAs(User::factory()->create(['phone' => '9990006001']));
        $in = fn (int $days) => CarpoolClock::now()->addDays($days)->setTime(12, 0);

        $this->assertTrue(CarpoolClock::withinPublishHorizon($in(30)));
        $this->assertFalse(CarpoolClock::withinPublishHorizon($in(40)));
        $this->getJson('/api/carpool/config')->assertOk()->assertJsonPath('publish_horizon_days', 30);

        CarpoolSetting::current()->update(['publish_horizon_days' => 45]);

        $this->assertTrue(CarpoolClock::withinPublishHorizon($in(40)));
        $this->assertFalse(CarpoolClock::withinPublishHorizon($in(50)));
        $this->getJson('/api/carpool/config')->assertOk()->assertJsonPath('publish_horizon_days', 45);
    }
}
