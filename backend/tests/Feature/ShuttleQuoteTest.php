<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class ShuttleQuoteTest extends TestCase
{
    use RefreshDatabase;

    public function test_missing_shuttle_fare_returns_unavailable_response(): void
    {
        [$cityId, $vehicleTypeId, $cityVehicleTypeId] = $this->seedShuttleVehicle();

        $response = $this->postJson('/api/shuttle/quote', [
            'city_id' => $cityId,
            'vehicle_type_id' => $vehicleTypeId,
            'pickup_lat' => 12.9716,
            'pickup_lng' => 77.5946,
            'drop_lat' => 12.9352,
            'drop_lng' => 77.6245,
        ]);

        $response->assertNotFound()
            ->assertJson([
                'available' => false,
                'message' => 'Shuttle fare is not configured for this vehicle yet.',
                'city_vehicle_type_id' => $cityVehicleTypeId,
            ]);
    }

    public function test_configured_shuttle_fare_returns_quote_without_enabling_booking(): void
    {
        [$cityId, $vehicleTypeId, $cityVehicleTypeId, $rideTypeId] = $this->seedShuttleVehicle();

        DB::table('pricing_rules')->insert([
            'city_id' => $cityId,
            'city_vehicle_type_id' => $cityVehicleTypeId,
            'ride_type_id' => $rideTypeId,
            'vehicle_type_id' => $vehicleTypeId,
            'base_fare' => 40,
            'surge_multiplier' => 1,
            'threshold_distance_1_km' => 2,
            'fare_per_km_after_threshold_1' => 8,
            'threshold_time_1_min' => 5,
            'fare_per_min_after_threshold_time_1' => 1,
            'tax_percent' => 5,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->postJson('/api/shuttle/quote', [
            'city_vehicle_type_id' => $cityVehicleTypeId,
            'pickup_lat' => 12.9716,
            'pickup_lng' => 77.5946,
            'drop_lat' => 12.9352,
            'drop_lng' => 77.6245,
            'route_distance_km' => 6,
            'route_time_min' => 18,
        ]);

        $response->assertOk()
            ->assertJson([
                'available' => true,
                'booking_enabled' => false,
                'mode' => 'shuttle',
                'currency' => 'INR',
                'city_vehicle_type_id' => $cityVehicleTypeId,
                'vehicle_type_id' => $vehicleTypeId,
                'vehicle_name' => 'Sedan Shuttle',
            ])
            ->assertJsonStructure([
                'distance_km',
                'time_min',
                'fare_breakdown',
                'estimated_fare',
            ]);
    }

    private function seedShuttleVehicle(): array
    {
        $now = now();
        $cityId = DB::table('cities')->insertGetId([
            'name' => 'Shuttle Test City',
            'country_code' => 'IN',
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $rideTypeId = DB::table('ride_types')->insertGetId([
            'name' => 'Shuttle',
            'description' => 'Dynamic shuttle',
            'sort_order' => 3,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Sedan',
            'sort_order' => 1,
            'is_active' => true,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $cityVehicleTypeId = DB::table('city_vehicle_types')->insertGetId([
            'city_id' => $cityId,
            'ride_type_id' => $rideTypeId,
            'vehicle_type_id' => $vehicleTypeId,
            'display_name' => 'Sedan Shuttle',
            'display_order' => 1,
            'max_people' => 4,
            'luggage_capacity' => 1,
            'toll_mode' => 'no',
            'commission_type' => 'percent',
            'commission_percent' => 0,
            'fixed_commission' => 0,
            'show_low_wallet_alert' => true,
            'is_active' => true,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return [$cityId, $vehicleTypeId, $cityVehicleTypeId, $rideTypeId];
    }
}
