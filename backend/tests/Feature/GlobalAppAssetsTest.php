<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\CityVehicleFamilyImage;
use App\Models\CityVehicleType;
use App\Models\ManagerRole;
use App\Models\RideType;
use App\Models\User;
use App\Models\VehicleFamilyImage;
use App\Models\VehicleType;
use App\Services\VehicleFamilyImageService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class GlobalAppAssetsTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        $role = ManagerRole::create(['slug' => 'super_admin', 'name' => 'Super Admin', 'is_system' => true]);
        $admin = User::factory()->create(['manager_role_id' => $role->id, 'manager_all_cities' => true]);
        $admin->addRole('admin');
        return $admin;
    }

    public function test_one_upload_resolves_identically_for_all_cities_and_platforms(): void
    {
        Storage::fake('public');
        $this->actingAs($this->admin())->postJson('/api/admin/app-assets', [
            'display_name' => ' SUMO ', 'key' => 'map_marker',
            'image' => UploadedFile::fake()->image('sumo.png'),
        ])->assertCreated();
        $this->assertSame(1, VehicleFamilyImage::count());
        $service = app(VehicleFamilyImageService::class);
        $url = VehicleFamilyImage::first()->image_url;
        foreach ([null, 1, 3, 999] as $city) {
            foreach (['android', 'ios', 'web'] as $platform) {
                $result = $service->resolveForVehicle($city, 'Sumo', $platform);
                $this->assertSame($url, $result['map_marker_url']);
                $this->assertSame($url, $result['images']['android']['map_marker']);
                $this->assertSame($url, $result['images']['ios']['map_marker']);
            }
        }
        $asset = VehicleFamilyImage::first();
        $this->deleteJson('/api/admin/app-assets/'.$asset->id)->assertOk();
        Storage::disk('public')->assertMissing($asset->image_path);
        $this->assertNull($service->resolveForVehicle(3, 'SUMO', 'ios')['map_marker_url']);
    }

    public function test_catalogue_lists_families_from_all_cities_once_without_city_selection(): void
    {
        $vehicle = VehicleType::create(['name' => 'SUMO', 'is_active' => true]);
        $ride = RideType::create(['name' => 'Private', 'mode' => 'private', 'is_active' => true]);
        foreach (['Srinagar', 'Mumbai'] as $name) {
            $city = City::create(['name' => $name, 'country_code' => 'IN']);
            $cityVehicle = CityVehicleType::create(['city_id' => $city->id, 'vehicle_type_id' => $vehicle->id,
                'ride_type_id' => $ride->id, 'display_name' => 'SUMO', 'is_active' => true]);
        }
        $this->actingAs($this->admin())->getJson('/api/admin/app-assets')
            ->assertOk()->assertJsonCount(1, 'families')->assertJsonPath('families.0.key', 'sumo');
        $photo = VehicleFamilyImage::create(['display_name' => 'SUMO', 'key' => 'booking_card', 'image_path' => 'sumo-photo.png']);
        $marker = VehicleFamilyImage::create(['display_name' => 'SUMO', 'key' => 'map_marker', 'image_path' => 'sumo-marker.png']);
        foreach (City::all() as $assetCity) {
            $this->getJson("/api/admin/cities/{$assetCity->id}/vehicle-types")
                ->assertOk()->assertJsonPath('data.0.image_url', $photo->image_url)
                ->assertJsonPath('data.0.map_marker_url', $marker->image_url);
        }
        $this->getJson("/api/admin/cities/{$city->id}/vehicle-types/{$cityVehicle->id}")
            ->assertOk()->assertJsonPath('vehicle_type.image_url', $photo->image_url);
        $this->postJson("/api/admin/cities/{$city->id}/vehicle-types/{$cityVehicle->id}/images", [])
            ->assertStatus(410);
    }

    public function test_delete_does_not_restore_archived_city_or_platform_images(): void
    {
        Storage::fake('public');
        $city = City::create(['name' => 'Srinagar', 'country_code' => 'IN']);
        Storage::disk('public')->put('legacy.png', 'legacy');
        CityVehicleFamilyImage::create(['city_id' => $city->id, 'display_name' => 'SUMO',
            'platform' => 'android', 'key' => 'booking_card', 'image_path' => 'legacy.png']);
        $asset = VehicleFamilyImage::create(['display_name' => 'SUMO', 'key' => 'booking_card', 'image_path' => 'legacy.png']);
        $this->actingAs($this->admin())->deleteJson('/api/admin/app-assets/'.$asset->id)->assertOk();
        $this->assertNull(app(VehicleFamilyImageService::class)->resolveForVehicle($city->id, 'SUMO')['image_url']);
        Storage::disk('public')->assertExists('legacy.png');
    }

    public function test_upload_requires_app_assets_permission(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $user->addRole('admin');
        $this->actingAs($user)->postJson('/api/admin/app-assets', [
            'display_name' => 'SUMO', 'key' => 'map_marker', 'image' => UploadedFile::fake()->image('sumo.png'),
        ])->assertForbidden();
        $this->assertSame(0, VehicleFamilyImage::count());
    }

    public function test_upload_requires_supported_slot(): void
    {
        Storage::fake('public');
        $this->actingAs($this->admin())->postJson('/api/admin/app-assets', [
            'display_name' => 'SUMO', 'key' => 'invoice_icon', 'image' => UploadedFile::fake()->image('sumo.png'),
        ])->assertUnprocessable();
        $this->assertSame(0, VehicleFamilyImage::count());
    }
}
