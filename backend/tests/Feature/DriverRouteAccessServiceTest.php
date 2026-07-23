<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\DriverRouteAccessService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * M1 — the route-group allocation resolver. Proves a driver's effective fixed
 * routes are the DISTINCT union of the routes in the groups assigned to them,
 * with no reference to any vehicle.
 */
class DriverRouteAccessServiceTest extends TestCase
{
    use RefreshDatabase;

    private DriverRouteAccessService $service;
    private int $cityId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = app(DriverRouteAccessService::class);
        $this->cityId = DB::table('cities')->insertGetId([
            'name' => 'Alloc City',
            'country_code' => 'IN',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function makeRoute(string $name): int
    {
        return DB::table('routes')->insertGetId([
            'city_id' => $this->cityId,
            'scope' => 'local',
            'mode' => 'fixed',
            'name' => $name,
            'origin_name' => "$name Origin",
            'dest_name' => "$name Dest",
            'origin_lat' => 34.0, 'origin_lng' => 74.0,
            'dest_lat' => 34.1, 'dest_lng' => 74.1,
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function makeGroup(string $name): int
    {
        return DB::table('route_groups')->insertGetId([
            'city_id' => $this->cityId,
            'name' => $name,
            'is_active' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function addRoutesToGroup(int $groupId, array $routeIds): void
    {
        foreach ($routeIds as $rid) {
            DB::table('route_group_route')->insert([
                'route_group_id' => $groupId,
                'route_id' => $rid,
                'created_at' => now(), 'updated_at' => now(),
            ]);
        }
    }

    private function assignGroup(int $driverUserId, int $groupId): void
    {
        DB::table('driver_route_group')->insert([
            'driver_user_id' => $driverUserId,
            'route_group_id' => $groupId,
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    public function test_single_group_returns_its_routes(): void
    {
        $driver = User::factory()->create();
        [$r1, $r2] = [$this->makeRoute('R1'), $this->makeRoute('R2')];
        $g = $this->makeGroup('Airport');
        $this->addRoutesToGroup($g, [$r1, $r2]);
        $this->assignGroup($driver->id, $g);

        $this->assertEqualsCanonicalizing([$r1, $r2], $this->service->effectiveRouteIds($driver->id));
    }

    public function test_two_groups_return_the_union(): void
    {
        $driver = User::factory()->create();
        [$r1, $r2, $r3] = [$this->makeRoute('R1'), $this->makeRoute('R2'), $this->makeRoute('R3')];
        $airport = $this->makeGroup('Airport');
        $night = $this->makeGroup('Night');
        $this->addRoutesToGroup($airport, [$r1, $r2]);
        $this->addRoutesToGroup($night, [$r3]);
        $this->assignGroup($driver->id, $airport);
        $this->assignGroup($driver->id, $night);

        $this->assertEqualsCanonicalizing([$r1, $r2, $r3], $this->service->effectiveRouteIds($driver->id));
    }

    public function test_route_in_two_of_the_drivers_groups_appears_once(): void
    {
        $driver = User::factory()->create();
        $shared = $this->makeRoute('Shared');
        $g1 = $this->makeGroup('G1');
        $g2 = $this->makeGroup('G2');
        $this->addRoutesToGroup($g1, [$shared]);
        $this->addRoutesToGroup($g2, [$shared]);
        $this->assignGroup($driver->id, $g1);
        $this->assignGroup($driver->id, $g2);

        $this->assertSame([$shared], $this->service->effectiveRouteIds($driver->id));
    }

    public function test_empty_group_yields_no_routes(): void
    {
        $driver = User::factory()->create();
        $this->assignGroup($driver->id, $this->makeGroup('Empty'));

        $this->assertSame([], $this->service->effectiveRouteIds($driver->id));
    }

    public function test_driver_with_no_groups_yields_no_routes(): void
    {
        $driver = User::factory()->create();
        $this->makeRoute('Unassigned'); // route exists but in no group of this driver

        $this->assertSame([], $this->service->effectiveRouteIds($driver->id));
    }

    public function test_removing_a_route_from_one_group_keeps_it_via_another(): void
    {
        $driver = User::factory()->create();
        $shared = $this->makeRoute('Shared');
        $g1 = $this->makeGroup('G1');
        $g2 = $this->makeGroup('G2');
        $this->addRoutesToGroup($g1, [$shared]);
        $this->addRoutesToGroup($g2, [$shared]);
        $this->assignGroup($driver->id, $g1);
        $this->assignGroup($driver->id, $g2);

        // Remove from G1 only — still granted via G2 (the overlap-revocation rule).
        DB::table('route_group_route')->where('route_group_id', $g1)->where('route_id', $shared)->delete();

        $this->assertSame([$shared], $this->service->effectiveRouteIds($driver->id));
    }

    public function test_can_access_route_reflects_entitlement(): void
    {
        $driver = User::factory()->create();
        $assigned = $this->makeRoute('Assigned');
        $unassigned = $this->makeRoute('Unassigned');
        $g = $this->makeGroup('G');
        $this->addRoutesToGroup($g, [$assigned]);
        $this->assignGroup($driver->id, $g);

        $this->assertTrue($this->service->canAccessRoute($driver->id, $assigned));
        $this->assertFalse($this->service->canAccessRoute($driver->id, $unassigned));
    }

    public function test_two_drivers_same_setup_are_independent(): void
    {
        $a = User::factory()->create();
        $b = User::factory()->create();
        [$r1, $r2, $r5] = [$this->makeRoute('R1'), $this->makeRoute('R2'), $this->makeRoute('R5')];
        $airport = $this->makeGroup('Airport');
        $north = $this->makeGroup('North');
        $this->addRoutesToGroup($airport, [$r1, $r2]);
        $this->addRoutesToGroup($north, [$r5]);
        $this->assignGroup($a->id, $airport);
        $this->assignGroup($b->id, $north);

        $this->assertEqualsCanonicalizing([$r1, $r2], $this->service->effectiveRouteIds($a->id));
        $this->assertSame([$r5], $this->service->effectiveRouteIds($b->id));
    }
}
