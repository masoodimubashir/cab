<?php

namespace Tests\Feature;

use App\Models\Driver;
use App\Models\ManagerRole;
use App\Models\PhoneOtp;
use App\Models\User;
use App\Services\Msg91Service;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\TestCase;

class AdminPhoneChangeTest extends TestCase
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
            'name' => 'Admin User',
            'email' => 'admin@dreamcabs.local',
            'manager_role_id' => $role->id,
            'manager_all_cities' => true,
        ]);
        $admin->addRole('admin');
        return $admin;
    }

    private function createCustomer(string $phone = '+919876543210'): User
    {
        $user = User::factory()->create([
            'name' => 'Customer Azaan',
            'phone' => $phone,
            'email' => 'azaan@example.com',
        ]);
        $user->addRole('customer');
        return $user;
    }

    private function createDriver(string $phone = '+919876543211'): Driver
    {
        $user = User::factory()->create([
            'name' => 'Driver Bilal',
            'phone' => $phone,
            'email' => 'bilal@example.com',
        ]);
        $user->addRole('driver');

        return Driver::create([
            'user_id' => $user->id,
            'approval_status' => 'approved',
        ]);
    }

    public function test_admin_can_start_customer_phone_change_and_sends_otp(): void
    {
        $msg91Mock = Mockery::mock(Msg91Service::class);
        $msg91Mock->shouldReceive('isLive')->andReturn(false);
        $msg91Mock->shouldReceive('sendOtp')->once()->andReturn(true);
        $this->app->instance(Msg91Service::class, $msg91Mock);

        $admin = $this->createAdmin();
        $customer = $this->createCustomer('+919876543210');

        Sanctum::actingAs($admin, ['act-as:admin']);

        $response = $this->postJson("/api/admin/customers/{$customer->id}/phone/start", [
            'phone' => '+919999988888',
        ]);

        $response->assertStatus(200)
            ->assertJson([
                'ok' => true,
                'phone' => '+919999988888',
            ]);

        $this->assertDatabaseHas('phone_otps', [
            'phone' => '+919999988888',
        ]);
    }

    public function test_admin_cannot_start_phone_change_with_existing_phone(): void
    {
        $admin = $this->createAdmin();
        $customer = $this->createCustomer('+919876543210');

        Sanctum::actingAs($admin, ['act-as:admin']);

        $response = $this->postJson("/api/admin/customers/{$customer->id}/phone/start", [
            'phone' => '+919876543210',
        ]);

        $response->assertStatus(422)
            ->assertJson(['message' => "This is already the customer's current phone number."]);
    }

    public function test_admin_verify_customer_phone_change_with_valid_otp(): void
    {
        $admin = $this->createAdmin();
        $customer = $this->createCustomer('+919876543210');

        Sanctum::actingAs($admin, ['act-as:admin']);

        PhoneOtp::create([
            'change_user_id' => $customer->id,
            'phone' => '+919999988888',
            'code_hash' => Hash::make('123456'),
            'attempts' => 0,
            'expires_at' => now()->addMinutes(5),
            'last_sent_at' => now(),
        ]);

        $response = $this->postJson("/api/admin/customers/{$customer->id}/phone/verify", [
            'phone' => '+919999988888',
            'code' => '123456',
        ]);

        $response->assertStatus(200)
            ->assertJson([
                'ok' => true,
                'message' => 'Customer phone number updated successfully.',
                'customer' => [
                    'id' => $customer->id,
                    'phone' => '+919999988888',
                ],
            ]);

        $this->assertEquals('+919999988888', $customer->fresh()->phone);
    }

    public function test_admin_verify_driver_phone_change_with_valid_otp(): void
    {
        $admin = $this->createAdmin();
        $driver = $this->createDriver('+919876543211');

        Sanctum::actingAs($admin, ['act-as:admin']);

        PhoneOtp::create([
            'change_user_id' => $driver->user_id,
            'phone' => '+919888877777',
            'code_hash' => Hash::make('654321'),
            'attempts' => 0,
            'expires_at' => now()->addMinutes(5),
            'last_sent_at' => now(),
        ]);

        $response = $this->postJson("/api/admin/drivers/{$driver->id}/phone/verify", [
            'phone' => '+919888877777',
            'code' => '654321',
        ]);

        $response->assertStatus(200)
            ->assertJson([
                'ok' => true,
                'message' => 'Driver phone number updated successfully.',
            ]);

        $this->assertEquals('+919888877777', $driver->user->fresh()->phone);
    }
}
