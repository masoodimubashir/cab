<?php

namespace Tests\Feature;

use App\Models\Driver;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class DriverLockedServiceRegistrationTest extends TestCase
{
    use RefreshDatabase;

    public function test_driver_registration_requires_and_locks_service_choice(): void
    {
        $cityId = DB::table('cities')->insertGetId([
            'name' => 'Locked Service City',
            'country_code' => 'IN',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Sedan Locked Service',
            'sort_order' => 1,
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $user = User::factory()->create();
        Sanctum::actingAs($user, ['act-as:driver']);

        $this->postJson('/api/drivers/register', [
            'city_id' => $cityId,
            'vehicle_type_id' => $vehicleTypeId,
        ])->assertStatus(422)
            ->assertJsonPath('message', 'Choose the service you will provide before continuing.');

        $this->postJson('/api/drivers/register', [
            'city_id' => $cityId,
            'vehicle_type_id' => $vehicleTypeId,
            'service_scope' => 'outstation',
            'service_mode' => 'shuttle',
        ])->assertOk()
            ->assertJsonPath('driver.service_scope', 'outstation')
            ->assertJsonPath('driver.service_mode', 'shuttle');

        $driver = Driver::query()->where('user_id', $user->id)->firstOrFail();
        $driver->forceFill(['approval_status' => 'approved'])->save();

        $this->postJson('/api/drivers/register', [
            'city_id' => $cityId,
            'vehicle_type_id' => $vehicleTypeId,
            'service_scope' => 'local',
            'service_mode' => 'private',
        ])->assertStatus(422)
            ->assertJsonPath('message', 'Ride type, vehicle type, and driver service are locked after approval. Contact the operator.');
    }
}
