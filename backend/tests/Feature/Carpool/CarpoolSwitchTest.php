<?php

namespace Tests\Feature\Carpool;

use App\Models\Carpool\CarpoolSetting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** The two carpool switches and /api/carpool/config (Carpool-Integration-Guide section 3). */
class CarpoolSwitchTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // A stand-in carpool endpoint behind the same middleware real ones will use.
        Route::middleware(['api', 'auth:sanctum', 'carpool.enabled'])
            ->get('/api/carpool/_probe', fn () => response()->json(['ok' => true]));

        Sanctum::actingAs(User::factory()->create(), ['act-as:customer']);
    }

    private function enable(bool $on): void
    {
        CarpoolSetting::current()->update(['enabled' => $on]);
    }

    public function test_settings_survive_a_serializing_cache(): void
    {
        // Real servers use file or Redis caches, where cached objects can't be
        // rebuilt (cache.serializable_classes is off). Only plain values may be cached.
        CarpoolSetting::current();
        $this->assertIsArray(\Illuminate\Support\Facades\Cache::get('carpool.settings'));

        config(['cache.default' => 'file']);
        \Illuminate\Support\Facades\Cache::forget('carpool.settings');
        $this->enable(true);
        CarpoolSetting::current();
        $this->assertTrue(CarpoolSetting::current()->enabled);
        \Illuminate\Support\Facades\Cache::forget('carpool.settings');
    }

    public function test_settings_row_starts_with_the_spec_defaults(): void
    {
        $s = CarpoolSetting::current();

        $this->assertFalse($s->enabled);
        $this->assertSame(2000, $s->search_distance_m);
        $this->assertSame(12, $s->auto_complete_hours);
        $this->assertSame(1, $s->chat_retention_days);
    }

    public function test_config_says_off_by_default(): void
    {
        $this->getJson('/api/carpool/config')->assertOk()->assertExactJson(['enabled' => false, 'driver_signup' => true]);
    }

    public function test_config_reports_settings_when_enabled(): void
    {
        $this->enable(true);

        $this->getJson('/api/carpool/config')->assertOk()
            ->assertJsonPath('enabled', true)
            ->assertJsonPath('search_distance_m', 2000)
            ->assertJsonPath('publish_horizon_days', 30)
            ->assertJsonPath('start_early_minutes', 60)
            ->assertJsonPath('pending_expire_minutes', 15)
            ->assertJsonPath('plan_grace_days', 1)
            ->assertJsonPath('missed_departure_days', 0)
            ->assertJsonPath('timezone', 'Asia/Kolkata');
    }

    public function test_config_follows_a_changed_timing_setting_and_keeps_every_older_field(): void
    {
        $this->enable(true);
        CarpoolSetting::current()->update(['publish_horizon_days' => 45, 'start_early_minutes' => 20, 'pending_expire_minutes' => 30, 'plan_grace_days' => 0, 'missed_departure_days' => 1]);

        $r = $this->getJson('/api/carpool/config')->assertOk()
            ->assertJsonPath('publish_horizon_days', 45)->assertJsonPath('start_early_minutes', 20)
            ->assertJsonPath('pending_expire_minutes', 30)->assertJsonPath('plan_grace_days', 0)->assertJsonPath('missed_departure_days', 1);

        // Apps already in the field read these; none may disappear or change name (additive only).
        foreach (['enabled', 'driver_signup', 'search_distance_m', 'publish_horizon_days', 'seats_max', 'message_max_chars', 'chat_retention_days', 'timezone', 'tile_name', 'tile_image_url'] as $key) {
            $this->assertArrayHasKey($key, $r->json(), $key);
        }
    }

    public function test_config_tells_the_apps_how_far_the_delay_button_moves_the_carpool(): void
    {
        $this->enable(true);
        $this->getJson('/api/carpool/config')->assertOk()->assertJsonPath('delay_minutes', 10);

        config(['carpool.delay_minutes' => 15]);
        $this->getJson('/api/carpool/config')->assertJsonPath('delay_minutes', 15);

        config(['carpool.delay_minutes' => 0]);
        $this->getJson('/api/carpool/config')->assertJsonPath('delay_minutes', 1);
    }

    public function test_saving_settings_clears_the_cache(): void
    {
        $this->enable(true);
        $this->getJson('/api/carpool/config')->assertJsonPath('enabled', true);

        $this->enable(false);
        $this->getJson('/api/carpool/config')->assertExactJson(['enabled' => false, 'driver_signup' => true]);
    }

    public function test_kill_switch_overrides_the_admin_setting(): void
    {
        $this->enable(true);
        config(['carpool.kill_switch' => true]);

        $this->getJson('/api/carpool/config')->assertOk()->assertExactJson(['enabled' => false, 'driver_signup' => false]);
        $this->getJson('/api/carpool/_probe')->assertNotFound();
    }

    public function test_carpool_routes_answer_when_kill_switch_is_off(): void
    {
        $this->getJson('/api/carpool/_probe')->assertOk();
    }

    public function test_config_needs_a_login(): void
    {
        $this->app['auth']->forgetGuards();

        $this->withHeaders(['Authorization' => ''])->getJson('/api/carpool/config')->assertUnauthorized();
    }
}
