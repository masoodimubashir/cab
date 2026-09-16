<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\CityVehicleType;
use App\Models\Driver;
use App\Models\PricingRule;
use App\Models\RideType;
use App\Models\Trip;
use App\Models\User;
use App\Models\VehicleType;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Support\SeatLayoutFactory;
use Tests\TestCase;

class AdminTripActionsTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private User $customer;
    private User $driver;
    private City $city;
    private RideType $rideType;
    private VehicleType $vehicleType;
    private CityVehicleType $cityVehicleType;
    private PricingRule $pricingRule;

    protected function setUp(): void
    {
        parent::setUp();

        $this->city = City::create([
            'name' => 'Test City',
            'country_code' => 'IN',
            'boundary_polygon' => [
                ['lat' => 12.0, 'lng' => 77.0],
                ['lat' => 13.0, 'lng' => 77.0],
                ['lat' => 13.0, 'lng' => 78.0],
                ['lat' => 12.0, 'lng' => 78.0],
            ],
        ]);

        $this->rideType = RideType::create([
            'name' => 'Sedan',
            'mode' => 'private',
            'sort_order' => 1,
        ]);

        $this->vehicleType = VehicleType::create([
            'name' => 'Sedan Car',
            'is_active' => true,
        ]);

        $this->cityVehicleType = CityVehicleType::create([
            'city_id' => $this->city->id,
            'ride_type_id' => $this->rideType->id,
            'vehicle_type_id' => $this->vehicleType->id,
            'display_name' => 'City Sedan',
            'is_active' => true,
        ]);

        $this->pricingRule = PricingRule::create([
            'city_id' => $this->city->id,
            'city_vehicle_type_id' => $this->cityVehicleType->id,
            'base_fare' => 50,
            'threshold_distance_1_km' => 2,
            'fare_per_km_after_threshold_1' => 15,
            'cancellation_charges' => 25,
            'surge_multiplier' => 1.0,
        ]);

        $this->customer = User::factory()->create();
        $this->driver = User::factory()->create();
        Driver::create([
            'user_id' => $this->driver->id,
            'vehicle_type_id' => $this->vehicleType->id,
            'approval_status' => 'approved',
            'is_online' => true,
        ]);

        $this->admin = User::factory()->create(['manager_all_cities' => true]);
        $this->admin->addRole('admin');
        $roleId = DB::table('manager_roles')->insertGetId([
            'slug' => 'super_admin',
            'name' => 'Super Admin',
            'is_system' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->admin->forceFill(['manager_role_id' => $roleId])->save();
    }

    private function asAdmin(): void
    {
        Sanctum::actingAs($this->admin, ['act-as:admin']);
    }

    public function test_admin_can_start_assigned_ride(): void
    {
        $this->asAdmin();

        $trip = Trip::create([
            'customer_id' => $this->customer->id,
            'driver_id' => $this->driver->id,
            'city_id' => $this->city->id,
            'ride_type_id' => $this->rideType->id,
            'city_vehicle_type_id' => $this->cityVehicleType->id,
            'pricing_rule_id' => $this->pricingRule->id,
            'status' => 'ARRIVED_PICKUP',
            'pickup_lat' => 12.5,
            'pickup_lng' => 77.5,
            'drop_lat' => 12.6,
            'drop_lng' => 77.6,
            'estimated_fare' => 200,
            'start_otp' => '123456',
            'start_otp_expires_at' => now()->addMinutes(10),
        ]);

        $res = $this->postJson("/api/admin/trips/{$trip->id}/start");
        $res->assertOk();
        $res->assertJsonFragment(['status' => 'EN_ROUTE_DROP']);

        $this->assertSame('EN_ROUTE_DROP', $trip->fresh()->status);
        $this->assertNull($trip->fresh()->start_otp);
    }

    public function test_admin_can_cancel_ride_with_waived_fee(): void
    {
        $this->asAdmin();

        $trip = Trip::create([
            'customer_id' => $this->customer->id,
            'driver_id' => $this->driver->id,
            'city_id' => $this->city->id,
            'ride_type_id' => $this->rideType->id,
            'city_vehicle_type_id' => $this->cityVehicleType->id,
            'pricing_rule_id' => $this->pricingRule->id,
            'status' => 'EN_ROUTE_PICKUP',
            'pickup_lat' => 12.5,
            'pickup_lng' => 77.5,
            'drop_lat' => 12.6,
            'drop_lng' => 77.6,
            'estimated_fare' => 200,
        ]);

        $res = $this->postJson("/api/admin/trips/{$trip->id}/cancel", [
            'reason' => 'Driver vehicle broke down',
            'waive_fee' => true,
        ]);

        $res->assertOk();
        $this->assertSame('CANCELLED', $trip->fresh()->status);
        $this->assertSame('Driver vehicle broke down', $trip->fresh()->cancelled_reason);
        $this->assertEquals(0.0, (float) $trip->fresh()->cancellation_fee_amount);
    }

    public function test_admin_can_change_drop_location_with_fare_recalculation(): void
    {
        $this->asAdmin();

        $trip = Trip::create([
            'customer_id' => $this->customer->id,
            'driver_id' => $this->driver->id,
            'city_id' => $this->city->id,
            'ride_type_id' => $this->rideType->id,
            'city_vehicle_type_id' => $this->cityVehicleType->id,
            'pricing_rule_id' => $this->pricingRule->id,
            'scope' => 'local',
            'status' => 'ARRIVED_PICKUP',
            'pickup_lat' => 12.5,
            'pickup_lng' => 77.5,
            'drop_lat' => 12.52,
            'drop_lng' => 77.52,
            'pickup_address' => 'Point A',
            'drop_address' => 'Old Point B',
            'estimated_fare' => 100,
        ]);

        $res = $this->postJson("/api/admin/trips/{$trip->id}/change-drop", [
            'drop_lat' => 12.6,
            'drop_lng' => 77.6,
            'drop_address' => 'New Point C',
        ]);

        $res->assertOk();
        $fresh = $trip->fresh();
        $this->assertSame('New Point C', $fresh->drop_address);
        $this->assertEquals(12.6, (float) $fresh->drop_lat);
        $this->assertEquals(77.6, (float) $fresh->drop_lng);
        $this->assertGreaterThan(100, (float) $fresh->estimated_fare);
    }

    public function test_admin_change_drop_rejects_identical_to_pickup(): void
    {
        $this->asAdmin();

        $trip = Trip::create([
            'customer_id' => $this->customer->id,
            'city_id' => $this->city->id,
            'ride_type_id' => $this->rideType->id,
            'city_vehicle_type_id' => $this->cityVehicleType->id,
            'pricing_rule_id' => $this->pricingRule->id,
            'status' => 'ASSIGNED',
            'pickup_lat' => 12.5,
            'pickup_lng' => 77.5,
            'drop_lat' => 12.6,
            'drop_lng' => 77.6,
        ]);

        $res = $this->postJson("/api/admin/trips/{$trip->id}/change-drop", [
            'drop_lat' => 12.5,
            'drop_lng' => 77.5,
            'drop_address' => 'Same Location',
        ]);

        $res->assertStatus(422);
    }

    public function test_admin_change_passenger_drop_rejects_cancelled_passenger(): void
    {
        $this->asAdmin();

        $route = \App\Models\Route::create([
            'city_id' => $this->city->id,
            'name' => 'Route A-B-C',
            'origin_name' => 'Stop A',
            'dest_name' => 'Stop C',
            'origin_lat' => 12.1,
            'origin_lng' => 77.1,
            'dest_lat' => 12.3,
            'dest_lng' => 77.3,
            'is_active' => true,
        ]);

        $stop1 = \App\Models\RouteStop::create([
            'route_id' => $route->id,
            'name' => 'Stop 1',
            'seq' => 1,
            'lat' => 12.1,
            'lng' => 77.1,
        ]);

        $stop2 = \App\Models\RouteStop::create([
            'route_id' => $route->id,
            'name' => 'Stop 2',
            'seq' => 2,
            'lat' => 12.2,
            'lng' => 77.2,
        ]);

        $stop3 = \App\Models\RouteStop::create([
            'route_id' => $route->id,
            'name' => 'Stop 3',
            'seq' => 3,
            'lat' => 12.3,
            'lng' => 77.3,
        ]);

        $layoutId = SeatLayoutFactory::standardErtiga6P($this->city->id, $this->vehicleType->id);

        $dep = \App\Models\RouteDeparture::create([
            'route_id' => $route->id,
            'driver_id' => $this->driver->id,
            'vehicle_seat_layout_id' => $layoutId,
            'service_date' => now()->toDateString(),
            'departure_kind' => 'driver_opened',
            'capacity' => 6,
            'seats_taken' => 1,
            'status' => 'SCHEDULED',
            'visible_to_customers' => true,
        ]);

        $trip = Trip::create([
            'customer_id' => $this->customer->id,
            'driver_id' => $this->driver->id,
            'city_id' => $this->city->id,
            'ride_type_id' => $this->rideType->id,
            'route_id' => $route->id,
            'route_departure_id' => $dep->id,
            'status' => 'ASSIGNED',
            'pickup_lat' => 12.1,
            'pickup_lng' => 77.1,
            'drop_lat' => 12.3,
            'drop_lng' => 77.3,
        ]);

        $passenger = \App\Models\SeatReservation::create([
            'route_departure_id' => $dep->id,
            'route_id' => $route->id,
            'trip_id' => $trip->id,
            'customer_id' => $this->customer->id,
            'board_stop_id' => $stop1->id,
            'drop_stop_id' => $stop2->id,
            'status' => 'CANCELLED',
            'seats' => 1,
        ]);

        $res = $this->postJson("/api/admin/trips/{$trip->id}/passengers/{$passenger->id}/change-drop", [
            'drop_stop_id' => $stop3->id,
        ]);

        $res->assertStatus(409);
    }
}
