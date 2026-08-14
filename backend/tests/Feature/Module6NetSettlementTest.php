<?php

namespace Tests\Feature;

use App\Models\Driver;
use App\Models\DriverSettlement;
use App\Models\OperatorSetting;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\NetSettlementService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Module 6 — the net settlement engine (Model B).
 *
 *   - NetSettlementService states a driver's position from the wallet:
 *     owed_by_company vs owed_by_driver, and the net (= balance) with the right
 *     sign.
 *   - Recording a payout snapshots that position into driver_settlements.
 *   - Go-online is blocked once the driver owes more than the operator's cash
 *     exposure limit (wallet_cash_min_capping).
 */
class Module6NetSettlementTest extends TestCase
{
    use RefreshDatabase;

    private function driver(): User
    {
        $u = User::factory()->create();
        $u->addRole('driver');

        return $u;
    }

    private function credit(User $u, float $amount, string $reason): void
    {
        WalletTransaction::query()->create([
            'user_id' => $u->id, 'amount' => $amount,
            'type' => WalletTransaction::TYPE_CREDIT, 'reason' => $reason,
        ]);
    }

    private function debit(User $u, float $amount, string $reason): void
    {
        WalletTransaction::query()->create([
            'user_id' => $u->id, 'amount' => $amount,
            'type' => WalletTransaction::TYPE_DEBIT, 'reason' => $reason,
        ]);
    }

    // ── the position math ──

    public function test_a_driver_owed_more_than_they_owe_has_a_positive_net(): void
    {
        $driver = $this->driver();
        // Earned ₹90 online, owes ₹20 commission on a cash ride.
        $this->credit($driver, 90, 'Ride earnings');
        $this->debit($driver, 20, 'Cash ride commission');

        $p = app(NetSettlementService::class)->position($driver);

        $this->assertSame(90.0, $p['earnings']);
        $this->assertSame(20.0, $p['commission']);
        $this->assertSame(70.0, $p['net']);
        $this->assertSame(70.0, $p['owed_by_company']);
        $this->assertSame(0.0, $p['owed_by_driver']);
    }

    public function test_a_driver_who_owes_more_than_they_earned_has_a_negative_net(): void
    {
        $driver = $this->driver();
        // Lots of cash rides: ₹30 earned, ₹100 commission owed.
        $this->credit($driver, 30, 'Ride earnings');
        $this->debit($driver, 100, 'Cash ride commission');

        $p = app(NetSettlementService::class)->position($driver);

        $this->assertSame(-70.0, $p['net']);
        $this->assertSame(0.0, $p['owed_by_company']);
        $this->assertSame(70.0, $p['owed_by_driver']);
    }

    public function test_a_top_up_counts_as_the_drivers_own_money_not_earnings(): void
    {
        $driver = $this->driver();
        $this->credit($driver, 500, 'Wallet top-up (Razorpay)');
        $this->debit($driver, 120, 'Cash ride commission');

        $p = app(NetSettlementService::class)->position($driver);

        $this->assertSame(500.0, $p['deposits']);
        $this->assertSame(0.0, $p['earnings']);
        $this->assertSame(120.0, $p['commission']);
        $this->assertSame(380.0, $p['net'], 'their float covers the commission');
        $this->assertSame(380.0, $p['owed_by_company']);
    }

    // ── settlement record on payout ──

    public function test_recording_a_payout_snapshots_the_position_and_returns_it(): void
    {
        $driverUser = $this->driver();
        $driver = Driver::query()->create([
            'user_id' => $driverUser->id, 'approval_status' => 'approved',
            'service_scope' => 'local', 'service_mode' => 'private', 'is_online' => false,
        ]);
        $this->credit($driverUser, 100, 'Ride earnings');

        $admin = User::factory()->create(['manager_all_cities' => true]);
        $admin->addRole('admin');
        $roleId = DB::table('manager_roles')->insertGetId([
            'slug' => 'super_admin', 'name' => 'Super Admin', 'is_system' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $admin->forceFill(['manager_role_id' => $roleId])->save();
        Sanctum::actingAs($admin, ['act-as:admin']);

        $payoutResp = $this->postJson("/api/admin/drivers/{$driver->id}/wallet/payout", [
            'amount' => 100, 'method' => 'gpay', 'reference' => 'UTR123',
        ])->assertCreated();
        $this->assertEquals(0.0, $payoutResp->json('settlement.net'));

        // The snapshot captured what was owed BEFORE the payout, and how much paid.
        $this->assertDatabaseHas('driver_settlements', [
            'user_id' => $driverUser->id,
            'owed_by_company' => 100.00,
            'owed_by_driver' => 0.00,
            'net' => 100.00,
            'amount_paid' => 100.00,
            'method' => 'gpay',
        ]);

        // The wallet is settled to zero and the history is visible on both sides.
        $adminResp = $this->getJson("/api/admin/drivers/{$driver->id}/settlement")->assertOk();
        $this->assertEquals(0.0, $adminResp->json('position.net'));
        $this->assertCount(1, $adminResp->json('history'));

        Sanctum::actingAs($driverUser, ['act-as:driver']);
        $driverResp = $this->getJson('/api/drivers/me/settlement')->assertOk();
        $this->assertEquals(0.0, $driverResp->json('position.net'));
        $this->assertCount(1, $driverResp->json('history'));
    }

    // ── exposure-limit go-online block ──

    private function onlineReadyDriver(): User
    {
        $u = User::factory()->create();
        $u->addRole('driver');
        Driver::query()->create([
            'user_id' => $u->id, 'approval_status' => 'approved', 'approved_at' => now(),
            'service_scope' => 'local', 'service_mode' => 'private', 'is_online' => false,
        ]);

        return $u;
    }

    public function test_go_online_is_blocked_once_debt_passes_the_exposure_limit(): void
    {
        OperatorSetting::instance()->update([
            'check_driver_debt' => true,
            'wallet_cash_min_capping' => -500,   // up to ₹500 of debt tolerated
        ]);

        $driver = $this->onlineReadyDriver();
        $this->debit($driver, 600, 'Cash ride commission'); // owes ₹600 > ₹500 limit

        Sanctum::actingAs($driver, ['act-as:driver']);
        $this->postJson('/api/drivers/go-online')
            ->assertStatus(422)
            ->assertJsonPath('error_code', 'driver_debt')
            ->assertJsonPath('limit', -500);

        $this->assertFalse((bool) Driver::query()->where('user_id', $driver->id)->value('is_online'));
    }

    public function test_go_online_is_allowed_while_debt_stays_within_the_exposure_limit(): void
    {
        OperatorSetting::instance()->update([
            'check_driver_debt' => true,
            'wallet_cash_min_capping' => -500,
        ]);

        $driver = $this->onlineReadyDriver();
        $this->debit($driver, 300, 'Cash ride commission'); // owes ₹300 ≤ ₹500 limit

        Sanctum::actingAs($driver, ['act-as:driver']);
        $this->postJson('/api/drivers/go-online')->assertOk();

        $this->assertTrue((bool) Driver::query()->where('user_id', $driver->id)->value('is_online'));
    }
}
