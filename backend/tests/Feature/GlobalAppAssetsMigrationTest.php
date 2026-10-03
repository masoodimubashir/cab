<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\CityVehicleFamilyImage;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class GlobalAppAssetsMigrationTest extends TestCase
{
    use RefreshDatabase;

    public function test_migration_preserves_uploads_and_chooses_latest_family_slot_across_cities(): void
    {
        $first = City::create(['name' => 'Srinagar', 'country_code' => 'IN']);
        $second = City::create(['name' => 'Mumbai', 'country_code' => 'IN']);
        foreach ([[$first, 'android', 'old.png', '2026-09-29 10:00:00'],
            [$second, 'ios', 'new.png', '2026-09-30 10:00:00']] as [$city, $platform, $path, $updated]) {
            CityVehicleFamilyImage::create(['city_id' => $city->id, 'display_name' => ' SUMO ',
                'platform' => $platform, 'key' => 'map_marker', 'image_path' => $path, 'updated_at' => $updated]);
            // updated_at is not mass assignable on the legacy model.
            DB::table('city_vehicle_family_images')->where('image_path', $path)->update(['updated_at' => $updated]);
        }
        $migration = require database_path('migrations/2026_10_01_120000_create_vehicle_family_images_table.php');
        $migration->importExistingImages();
        $this->assertDatabaseCount('vehicle_family_images', 1);
        $this->assertDatabaseHas('vehicle_family_images', ['display_name' => 'sumo', 'key' => 'map_marker', 'image_path' => 'new.png']);
        $this->assertDatabaseCount('city_vehicle_family_images', 2);
    }
}
