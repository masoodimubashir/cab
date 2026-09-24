<?php

namespace Tests\Feature;

use App\Models\PhoneOtp;
use App\Models\User;
use App\Services\Msg91Service;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\TestCase;

class ProfilePhoneChangeTest extends TestCase
{
    use RefreshDatabase;

    private function createCustomer(string $phone = '+919876543210'): User
    {
        $user = User::factory()->create([
            'name' => 'Test Customer',
            'phone' => $phone,
            'email' => 'customer@example.com',
        ]);
        $user->addRole('customer');
        return $user;
    }

    private function createDriver(string $phone = '+919876543211'): User
    {
        $user = User::factory()->create([
            'name' => 'Test Driver',
            'phone' => $phone,
            'email' => 'driver@example.com',
        ]);
        $user->addRole('driver');
        return $user;
    }

    public function test_unauthenticated_user_cannot_start_phone_change(): void
    {
        $response = $this->postJson('/api/me/phone/change/start', [
            'phone' => '+919999999999',
        ]);

        $response->assertStatus(401);
    }

    public function test_cannot_start_phone_change_with_same_phone(): void
    {
        $user = $this->createCustomer('+919876543210');
        Sanctum::actingAs($user, ['*']);

        $response = $this->postJson('/api/me/phone/change/start', [
            'phone' => '+919876543210',
        ]);

        $response->assertStatus(422)
            ->assertJson(['message' => 'This is already your current phone number.']);
    }

    public function test_cannot_start_phone_change_with_phone_registered_to_another_account(): void
    {
        $user1 = $this->createCustomer('+919876543210');
        $this->createDriver('+919876543211');

        Sanctum::actingAs($user1, ['*']);

        $response = $this->postJson('/api/me/phone/change/start', [
            'phone' => '+919876543211',
        ]);

        $response->assertStatus(422)
            ->assertJson(['message' => 'This phone number is already registered to another account.']);
    }

    public function test_can_start_phone_change_and_sends_otp(): void
    {
        $msg91Mock = Mockery::mock(Msg91Service::class);
        $msg91Mock->shouldReceive('isLive')->andReturn(false);
        $msg91Mock->shouldReceive('sendOtp')->once()->andReturn(true);
        $this->app->instance(Msg91Service::class, $msg91Mock);

        $user = $this->createCustomer('+919876543210');
        Sanctum::actingAs($user, ['*']);

        $response = $this->postJson('/api/me/phone/change/start', [
            'phone' => '+919999999999',
        ]);

        $response->assertStatus(200)
            ->assertJson([
                'ok' => true,
                'phone' => '+919999999999',
            ]);

        $this->assertDatabaseHas('phone_otps', [
            'phone' => '+919999999999',
        ]);
    }

    public function test_verify_phone_change_with_invalid_code_fails(): void
    {
        $user = $this->createCustomer('+919876543210');
        Sanctum::actingAs($user, ['*']);

        PhoneOtp::create([
            'change_user_id' => $user->id,
            'phone' => '+919999999999',
            'code_hash' => Hash::make('123456'),
            'attempts' => 0,
            'expires_at' => now()->addMinutes(5),
            'last_sent_at' => now(),
        ]);

        $response = $this->postJson('/api/me/phone/change/verify', [
            'phone' => '+919999999999',
            'code' => '000000',
        ]);

        $response->assertStatus(422)
            ->assertJson(['message' => 'Invalid or expired verification code. Please try again.']);

        $this->assertEquals('+919876543210', $user->fresh()->phone);
    }

    public function test_verify_phone_change_with_valid_code_updates_user_phone(): void
    {
        $user = $this->createCustomer('+919876543210');
        Sanctum::actingAs($user, ['*']);

        PhoneOtp::create([
            'change_user_id' => $user->id,
            'phone' => '+919999999999',
            'code_hash' => Hash::make('654321'),
            'attempts' => 0,
            'expires_at' => now()->addMinutes(5),
            'last_sent_at' => now(),
        ]);

        $response = $this->postJson('/api/me/phone/change/verify', [
            'phone' => '+919999999999',
            'code' => '654321',
        ]);

        $response->assertStatus(200)
            ->assertJson([
                'ok' => true,
                'message' => 'Phone number updated successfully.',
                'user' => [
                    'id' => $user->id,
                    'phone' => '+919999999999',
                ],
            ]);

        $this->assertEquals('+919999999999', $user->fresh()->phone);
        // OTP should be consumed (deleted)
        $this->assertDatabaseMissing('phone_otps', [
            'phone' => '+919999999999',
        ]);
    }

    public function test_driver_can_also_verify_phone_change(): void
    {
        $driver = $this->createDriver('+919876543211');
        Sanctum::actingAs($driver, ['*']);

        PhoneOtp::create([
            'change_user_id' => $driver->id,
            'phone' => '+919888888888',
            'code_hash' => Hash::make('888888'),
            'attempts' => 0,
            'expires_at' => now()->addMinutes(5),
            'last_sent_at' => now(),
        ]);

        $response = $this->postJson('/api/me/phone/change/verify', [
            'phone' => '+919888888888',
            'code' => '888888',
        ]);

        $response->assertStatus(200)
            ->assertJson([
                'ok' => true,
                'message' => 'Phone number updated successfully.',
                'user' => [
                    'id' => $driver->id,
                    'phone' => '+919888888888',
                ],
            ]);

        $this->assertEquals('+919888888888', $driver->fresh()->phone);
    }
}
