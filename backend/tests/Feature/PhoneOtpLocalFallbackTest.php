<?php

namespace Tests\Feature;

use App\Models\PhoneOtp;
use App\Services\Msg91Service;
use App\Services\PhoneOtpService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Log;
use Mockery;
use Tests\TestCase;

class PhoneOtpLocalFallbackTest extends TestCase
{
    use RefreshDatabase;

    private const PHONE = '+919876543210';

    protected function tearDown(): void
    {
        $this->app->instance('env', 'testing');
        parent::tearDown();
    }

    private function service(bool $live, bool $expectGateway = false): PhoneOtpService
    {
        $sms = Mockery::mock(Msg91Service::class);
        $sms->shouldReceive('isLive')->andReturn($live);
        if ($expectGateway) {
            $sms->shouldReceive('sendOtp')->once()->andReturn(true);
        } else {
            $sms->shouldNotReceive('sendOtp');
        }

        return new PhoneOtpService($sms);
    }

    /** Starts an OTP in local log-only mode and returns the code that was logged. */
    private function startLocalAndCaptureCode(PhoneOtpService $otp): string
    {
        Log::spy();
        $this->assertSame(['sent' => true], $otp->start(self::PHONE));

        $code = null;
        Log::shouldHaveReceived('info')->once()->withArgs(function ($message) use (&$code) {
            if (preg_match('/^\[otp:local\].*: (\d{6})$/', $message, $m)) {
                $code = $m[1];
                return true;
            }
            return false;
        });

        return $code;
    }

    public function test_local_without_sms_key_logs_a_random_code_and_stores_only_its_hash(): void
    {
        $this->app->instance('env', 'local');
        $code = $this->startLocalAndCaptureCode($this->service(live: false));

        $row = PhoneOtp::query()->where('phone', self::PHONE)->firstOrFail();
        $this->assertNotSame($code, $row->code_hash);
        $this->assertStringNotContainsString($code, $row->code_hash);
    }

    public function test_local_code_verifies_once_only(): void
    {
        $this->app->instance('env', 'local');
        $otp = $this->service(live: false);
        $code = $this->startLocalAndCaptureCode($otp);

        $this->assertTrue($otp->verify(self::PHONE, $code));
        $this->assertFalse($otp->verify(self::PHONE, $code));
    }

    public function test_local_mode_keeps_the_resend_cooldown(): void
    {
        $this->app->instance('env', 'local');
        $otp = $this->service(live: false);
        $this->startLocalAndCaptureCode($otp);

        $again = $otp->start(self::PHONE);
        $this->assertFalse($again['sent']);
        $this->assertArrayHasKey('cooldown', $again);
    }

    public function test_local_code_expires(): void
    {
        $this->app->instance('env', 'local');
        $otp = $this->service(live: false);
        $code = $this->startLocalAndCaptureCode($otp);

        $this->travel((int) config('services.msg91.otp_ttl_min', 5) + 1)->minutes();
        $this->assertFalse($otp->verify(self::PHONE, $code));
    }

    public function test_local_code_is_locked_after_max_attempts(): void
    {
        $this->app->instance('env', 'local');
        $otp = $this->service(live: false);
        $code = $this->startLocalAndCaptureCode($otp);
        $wrong = $code === '000000' ? '111111' : '000000';

        for ($i = 0; $i < (int) config('services.msg91.max_attempts', 5); $i++) {
            $this->assertFalse($otp->verify(self::PHONE, $wrong));
        }
        $this->assertFalse($otp->verify(self::PHONE, $code));
    }

    public function test_production_and_staging_without_sms_key_fail_and_never_log_a_code(): void
    {
        foreach (['production', 'staging', 'testing'] as $env) {
            $this->app->instance('env', $env);
            Log::spy();

            $this->assertSame(['sent' => false], $this->service(live: false)->start(self::PHONE), $env);
            $this->assertDatabaseCount('phone_otps', 0);
            Log::shouldNotHaveReceived('info');
        }
    }

    public function test_local_with_sms_key_still_uses_the_gateway(): void
    {
        $this->app->instance('env', 'local');
        Log::spy();

        $this->assertSame(['sent' => true], $this->service(live: true, expectGateway: true)->start(self::PHONE));
        Log::shouldNotHaveReceived('info');
    }
}
