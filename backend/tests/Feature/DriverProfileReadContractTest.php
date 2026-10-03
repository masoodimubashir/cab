<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\CityVehicleType;
use App\Models\Driver;
use App\Models\RideType;
use App\Models\User;
use App\Models\VehicleType;
use App\Models\VehicleFamilyImage;
use App\Models\Trip;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DriverProfileReadContractTest extends TestCase
{
    use RefreshDatabase;

    public function test_approved_driver_profile_preserves_vehicle_text_city_and_service(): void
    {
        $city = City::create(['name' => 'Audit City', 'country_code' => 'IN']);
        $user = User::factory()->create();
        $user->addRole('driver');
        $type = VehicleType::create(['name' => 'SUMO', 'is_active' => true]);
        $ride = RideType::create(['name' => 'Private', 'mode' => 'private', 'is_active' => true]);
        $family = CityVehicleType::create([
            'city_id' => $city->id, 'vehicle_type_id' => $type->id,
            'ride_type_id' => $ride->id, 'display_name' => 'SUMO', 'is_active' => true,
        ]);
        Driver::create([
            'user_id' => $user->id, 'city_id' => $city->id,
            'vehicle_type_id' => $type->id, 'city_vehicle_type_id' => $family->id,
            'vehicle_type' => 'SUMO', 'vehicle_model' => '2024',
            'approval_status' => 'approved', 'service_scope' => 'local', 'service_mode' => 'private',
        ]);
        $photo = VehicleFamilyImage::create(['display_name' => 'SUMO', 'key' => 'booking_card', 'image_path' => 'sumo-photo.png']);

        $response = $this->actingAs($user)->getJson('/api/drivers/me');
        $response->assertOk()
            ->assertJsonPath('driver.approval_status', 'approved')
            ->assertJsonPath('driver.city_id', $city->id)
            ->assertJsonPath('driver.service_scope', 'local')
            ->assertJsonPath('driver.service_mode', 'private')
            ->assertJsonPath('driver.vehicle_type', 'SUMO')
            ->assertJsonPath('driver.image_url', $photo->image_url)
            ->assertJsonPath('driver.vehicle.image_url', $photo->image_url);
        $this->getJson('/api/catalog/vehicle-types')->assertOk()->assertJsonPath('data.0.image_url', $photo->image_url);
        $this->getJson("/api/catalog/cities/{$city->id}/vehicles?vehicle_type_id={$type->id}")
            ->assertOk()->assertJsonPath('data.0.image_url', $photo->image_url);
        Trip::create(['customer_id' => User::factory()->create()->id, 'driver_id' => $user->id,
            'city_id' => $city->id, 'city_vehicle_type_id' => $family->id, 'ride_type_id' => $ride->id,
            'status' => 'COMPLETED', 'scope' => 'local', 'pickup_address' => 'Sopore', 'drop_address' => 'Srinagar',
            'pickup_lat' => 34.3, 'pickup_lng' => 74.4, 'drop_lat' => 34.1, 'drop_lng' => 74.8,
            'estimated_fare' => 100, 'final_fare' => 100, 'currency' => 'INR']);
        $this->getJson('/api/driver/trips/history')->assertOk()->assertJsonPath('data.data.0.image_url', $photo->image_url);
    }
}
