<?php

namespace Tests\Feature;

use App\Models\Route;
use App\Models\RouteDeparture;
use App\Models\SeatReservation;
use App\Models\User;
use App\Services\FixedBookingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Support\SeatLayoutFactory;
use Tests\TestCase;

/**
 * Verifies the route-name lock: a ride freezes its route's name at booking time
 * so renaming the route later never changes the name shown on past rides, while
 * the ride's from/to (already snapshotted) stays correct too.
 */
class FixedRouteNameLockTest extends TestCase
{
    use RefreshDatabase;

    private function makeCity(string $name): int
    {
        return DB::table('cities')->insertGetId([
            'name' => $name,
            'country_code' => 'IN',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function makeRoute(int $cityId, string $name): Route
    {
        return Route::query()->create([
            'city_id' => $cityId,
            'scope' => 'local',
            'mode' => 'fixed',
            'name' => $name,
            'origin_name' => 'Sopore',
            'dest_name' => 'Srinagar',
            'origin_lat' => 34.2900000,
            'origin_lng' => 74.4700000,
            'dest_lat' => 34.0800000,
            'dest_lng' => 74.7900000,
            'fare_config' => ['seat_fare' => 120],
            'is_active' => true,
        ]);
    }

    private function makeReservation(Route $route, User $customer, ?string $snapshotName): SeatReservation
    {
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Ertiga ' . uniqid(), 'sort_order' => 1, 'is_active' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $layoutId = SeatLayoutFactory::standardErtiga6P($route->city_id, $vehicleTypeId);

        $dep = RouteDeparture::query()->create([
            'route_id' => $route->id,
            'vehicle_seat_layout_id' => $layoutId,
            'service_date' => now()->toDateString(),
            'capacity' => 4,
            'seats_taken' => 1,
            'status' => 'COMPLETED',
        ]);

        return SeatReservation::query()->create([
            'route_departure_id' => $dep->id,
            'route_id' => $route->id,
            'route_name' => $snapshotName,
            'customer_id' => $customer->id,
            'seats' => 1,
            'board_address' => 'Sopore',
            'drop_address' => 'Srinagar',
            'fare_amount' => 120,
            'payment_method' => 'wallet',
            'status' => 'COMPLETED',
        ]);
    }

    public function test_route_name_column_exists(): void
    {
        $this->assertTrue(Schema::hasColumn('seat_reservations', 'route_name'));
    }

    public function test_renaming_route_does_not_change_name_on_past_ride(): void
    {
        $cityId = $this->makeCity('Lock City');
        $customer = User::factory()->create();
        $route = $this->makeRoute($cityId, 'Sopore Express');
        $res = $this->makeReservation($route, $customer, 'Sopore Express');

        // Admin completely changes the route later, including its name.
        $route->update(['name' => 'Gulmarg Express', 'origin_name' => 'Tangmarg', 'dest_name' => 'Gulmarg']);

        $shaped = app(FixedBookingService::class)->shapeBooking($res->fresh(['route', 'routeDeparture']));

        // The frozen name wins — old ride is unaffected by the rename.
        $this->assertSame('Sopore Express', $shaped['route_name']);
        // And the from/to snapshot is still correct too.
        $this->assertSame('Sopore', $shaped['board']);
        $this->assertSame('Srinagar', $shaped['drop']);
    }

    public function test_legacy_ride_without_snapshot_falls_back_to_live_name(): void
    {
        $cityId = $this->makeCity('Legacy City');
        $customer = User::factory()->create();
        $route = $this->makeRoute($cityId, 'Live Name');
        $res = $this->makeReservation($route, $customer, null); // legacy row, no snapshot

        $shaped = app(FixedBookingService::class)->shapeBooking($res->fresh(['route', 'routeDeparture']));

        $this->assertSame('Live Name', $shaped['route_name']);
    }
}
