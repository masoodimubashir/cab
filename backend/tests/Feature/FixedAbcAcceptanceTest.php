<?php

namespace Tests\Feature;

use App\Models\Driver;
use App\Models\Route;
use App\Models\RouteDeparture;
use App\Models\SeatReservation;
use App\Models\Trip;
use App\Models\User;
use App\Services\CommissionSettlementService;
use App\Services\WalletService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Support\SeatLayoutFactory;
use Tests\TestCase;

/**
 * M8 — the A/B/C acceptance run.
 *
 * Codifies the tracker's headline scenario end-to-end at the backend: one
 * shared vehicle "Ertiga", three drivers A/B/C bound to it, six vehicle-less
 * routes R1–R6, three groups (Airport{R1,R2}, North{R3,R4}, Night{R6}), and
 * three assignments (A→Airport, B→North, C→Airport+Night). Proves each driver
 * sees exactly their union, `open()` is gated per driver, C's R6 ride settles
 * to the right wallet amount, and adding R7 to Airport ripples to A+C but not
 * B — the whole point of the decoupling.
 */
class FixedAbcAcceptanceTest extends TestCase
{
    use RefreshDatabase;

    private int $cityId;
    private int $ertigaId;
    private int $layoutId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->cityId = DB::table('cities')->insertGetId([
            'name' => 'Acceptance City', 'country_code' => 'IN',
            'created_at' => now(), 'updated_at' => now(),
        ]);
        // Shared "Ertiga" — bolted to all 3 drivers to prove the decoupling: the
        // same vehicle never leaks into anyone's route list.
        $this->ertigaId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Ertiga', 'sort_order' => 1, 'is_active' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        // Post-M0: every departure carries a layout. Seed the city so the
        // driver-open flow + direct RouteDeparture inserts can attach one.
        $this->layoutId = SeatLayoutFactory::standardErtiga6P($this->cityId, $this->ertigaId);
    }

    /** Vehicle-less fixed route with a 10% percent commission baked into fare_config. */
    private function makeRoute(string $name, string $scope = 'local'): int
    {
        return DB::table('routes')->insertGetId([
            'city_id' => $this->cityId, 'scope' => $scope, 'mode' => 'fixed', 'name' => $name,
            'origin_name' => "$name O", 'dest_name' => "$name D",
            'origin_lat' => 34.0, 'origin_lng' => 74.0, 'dest_lat' => 34.1, 'dest_lng' => 74.1,
            'city_vehicle_type_id' => null,
            'max_seats_per_booking' => 6, 'max_luggage_per_vehicle' => 2,
            'fare_config' => json_encode([
                'seat_fare' => 100, 'commission_type' => 'percent', 'commission_percent' => 10,
            ]),
            'is_active' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function makeGroup(string $name, array $routeIds): int
    {
        $gid = DB::table('route_groups')->insertGetId([
            'city_id' => $this->cityId, 'name' => $name, 'is_active' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        foreach ($routeIds as $rid) {
            DB::table('route_group_route')->insert([
                'route_group_id' => $gid, 'route_id' => $rid,
                'created_at' => now(), 'updated_at' => now(),
            ]);
        }
        return $gid;
    }

    /** Every driver is online + local + fixed and points at the shared Ertiga. */
    private function makeDriver(): User
    {
        $user = User::factory()->create();
        $user->addRole('driver');
        $driver = Driver::query()->create([
            'user_id' => $user->id,
            'city_id' => $this->cityId,
            'vehicle_type_id' => $this->ertigaId,
            'approval_status' => 'approved',
            'service_scope' => 'local',
            'service_mode' => 'fixed',
            'is_online' => true,
            'last_online_at' => now(),
        ]);
        $driver->forceFill(['active_service_mode' => 'fixed', 'active_service_scope' => 'local'])->save();
        return $user;
    }

    private function assign(User $driverUser, int $groupId): void
    {
        DB::table('driver_route_group')->insert([
            'driver_user_id' => $driverUser->id, 'route_group_id' => $groupId,
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function actAsAdmin(): User
    {
        $admin = User::factory()->create(['manager_all_cities' => true]);
        $admin->addRole('admin');
        $roleId = DB::table('manager_roles')->insertGetId([
            'slug' => 'super_admin', 'name' => 'Super Admin', 'is_system' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $admin->forceFill(['manager_role_id' => $roleId])->save();
        Sanctum::actingAs($admin, ['act-as:admin']);
        return $admin;
    }

    private function routeIds($response): array
    {
        return collect($response->json('data'))->pluck('id')->all();
    }

    /**
     * Build the full A/B/C stage: 3 drivers, 6 routes, 3 groups, 3 assignments.
     * Returns everything under human-readable keys so each test can grab what it needs.
     */
    private function abcSetup(): array
    {
        $r = [
            1 => $this->makeRoute('R1'), 2 => $this->makeRoute('R2'),
            3 => $this->makeRoute('R3'), 4 => $this->makeRoute('R4'),
            5 => $this->makeRoute('R5'), 6 => $this->makeRoute('R6'),
        ];
        $g = [
            'airport' => $this->makeGroup('Airport', [$r[1], $r[2]]),
            'north'   => $this->makeGroup('North',   [$r[3], $r[4]]),
            'night'   => $this->makeGroup('Night',   [$r[6]]),
        ];
        $a = $this->makeDriver();
        $b = $this->makeDriver();
        $c = $this->makeDriver();
        $this->assign($a, $g['airport']);
        $this->assign($b, $g['north']);
        $this->assign($c, $g['airport']);
        $this->assign($c, $g['night']);

        return compact('r', 'g', 'a', 'b', 'c');
    }

    public function test_each_driver_sees_exactly_the_union_of_their_groups(): void
    {
        ['r' => $r, 'a' => $a, 'b' => $b, 'c' => $c] = $this->abcSetup();

        Sanctum::actingAs($a, ['act-as:driver']);
        $this->assertEqualsCanonicalizing(
            [$r[1], $r[2]],
            $this->routeIds($this->getJson('/api/fixed/driver/routes')->assertOk()),
            'Driver A (Airport) must see exactly R1, R2',
        );

        Sanctum::actingAs($b, ['act-as:driver']);
        $this->assertEqualsCanonicalizing(
            [$r[3], $r[4]],
            $this->routeIds($this->getJson('/api/fixed/driver/routes')->assertOk()),
            'Driver B (North) must see exactly R3, R4',
        );

        Sanctum::actingAs($c, ['act-as:driver']);
        $this->assertEqualsCanonicalizing(
            [$r[1], $r[2], $r[6]],
            $this->routeIds($this->getJson('/api/fixed/driver/routes')->assertOk()),
            'Driver C (Airport ∪ Night) must see exactly R1, R2, R6',
        );
    }

    public function test_open_is_gated_per_driver_regardless_of_shared_vehicle(): void
    {
        ['r' => $r, 'a' => $a, 'b' => $b, 'c' => $c] = $this->abcSetup();

        // A opens R1 (assigned) → OK. A tries R3 (not assigned) → 403.
        Sanctum::actingAs($a, ['act-as:driver']);
        $this->postJson('/api/fixed/driver/vehicles', ['route_id' => $r[1], 'capacity' => 4])->assertCreated();
        $this->postJson('/api/fixed/driver/vehicles', ['route_id' => $r[3], 'capacity' => 4])->assertStatus(403);

        // B opens R3 → OK. B tries R6 → 403. Same vehicle as A, still gated.
        Sanctum::actingAs($b, ['act-as:driver']);
        $this->postJson('/api/fixed/driver/vehicles', ['route_id' => $r[3], 'capacity' => 4])->assertCreated();
        $this->postJson('/api/fixed/driver/vehicles', ['route_id' => $r[6], 'capacity' => 4])->assertStatus(403);

        // C opens R6 (Night) → OK. C tries R4 (North, not theirs) → 403.
        Sanctum::actingAs($c, ['act-as:driver']);
        $this->postJson('/api/fixed/driver/vehicles', ['route_id' => $r[6], 'capacity' => 4])->assertCreated();
        $this->postJson('/api/fixed/driver/vehicles', ['route_id' => $r[4], 'capacity' => 4])->assertStatus(403);
    }

    public function test_driver_c_completes_r6_and_gets_credited_after_commission(): void
    {
        ['r' => $r, 'c' => $c] = $this->abcSetup();
        $route = Route::findOrFail($r[6]);
        $customer = User::factory()->create();
        $rideTypeId = DB::table('ride_types')->insertGetId(['name' => 'Fixed', 'created_at' => now(), 'updated_at' => now()]);

        $dep = RouteDeparture::create([
            'route_id' => $route->id, 'driver_id' => $c->id, 'city_vehicle_type_id' => null,
            'vehicle_seat_layout_id' => $this->layoutId,
            'service_date' => now()->toDateString(), 'departure_kind' => 'driver_opened',
            'capacity' => 6, 'seats_taken' => 1, 'status' => 'DEPARTED', 'visible_to_customers' => true,
        ]);
        $trip = Trip::create([
            'customer_id' => null, 'driver_id' => $c->id, 'city_id' => $this->cityId, 'scope' => 'local',
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

        // ₹100 fare − 10% commission (from the route's fare_config, vehicle never consulted) = ₹90 to driver C.
        $this->assertEqualsWithDelta(90.0, app(WalletService::class)->balance($c->fresh()), 0.001);
    }

    public function test_adding_r7_to_airport_ripples_to_a_and_c_but_not_b(): void
    {
        ['r' => $r, 'g' => $g, 'a' => $a, 'b' => $b, 'c' => $c] = $this->abcSetup();
        $r7 = $this->makeRoute('R7');

        // Admin adds R7 to Airport via the real PATCH endpoint (proves the graph updates).
        $this->actAsAdmin();
        $this->patchJson("/api/admin/cities/{$this->cityId}/route-groups/{$g['airport']}", [
            'name' => 'Airport',
            'route_ids' => [$r[1], $r[2], $r7],
        ])->assertOk();

        // A (Airport) + C (Airport ∪ Night) now include R7; B (North) does not.
        Sanctum::actingAs($a, ['act-as:driver']);
        $this->assertContains($r7, $this->routeIds($this->getJson('/api/fixed/driver/routes')));

        Sanctum::actingAs($c, ['act-as:driver']);
        $this->assertContains($r7, $this->routeIds($this->getJson('/api/fixed/driver/routes')));

        Sanctum::actingAs($b, ['act-as:driver']);
        $this->assertNotContains($r7, $this->routeIds($this->getJson('/api/fixed/driver/routes')));
    }
}
