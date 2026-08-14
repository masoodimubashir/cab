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
 * Import of Google My Maps exports (KML) into draft fixed routes. The endpoint
 * only parses — it never saves — so these assert the extracted geometry/names.
 */
class AdminFixedRouteKmlImportTest extends TestCase
{
    use RefreshDatabase;

    private int $cityId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->cityId = DB::table('cities')->insertGetId([
            'name' => 'KML City', 'country_code' => 'IN',
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

    private function upload(string $contents, string $name = 'map.kml'): \Illuminate\Testing\TestResponse
    {
        $file = UploadedFile::fake()->createWithContent($name, $contents);

        return $this->post(
            "/api/admin/cities/{$this->cityId}/fixed-routes/import-kml",
            ['file' => $file],
            ['Accept' => 'application/json'],
        );
    }

    public function test_it_parses_a_my_maps_route_into_a_draft(): void
    {
        $kml = <<<'KML'
<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Model Town To General Bus Stand Sopore</name>
    <Placemark>
      <name>Directions from A to B</name>
      <LineString>
        <coordinates>
          74.44444,34.30355,0
          74.44803,34.30031,0
          74.46110,34.28848,0
        </coordinates>
      </LineString>
    </Placemark>
    <Placemark>
      <name>Model Town, Sopore</name>
      <Point><coordinates>74.4444411,34.3035528,0</coordinates></Point>
    </Placemark>
    <Placemark>
      <name>General Bus Stand, Sopore</name>
      <Point><coordinates>74.461102,34.2884755,0</coordinates></Point>
    </Placemark>
  </Document>
</kml>
KML;

        $res = $this->upload($kml)->assertOk();

        $res->assertJsonPath('count', 1);
        $res->assertJsonPath('routes.0.name', 'Model Town To General Bus Stand Sopore');
        $res->assertJsonPath('routes.0.origin_name', 'Model Town, Sopore');
        $res->assertJsonPath('routes.0.dest_name', 'General Bus Stand, Sopore');
        // Coordinates are flipped from KML lng,lat to the app's lat,lng.
        $this->assertEqualsWithDelta(34.30355, $res->json('routes.0.origin_lat'), 0.0001);
        $this->assertEqualsWithDelta(74.44444, $res->json('routes.0.origin_lng'), 0.0001);
        $this->assertEqualsWithDelta(34.28848, $res->json('routes.0.dest_lat'), 0.0001);
        $this->assertCount(3, $res->json('routes.0.path'));
    }

    public function test_network_link_export_is_rejected_with_a_helpful_message(): void
    {
        $kml = <<<'KML'
<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>My Map</name>
    <NetworkLink>
      <Link><href>https://www.google.com/maps/d/kml?mid=abc</href></Link>
    </NetworkLink>
  </Document>
</kml>
KML;

        $this->upload($kml)
            ->assertStatus(422)
            ->assertJsonPath('message', fn ($m) => str_contains((string) $m, 'network link'));
    }

    public function test_non_kml_file_is_rejected(): void
    {
        $this->upload('hello world', 'notes.txt')->assertStatus(422);
    }

    private const SAMPLE_KML = <<<'KML'
<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Model Town To General Bus Stand Sopore</name>
    <Placemark>
      <name>Directions from A to B</name>
      <LineString><coordinates>74.44444,34.30355,0 74.46110,34.28848,0</coordinates></LineString>
    </Placemark>
    <Placemark><name>Model Town, Sopore</name><Point><coordinates>74.4444411,34.3035528,0</coordinates></Point></Placemark>
    <Placemark><name>General Bus Stand, Sopore</name><Point><coordinates>74.461102,34.2884755,0</coordinates></Point></Placemark>
  </Document>
</kml>
KML;

    private function makeFixedRoute(string $name, float $seatFare): Route
    {
        return Route::query()->create([
            'city_id' => $this->cityId,
            'scope' => 'local',
            'mode' => 'fixed',
            'name' => $name,
            'origin_name' => 'Model Town',
            'dest_name' => 'General Bus Stand',
            'origin_lat' => 34.3035528,
            'origin_lng' => 74.4444411,
            'dest_lat' => 34.2884755,
            'dest_lng' => 74.4611020,
            'fare_config' => ['seat_fare' => $seatFare, 'commission_type' => 'percent'],
            'luggage_surcharge_amount' => 42,
            'is_active' => true,
        ]);
    }

    public function test_import_tags_a_same_name_existing_route_with_its_config(): void
    {
        // A route with the same name (case/space-insensitive) already exists.
        $route = $this->makeFixedRoute('Model Town To General Bus Stand Sopore', 199);

        $res = $this->upload(self::SAMPLE_KML)->assertOk();

        // The draft points at the existing route and carries its config to preserve.
        $res->assertJsonPath('routes.0.existing_route_id', $route->id);
        $res->assertJsonPath('routes.0.existing.fare_config.seat_fare', 199);
        $res->assertJsonPath('routes.0.existing.luggage_surcharge_amount', 42);
    }

    public function test_import_without_a_matching_route_has_null_existing(): void
    {
        $this->makeFixedRoute('A Completely Different Route', 150);

        $res = $this->upload(self::SAMPLE_KML)->assertOk();

        $this->assertNull($res->json('routes.0.existing_route_id'));
        $this->assertNull($res->json('routes.0.existing'));
    }
}
