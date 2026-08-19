<?php

namespace Tests\Feature;

use App\Models\Driver;
use App\Models\DriverPayoutLedger;
use App\Models\OperatorSetting;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\PayoutLedgerService;
use App\Services\WalletService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Module 6 — Payout Ledger and Wallet Settlement Separation.
 *
 *   - PayoutLedgerService manages operator-held money and transfers independently.
 *   - Recording a payout transfer creates a TRANSFER in driver_payout_ledger and does NOT touch wallet.
 *   - Universal wallet limit check enforces minimum balance on debits.
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

    public function test_driver_payout_ledger_tracks_collections_and_pending_payouts(): void
    {
        $driver = $this->driver();
        $service = app(PayoutLedgerService::class);

        // Operator collected ₹200 online fare
        $service->recordCollection($driver, 200, DriverPayoutLedger::SOURCE_ONLINE_FARE);
        // Operator collected ₹50 upfront deposit
        $service->recordCollection($driver, 50, DriverPayoutLedger::SOURCE_ONLINE_DEPOSIT);

        $this->assertSame(250.0, $service->moneyCollected($driver));
        $this->assertSame(0.0, $service->moneyTransferred($driver));
        $this->assertSame(250.0, $service->pendingPayout($driver));
    }

    public function test_recording_a_payout_transfer_updates_pending_and_completed_payouts(): void
    {
        $driverUser = $this->driver();
        $driver = Driver::query()->create([
            'user_id' => $driverUser->id, 'approval_status' => 'approved',
            'service_scope' => 'local', 'service_mode' => 'private', 'is_online' => false,
        ]);

        $service = app(PayoutLedgerService::class);
        $service->recordCollection($driverUser, 100, DriverPayoutLedger::SOURCE_ONLINE_FARE);

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

        $this->assertSame(0.0, (float) $payoutResp->json('summary.pending_payout'));
        $this->assertSame(100.0, (float) $payoutResp->json('summary.completed_payout'));

        // Payout ledger row created as TRANSFER
        $this->assertDatabaseHas('driver_payout_ledger', [
            'driver_user_id' => $driverUser->id,
            'type' => 'TRANSFER',
            'amount' => 100.00,
            'method' => 'gpay',
            'reference' => 'UTR123',
        ]);

        // Wallet was NOT touched by the payout
        $this->assertSame(0.0, app(WalletService::class)->balance($driverUser));
    }

    public function test_payout_transfer_cannot_exceed_pending_amount(): void
    {
        $driverUser = $this->driver();
        $driver = Driver::query()->create([
            'user_id' => $driverUser->id, 'approval_status' => 'approved',
            'service_scope' => 'local', 'service_mode' => 'private', 'is_online' => false,
        ]);

        $service = app(PayoutLedgerService::class);
        $service->recordCollection($driverUser, 50, DriverPayoutLedger::SOURCE_ONLINE_FARE);

        $admin = User::factory()->create(['manager_all_cities' => true]);
        $admin->addRole('admin');
        $roleId = DB::table('manager_roles')->insertGetId([
            'slug' => 'super_admin', 'name' => 'Super Admin', 'is_system' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $admin->forceFill(['manager_role_id' => $roleId])->save();
        Sanctum::actingAs($admin, ['act-as:admin']);

        // Attempting to payout ₹100 when only ₹50 is pending
        $this->postJson("/api/admin/drivers/{$driver->id}/wallet/payout", [
            'amount' => 100, 'method' => 'gpay',
        ])->assertStatus(422);
    }
}
