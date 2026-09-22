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

    public function test_admin_can_fetch_fixed_departure_manifest(): void
    {
        $this->asAdmin();

        $route = \App\Models\Route::create([
            'city_id' => $this->city->id,
            'name' => 'Route Manifest Test',
            'origin_name' => 'Start',
            'dest_name' => 'End',
            'origin_lat' => 12.1,
            'origin_lng' => 77.1,
            'dest_lat' => 12.3,
            'dest_lng' => 77.3,
            'is_active' => true,
        ]);

        $layoutId = SeatLayoutFactory::standardErtiga6P($this->city->id, $this->vehicleType->id);

        $dep = \App\Models\RouteDeparture::create([
            'route_id' => $route->id,
            'driver_id' => $this->driver->id,
            'vehicle_seat_layout_id' => $layoutId,
            'service_date' => now()->toDateString(),
            'departure_kind' => 'driver_opened',
            'capacity' => 4,
            'seats_taken' => 0,
            'status' => 'FORMING',
            'visible_to_customers' => true,
        ]);

        $res = $this->getJson("/api/admin/cities/{$this->city->id}/departures/{$dep->id}/manifest");
        $res->assertOk();
        $res->assertJsonStructure([
            'departure',
            'passengers',
            'stops',
        ]);
    }

    public function test_admin_change_passenger_drop_rejects_stop_from_different_route(): void
    {
        $this->asAdmin();

        $route1 = \App\Models\Route::create([
            'city_id' => $this->city->id,
            'name' => 'Route 1',
            'origin_name' => 'Start 1',
            'dest_name' => 'End 1',
            'origin_lat' => 12.1,
            'origin_lng' => 77.1,
            'dest_lat' => 12.3,
            'dest_lng' => 77.3,
            'is_active' => true,
        ]);
        $stop1_1 = \App\Models\RouteStop::create(['route_id' => $route1->id, 'name' => 'Stop 1-1', 'seq' => 1, 'lat' => 12.1, 'lng' => 77.1]);
        $stop1_2 = \App\Models\RouteStop::create(['route_id' => $route1->id, 'name' => 'Stop 1-2', 'seq' => 2, 'lat' => 12.2, 'lng' => 77.2]);

        $route2 = \App\Models\Route::create([
            'city_id' => $this->city->id,
            'name' => 'Route 2',
            'origin_name' => 'Start 2',
            'dest_name' => 'End 2',
            'origin_lat' => 13.1,
            'origin_lng' => 78.1,
            'dest_lat' => 13.3,
            'dest_lng' => 78.3,
            'is_active' => true,
        ]);
        $stop2_1 = \App\Models\RouteStop::create(['route_id' => $route2->id, 'name' => 'Stop 2-1', 'seq' => 1, 'lat' => 13.1, 'lng' => 78.1]);

        $layoutId = SeatLayoutFactory::standardErtiga6P($this->city->id, $this->vehicleType->id);
        $dep = \App\Models\RouteDeparture::create([
            'route_id' => $route1->id,
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
            'route_id' => $route1->id,
            'route_departure_id' => $dep->id,
            'status' => 'ASSIGNED',
            'pickup_lat' => 12.1,
            'pickup_lng' => 77.1,
            'drop_lat' => 12.2,
            'drop_lng' => 77.2,
        ]);

        $passenger = \App\Models\SeatReservation::create([
            'route_departure_id' => $dep->id,
            'route_id' => $route1->id,
            'trip_id' => $trip->id,
            'customer_id' => $this->customer->id,
            'board_stop_id' => $stop1_1->id,
            'drop_stop_id' => $stop1_2->id,
            'status' => 'CONFIRMED',
            'seats' => 1,
            'fare_amount' => 150.0,
            'payment_status' => 'PAID',
        ]);

        $res = $this->postJson("/api/admin/trips/{$trip->id}/passengers/{$passenger->id}/change-drop", [
            'drop_stop_id' => $stop2_1->id,
        ]);

        $res->assertStatus(422);
        $this->assertStringContainsString('same route', strtolower($res->json('message')));
        $this->assertSame($stop1_2->id, $passenger->fresh()->drop_stop_id);
    }

    public function test_admin_change_passenger_drop_rejects_stop_behind_vehicle_progress(): void
    {
        $this->asAdmin();

        $route = \App\Models\Route::create([
            'city_id' => $this->city->id,
            'name' => 'Progress Route',
            'origin_name' => 'Stop 1',
            'dest_name' => 'Stop 4',
            'origin_lat' => 12.1,
            'origin_lng' => 77.1,
            'dest_lat' => 12.4,
            'dest_lng' => 77.4,
            'is_active' => true,
        ]);
        $stop1 = \App\Models\RouteStop::create(['route_id' => $route->id, 'name' => 'Stop 1', 'seq' => 1, 'lat' => 12.1, 'lng' => 77.1]);
        $stop2 = \App\Models\RouteStop::create(['route_id' => $route->id, 'name' => 'Stop 2', 'seq' => 2, 'lat' => 12.2, 'lng' => 77.2]);
        $stop3 = \App\Models\RouteStop::create(['route_id' => $route->id, 'name' => 'Stop 3', 'seq' => 3, 'lat' => 12.3, 'lng' => 77.3]);
        $stop4 = \App\Models\RouteStop::create(['route_id' => $route->id, 'name' => 'Stop 4', 'seq' => 4, 'lat' => 12.4, 'lng' => 77.4]);

        $layoutId = SeatLayoutFactory::standardErtiga6P($this->city->id, $this->vehicleType->id);
        $dep = \App\Models\RouteDeparture::create([
            'route_id' => $route->id,
            'driver_id' => $this->driver->id,
            'vehicle_seat_layout_id' => $layoutId,
            'service_date' => now()->toDateString(),
            'departure_kind' => 'driver_opened',
            'capacity' => 6,
            'seats_taken' => 1,
            'status' => 'DEPARTED',
            'fixed_last_reached_stop_seq' => 2,
            'visible_to_customers' => true,
        ]);

        $trip = Trip::create([
            'customer_id' => $this->customer->id,
            'driver_id' => $this->driver->id,
            'city_id' => $this->city->id,
            'ride_type_id' => $this->rideType->id,
            'route_id' => $route->id,
            'route_departure_id' => $dep->id,
            'status' => 'EN_ROUTE_DROP',
            'pickup_lat' => 12.1,
            'pickup_lng' => 77.1,
            'drop_lat' => 12.4,
            'drop_lng' => 77.4,
        ]);

        $passenger = \App\Models\SeatReservation::create([
            'route_departure_id' => $dep->id,
            'route_id' => $route->id,
            'trip_id' => $trip->id,
            'customer_id' => $this->customer->id,
            'board_stop_id' => $stop1->id,
            'drop_stop_id' => $stop4->id,
            'status' => 'BOARDED',
            'seats' => 1,
            'fare_amount' => 200.0,
            'payment_status' => 'PAID',
        ]);

        // Trying to set drop to Stop 2 when vehicle is already past Stop 2
        $res = $this->postJson("/api/admin/trips/{$trip->id}/passengers/{$passenger->id}/change-drop", [
            'drop_stop_id' => $stop2->id,
        ]);

        $res->assertStatus(422);
        $this->assertStringContainsString('reached or passed', strtolower($res->json('message')));
        $this->assertSame($stop4->id, $passenger->fresh()->drop_stop_id);
    }

    public function test_admin_change_passenger_drop_rejects_when_leg_seat_capacity_exceeded(): void
    {
        $this->asAdmin();

        $secondCustomer = User::factory()->create();

        $route = \App\Models\Route::create([
            'city_id' => $this->city->id,
            'name' => 'Capacity Test Route',
            'origin_name' => 'Stop 1',
            'dest_name' => 'Stop 4',
            'origin_lat' => 12.1,
            'origin_lng' => 77.1,
            'dest_lat' => 12.4,
            'dest_lng' => 77.4,
            'is_active' => true,
        ]);
        $stop1 = \App\Models\RouteStop::create(['route_id' => $route->id, 'name' => 'Stop 1', 'seq' => 1, 'lat' => 12.1, 'lng' => 77.1]);
        $stop2 = \App\Models\RouteStop::create(['route_id' => $route->id, 'name' => 'Stop 2', 'seq' => 2, 'lat' => 12.2, 'lng' => 77.2]);
        $stop3 = \App\Models\RouteStop::create(['route_id' => $route->id, 'name' => 'Stop 3', 'seq' => 3, 'lat' => 12.3, 'lng' => 77.3]);
        $stop4 = \App\Models\RouteStop::create(['route_id' => $route->id, 'name' => 'Stop 4', 'seq' => 4, 'lat' => 12.4, 'lng' => 77.4]);

        $layoutId = SeatLayoutFactory::standardErtiga6P($this->city->id, $this->vehicleType->id);
        // Vehicle total seat capacity = 3
        $dep = \App\Models\RouteDeparture::create([
            'route_id' => $route->id,
            'driver_id' => $this->driver->id,
            'vehicle_seat_layout_id' => $layoutId,
            'service_date' => now()->toDateString(),
            'departure_kind' => 'driver_opened',
            'capacity' => 3,
            'seats_taken' => 3,
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
            'drop_lat' => 12.2,
            'drop_lng' => 77.2,
        ]);

        // Passenger 1: Stop 1 -> Stop 2 (occupies 2 seats on Leg 1->2)
        $passenger1 = \App\Models\SeatReservation::create([
            'route_departure_id' => $dep->id,
            'route_id' => $route->id,
            'trip_id' => $trip->id,
            'customer_id' => $this->customer->id,
            'board_stop_id' => $stop1->id,
            'drop_stop_id' => $stop2->id,
            'status' => 'CONFIRMED',
            'seats' => 2,
            'fare_amount' => 180.0,
            'payment_status' => 'PAID',
        ]);

        // Passenger 2: Stop 2 -> Stop 4 (occupies 2 seats on Leg 2->3 and Leg 3->4)
        \App\Models\SeatReservation::create([
            'route_departure_id' => $dep->id,
            'route_id' => $route->id,
            'trip_id' => $trip->id,
            'customer_id' => $secondCustomer->id,
            'board_stop_id' => $stop2->id,
            'drop_stop_id' => $stop4->id,
            'status' => 'CONFIRMED',
            'seats' => 2,
            'fare_amount' => 200.0,
            'payment_status' => 'PAID',
        ]);

        // Passenger 1 attempts to change drop from Stop 2 to Stop 3.
        // Leg 2->3 would need Passenger 1 (2 seats) + Passenger 2 (2 seats) = 4 seats > capacity (3 seats).
        $res = $this->postJson("/api/admin/trips/{$trip->id}/passengers/{$passenger1->id}/change-drop", [
            'drop_stop_id' => $stop3->id,
        ]);

        $res->assertStatus(422);
        $this->assertStringContainsString('seat capacity', strtolower($res->json('message')));
        $this->assertSame($stop2->id, $passenger1->fresh()->drop_stop_id);
    }

    public function test_admin_change_passenger_drop_rejects_when_leg_luggage_capacity_exceeded(): void
    {
        $this->asAdmin();

        $secondCustomer = User::factory()->create();

        $route = \App\Models\Route::create([
            'city_id' => $this->city->id,
            'name' => 'Luggage Test Route',
            'origin_name' => 'Stop 1',
            'dest_name' => 'Stop 4',
            'origin_lat' => 12.1,
            'origin_lng' => 77.1,
            'dest_lat' => 12.4,
            'dest_lng' => 77.4,
            'is_active' => true,
        ]);
        $stop1 = \App\Models\RouteStop::create(['route_id' => $route->id, 'name' => 'Stop 1', 'seq' => 1, 'lat' => 12.1, 'lng' => 77.1]);
        $stop2 = \App\Models\RouteStop::create(['route_id' => $route->id, 'name' => 'Stop 2', 'seq' => 2, 'lat' => 12.2, 'lng' => 77.2]);
        $stop3 = \App\Models\RouteStop::create(['route_id' => $route->id, 'name' => 'Stop 3', 'seq' => 3, 'lat' => 12.3, 'lng' => 77.3]);
        $stop4 = \App\Models\RouteStop::create(['route_id' => $route->id, 'name' => 'Stop 4', 'seq' => 4, 'lat' => 12.4, 'lng' => 77.4]);

        $layoutId = SeatLayoutFactory::standardErtiga6P($this->city->id, $this->vehicleType->id);
        // Vehicle total capacity = 4 seats, 2 luggage
        $dep = \App\Models\RouteDeparture::create([
            'route_id' => $route->id,
            'driver_id' => $this->driver->id,
            'vehicle_seat_layout_id' => $layoutId,
            'service_date' => now()->toDateString(),
            'departure_kind' => 'driver_opened',
            'capacity' => 4,
            'luggage_capacity' => 2,
            'seats_taken' => 2,
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
            'drop_lat' => 12.2,
            'drop_lng' => 77.2,
        ]);

        // Passenger 1: Stop 1 -> Stop 2 (1 seat, 2 extra luggage)
        $passenger1 = \App\Models\SeatReservation::create([
            'route_departure_id' => $dep->id,
            'route_id' => $route->id,
            'trip_id' => $trip->id,
            'customer_id' => $this->customer->id,
            'board_stop_id' => $stop1->id,
            'drop_stop_id' => $stop2->id,
            'status' => 'CONFIRMED',
            'seats' => 1,
            'has_extra_luggage' => true,
            'extra_luggage_count' => 2,
            'fare_amount' => 150.0,
            'payment_status' => 'PAID',
        ]);

        // Passenger 2: Stop 2 -> Stop 4 (1 seat, 1 extra luggage)
        \App\Models\SeatReservation::create([
            'route_departure_id' => $dep->id,
            'route_id' => $route->id,
            'trip_id' => $trip->id,
            'customer_id' => $secondCustomer->id,
            'board_stop_id' => $stop2->id,
            'drop_stop_id' => $stop4->id,
            'status' => 'CONFIRMED',
            'seats' => 1,
            'has_extra_luggage' => true,
            'extra_luggage_count' => 1,
            'fare_amount' => 150.0,
            'payment_status' => 'PAID',
        ]);

        // Passenger 1 tries to extend drop to Stop 3.
        // Leg 2->3 would need Passenger 1 (2 luggage) + Passenger 2 (1 luggage) = 3 luggage > capacity (2).
        $res = $this->postJson("/api/admin/trips/{$trip->id}/passengers/{$passenger1->id}/change-drop", [
            'drop_stop_id' => $stop3->id,
        ]);

        $res->assertStatus(422);
        $this->assertStringContainsString('luggage capacity', strtolower($res->json('message')));
        $this->assertSame($stop2->id, $passenger1->fresh()->drop_stop_id);
    }

    public function test_admin_change_passenger_drop_rejects_non_drop_stop(): void
    {
        $this->asAdmin();

        $route = \App\Models\Route::create([
            'city_id' => $this->city->id,
            'name' => 'Drop Eligibility Route',
            'origin_name' => 'Stop 1',
            'dest_name' => 'Stop 3',
            'origin_lat' => 12.1,
            'origin_lng' => 77.1,
            'dest_lat' => 12.3,
            'dest_lng' => 77.3,
            'is_active' => true,
        ]);
        $stop1 = \App\Models\RouteStop::create(['route_id' => $route->id, 'name' => 'Stop 1', 'seq' => 1, 'lat' => 12.1, 'lng' => 77.1, 'is_drop' => true]);
        $stop2 = \App\Models\RouteStop::create(['route_id' => $route->id, 'name' => 'Stop 2', 'seq' => 2, 'lat' => 12.2, 'lng' => 77.2, 'is_drop' => true]);
        $stop3 = \App\Models\RouteStop::create(['route_id' => $route->id, 'name' => 'Stop 3 (Pickup Only)', 'seq' => 3, 'lat' => 12.3, 'lng' => 77.3, 'is_drop' => false]);

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
            'drop_lat' => 12.2,
            'drop_lng' => 77.2,
        ]);

        $passenger = \App\Models\SeatReservation::create([
            'route_departure_id' => $dep->id,
            'route_id' => $route->id,
            'trip_id' => $trip->id,
            'customer_id' => $this->customer->id,
            'board_stop_id' => $stop1->id,
            'drop_stop_id' => $stop2->id,
            'status' => 'CONFIRMED',
            'seats' => 1,
            'fare_amount' => 150.0,
            'payment_status' => 'PAID',
        ]);

        $res = $this->postJson("/api/admin/trips/{$trip->id}/passengers/{$passenger->id}/change-drop", [
            'drop_stop_id' => $stop3->id,
        ]);

        $res->assertStatus(422);
        $this->assertStringContainsString('not designated as a drop stop', strtolower($res->json('message')));
        $this->assertSame($stop2->id, $passenger->fresh()->drop_stop_id);
    }

    public function test_admin_change_passenger_drop_rejects_unavailable_stop(): void
    {
        $this->asAdmin();

        $route = \App\Models\Route::create([
            'city_id' => $this->city->id,
            'name' => 'Unavailable Stop Route',
            'origin_name' => 'Stop 1',
            'dest_name' => 'Stop 3',
            'origin_lat' => 12.1,
            'origin_lng' => 77.1,
            'dest_lat' => 12.3,
            'dest_lng' => 77.3,
            'is_active' => true,
        ]);
        $stop1 = \App\Models\RouteStop::create(['route_id' => $route->id, 'name' => 'Stop 1', 'seq' => 1, 'lat' => 12.1, 'lng' => 77.1, 'is_drop' => true]);
        $stop2 = \App\Models\RouteStop::create(['route_id' => $route->id, 'name' => 'Stop 2', 'seq' => 2, 'lat' => 12.2, 'lng' => 77.2, 'is_drop' => true]);
        $stop3 = \App\Models\RouteStop::create([
            'route_id' => $route->id,
            'name' => 'Stop 3 (Temporary Closed)',
            'seq' => 3,
            'lat' => 12.3,
            'lng' => 77.3,
            'is_drop' => true,
            'is_temporarily_unavailable' => true,
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
            'drop_lat' => 12.2,
            'drop_lng' => 77.2,
        ]);

        $passenger = \App\Models\SeatReservation::create([
            'route_departure_id' => $dep->id,
            'route_id' => $route->id,
            'trip_id' => $trip->id,
            'customer_id' => $this->customer->id,
            'board_stop_id' => $stop1->id,
            'drop_stop_id' => $stop2->id,
            'status' => 'CONFIRMED',
            'seats' => 1,
            'fare_amount' => 150.0,
            'payment_status' => 'PAID',
        ]);

        $res = $this->postJson("/api/admin/trips/{$trip->id}/passengers/{$passenger->id}/change-drop", [
            'drop_stop_id' => $stop3->id,
        ]);

        $res->assertStatus(422);
        $this->assertStringContainsString('currently unavailable', strtolower($res->json('message')));
        $this->assertSame($stop2->id, $passenger->fresh()->drop_stop_id);
    }

    public function test_admin_change_passenger_drop_rejects_when_vehicle_has_zero_luggage_capacity(): void
    {
        $this->asAdmin();

        $route = \App\Models\Route::create([
            'city_id' => $this->city->id,
            'name' => 'Zero Luggage Route',
            'origin_name' => 'Stop 1',
            'dest_name' => 'Stop 3',
            'origin_lat' => 12.1,
            'origin_lng' => 77.1,
            'dest_lat' => 12.3,
            'dest_lng' => 77.3,
            'is_active' => true,
        ]);
        $stop1 = \App\Models\RouteStop::create(['route_id' => $route->id, 'name' => 'Stop 1', 'seq' => 1, 'lat' => 12.1, 'lng' => 77.1, 'is_drop' => true]);
        $stop2 = \App\Models\RouteStop::create(['route_id' => $route->id, 'name' => 'Stop 2', 'seq' => 2, 'lat' => 12.2, 'lng' => 77.2, 'is_drop' => true]);
        $stop3 = \App\Models\RouteStop::create(['route_id' => $route->id, 'name' => 'Stop 3', 'seq' => 3, 'lat' => 12.3, 'lng' => 77.3, 'is_drop' => true]);

        $layoutId = SeatLayoutFactory::standardErtiga6P($this->city->id, $this->vehicleType->id);
        // Vehicle explicitly has 0 luggage capacity
        $dep = \App\Models\RouteDeparture::create([
            'route_id' => $route->id,
            'driver_id' => $this->driver->id,
            'vehicle_seat_layout_id' => $layoutId,
            'service_date' => now()->toDateString(),
            'departure_kind' => 'driver_opened',
            'capacity' => 6,
            'luggage_capacity' => 0,
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
            'drop_lat' => 12.2,
            'drop_lng' => 77.2,
        ]);

        // Passenger holds 1 extra luggage item
        $passenger = \App\Models\SeatReservation::create([
            'route_departure_id' => $dep->id,
            'route_id' => $route->id,
            'trip_id' => $trip->id,
            'customer_id' => $this->customer->id,
            'board_stop_id' => $stop1->id,
            'drop_stop_id' => $stop2->id,
            'status' => 'CONFIRMED',
            'seats' => 1,
            'has_extra_luggage' => true,
            'extra_luggage_count' => 1,
            'fare_amount' => 150.0,
            'payment_status' => 'PAID',
        ]);

        $res = $this->postJson("/api/admin/trips/{$trip->id}/passengers/{$passenger->id}/change-drop", [
            'drop_stop_id' => $stop3->id,
        ]);

        $res->assertStatus(422);
        $this->assertStringContainsString('luggage capacity', strtolower($res->json('message')));
        $this->assertSame($stop2->id, $passenger->fresh()->drop_stop_id);
    }

    public function test_admin_change_passenger_drop_succeeds_extending_drop_and_preserves_fare(): void
    {
        $this->asAdmin();

        $notificationService = \Mockery::spy(\App\Services\NotificationService::class);
        $this->app->instance(\App\Services\NotificationService::class, $notificationService);

        $route = \App\Models\Route::create([
            'city_id' => $this->city->id,
            'name' => 'Valid Extension Route',
            'origin_name' => 'Stop 1',
            'dest_name' => 'Stop 3',
            'origin_lat' => 12.1,
            'origin_lng' => 77.1,
            'dest_lat' => 12.3,
            'dest_lng' => 77.3,
            'is_active' => true,
        ]);
        $stop1 = \App\Models\RouteStop::create(['route_id' => $route->id, 'name' => 'Stop 1', 'seq' => 1, 'lat' => 12.1, 'lng' => 77.1, 'is_drop' => true]);
        $stop2 = \App\Models\RouteStop::create(['route_id' => $route->id, 'name' => 'Stop 2', 'seq' => 2, 'lat' => 12.2, 'lng' => 77.2, 'is_drop' => true]);
        $stop3 = \App\Models\RouteStop::create(['route_id' => $route->id, 'name' => 'Stop 3', 'seq' => 3, 'lat' => 12.3, 'lng' => 77.3, 'is_drop' => true]);

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
            'drop_lat' => 12.2,
            'drop_lng' => 77.2,
        ]);

        $passenger = \App\Models\SeatReservation::create([
            'route_departure_id' => $dep->id,
            'route_id' => $route->id,
            'trip_id' => $trip->id,
            'customer_id' => $this->customer->id,
            'board_stop_id' => $stop1->id,
            'drop_stop_id' => $stop2->id,
            'status' => 'CONFIRMED',
            'seats' => 1,
            'fare_amount' => 150.0,
            'payment_status' => 'PAID',
            'payment_method' => 'razorpay',
            'payment_reference' => 'pay_test123',
        ]);

        $res = $this->postJson("/api/admin/trips/{$trip->id}/passengers/{$passenger->id}/change-drop", [
            'drop_stop_id' => $stop3->id,
        ]);

        $res->assertOk();
        $fresh = $passenger->fresh();
        $this->assertSame($stop3->id, $fresh->drop_stop_id);
        $this->assertEquals(12.3, (float) $fresh->drop_lat);
        $this->assertEquals(77.3, (float) $fresh->drop_lng);
        $this->assertSame('Stop 3', $fresh->drop_address);
        // Fare and payment must remain preserved
        $this->assertEquals(150.0, (float) $fresh->fare_amount);
        $this->assertSame('PAID', $fresh->payment_status);
        $this->assertSame('razorpay', $fresh->payment_method);
        $this->assertSame('pay_test123', $fresh->payment_reference);

        // Assert notification created for customer and driver in DB
        $this->assertDatabaseHas('app_notifications', [
            'user_id' => $this->customer->id,
            'type' => 'trip_destination_updated',
        ]);
        $this->assertDatabaseHas('app_notifications', [
            'user_id' => $this->driver->id,
            'type' => 'passenger_destination_updated',
        ]);

        // Assert push notification was dispatched directly to the customer & driver via NotificationService
        $notificationService->shouldHaveReceived('sendToUser')
            ->with(
                \Mockery::on(fn ($u) => (int) $u->id === (int) $this->driver->id),
                'Passenger drop updated',
                \Mockery::type('string'),
                \Mockery::on(fn ($data) => isset($data['drop_stop_id']) && (int) $data['drop_stop_id'] === $stop3->id)
            )
            ->once();

        $notificationService->shouldHaveReceived('sendToUser')
            ->with(
                \Mockery::on(fn ($u) => (int) $u->id === (int) $this->customer->id),
                'Destination updated',
                \Mockery::type('string'),
                \Mockery::on(fn ($data) => isset($data['drop_stop_id']) && (int) $data['drop_stop_id'] === $stop3->id)
            )
            ->once();
    }

    public function test_admin_change_passenger_drop_does_not_send_notifications_on_failure(): void
    {
        $this->asAdmin();

        $notificationService = \Mockery::spy(\App\Services\NotificationService::class);
        $this->app->instance(\App\Services\NotificationService::class, $notificationService);

        $route = \App\Models\Route::create([
            'city_id' => $this->city->id,
            'name' => 'Failure Notification Route',
            'origin_name' => 'Stop 1',
            'dest_name' => 'Stop 3',
            'origin_lat' => 12.1,
            'origin_lng' => 77.1,
            'dest_lat' => 12.3,
            'dest_lng' => 77.3,
            'is_active' => true,
        ]);
        $stop1 = \App\Models\RouteStop::create(['route_id' => $route->id, 'name' => 'Stop 1', 'seq' => 1, 'lat' => 12.1, 'lng' => 77.1, 'is_drop' => true]);
        $stop2 = \App\Models\RouteStop::create(['route_id' => $route->id, 'name' => 'Stop 2', 'seq' => 2, 'lat' => 12.2, 'lng' => 77.2, 'is_drop' => true]);

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
            'drop_lat' => 12.2,
            'drop_lng' => 77.2,
        ]);

        $passenger = \App\Models\SeatReservation::create([
            'route_departure_id' => $dep->id,
            'route_id' => $route->id,
            'trip_id' => $trip->id,
            'customer_id' => $this->customer->id,
            'board_stop_id' => $stop1->id,
            'drop_stop_id' => $stop2->id,
            'status' => 'CONFIRMED',
            'seats' => 1,
            'fare_amount' => 150.0,
            'payment_status' => 'PAID',
        ]);

        // Attempting to change drop to invalid stop ID
        $res = $this->postJson("/api/admin/trips/{$trip->id}/passengers/{$passenger->id}/change-drop", [
            'drop_stop_id' => 999999,
        ]);

        $res->assertStatus(422);

        // Prove push notification was NEVER sent
        $notificationService->shouldNotHaveReceived('sendToUser');

        // Prove in-app DB notification was NEVER created
        $this->assertDatabaseMissing('app_notifications', [
            'user_id' => $this->customer->id,
            'type' => 'trip_destination_updated',
        ]);
        $this->assertDatabaseMissing('app_notifications', [
            'user_id' => $this->driver->id,
            'type' => 'passenger_destination_updated',
        ]);
    }
}

