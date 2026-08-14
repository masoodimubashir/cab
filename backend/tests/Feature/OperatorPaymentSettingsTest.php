<?php

namespace Tests\Feature;

use App\Models\OperatorSetting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Module 1 — payment-method config moved onto the global operator_settings row:
 * three switches (Online / GPay / Cash) plus a percentage cash deposit. Guards:
 * at least one method must stay on, and the deposit stays within 0–100%.
 */
class OperatorPaymentSettingsTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $now = now();
        $this->admin = User::factory()->create(['manager_all_cities' => true]);
        $this->admin->addRole('admin');
        $roleId = DB::table('manager_roles')->insertGetId([
            'slug' => 'super_admin', 'name' => 'Super Admin', 'is_system' => true,
            'created_at' => $now, 'updated_at' => $now,
        ]);
        $this->admin->forceFill(['manager_role_id' => $roleId])->save();
    }

    private function asAdmin(): void
    {
        Sanctum::actingAs($this->admin, ['act-as:admin']);
    }

    public function test_show_returns_payment_method_fields_with_defaults(): void
    {
        $this->asAdmin();

        $res = $this->getJson('/api/admin/operator-settings');

        $res->assertOk()
            ->assertJsonPath('settings.payment_online_enabled', true)
            ->assertJsonPath('settings.payment_gpay_enabled', true)
            ->assertJsonPath('settings.payment_cash_enabled', false);

        // Deposit defaults to 20% (stored as decimal:2 → "20.00").
        $this->assertEquals(20, (float) $res->json('settings.cash_deposit_percent'));
    }

    public function test_update_persists_switches_and_deposit(): void
    {
        $this->asAdmin();

        $this->patchJson('/api/admin/operator-settings', [
            'payment_online_enabled' => true,
            'payment_gpay_enabled' => false,
            'payment_cash_enabled' => true,
            'cash_deposit_percent' => 25,
        ])->assertOk();

        $settings = OperatorSetting::instance()->fresh();
        $this->assertTrue((bool) $settings->payment_online_enabled);
        $this->assertFalse((bool) $settings->payment_gpay_enabled);
        $this->assertTrue((bool) $settings->payment_cash_enabled);
        $this->assertEquals(25, (float) $settings->cash_deposit_percent);
    }

    public function test_update_persists_tips_enabled_toggle(): void
    {
        $this->asAdmin();

        // Off by default.
        $this->assertFalse((bool) OperatorSetting::instance()->tips_enabled);

        $this->patchJson('/api/admin/operator-settings', ['tips_enabled' => true])->assertOk();
        $this->assertTrue((bool) OperatorSetting::instance()->fresh()->tips_enabled);

        $this->patchJson('/api/admin/operator-settings', ['tips_enabled' => false])->assertOk();
        $this->assertFalse((bool) OperatorSetting::instance()->fresh()->tips_enabled);
    }

    public function test_cannot_disable_all_payment_methods_at_once(): void
    {
        $this->asAdmin();

        $this->patchJson('/api/admin/operator-settings', [
            'payment_online_enabled' => false,
            'payment_gpay_enabled' => false,
            'payment_cash_enabled' => false,
        ])->assertStatus(422);
    }

    public function test_partial_update_cannot_turn_off_the_last_remaining_method(): void
    {
        $this->asAdmin();

        // Leave only Online on.
        OperatorSetting::instance()->forceFill([
            'payment_online_enabled' => true,
            'payment_gpay_enabled' => false,
            'payment_cash_enabled' => false,
        ])->save();

        // A request that only turns Online off would leave nothing enabled —
        // resolved against the stored (off) GPay/Cash, so it must be rejected.
        $this->patchJson('/api/admin/operator-settings', [
            'payment_online_enabled' => false,
        ])->assertStatus(422);
    }

    public function test_cash_deposit_percent_must_be_within_range(): void
    {
        $this->asAdmin();

        $this->patchJson('/api/admin/operator-settings', [
            'payment_cash_enabled' => true,
            'cash_deposit_percent' => -5,
        ])->assertStatus(422);

        $this->patchJson('/api/admin/operator-settings', [
            'payment_cash_enabled' => true,
            'cash_deposit_percent' => 150,
        ])->assertStatus(422);
    }
}
