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
            ->assertJsonPath('timezone', 'Asia/Kolkata');
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
