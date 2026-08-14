<?php

namespace Tests\Feature;

use App\Models\Driver;
use App\Models\Trip;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\CommissionSettlementService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Module 5 — a settled ride's wallet records are visible on BOTH sides: the
 * driver's own wallet API and the admin's per-driver transactions API show the
 * same movement. This is the "one trustworthy money trail" the settlement chain
 * (Modules 6–7) is built on.
 */
class Module5WalletVisibilityTest extends TestCase
{
    use RefreshDatabase;

    private int $cityId;
    private int $cvtId;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('services.payments.split_enabled', false);

        $now = now();
        $this->cityId = DB::table('cities')->insertGetId([
            'name' => 'Pune', 'country_code' => 'IN', 'created_at' => $now, 'updated_at' => $now,
        ]);
        DB::table('ride_types')->insert([
            'id' => 1, 'name' => 'Mini', 'description' => 'Mini', 'sort_order' => 1, 'created_at' => $now, 'updated_at' => $now,
        ]);
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Mini ' . uniqid(), 'sort_order' => 1, 'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
        ]);
        $this->cvtId = DB::table('city_vehicle_types')->insertGetId([
            'city_id' => $this->cityId, 'ride_type_id' => 1, 'vehicle_type_id' => $vehicleTypeId,
            'display_name' => 'Mini', 'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
        ]);
        \App\Models\PricingRule::query()->create([
            'city_id' => $this->cityId, 'ride_type_id' => 1, 'vehicle_type_id' => $vehicleTypeId,
            'city_vehicle_type_id' => $this->cvtId, 'base_fare' => 0, 'surge_multiplier' => 1,
            'commission_type' => 'percent', 'commission_percent' => 10, 'fixed_commission' => 0,
        ]);
    }

    public function test_a_settled_online_ride_is_visible_to_both_the_driver_and_the_admin(): void
    {
        $driverUser = User::factory()->create();
        $driverUser->addRole('driver');
        $driver = Driver::query()->create([
            'user_id' => $driverUser->id, 'approval_status' => 'approved',
            'service_scope' => 'local', 'service_mode' => 'private',
            'active_service_scope' => 'local', 'active_service_mode' => 'private',
            'is_online' => true, 'last_online_at' => now(),
        ]);

        $customer = User::factory()->create();
        $customer->addRole('customer');

        $trip = Trip::query()->create([
            'customer_id' => $customer->id, 'driver_id' => $driverUser->id,
            'city_id' => $this->cityId, 'ride_type_id' => 1, 'city_vehicle_type_id' => $this->cvtId,
            'status' => 'COMPLETED', 'payment_method' => 'razorpay',
            'estimated_fare' => 100, 'final_fare' => 100, 'currency' => 'INR',
            'pickup_lat' => 18.52, 'pickup_lng' => 73.85, 'drop_lat' => 18.50, 'drop_lng' => 73.80,
        ]);

        app(CommissionSettlementService::class)->settle($trip);

        // A record exists: ₹90 earning credit.
        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $driverUser->id, 'type' => WalletTransaction::TYPE_CREDIT,
            'amount' => 90.00, 'reason' => 'Ride earnings', 'engagement_id' => $trip->id,
        ]);

        // ── Driver side ──
        Sanctum::actingAs($driverUser, ['act-as:driver']);
        $driverResp = $this->getJson('/api/drivers/me/wallet')->assertOk();
        $this->assertEquals(90.0, $driverResp->json('balance'));
        $this->assertTrue(
            collect($driverResp->json('transactions'))
                ->contains(fn ($t) => $t['reason'] === 'Ride earnings' && (float) $t['amount'] === 90.0),
            'the driver should see the earning in their wallet feed',
        );

        // ── Admin side (same record) ──
        $admin = User::factory()->create(['manager_all_cities' => true]);
        $admin->addRole('admin');
        $roleId = DB::table('manager_roles')->insertGetId([
            'slug' => 'super_admin', 'name' => 'Super Admin', 'is_system' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $admin->forceFill(['manager_role_id' => $roleId])->save();
        Sanctum::actingAs($admin, ['act-as:admin']);
        $adminResp = $this->getJson("/api/admin/drivers/{$driver->id}/wallet/transactions")->assertOk();
        $this->assertTrue(
            collect($adminResp->json('data.data'))
                ->contains(fn ($t) => $t['reason'] === 'Ride earnings' && (float) $t['amount'] === 90.0),
            'the admin should see the same earning on the driver record',
        );
    }
}
