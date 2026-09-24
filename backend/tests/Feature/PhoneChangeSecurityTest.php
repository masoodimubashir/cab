<?php

namespace Tests\Feature;

use App\Models\Driver;
use App\Models\ManagerRole;
use App\Models\PhoneOtp;
use App\Models\User;
use App\Services\Msg91Service;
use App\Services\PhoneOtpService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Mockery;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class PhoneChangeSecurityTest extends TestCase
{
    use RefreshDatabase;

    private const PHONE = '+919999999999';

    public static function flows(): array
    {
        return [['customer'], ['driver'], ['admin_customer'], ['admin_driver']];
    }

    private function flow(string $flow): array
    {
        $user = User::factory()->create(['phone' => '+919876543210', 'dob' => '1990-01-01']);
        $user->addRole(str_contains($flow, 'driver') ? 'driver' : 'customer');
        if (!str_starts_with($flow, 'admin_')) {
            Sanctum::actingAs($user, ['*']);
            return [$user, '/api/me/phone/change', '/api/me/profile'];
        }
        $role = ManagerRole::create(['slug' => 'super_admin', 'name' => 'Super Admin', 'is_system' => true]);
        $admin = User::factory()->create(['manager_role_id' => $role->id, 'manager_all_cities' => true]);
        $admin->addRole('admin');
        Sanctum::actingAs($admin, ['act-as:admin']);
        $base = "/api/admin/customers/{$user->id}";
        if ($flow === 'admin_driver') {
            $driver = Driver::create(['user_id' => $user->id, 'approval_status' => 'approved']);
            $base = "/api/admin/drivers/{$driver->id}";
        }
        return [$user, $base.'/phone', $base];
    }

    private function otp(?int $userId, array $overrides = []): PhoneOtp
    {
        return PhoneOtp::create(array_merge([
            'phone' => self::PHONE,
            'change_user_id' => $userId,
            'code_hash' => Hash::make('123456'),
            'attempts' => 0,
            'expires_at' => now()->addMinutes(5),
            'last_sent_at' => now()->subMinute(),
        ], $overrides));
    }

    #[DataProvider('flows')]
    public function test_login_code_cannot_change_phone(string $flow): void
    {
        [$user, $url] = $this->flow($flow);
        $this->otp(null);
        $this->postJson($url.'/verify', ['phone' => self::PHONE, 'code' => '123456'])->assertUnprocessable();
        $this->assertSame('+919876543210', $user->fresh()->phone);
    }

    #[DataProvider('flows')]
    public function test_code_is_bound_to_account_and_number(string $flow): void
    {
        [$user, $url] = $this->flow($flow);
        $other = User::factory()->create();
        $row = $this->otp($other->id);
        $this->postJson($url.'/verify', ['phone' => self::PHONE, 'code' => '123456'])->assertUnprocessable();
        $row->update(['change_user_id' => $user->id]);
        $this->postJson($url.'/verify', ['phone' => '+919888888888', 'code' => '123456'])->assertUnprocessable();
        $this->assertSame('+919876543210', $user->fresh()->phone);
    }

    #[DataProvider('flows')]
    public function test_expired_and_exhausted_codes_fail(string $flow): void
    {
        [$user, $url] = $this->flow($flow);
        $row = $this->otp($user->id, ['expires_at' => now()->subSecond()]);
        $this->postJson($url.'/verify', ['phone' => self::PHONE, 'code' => '123456'])->assertUnprocessable();
        $row->update(['expires_at' => now()->addMinutes(5), 'attempts' => config('services.msg91.max_attempts', 5)]);
        $this->postJson($url.'/verify', ['phone' => self::PHONE, 'code' => '123456'])->assertUnprocessable();
        $this->assertSame('+919876543210', $user->fresh()->phone);
    }

    #[DataProvider('flows')]
    public function test_codes_are_six_digits_and_single_use(string $flow): void
    {
        [$user, $url] = $this->flow($flow);
        $this->otp($user->id);
        foreach (['1234', '1234567', 'abcdef'] as $code) {
            $this->postJson($url.'/verify', ['phone' => self::PHONE, 'code' => $code])
                ->assertUnprocessable()->assertJsonValidationErrors('code');
        }
        $this->postJson($url.'/verify', ['phone' => self::PHONE, 'code' => '123456'])->assertOk();
        $this->postJson($url.'/verify', ['phone' => self::PHONE, 'code' => '123456'])->assertUnprocessable();
        $this->assertSame(self::PHONE, $user->fresh()->phone);
    }

    #[DataProvider('flows')]
    public function test_number_claimed_after_issuance_is_rejected(string $flow): void
    {
        [$user, $url] = $this->flow($flow);
        $this->otp($user->id);
        User::factory()->create(['phone' => self::PHONE]);
        $this->postJson($url.'/verify', ['phone' => self::PHONE, 'code' => '123456'])->assertUnprocessable();
        $this->assertSame('+919876543210', $user->fresh()->phone);
    }

    #[DataProvider('flows')]
    public function test_standard_update_cannot_overwrite_phone(string $flow): void
    {
        [$user, , $url] = $this->flow($flow);
        $data = ['phone' => self::PHONE, 'name' => 'Updated Name'];
        if (str_starts_with($flow, 'admin_')) {
            $this->patchJson($url, $data)->assertOk();
        } else {
            $this->postJson($url, $data)->assertOk();
        }
        $this->assertSame('+919876543210', $user->fresh()->phone);
        $this->assertSame('Updated Name', $user->fresh()->name);
    }

    #[DataProvider('flows')]
    public function test_resend_supersedes_code_and_binds_target(string $flow): void
    {
        [$user, $url] = $this->flow($flow);
        $this->otp($user->id);
        $codes = [];
        $sms = Mockery::mock(Msg91Service::class);
        $sms->shouldReceive('isLive')->andReturn(true);
        $sms->shouldReceive('sendOtp')->twice()->andReturnUsing(function ($phone, $code) use (&$codes) {
            $codes[] = $code;
            return true;
        });
        $this->app->instance(Msg91Service::class, $sms);
        $this->postJson($url.'/start', ['phone' => self::PHONE])->assertOk();
        $row = PhoneOtp::where('phone', self::PHONE)->firstOrFail();
        $this->assertSame($user->id, $row->change_user_id);
        $this->assertMatchesRegularExpression('/^[0-9]{6}$/', $codes[0]);
        $this->assertTrue(Hash::check($codes[0], $row->code_hash));
        // Replace the previous code deterministically to avoid a random collision in the test.
        $oldCode = $codes[0] === '123456' ? '654321' : '123456';
        $this->postJson($url.'/verify', ['phone' => self::PHONE, 'code' => $oldCode])->assertUnprocessable();
        $this->postJson($url.'/start', ['phone' => self::PHONE])->assertStatus(429);
        $this->postJson($url.'/start', ['phone' => '+919888888888'])->assertOk();
        $this->postJson($url.'/verify', ['phone' => self::PHONE, 'code' => $codes[0]])->assertUnprocessable();
        $this->assertDatabaseMissing('phone_otps', ['phone' => self::PHONE]);
    }

    #[DataProvider('flows')]
    public function test_start_and_verify_share_rate_limit(string $flow): void
    {
        [, $url] = $this->flow($flow);
        for ($i = 0; $i < 5; $i++) {
            $this->postJson($url.'/verify', ['phone' => self::PHONE, 'code' => '000000'])->assertUnprocessable();
        }
        $this->postJson($url.'/verify', ['phone' => self::PHONE, 'code' => '000000'])->assertStatus(429);
        $this->postJson($url.'/start', ['phone' => self::PHONE])->assertStatus(429);
    }

    public function test_phone_change_code_cannot_be_used_for_login(): void
    {
        [$user] = $this->flow('customer');
        $this->otp($user->id);
        $this->assertFalse(app(PhoneOtpService::class)->verify(self::PHONE, '123456'));
        $this->assertDatabaseHas('phone_otps', ['phone' => self::PHONE, 'attempts' => 0]);
    }

    #[DataProvider('flows')]
    public function test_failed_sms_does_not_leave_usable_code(string $flow): void
    {
        [$user, $url] = $this->flow($flow);
        $sms = Mockery::mock(Msg91Service::class);
        $sms->shouldReceive('isLive')->andReturn(true);
        $sms->shouldReceive('sendOtp')->once()->andReturn(false);
        $this->app->instance(Msg91Service::class, $sms);
        $this->postJson($url.'/start', ['phone' => self::PHONE])->assertStatus(503);
        $this->assertDatabaseMissing('phone_otps', ['phone' => self::PHONE]);
        $this->assertSame('+919876543210', $user->fresh()->phone);
    }

    public function test_mock_sms_cannot_authorize_production_phone_change(): void
    {
        [$user, $url] = $this->flow('customer');
        $sms = Mockery::mock(Msg91Service::class);
        $sms->shouldReceive('isLive')->andReturn(false);
        $sms->shouldNotReceive('sendOtp');
        $this->app->instance(Msg91Service::class, $sms);
        $this->app->instance('env', 'production');
        $this->postJson($url.'/start', ['phone' => self::PHONE])->assertStatus(503)->assertJsonMissingPath('dev_code');
        $this->assertDatabaseMissing('phone_otps', ['phone' => self::PHONE]);
    }

    public function test_wrong_attempts_exhaust_code_and_login_still_works(): void
    {
        [$user] = $this->flow('customer');
        $this->otp($user->id);
        $service = app(PhoneOtpService::class);
        for ($i = 0; $i < config('services.msg91.max_attempts', 5); $i++) {
            $this->assertFalse($service->verifyPhoneChange($user, self::PHONE, '000000'));
        }
        $this->assertFalse($service->verifyPhoneChange($user, self::PHONE, '123456'));
        $this->assertSame('+919876543210', $user->fresh()->phone);
        PhoneOtp::query()->delete();
        $this->otp(null);
        $this->assertTrue($service->verify(self::PHONE, '123456'));
        $this->assertFalse($service->verify(self::PHONE, '123456'));
    }

    public function test_database_collision_rolls_back_otp_consumption(): void
    {
        [$user] = $this->flow('customer');
        $this->otp($user->id);
        User::factory()->create(['phone' => self::PHONE]);
        try {
            app(PhoneOtpService::class)->verifyPhoneChange($user, self::PHONE, '123456');
            $this->fail('Expected a phone collision validation error.');
        } catch (\Illuminate\Validation\ValidationException $exception) {
            $this->assertArrayHasKey('phone', $exception->errors());
        }
        $this->assertSame('+919876543210', $user->fresh()->phone);
        $this->assertDatabaseHas('phone_otps', ['phone' => self::PHONE, 'attempts' => 0]);
    }

    public function test_admin_without_management_permissions_cannot_change_phones(): void
    {
        $role = ManagerRole::create(['slug' => 'restricted', 'name' => 'Restricted']);
        $admin = User::factory()->create(['manager_role_id' => $role->id]);
        $admin->addRole('admin');
        $user = User::factory()->create();
        $user->addRole('customer');
        $driver = Driver::create(['user_id' => $user->id]);
        Sanctum::actingAs($admin, ['act-as:admin']);
        foreach (["/api/admin/customers/{$user->id}", "/api/admin/drivers/{$driver->id}"] as $url) {
            foreach (['start', 'verify'] as $action) {
                $this->postJson($url.'/phone/'.$action, ['phone' => self::PHONE, 'code' => '123456'])->assertForbidden();
            }
        }
    }

    public function test_unauthenticated_requests_cannot_start_or_verify_changes(): void
    {
        $user = User::factory()->create();
        $driver = Driver::create(['user_id' => $user->id]);
        foreach (['/api/me/phone/change', "/api/admin/customers/{$user->id}/phone", "/api/admin/drivers/{$driver->id}/phone"] as $url) {
            foreach (['start', 'verify'] as $action) {
                $this->postJson($url.'/'.$action, ['phone' => self::PHONE, 'code' => '123456'])->assertUnauthorized();
            }
        }
    }

    public function test_non_admin_cannot_start_or_verify_admin_changes(): void
    {
        $user = User::factory()->create();
        $user->addRole('customer');
        $driver = Driver::create(['user_id' => $user->id]);
        Sanctum::actingAs($user, ['*']);
        foreach (["/api/admin/customers/{$user->id}", "/api/admin/drivers/{$driver->id}"] as $url) {
            foreach (['start', 'verify'] as $action) {
                $this->postJson($url.'/phone/'.$action, ['phone' => self::PHONE, 'code' => '123456'])->assertForbidden();
            }
        }
    }
}
