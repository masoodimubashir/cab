<?php

namespace Tests\Feature;

use App\Events\FareNegotiationOfferAdded;
use App\Events\FareNegotiationLocked;
use App\Events\SosTriggered;
use App\Events\TripStatusUpdated;
use App\Events\TripLocationUpdated;
use App\Models\Driver;
use App\Models\Trip;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class DreamCabsApiTest extends TestCase
{
    use RefreshDatabase;

    private function seedPricing(): array
    {
        $now = now();

        $cityId = DB::table('cities')->insertGetId([
            'name' => 'Bengaluru',
            'country_code' => 'IN',
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $rideTypeId = DB::table('ride_types')->insertGetId([
            'name' => 'Mini',
            'description' => 'Mini cab',
            'sort_order' => 1,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $pricingRuleId = DB::table('pricing_rules')->insertGetId([
            'city_id' => $cityId,
            'ride_type_id' => $rideTypeId,
            'base_fare' => 50,
            'surge_multiplier' => 1,
            'threshold_distance_1_km' => 5,
            'fare_per_km_after_threshold_1' => 10,
            'threshold_time_1_min' => 10,
            'fare_per_min_after_threshold_time_1' => 1.5,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return [$cityId, $rideTypeId, $pricingRuleId];
    }

    public function test_pricing_estimate_endpoint_returns_estimated_fare(): void
    {
        [$cityId, $rideTypeId] = $this->seedPricing();

        $response = $this->postJson('/api/pricing/estimate', [
            'city_id' => $cityId,
            'ride_type_id' => $rideTypeId,
            'pickup_lat' => 12.9716,
            'pickup_lng' => 77.5946,
            'drop_lat' => 12.9352,
            'drop_lng' => 77.6245,
        ]);

        $response->assertOk()
            ->assertJsonStructure([
                'currency',
                'distance_km',
                'time_min',
                'fare_breakdown',
                'estimated_fare',
                'commission_percent',
            ]);
    }

    public function test_trip_negotiation_and_driver_location_emit_events(): void
    {
        Event::fake([FareNegotiationOfferAdded::class, TripLocationUpdated::class]);

        [$cityId, $rideTypeId] = $this->seedPricing();

        $customer = User::factory()->create(['role' => 'customer']);
        $driverUser = User::factory()->create(['role' => 'driver']);
        Driver::query()->create([
            'user_id' => $driverUser->id,
            'approval_status' => 'approved',
            'approved_at' => now(),
            'is_online' => true,
        ]);

        Sanctum::actingAs($customer);
        $createTrip = $this->postJson('/api/trips', [
            'city_id' => $cityId,
            'ride_type_id' => $rideTypeId,
            'pickup_lat' => 12.9716,
            'pickup_lng' => 77.5946,
            'drop_lat' => 12.9352,
            'drop_lng' => 77.6245,
        ])->assertCreated();

        $tripId = $createTrip->json('trip.id');
        $trip = Trip::query()->findOrFail($tripId);
        $trip->driver_id = $driverUser->id;
        $trip->save();

        $this->postJson("/api/trips/{$tripId}/negotiation/customer-offer", [
            'amount' => 220,
        ])->assertOk();

        Sanctum::actingAs($driverUser);
        $this->postJson("/api/trips/{$tripId}/negotiation/driver-action", [
            'action' => 'COUNTER',
            'amount' => 250,
        ])->assertOk();

        $this->postJson("/api/trips/{$tripId}/location", [
            'lat' => 12.9701,
            'lng' => 77.6001,
        ])->assertOk();

        Event::assertDispatched(FareNegotiationOfferAdded::class);
        Event::assertDispatched(TripLocationUpdated::class);
    }

    public function test_trip_negotiation_lock_assignment_progress_sos_rating(): void
    {
        Event::fake([FareNegotiationOfferAdded::class, FareNegotiationLocked::class, TripStatusUpdated::class, SosTriggered::class]);

        [$cityId, $rideTypeId] = $this->seedPricing();

        $customer = User::factory()->create(['role' => 'customer']);
        $driverUser = User::factory()->create(['role' => 'driver']);

        Driver::query()->create([
            'user_id' => $driverUser->id,
            'approval_status' => 'approved',
            'approved_at' => now(),
            'is_online' => true,
        ]);

        Sanctum::actingAs($customer);
        $createTrip = $this->postJson('/api/trips', [
            'city_id' => $cityId,
            'ride_type_id' => $rideTypeId,
            'pickup_lat' => 12.9716,
            'pickup_lng' => 77.5946,
            'drop_lat' => 12.9352,
            'drop_lng' => 77.6245,
        ])->assertCreated();

        $tripId = $createTrip->json('trip.id');

        // Assign driver before negotiation confirm so SOS/rating flows can reference driver_id.
        $trip = Trip::query()->findOrFail($tripId);
        $trip->driver_id = $driverUser->id;
        $trip->save();

        // SOS in negotiation state.
        $this->postJson("/api/trips/{$tripId}/sos", [
            'lat' => 12.9701,
            'lng' => 77.6001,
            'note' => 'Test SOS',
        ])->assertOk();

        // Customer offers; driver counters (sets negotiation final_amount).
        $this->postJson("/api/trips/{$tripId}/negotiation/customer-offer", [
            'amount' => 220,
        ])->assertOk();

        Sanctum::actingAs($driverUser);
        $this->postJson("/api/trips/{$tripId}/negotiation/driver-action", [
            'action' => 'COUNTER',
            'amount' => 250,
        ])->assertOk();

        // Customer confirms final amount -> locks negotiation and moves trip to CONFIRMED.
        Sanctum::actingAs($customer);
        $this->postJson("/api/trips/{$tripId}/negotiation/customer-confirm", [
            'final_fare' => 250,
        ])->assertOk();

        Event::assertDispatched(FareNegotiationLocked::class);
        Event::assertDispatched(TripStatusUpdated::class);
        Event::assertDispatched(SosTriggered::class);

        // Driver accepts assignment -> ASSIGNED.
        Sanctum::actingAs($driverUser);
        $this->postJson("/api/trips/{$tripId}/driver-accept", [])->assertOk();

        // Drive trip to completion via valid state transitions.
        $this->patchJson("/api/trips/{$tripId}/driver-progress", [
            'status' => 'EN_ROUTE_PICKUP',
            'location' => ['lat' => 12.9701, 'lng' => 77.6001],
        ])->assertOk();

        $this->patchJson("/api/trips/{$tripId}/driver-progress", [
            'status' => 'ARRIVED_PICKUP',
            'location' => ['lat' => 12.9702, 'lng' => 77.6002],
        ])->assertOk();

        $this->patchJson("/api/trips/{$tripId}/driver-progress", [
            'status' => 'EN_ROUTE_DROP',
            'location' => ['lat' => 12.9703, 'lng' => 77.6003],
        ])->assertOk();

        $this->patchJson("/api/trips/{$tripId}/driver-progress", [
            'status' => 'ARRIVED_DROP',
            'location' => ['lat' => 12.9704, 'lng' => 77.6004],
        ])->assertOk();

        $this->patchJson("/api/trips/{$tripId}/driver-progress", [
            'status' => 'COMPLETED',
            'location' => ['lat' => 12.9705, 'lng' => 77.6005],
        ])->assertOk();

        // Customer pays cash -> SUCCESS payment.
        Sanctum::actingAs($customer);
        $this->postJson("/api/trips/{$tripId}/pay/cash", [])->assertOk();

        // Customer rates driver after completion.
        $this->postJson("/api/trips/{$tripId}/rating", [
            'score' => 5,
            'comment' => 'Great trip',
        ])->assertOk();

        $trip = Trip::query()->findOrFail($tripId);
        $this->assertSame('COMPLETED', $trip->status);
    }

    public function test_cash_payment_then_invoice_generation(): void
    {
        [$cityId, $rideTypeId, $pricingRuleId] = $this->seedPricing();

        $customer = User::factory()->create(['role' => 'customer']);
        $driver = User::factory()->create(['role' => 'driver']);

        $trip = Trip::query()->create([
            'customer_id' => $customer->id,
            'driver_id' => $driver->id,
            'ride_type_id' => $rideTypeId,
            'pricing_rule_id' => $pricingRuleId,
            'status' => 'COMPLETED',
            'estimated_fare' => 250,
            'final_fare' => 300,
            'currency' => 'INR',
            'pickup_lat' => 12.9716,
            'pickup_lng' => 77.5946,
            'drop_lat' => 12.9352,
            'drop_lng' => 77.6245,
            'completed_at' => now(),
        ]);

        Sanctum::actingAs($customer);
        $this->postJson("/api/trips/{$trip->id}/pay/cash", [])
            ->assertOk()
            ->assertJsonPath('payment.status', 'SUCCESS');

        $this->postJson("/api/trips/{$trip->id}/invoice", [])
            ->assertOk()
            ->assertJsonStructure(['invoice' => ['id', 'invoice_no', 'trip_id']]);
    }

    /**
     * Regression: in percentage-tip mode the client converts the chosen percent
     * into rupees and posts rupees. The server must store that rupee value as-is
     * and NOT re-interpret it as a percent (which double-converted: a 20% tip on
     * a ₹200 fare was billed ₹80 instead of ₹40).
     */
    public function test_percentage_tip_is_stored_as_rupees_without_double_conversion(): void
    {
        [$cityId, $rideTypeId, $pricingRuleId] = $this->seedPricing();

        $settings = \App\Models\OperatorSetting::instance();
        $settings->tip_in_percentage = true;
        $settings->save();

        $customer = User::factory()->create(['role' => 'customer']);
        $driver = User::factory()->create(['role' => 'driver']);

        $trip = Trip::query()->create([
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

        // The client already turned "20%" of ₹200 into ₹40 before posting.
        Sanctum::actingAs($customer);
        $this->postJson("/api/trips/{$trip->id}/tip", ['amount' => 40])->assertOk();

        // Stored as ₹40 — not re-converted to 40% of ₹200 (₹80).
        $this->assertEquals(40.0, (float) $trip->fresh()->tip_amount);

        // Driver credited for the tip.
        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $driver->id,
            'engagement_id' => $trip->id,
            'reason' => 'Customer tip',
        ]);
    }
}

