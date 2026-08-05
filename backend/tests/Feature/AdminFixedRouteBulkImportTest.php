<?php

namespace Tests\Feature;

use App\Models\Route;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Bulk "Import from My Maps": every new route in the file is attached to the
 * chosen vehicle with name + line only (no stops/price, inactive) — a "Needs
 * pricing" route. Same-name routes are skipped, and a Needs-pricing route may
 * not be added to a group until it has a fare.
 */
class AdminFixedRouteBulkImportTest extends TestCase
{
    use RefreshDatabase;

    private int $cityId;
    private int $vehicleTypeId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->cityId = DB::table('cities')->insertGetId([
            'name' => 'Bulk City', 'country_code' => 'IN',
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $rideTypeId = DB::table('ride_types')->insertGetId([
            'name' => 'RT ' . uniqid(), 'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->vehicleTypeId = DB::table('city_vehicle_types')->insertGetId([
            'city_id' => $this->cityId, 'ride_type_id' => $rideTypeId,
            'display_name' => 'Sumo',
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

    private const TWO_ROUTE_KML = <<<'KML'
<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Bulk Map</name>
    <Placemark><name>Route Alpha</name><LineString><coordinates>74.44,34.30,0 74.46,34.28,0</coordinates></LineString></Placemark>
    <Placemark><name>Route Beta</name><LineString><coordinates>74.50,34.20,0 74.52,34.18,0</coordinates></LineString></Placemark>
  </Document>
</kml>
KML;

    private function bulkUpload(string $contents): \Illuminate\Testing\TestResponse
    {
        $file = UploadedFile::fake()->createWithContent('bulk.kml', $contents);

        return $this->post(
            "/api/admin/cities/{$this->cityId}/fixed-routes/import-kml-bulk",
            ['file' => $file, 'city_vehicle_type_id' => $this->vehicleTypeId],
            ['Accept' => 'application/json'],
        );
    }

    public function test_bulk_import_attaches_needs_pricing_routes_to_the_vehicle_and_skips_existing(): void
    {
        Route::query()->create([
            'city_id' => $this->cityId, 'scope' => 'local', 'mode' => 'fixed',
            'name' => 'Route Alpha', 'origin_name' => 'A', 'dest_name' => 'B',
            'origin_lat' => 34.3, 'origin_lng' => 74.44, 'dest_lat' => 34.28, 'dest_lng' => 74.46,
            'fare_config' => ['seat_fare' => 100], 'is_active' => true,
        ]);

        $res = $this->bulkUpload(self::TWO_ROUTE_KML)->assertOk();
        $res->assertJsonPath('created_count', 1);
        $res->assertJsonPath('skipped_count', 1);
        $res->assertJsonPath('skipped_names.0', 'Route Alpha');

        $route = Route::query()->where('name', 'Route Beta')->firstOrFail();
        $this->assertSame($this->vehicleTypeId, (int) $route->city_vehicle_type_id);
        $this->assertFalse((bool) $route->is_active);
        $this->assertNull($route->fare_config['seat_fare'] ?? null);
        $this->assertSame(0, DB::table('route_stops')->where('route_id', $route->id)->count());
    }

    public function test_needs_pricing_route_cannot_be_added_to_a_group(): void
    {
        $this->bulkUpload(self::TWO_ROUTE_KML)->assertOk();
        $route = Route::query()->where('name', 'Route Beta')->firstOrFail();

        $group = $this->postJson("/api/admin/cities/{$this->cityId}/route-groups", [
            'name' => 'Line A', 'city_vehicle_type_id' => $this->vehicleTypeId,
        ])->assertCreated();
        $groupId = $group->json('route_group.id');

        // Grouping a price-less route is rejected.
        $this->patchJson("/api/admin/cities/{$this->cityId}/route-groups/{$groupId}", [
            'route_ids' => [$route->id],
        ])->assertStatus(422);
    }
}
