<?php

namespace Tests\Feature;

use App\Models\PhoneOtp;
use App\Services\Msg91Service;
use App\Services\PhoneOtpService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery;
use Tests\TestCase;

class PhoneOtpProductionSafetyTest extends TestCase
{
    use RefreshDatabase;

    public function test_production_without_sms_credentials_cannot_return_a_mock_code(): void
    {
        $sms = Mockery::mock(Msg91Service::class);
        $sms->shouldReceive('isLive')->once()->andReturn(false);
        $sms->shouldNotReceive('sendOtp');
        $this->app->instance('env', 'production');
        try {
            $this->assertSame(['sent' => false], (new PhoneOtpService($sms))->start('+919876543210'));
            $this->assertDatabaseCount('phone_otps', 0);
        } finally {
            $this->app->instance('env', 'testing');
        }
    }

    public function test_production_sms_failure_invalidates_the_login_code(): void
    {
        $sms = Mockery::mock(Msg91Service::class);
        $sms->shouldReceive('isLive')->once()->andReturn(true);
        $sms->shouldReceive('sendOtp')->once()->andReturn(false);
        $this->app->instance('env', 'production');
        try {
            $this->assertSame(['sent' => false], (new PhoneOtpService($sms))->start('+919876543210'));
            $this->assertSame(0, PhoneOtp::query()->count());
        } finally {
            $this->app->instance('env', 'testing');
        }
    }
}
