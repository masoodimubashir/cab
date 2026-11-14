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

/** Stored snapshots remain intact; current operator labels win in the UI. */
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

    public function test_import_and_duplicate_lookup_accepts_current_and_original_corridor_titles(): void
    {
        $city = \App\Models\City::findOrFail($this->makeCity('Lookup City'));
        $route = $this->makeRoute($city->id, 'Google start → Google end');
        $service = app(\App\Services\FixedRouteService::class);
        $this->assertSame($route->id, $service->findAdminRouteByName($city, ' sopore → SRINAGAR ')?->id);
        $this->assertSame($route->id, $service->findAdminRouteByName($city, 'Google start → Google end')?->id);
        $this->assertNull($service->findAdminRouteByName($city, 'Another route'));
    }

    public function test_current_display_name_replaces_snapshot_on_past_ride(): void
    {
        $cityId = $this->makeCity('Lock City');
        $customer = User::factory()->create();
        $route = $this->makeRoute($cityId, 'Sopore Express');
        $res = $this->makeReservation($route, $customer, 'Sopore Express');

        // Admin completely changes the route later, including its name.
        $route->update(['name' => 'Gulmarg Express', 'origin_name' => 'Tangmarg', 'dest_name' => 'Gulmarg']);

        $shaped = app(FixedBookingService::class)->shapeBooking($res->fresh(['route', 'routeDeparture']));

        // Display the current name without rewriting the stored snapshot.
        $this->assertSame('Gulmarg Express', $shaped['route_name']);
        $this->assertSame('Sopore Express', $res->getRawOriginal('route_name'));
        $this->assertSame('Tangmarg', $shaped['origin_name']);
        $this->assertSame('Gulmarg', $shaped['dest_name']);
        // Unmapped pickup/drop points retain their own labels.
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

    public function test_booking_list_uses_current_mapped_stop_names_instead_of_google_snapshots(): void
    {
        $cityId = $this->makeCity('Display City');
        $customer = User::factory()->create();
        $route = $this->makeRoute($cityId, 'Google start → Google end');
        $start = $route->stops()->create(['seq' => 1, 'name' => 'Custom start', 'lat' => 34.29, 'lng' => 74.47,
            'is_pickup' => true, 'is_drop' => false, 'is_active' => true]);
        $end = $route->stops()->create(['seq' => 2, 'name' => 'Custom end', 'lat' => 34.08, 'lng' => 74.79,
            'is_pickup' => false, 'is_drop' => true, 'is_active' => true]);
        $reservation = $this->makeReservation($route, $customer, 'Google start → Google end');
        $reservation->update(['board_stop_id' => $start->id, 'drop_stop_id' => $end->id]);
        $route->update(['origin_name' => 'Custom start', 'dest_name' => 'Custom end']);
        $rows = app(FixedBookingService::class)->myBookings($customer)['data'];
        $this->assertSame('Custom start → Custom end', $rows[0]['route_name']);
        $this->assertSame('Custom start', $rows[0]['origin_name']);
        $this->assertSame('Custom end', $rows[0]['dest_name']);
        $this->assertSame('Custom start', $rows[0]['board']);
        $this->assertSame('Custom end', $rows[0]['drop']);
        $this->assertSame('Sopore', $reservation->fresh()->getRawOriginal('board_address'));
    }
}
