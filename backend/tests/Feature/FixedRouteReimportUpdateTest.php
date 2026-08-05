<?php

namespace Tests\Feature;

use App\Models\Route;
use App\Models\RouteStop;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Option 2 re-import: updating an existing fixed route (matched by name) must
 * REPLACE its line + stops while PRESERVING its fare and settings, and must
 * RETIRE the old stops (keep the rows) rather than delete them — so past
 * bookings that reference those stops are never orphaned.
 */
class FixedRouteReimportUpdateTest extends TestCase
{
    use RefreshDatabase;

    private int $cityId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->cityId = DB::table('cities')->insertGetId([
            'name' => 'Reimport City', 'country_code' => 'IN',
            'created_at' => now(), 'updated_at' => now(),
        ]);

        $admin = User::factory()->create(['manager_all_cities' => true]);
        $admin->addRole('admin');
        $roleId = DB::table('manager_roles')->insertGetId([
            'slug' => 'super_admin', 'name' => 'Super Admin', 'is_system' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $admin->forceFill(['manager_role_id' => $roleId])->save();
        Sanctum::actingAs($admin, ['act-as:admin']);
    }

    public function test_reimport_replaces_line_and_stops_but_keeps_fare_and_retires_old_stops(): void
    {
        $route = Route::query()->create([
            'city_id' => $this->cityId,
            'scope' => 'local',
            'mode' => 'fixed',
            'name' => 'Sopore Express',
            'origin_name' => 'Old Origin',
            'dest_name' => 'Old Dest',
            'origin_lat' => 34.1000000, 'origin_lng' => 74.1000000,
            'dest_lat' => 34.2000000, 'dest_lng' => 74.2000000,
            'path_polyline' => [[34.10, 74.10], [34.20, 74.20]],
            'fare_config' => ['seat_fare' => 199, 'commission_type' => 'percent', 'commission_percent' => 10],
            'luggage_surcharge_amount' => 42,
            'is_active' => true,
        ]);
        foreach (['Old Origin', 'Old Middle', 'Old Dest'] as $i => $name) {
            RouteStop::query()->create([
                'route_id' => $route->id, 'seq' => $i + 1, 'name' => $name,
                'lat' => 34.1 + $i * 0.05, 'lng' => 74.1 + $i * 0.05,
                'is_pickup' => true, 'is_drop' => true, 'is_active' => true,
            ]);
        }

        // Simulate what the client sends on a My Maps re-import: NEW geometry and
        // NEW stops (no ids), with the EXISTING fare/settings re-sent unchanged.
        $payload = [
            'scope' => 'local',
            'name' => 'Sopore Express',
            'origin_name' => 'New Origin',
            'dest_name' => 'New Dest',
            'origin_lat' => 34.3000000, 'origin_lng' => 74.3000000,
            'dest_lat' => 34.4000000, 'dest_lng' => 74.4000000,
            'path_polyline' => [[34.30, 74.30], [34.35, 74.35], [34.40, 74.40]],
            'fare_config' => ['seat_fare' => 199, 'commission_type' => 'percent', 'commission_percent' => 10],
            'luggage_surcharge_amount' => 42,
            'requires_prepaid' => true,
            'stops' => [
                ['name' => 'New Origin', 'lat' => 34.30, 'lng' => 74.30, 'is_pickup' => true, 'is_drop' => false],
                ['name' => 'New Middle', 'lat' => 34.35, 'lng' => 74.35, 'is_pickup' => true, 'is_drop' => true],
                ['name' => 'New Dest', 'lat' => 34.40, 'lng' => 74.40, 'is_pickup' => false, 'is_drop' => true],
            ],
        ];

        $this->patchJson(
            "/api/admin/cities/{$this->cityId}/fixed-routes/{$route->id}",
            $payload,
        )->assertOk();

        $route->refresh();

        // Geometry replaced.
        $this->assertSame('New Origin', $route->origin_name);
        $this->assertSame('New Dest', $route->dest_name);
        $this->assertEqualsWithDelta(34.30, (float) $route->origin_lat, 0.0001);
        $this->assertCount(3, $route->path_polyline);

        // Fare + surcharge preserved (re-sent by the client).
        $this->assertSame(199.0, (float) $route->fare_config['seat_fare']);
        $this->assertSame(42.0, (float) $route->luggage_surcharge_amount);

        // New stops are active; old ones are RETIRED (kept, not deleted).
        $active = RouteStop::query()->where('route_id', $route->id)->where('is_active', true)->pluck('name')->all();
        sort($active);
        $this->assertSame(['New Dest', 'New Middle', 'New Origin'], $active);

        $retired = RouteStop::query()->where('route_id', $route->id)->where('is_active', false)->pluck('name')->all();
        sort($retired);
        $this->assertSame(['Old Dest', 'Old Middle', 'Old Origin'], $retired);

        // Nothing was hard-deleted — every original stop row still exists.
        $this->assertSame(6, RouteStop::query()->where('route_id', $route->id)->count());
    }
}
