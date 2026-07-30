<?php

namespace Tests\Feature;

use App\Models\Driver;
use App\Models\Route;
use App\Models\RouteDeparture;
use App\Models\SeatReservation;
use App\Models\Trip;
use App\Models\User;
use App\Services\CommissionSettlementService;
use App\Services\FixedPricingService;
use App\Services\WalletService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Support\SeatLayoutFactory;
use Tests\TestCase;

/**
 * M4 — route decoupling. Proves a fixed route can exist with NO vehicle, owns
 * its own capacity, and that all money (commission/earnings) is computed from
 * the route's own fare_config — never the vehicle. This is the money-safety
 * proof for the decoupling.
 */
class FixedRouteVehicleDecouplingTest extends TestCase
{
    use RefreshDatabase;

    private int $cityId;
    private int $layoutId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->cityId = DB::table('cities')->insertGetId([
            'name' => 'Decouple City', 'country_code' => 'IN',
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Ertiga', 'sort_order' => 1, 'is_active' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->layoutId = SeatLayoutFactory::standardErtiga6P($this->cityId, $vehicleTypeId);
    }

    private function actAsAdmin(): void
    {
        $admin = User::factory()->create(['manager_all_cities' => true]);
        $admin->addRole('admin');
        $roleId = DB::table('manager_roles')->insertGetId([
            'slug' => 'super_admin', 'name' => 'Super Admin', 'is_system' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $admin->forceFill(['manager_role_id' => $roleId])->save();
        Sanctum::actingAs($admin, ['act-as:admin']);
    }

    private function routePayload(array $overrides = []): array
    {
        return array_merge([
            'scope' => 'local',
            'name' => 'VL Route',
            'origin_name' => 'A', 'dest_name' => 'B',
            'origin_lat' => 34.0, 'origin_lng' => 74.0, 'dest_lat' => 34.1, 'dest_lng' => 74.1,
            'max_seats_per_booking' => 6,
            'max_luggage_per_vehicle' => 2,
            'fare_config' => ['seat_fare' => 100],
            'stops' => [
                ['seq' => 1, 'name' => 'A', 'lat' => 34.0, 'lng' => 74.0, 'is_pickup' => true, 'is_drop' => false],
                ['seq' => 2, 'name' => 'B', 'lat' => 34.1, 'lng' => 74.1, 'is_pickup' => false, 'is_drop' => true],
            ],
        ], $overrides);
    }

    private function vehiclelessRoute(): Route
    {
        return Route::create([
            'city_id' => $this->cityId,
            'scope' => 'local', 'mode' => 'fixed', 'name' => 'VL',
            'origin_name' => 'O', 'dest_name' => 'D',
            'origin_lat' => 34.0, 'origin_lng' => 74.0, 'dest_lat' => 34.1, 'dest_lng' => 74.1,
            'city_vehicle_type_id' => null,
            'max_seats_per_booking' => 6,
            'max_luggage_per_vehicle' => 2,
            'fare_config' => ['seat_fare' => 100, 'commission_type' => 'percent', 'commission_percent' => 10],
            'is_active' => true,
        ]);
    }

    public function test_admin_can_create_a_route_without_a_vehicle(): void
    {
        $this->actAsAdmin();
        $res = $this->postJson("/api/admin/cities/{$this->cityId}/fixed-routes", $this->routePayload());

        $res->assertCreated();
        $route = Route::findOrFail($res->json('route.id'));
        $this->assertNull($route->city_vehicle_type_id);
        $this->assertSame(6, (int) $route->max_seats_per_booking);
        $this->assertSame(2, (int) $route->max_luggage_per_vehicle);
    }

    public function test_route_owns_its_capacity_even_when_a_vehicle_is_provided(): void
    {
        // Vehicle says 4 seats / 1 bag, but the route explicitly requests 6 / 3.
        $vehicleId = DB::table('city_vehicle_types')->insertGetId([
            'city_id' => $this->cityId, 'ride_type_id' => null, 'display_name' => 'Small',
            'display_order' => 1, 'max_people' => 4, 'luggage_capacity' => 1,
            'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
        ]);

        $this->actAsAdmin();
        $res = $this->postJson("/api/admin/cities/{$this->cityId}/fixed-routes", $this->routePayload([
            'city_vehicle_type_id' => $vehicleId,
            'max_seats_per_booking' => 6,
            'max_luggage_per_vehicle' => 3,
        ]));

        $res->assertCreated();
        $route = Route::findOrFail($res->json('route.id'));
        $this->assertSame(6, (int) $route->max_seats_per_booking); // route input wins
        $this->assertSame(3, (int) $route->max_luggage_per_vehicle);
    }

    public function test_commission_is_computed_from_fare_config_not_the_vehicle(): void
    {
        $route = $this->vehiclelessRoute();
        $this->assertNull($route->city_vehicle_type_id);

        $commission = app(FixedPricingService::class)->bookingCommission($route, 100.0, 1);
        $this->assertSame(10.0, $commission['amount']); // 10% of 100, no vehicle consulted
    }

    public function test_vehicleless_route_settles_and_credits_the_driver_correctly(): void
    {
        // This case pins the legacy wallet-settlement path (split engine OFF):
        // it checks that a *vehicleless* route still settles the driver's share the
        // classic way. The split-engine equivalent (Route transfer / held earning)
        // is covered by BookingSettlementPhase5Test.
        config()->set('services.payments.split_enabled', false);

        $route = $this->vehiclelessRoute();
        $driverUser = User::factory()->create();
        Driver::create(['user_id' => $driverUser->id, 'city_id' => $this->cityId, 'approval_status' => 'approved']);
        $customer = User::factory()->create();
        $rideTypeId = DB::table('ride_types')->insertGetId(['name' => 'Fixed', 'created_at' => now(), 'updated_at' => now()]);

        $dep = RouteDeparture::create([
            'route_id' => $route->id, 'driver_id' => $driverUser->id, 'city_vehicle_type_id' => null,
            'vehicle_seat_layout_id' => $this->layoutId,
            'service_date' => now()->toDateString(), 'departure_kind' => 'driver_opened',
            'capacity' => 6, 'seats_taken' => 1, 'status' => 'DEPARTED', 'visible_to_customers' => true,
        ]);

        $trip = Trip::create([
            'customer_id' => null, 'driver_id' => $driverUser->id, 'city_id' => $this->cityId, 'scope' => 'local',
            'city_vehicle_type_id' => null, 'ride_type_id' => $rideTypeId,
            'route_id' => $route->id, 'route_departure_id' => $dep->id,
            'status' => 'COMPLETED', 'estimated_fare' => 100, 'final_fare' => 100, 'currency' => 'INR',
            'pickup_address' => 'O', 'pickup_lat' => 34.0, 'pickup_lng' => 74.0,
            'drop_address' => 'D', 'drop_lat' => 34.1, 'drop_lng' => 74.1,
        ]);

        SeatReservation::create([
            'route_departure_id' => $dep->id, 'trip_id' => $trip->id, 'route_id' => $route->id,
            'customer_id' => $customer->id, 'seats' => 1, 'fare_amount' => 100,
            'status' => 'BOARDED', 'payment_status' => 'PAID', 'booking_channel' => 'advance',
        ]);

        app(CommissionSettlementService::class)->settle($trip->fresh());

        // Fare 100 − 10% commission (from fare_config) = 90 credited to the driver.
        $this->assertEqualsWithDelta(90.0, app(WalletService::class)->balance($driverUser->fresh()), 0.001);
    }
}
