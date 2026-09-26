<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Driver;
use App\Models\ManagerRole;
use App\Models\PhoneOtp;
use App\Models\User;
use App\Models\VehicleType;
use App\Services\Msg91Service;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\TestCase;

class DriverProfileVehicleManagementTest extends TestCase
{
    use RefreshDatabase;

    private function createAdmin(): User
    {
        $role = ManagerRole::query()->create([
            'slug' => 'super_admin',
            'name' => 'Super Admin',
            'is_system' => true,
        ]);
        $admin = User::factory()->create([
            'manager_role_id' => $role->id,
            'manager_all_cities' => true,
        ]);
        $admin->addRole('admin');

        return $admin;
    }

    private function createDriver(array $userAttributes = [], array $driverAttributes = []): array
    {
        $user = User::factory()->create(array_merge([
            'name' => 'Kashmir Driver',
            'phone' => '+919419000001',
            'email' => 'driver@dreamcabs.in',
        ], $userAttributes));
        $user->addRole('driver');

        $driver = Driver::query()->create(array_merge([
            'user_id' => $user->id,
            'approval_status' => 'approved',
            'vehicle_reg_no' => 'JK01AB1234',
            'vehicle_model' => '2022',
            'vehicle_color' => 'White',
            'service_scope' => 'local',
            'service_mode' => 'private',
        ], $driverAttributes));

        return [$user, $driver];
    }

    public function test_driver_can_update_personal_profile_details(): void
    {
        Storage::fake('public');
        [$user, $driver] = $this->createDriver();
        Sanctum::actingAs($user, ['act-as:driver']);

        $photo = UploadedFile::fake()->image('driver_avatar.jpg', 300, 300);

        $response = $this->postJson('/api/me/profile', [
            'name' => 'Updated Driver Name',
            'email' => 'updated.driver@dreamcabs.in',
            'photo' => $photo,
        ]);

        $response->assertOk()
            ->assertJsonPath('user.name', 'Updated Driver Name')
            ->assertJsonPath('user.email', 'updated.driver@dreamcabs.in');

        $this->assertSame('Updated Driver Name', $user->fresh()->name);
        $this->assertSame('updated.driver@dreamcabs.in', $user->fresh()->email);
        $this->assertNotNull($user->fresh()->avatar_path);
        Storage::disk('public')->assertExists($user->fresh()->avatar_path);
    }

    public function test_driver_cannot_update_email_to_already_registered_address(): void
    {
        User::factory()->create(['email' => 'taken@dreamcabs.in']);
        [$user, $driver] = $this->createDriver(['email' => 'my.driver@dreamcabs.in']);
        Sanctum::actingAs($user, ['act-as:driver']);

        $response = $this->postJson('/api/me/profile', [
            'name' => 'My Driver',
            'email' => 'taken@dreamcabs.in',
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['email']);
    }

    public function test_driver_can_initiate_phone_change_with_sms_otp(): void
    {
        $msg91Mock = Mockery::mock(Msg91Service::class);
        $msg91Mock->shouldReceive('isLive')->andReturn(false);
        $msg91Mock->shouldReceive('sendOtp')->once()->andReturn(true);
        $this->app->instance(Msg91Service::class, $msg91Mock);

        [$user, $driver] = $this->createDriver(['phone' => '+919419000001']);
        Sanctum::actingAs($user, ['act-as:driver']);

        $response = $this->postJson('/api/me/phone/change/start', [
            'phone' => '+919419999888',
        ]);

        $response->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('phone', '+919419999888');

        $this->assertDatabaseHas('phone_otps', [
            'phone' => '+919419999888',
            'change_user_id' => $user->id,
        ]);
    }

    public function test_driver_cannot_start_phone_change_with_duplicate_phone(): void
    {
        User::factory()->create(['phone' => '+919999999999']);
        [$user, $driver] = $this->createDriver(['phone' => '+919419000001']);
        Sanctum::actingAs($user, ['act-as:driver']);

        $response = $this->postJson('/api/me/phone/change/start', [
            'phone' => '+919999999999',
        ]);

        $response->assertStatus(422)
            ->assertJson(['message' => 'This phone number is already registered to another account.']);
    }

    public function test_driver_can_verify_phone_change_with_valid_otp(): void
    {
        [$user, $driver] = $this->createDriver(['phone' => '+919419000001']);
        Sanctum::actingAs($user, ['act-as:driver']);

        PhoneOtp::create([
            'change_user_id' => $user->id,
            'phone' => '+919419999888',
            'code_hash' => Hash::make('654321'),
            'attempts' => 0,
            'expires_at' => now()->addMinutes(5),
            'last_sent_at' => now(),
        ]);

        $response = $this->postJson('/api/me/phone/change/verify', [
            'phone' => '+919419999888',
            'code' => '654321',
        ]);

        $response->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('message', 'Phone number updated successfully.')
            ->assertJsonPath('user.phone', '+919419999888');

        $this->assertSame('+919419999888', $user->fresh()->phone);
        $this->assertDatabaseMissing('phone_otps', [
            'phone' => '+919419999888',
        ]);
    }

    public function test_approved_driver_cannot_modify_locked_vehicle_type_or_service(): void
    {
        $cityId = DB::table('cities')->insertGetId([
            'name' => 'Srinagar Test',
            'country_code' => 'IN',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $sedanId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Sedan Test',
            'sort_order' => 1,
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $suvId = DB::table('vehicle_types')->insertGetId([
            'name' => 'SUV Test',
            'sort_order' => 2,
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        [$user, $driver] = $this->createDriver([], [
            'city_id' => $cityId,
            'vehicle_type_id' => $sedanId,
            'approval_status' => 'approved',
            'service_scope' => 'local',
            'service_mode' => 'private',
        ]);
        Sanctum::actingAs($user, ['act-as:driver']);

        $response = $this->postJson('/api/drivers/register', [
            'city_id' => $cityId,
            'vehicle_type_id' => $suvId,
            'service_scope' => 'outstation',
            'service_mode' => 'shuttle',
        ]);

        $response->assertStatus(422)
            ->assertJsonPath('message', 'Ride type, vehicle type, and driver service are locked after approval. Contact the operator.');

        $this->assertSame($sedanId, $driver->fresh()->vehicle_type_id);
        $this->assertSame('local', $driver->fresh()->service_scope);
        $this->assertSame('private', $driver->fresh()->service_mode);
    }

    public function test_admin_can_view_and_update_driver_personal_and_vehicle_details(): void
    {
        $admin = $this->createAdmin();
        $cityId = DB::table('cities')->insertGetId([
            'name' => 'Baramulla Test',
            'country_code' => 'IN',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $suvId = DB::table('vehicle_types')->insertGetId([
            'name' => 'SUV Admin Test',
            'sort_order' => 1,
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        [$user, $driver] = $this->createDriver([], [
            'city_id' => $cityId,
            'vehicle_reg_no' => 'JK01OLD111',
            'vehicle_model' => '2019',
            'vehicle_color' => 'Black',
        ]);

        Sanctum::actingAs($admin, ['act-as:admin']);

        // Admin checks profile
        $this->getJson("/api/admin/drivers/{$driver->id}/profile")
            ->assertOk()
            ->assertJsonPath('driver.vehicle_reg_no', 'JK01OLD111');

        // Admin updates driver vehicle and personal info
        $updateResponse = $this->patchJson("/api/admin/drivers/{$driver->id}", [
            'name' => 'Admin Renamed Driver',
            'vehicle_reg_no' => 'JK01NEW999',
            'vehicle_model' => '2024',
            'vehicle_color' => 'Silver',
            'vehicle_type_id' => $suvId,
            'city_id' => $cityId,
        ]);

        $updateResponse->assertOk()
            ->assertJsonPath('message', 'Driver details updated successfully.');

        $this->assertSame('Admin Renamed Driver', $user->fresh()->name);
        $this->assertSame('JK01NEW999', $driver->fresh()->vehicle_reg_no);
        $this->assertSame('2024', $driver->fresh()->vehicle_model);
        $this->assertSame('Silver', $driver->fresh()->vehicle_color);
        $this->assertSame($suvId, $driver->fresh()->vehicle_type_id);
    }

    public function test_admin_can_initiate_and_verify_driver_phone_change(): void
    {
        $msg91Mock = Mockery::mock(Msg91Service::class);
        $msg91Mock->shouldReceive('isLive')->andReturn(false);
        $msg91Mock->shouldReceive('sendOtp')->once()->andReturn(true);
        $this->app->instance(Msg91Service::class, $msg91Mock);

        $admin = $this->createAdmin();
        [$user, $driver] = $this->createDriver(['phone' => '+919419000001']);

        Sanctum::actingAs($admin, ['act-as:admin']);

        // Admin initiates phone change for driver
        $startResponse = $this->postJson("/api/admin/drivers/{$driver->id}/phone/start", [
            'phone' => '+919419111222',
        ]);

        $startResponse->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('phone', '+919419111222');

        $otp = PhoneOtp::query()->where('phone', '+919419111222')->firstOrFail();
        $otp->update(['code_hash' => Hash::make('998877')]);

        // Admin verifies with valid OTP
        $verifyResponse = $this->postJson("/api/admin/drivers/{$driver->id}/phone/verify", [
            'phone' => '+919419111222',
            'code' => '998877',
        ]);

        $verifyResponse->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('driver.user.phone', '+919419111222');

        $this->assertSame('+919419111222', $user->fresh()->phone);
    }
}
