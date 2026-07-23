<?php

namespace Tests\Feature;

use App\Models\DepartureSeat;
use App\Models\Driver;
use App\Models\FixedSeatHold;
use App\Models\Route;
use App\Models\RouteDeparture;
use App\Models\RouteStop;
use App\Models\User;
use App\Services\FixedAvailabilityService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * M8 — end-to-end acceptance for the fully customisable seat layout feature.
 *
 * One test that walks the whole story via real HTTP endpoints:
 *
 *   Admin → designs a layout (POST /admin/cities/{city}/vehicle-seat-layouts)
 *   Driver → opens a vehicle with that layout (POST /fixed/driver/vehicles)
 *          → snapshot creates departure_seats all AVAILABLE
 *   C1    → holds 2A, then confirms → BOOKED
 *   C1    → holds 2B separately, confirms → BOOKED (two bookings so the
 *           admin cancel below can free 2A only, keeping 2B booked)
 *   C2    → tries 2A → 422; picks 3A; confirms → BOOKED
 *   Admin → cancels C1's 2A booking → 2A back to AVAILABLE, 2B still BOOKED
 *   C3    → holds 3B, abandons → hold expires → 3B back to AVAILABLE
 *
 * Every step reads/asserts the seat map so the story stays coherent.
 * The seat_map endpoint is the ground-truth surface the customer app sees.
 */
class FixedSeatLayoutAcceptanceTest extends TestCase
{
    use RefreshDatabase;

    private int $cityId;
    private int $vehicleTypeId;
    private User $admin;
    private User $driver;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('services.razorpay.key_id', 'rzp_test_m8');

        $this->cityId = DB::table('cities')->insertGetId([
            'name' => 'M8 City', 'country_code' => 'IN',
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Ertiga', 'sort_order' => 1, 'is_active' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);

        $this->admin = User::factory()->create(['manager_all_cities' => true]);
        $this->admin->addRole('admin');
        $roleId = DB::table('manager_roles')->insertGetId([
            'slug' => 'super_admin', 'name' => 'Super Admin', 'is_system' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->admin->forceFill(['manager_role_id' => $roleId])->save();

        $this->driver = $this->onlineFixedDriver();
    }

    public function test_full_seat_layout_story_from_admin_design_to_hold_expiry(): void
    {
        // ─── Step 1: Admin designs the "Ertiga 6P" layout via the real API. ───
        Sanctum::actingAs($this->admin, ['act-as:admin']);
        $layoutId = (int) $this->postJson("/api/admin/cities/{$this->cityId}/vehicle-seat-layouts", [
            'name' => 'Ertiga 6P e2e',
            'vehicle_type_id' => $this->vehicleTypeId,
            'rows' => 3,
            'cols' => 3,
            'cells' => [
                ['row' => 1, 'col' => 1, 'kind' => 'blocked'], // driver
                ['row' => 1, 'col' => 2, 'kind' => 'seat', 'label' => '1A', 'category' => 'front'],
                ['row' => 1, 'col' => 3, 'kind' => 'blocked'],
                ['row' => 2, 'col' => 1, 'kind' => 'seat', 'label' => '2A', 'category' => 'window'],
                ['row' => 2, 'col' => 2, 'kind' => 'seat', 'label' => '2B', 'category' => 'middle'],
                ['row' => 2, 'col' => 3, 'kind' => 'seat', 'label' => '2C', 'category' => 'window'],
                ['row' => 3, 'col' => 1, 'kind' => 'seat', 'label' => '3A', 'category' => 'rear'],
                ['row' => 3, 'col' => 2, 'kind' => 'aisle'],
                ['row' => 3, 'col' => 3, 'kind' => 'seat', 'label' => '3B', 'category' => 'rear'],
            ],
        ])->assertCreated()->json('layout.id');

        // ─── Step 2: Route + driver group + driver opens vehicle with layout. ───
        $route = $this->makeRoute();
        $this->grantDriverRoute($this->driver, $route);

        Sanctum::actingAs($this->driver, ['act-as:driver']);
        $depId = (int) $this->postJson('/api/fixed/driver/vehicles', [
            'route_id' => $route->id,
            'vehicle_seat_layout_id' => $layoutId,
        ])->assertCreated()->json('vehicle.id');

        // Snapshot check — 6 seat rows all AVAILABLE, capacity == seat count.
        $this->assertSame(6, (int) RouteDeparture::query()->findOrFail($depId)->capacity);
        $this->assertSame(
            ['1A', '2A', '2B', '2C', '3A', '3B'],
            DepartureSeat::query()->where('route_departure_id', $depId)->orderBy('label')->pluck('label')->all(),
        );
        $this->assertTrue(
            DepartureSeat::query()->where('route_departure_id', $depId)->where('status', 'AVAILABLE')->count() === 6,
        );

        // Open the boarding window so customers can hit the flow.
        RouteDeparture::query()->whereKey($depId)->update([
            'depart_at' => now()->addHours(2),
            'announced_depart_at' => now()->addHours(2),
            'boarding_opened_at' => now(),
        ]);
        [$pickup, $drop] = $this->makeStops($route);

        // ─── Step 3: C1 books 2A. ───
        $c1 = $this->makeCustomer();
        $c1Booking2A = $this->bookOneSeat($c1, $depId, $pickup, $drop, '2A', 'c1-2a');
        $this->assertSame('BOOKED', $this->seatStatus($depId, '2A'));

        // ─── Step 4: C1 also books 2B (separate reservation so we can cancel 2A
        //             only in step 6 without touching 2B). ───
        $c1Booking2B = $this->bookOneSeat($c1, $depId, $pickup, $drop, '2B', 'c1-2b');
        $this->assertSame('BOOKED', $this->seatStatus($depId, '2B'));

        // ─── Step 5: C2 tries 2A → 422. Then picks 3A and pays. ───
        $c2 = $this->makeCustomer();
        Sanctum::actingAs($c2, ['act-as:customer']);
        $this->withHeaders(['Idempotency-Key' => 'c2-race'])
            ->postJson('/api/fixed/seat-holds', [
                'route_departure_id' => $depId,
                'board_stop_id' => $pickup->id,
                'drop_stop_id' => $drop->id,
                'seat_labels' => ['2A'],
            ])->assertStatus(422);

        $c2Booking3A = $this->bookOneSeat($c2, $depId, $pickup, $drop, '3A', 'c2-3a');
        $this->assertSame('BOOKED', $this->seatStatus($depId, '3A'));

        // Seat-map view for C2 must show 2A/2B as BOOKED at this point.
        Sanctum::actingAs($c2, ['act-as:customer']);
        $map = $this->getJson("/api/fixed/departures/{$depId}/seat-map")->assertOk();
        $cells = collect($map->json('cells'));
        $this->assertSame('BOOKED', $cells->firstWhere('label', '2A')['status']);
        $this->assertSame('BOOKED', $cells->firstWhere('label', '2B')['status']);
        $this->assertSame('BOOKED', $cells->firstWhere('label', '3A')['status']);

        // ─── Step 6: Admin cancels C1's 2A booking only. ───
        Sanctum::actingAs($this->admin, ['act-as:admin']);
        $this->postJson("/api/admin/cities/{$this->cityId}/fixed-bookings/{$c1Booking2A}/cancel", [
            'reason' => 'M8 acceptance test — cancel just the 2A booking',
        ])->assertOk();

        $this->assertSame('AVAILABLE', $this->seatStatus($depId, '2A'), '2A should free after cancelling its booking');
        $this->assertSame('BOOKED',    $this->seatStatus($depId, '2B'), '2B belongs to a different booking; must stay BOOKED');
        $this->assertSame('BOOKED',    $this->seatStatus($depId, '3A'), 'C2 is untouched');

        // ─── Step 7: C3 holds 3B then abandons → time-travel past expiry → 3B frees. ───
        $c3 = $this->makeCustomer();
        Sanctum::actingAs($c3, ['act-as:customer']);
        $c3HoldId = (int) $this->withHeaders(['Idempotency-Key' => 'c3-abandon'])
            ->postJson('/api/fixed/seat-holds', [
                'route_departure_id' => $depId,
                'board_stop_id' => $pickup->id,
                'drop_stop_id' => $drop->id,
                'seat_labels' => ['3B'],
            ])->assertCreated()->json('hold.id');

        $this->assertSame('HELD', $this->seatStatus($depId, '3B'));

        // Age the hold past its TTL and drive the lazy expiry.
        FixedSeatHold::query()->whereKey($c3HoldId)->update([
            'expires_at' => now()->subMinute(),
        ]);
        $hold = FixedSeatHold::query()->findOrFail($c3HoldId);
        app(FixedAvailabilityService::class)->expireHoldIfNeeded($hold);

        $this->assertSame('EXPIRED',   FixedSeatHold::query()->findOrFail($c3HoldId)->status);
        $this->assertSame('AVAILABLE', $this->seatStatus($depId, '3B'));

        // Sanity: the newly-freed 2A and 3B are immediately re-holdable.
        Sanctum::actingAs($this->makeCustomer(), ['act-as:customer']);
        $this->withHeaders(['Idempotency-Key' => 'c4-final'])
            ->postJson('/api/fixed/seat-holds', [
                'route_departure_id' => $depId,
                'board_stop_id' => $pickup->id,
                'drop_stop_id' => $drop->id,
                'seat_labels' => ['2A', '3B'],
            ])->assertCreated();

        $this->assertSame('HELD', $this->seatStatus($depId, '2A'));
        $this->assertSame('HELD', $this->seatStatus($depId, '3B'));
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private function makeRoute(): Route
    {
        return Route::query()->create([
            'city_id' => $this->cityId, 'scope' => 'local', 'mode' => 'fixed',
            'name' => 'M8 Route', 'origin_name' => 'A', 'dest_name' => 'B',
            'origin_lat' => 34.0, 'origin_lng' => 74.0,
            'dest_lat' => 34.1, 'dest_lng' => 74.1,
            'fare_config' => ['seat_fare' => 120],
            'booking_window_hours' => 6, 'max_seats_per_booking' => 4,
            'waiting_time_per_stop_minutes' => 5,
            'luggage_surcharge_amount' => 25, 'max_luggage_per_vehicle' => 3,
            'requires_prepaid' => true, 'board_anywhere' => false, 'is_active' => true,
        ]);
    }

    private function makeStops(Route $route): array
    {
        $pickup = RouteStop::query()->create([
            'route_id' => $route->id, 'seq' => 1, 'name' => 'A',
            'lat' => 34.0, 'lng' => 74.0,
            'is_pickup' => true, 'is_drop' => false, 'is_active' => true,
            'is_temporarily_unavailable' => false,
        ]);
        $drop = RouteStop::query()->create([
            'route_id' => $route->id, 'seq' => 2, 'name' => 'B',
            'lat' => 34.1, 'lng' => 74.1,
            'is_pickup' => false, 'is_drop' => true, 'is_active' => true,
            'is_temporarily_unavailable' => false,
        ]);
        return [$pickup, $drop];
    }

    private function onlineFixedDriver(): User
    {
        $u = User::factory()->create();
        $u->addRole('driver');
        $driver = Driver::query()->create([
            'user_id' => $u->id,
            'city_id' => $this->cityId,
            'approval_status' => 'approved',
            'service_scope' => 'local',
            'service_mode' => 'fixed',
            'is_online' => true,
            'last_online_at' => now(),
        ]);
        $driver->forceFill(['active_service_mode' => 'fixed', 'active_service_scope' => 'local'])->save();
        return $u;
    }

    private function grantDriverRoute(User $driver, Route $route): void
    {
        $gid = DB::table('route_groups')->insertGetId([
            'city_id' => $this->cityId, 'name' => 'M8 group', 'is_active' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('route_group_route')->insert([
            'route_group_id' => $gid, 'route_id' => $route->id,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('driver_route_group')->insert([
            'driver_user_id' => $driver->id, 'route_group_id' => $gid,
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function makeCustomer(): User
    {
        $u = User::factory()->create();
        $u->addRole('customer');
        return $u;
    }

    private function bookOneSeat(User $customer, int $depId, RouteStop $pickup, RouteStop $drop, string $label, string $key): int
    {
        Sanctum::actingAs($customer, ['act-as:customer']);
        $holdId = $this->withHeaders(['Idempotency-Key' => "$key-hold"])
            ->postJson('/api/fixed/seat-holds', [
                'route_departure_id' => $depId,
                'board_stop_id' => $pickup->id,
                'drop_stop_id' => $drop->id,
                'seat_labels' => [$label],
            ])->assertCreated()->json('hold.id');

        return (int) $this->withHeaders(['Idempotency-Key' => "$key-pay"])
            ->postJson("/api/fixed/seat-holds/{$holdId}/test-confirm-payment", [
                'booking_channel' => 'advance',
            ])->assertCreated()->json('reservation.id');
    }

    private function seatStatus(int $depId, string $label): string
    {
        return DepartureSeat::query()
            ->where('route_departure_id', $depId)
            ->where('label', $label)
            ->value('status');
    }
}
