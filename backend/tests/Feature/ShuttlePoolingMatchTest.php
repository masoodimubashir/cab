<?php

namespace Tests\Feature;

use App\Models\CitySetting;
use App\Models\ShuttleJourney;
use App\Models\ShuttlePassengerBooking;
use App\Models\User;
use App\Services\ShuttleBookingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Module 8B — pooling matcher (decision 1A). A new shuttle rider joins a still-
 * forming journey heading the same way (pickup near pickup, drop near drop, seat
 * free); otherwise a fresh journey is started.
 */
class ShuttlePoolingMatchTest extends TestCase
{
    use RefreshDatabase;

    private int $cityId;
    private int $cityVehicleTypeId;

    protected function setUp(): void
    {
        parent::setUp();
        $now = now();
        $this->cityId = DB::table('cities')->insertGetId(['name' => 'Pool City', 'country_code' => 'IN', 'created_at' => $now, 'updated_at' => $now]);
        $rideTypeId = DB::table('ride_types')->insertGetId(['name' => 'Shuttle', 'mode' => 'shuttle', 'description' => 'Shuttle', 'sort_order' => 1, 'created_at' => $now, 'updated_at' => $now]);
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId(['name' => 'Van', 'sort_order' => 1, 'is_active' => true, 'created_at' => $now, 'updated_at' => $now]);
        $this->cityVehicleTypeId = DB::table('city_vehicle_types')->insertGetId([
            'city_id' => $this->cityId, 'ride_type_id' => $rideTypeId, 'vehicle_type_id' => $vehicleTypeId,
            'display_name' => 'Van', 'display_order' => 1, 'max_people' => 3, 'luggage_capacity' => 1,
            'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
        ]);
        DB::table('pricing_rules')->insert([
            'city_id' => $this->cityId, 'city_vehicle_type_id' => $this->cityVehicleTypeId, 'ride_type_id' => $rideTypeId, 'vehicle_type_id' => $vehicleTypeId,
            'base_fare' => 40, 'surge_multiplier' => 1, 'threshold_distance_1_km' => 2, 'fare_per_km_after_threshold_1' => 8,
            'threshold_time_1_min' => 5, 'fare_per_min_after_threshold_time_1' => 1, 'tax_percent' => 5,
            'commission_type' => 'percent', 'commission_percent' => 20, 'fixed_commission' => 0,
            'created_at' => $now, 'updated_at' => $now,
        ]);
        CitySetting::query()->create([
            'city_id' => $this->cityId,
            'shuttle_pickup_match_distance_km' => 1.5,
            'shuttle_drop_match_distance_km' => 1.5,
        ]);
    }

    private function book(float $pLat, float $pLng, float $dLat, float $dLng): ShuttlePassengerBooking
    {
        $customer = User::factory()->create();
        $customer->addRole('customer');

        return app(ShuttleBookingService::class)->createBooking($customer, [
            'city_vehicle_type_id' => $this->cityVehicleTypeId,
            'pickup_lat' => $pLat, 'pickup_lng' => $pLng, 'pickup_address' => 'P',
            'drop_lat' => $dLat, 'drop_lng' => $dLng, 'drop_address' => 'D',
            'route_distance_km' => 6, 'route_time_min' => 18,
        ]);
    }

    public function test_a_nearby_rider_joins_the_same_journey(): void
    {
        $first = $this->book(12.9716, 77.5946, 12.9352, 77.6245);
        // ~150 m away pickup and drop — well within the 1.5 km match.
        $second = $this->book(12.9720, 77.5950, 12.9356, 77.6249);

        $this->assertSame($first->shuttle_journey_id, $second->shuttle_journey_id);
        $journey = ShuttleJourney::query()->findOrFail($first->shuttle_journey_id);
        $this->assertSame(2, (int) $journey->seats_taken);
    }

    public function test_a_far_rider_starts_a_new_journey(): void
    {
        $first = $this->book(12.9716, 77.5946, 12.9352, 77.6245);
        // Pickup ~5 km away — beyond the match distance.
        $second = $this->book(13.0200, 77.5946, 12.9352, 77.6245);

        $this->assertNotSame($first->shuttle_journey_id, $second->shuttle_journey_id);
        $this->assertSame(1, (int) ShuttleJourney::query()->findOrFail($first->shuttle_journey_id)->seats_taken);
        $this->assertSame(1, (int) ShuttleJourney::query()->findOrFail($second->shuttle_journey_id)->seats_taken);
    }

    public function test_a_full_journey_is_not_joined(): void
    {
        // Capacity is 3; fill it with three nearby riders, the fourth starts fresh.
        $a = $this->book(12.9716, 77.5946, 12.9352, 77.6245);
        $this->book(12.9717, 77.5947, 12.9353, 77.6246);
        $this->book(12.9718, 77.5948, 12.9354, 77.6247);
        $fourth = $this->book(12.9719, 77.5949, 12.9355, 77.6248);

        $this->assertNotSame($a->shuttle_journey_id, $fourth->shuttle_journey_id);
        $this->assertSame(3, (int) ShuttleJourney::query()->findOrFail($a->shuttle_journey_id)->seats_taken);
        $this->assertSame(1, (int) ShuttleJourney::query()->findOrFail($fourth->shuttle_journey_id)->seats_taken);
    }
}
