<?php

namespace Tests\Feature;

use App\Models\OperatorSetting;
use App\Models\Trip;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Module 1 — the global tips on/off switch (Operator Settings → Tips).
 *
 * Tipping defaults to OFF. When off, the customer can't leave a tip on any ride
 * type and the public config reports it disabled; when on, the existing tipping
 * behaviour applies.
 */
class TipsToggleTest extends TestCase
{
    use RefreshDatabase;

    /** @return array{0:int,1:int} [rideTypeId, pricingRuleId] */
    private function seedPricing(): array
    {
        $now = now();
        $cityId = DB::table('cities')->insertGetId([
            'name' => 'Bengaluru', 'country_code' => 'IN', 'created_at' => $now, 'updated_at' => $now,
        ]);
        $rideTypeId = DB::table('ride_types')->insertGetId([
            'name' => 'Mini', 'description' => 'Mini cab', 'sort_order' => 1, 'created_at' => $now, 'updated_at' => $now,
        ]);
        $pricingRuleId = DB::table('pricing_rules')->insertGetId([
            'city_id' => $cityId, 'ride_type_id' => $rideTypeId, 'base_fare' => 50, 'surge_multiplier' => 1,
            'created_at' => $now, 'updated_at' => $now,
        ]);

        return [$rideTypeId, $pricingRuleId];
    }

    private function completedTrip(User $customer, User $driver, int $rideTypeId, int $pricingRuleId): Trip
    {
        return Trip::query()->create([
            'customer_id' => $customer->id,
            'driver_id' => $driver->id,
            'ride_type_id' => $rideTypeId,
            'pricing_rule_id' => $pricingRuleId,
            'status' => 'COMPLETED',
            'estimated_fare' => 200,
            'final_fare' => 200,
            'currency' => 'INR',
            'pickup_lat' => 12.9716,
            'pickup_lng' => 77.5946,
            'drop_lat' => 12.9352,
            'drop_lng' => 77.6245,
            'completed_at' => now(),
        ]);
    }

    public function test_tip_is_blocked_when_tipping_is_disabled(): void
    {
        // Default is OFF — assert the default, then exercise the endpoint.
        $this->assertFalse((bool) OperatorSetting::instance()->tips_enabled);

        [$rideTypeId, $pricingRuleId] = $this->seedPricing();
        $customer = User::factory()->create();
        $customer->addRole('customer');
        $driver = User::factory()->create();
        $driver->addRole('driver');
        $trip = $this->completedTrip($customer, $driver, $rideTypeId, $pricingRuleId);

        Sanctum::actingAs($customer, ['act-as:customer']);
        $this->postJson("/api/trips/{$trip->id}/tip", ['amount' => 40])->assertStatus(403);

        // Nothing recorded on the trip, and the driver was not credited.
        $this->assertNull($trip->fresh()->tip_amount);
        $this->assertDatabaseMissing('wallet_transactions', [
            'engagement_id' => $trip->id,
            'reason' => 'Customer tip',
        ]);
    }

    public function test_tip_flows_when_tipping_is_enabled(): void
    {
        OperatorSetting::instance()->update(['tips_enabled' => true]);

        [$rideTypeId, $pricingRuleId] = $this->seedPricing();
        $customer = User::factory()->create();
        $customer->addRole('customer');
        $driver = User::factory()->create();
        $driver->addRole('driver');
        $trip = $this->completedTrip($customer, $driver, $rideTypeId, $pricingRuleId);

        Sanctum::actingAs($customer, ['act-as:customer']);
        $this->postJson("/api/trips/{$trip->id}/tip", ['amount' => 40])->assertCreated();

        $this->assertEquals(40.0, (float) $trip->fresh()->tip_amount);
        $this->assertDatabaseHas('driver_payout_ledger', [
            'driver_user_id' => $driver->id,
            'trip_id' => $trip->id,
            'type' => 'COLLECTED',
            'source' => 'tip',
            'amount' => 40.00,
        ]);
        $this->assertDatabaseMissing('wallet_transactions', [
            'engagement_id' => $trip->id,
        ]);
    }

    public function test_public_tipping_endpoint_reports_enabled_flag(): void
    {
        $user = User::factory()->create();
        $user->addRole('customer');
        Sanctum::actingAs($user, ['act-as:customer']);

        // Off by default.
        $this->getJson('/api/operator/tipping')->assertOk()->assertJson(['enabled' => false]);

        OperatorSetting::instance()->update(['tips_enabled' => true]);
        $this->getJson('/api/operator/tipping')->assertOk()->assertJson(['enabled' => true]);
    }
}
