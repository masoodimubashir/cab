<?php

namespace Tests\Feature\Carpool;

use App\Http\Controllers\Dev\DevHubController;
use App\Models\Carpool\CarpoolSetting;
use App\Services\Dev\DevHub;
use App\Services\Msg91Service;
use App\Services\PhoneOtpService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Mockery;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

/**
 * The developer hub must be impossible to use anywhere but a local laptop
 * (hardening slice S1). Every case below turns the hub switch ON and then
 * checks that a non-local environment still gets nothing.
 */
class DevHubProductionGuardTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        $this->app->instance('env', 'testing');
        parent::tearDown();
    }

    private function asEnvironment(string $env): void
    {
        $this->app->instance('env', $env);
        config(['dev_hub.enabled' => true]);
    }

    public function test_the_hub_routes_are_not_registered_outside_a_local_environment(): void
    {
        // The test run is APP_ENV=testing, so bootstrap/app.php must not have loaded routes/dev.php.
        $devRoutes = collect(Route::getRoutes()->getRoutes())
            ->filter(fn ($r) => str_starts_with($r->uri(), 'api/dev'));
        $this->assertCount(0, $devRoutes);

        config(['dev_hub.enabled' => true]);
        $this->getJson('/api/dev/state')->assertNotFound();
        $this->postJson('/api/dev/sign-in', ['person' => 'c-new'])->assertNotFound();
        $this->postJson('/api/dev/fresh-number')->assertNotFound();
    }

    public function test_the_hub_is_off_in_production_even_when_the_switch_is_on(): void
    {
        foreach (['production', 'staging', 'testing'] as $env) {
            $this->asEnvironment($env);
            $this->assertFalse(DevHub::on(), $env);
            $this->assertFalse(DevHub::isTestPhone('9990000001'), $env);
            $this->assertFalse(DevHub::isTestPhone('+919990000042'), $env);
        }
    }

    public function test_the_hub_guard_answers_404_outside_a_local_environment(): void
    {
        $this->asEnvironment('production');
        try {
            DevHub::guard();
            $this->fail('The guard let a production request through.');
        } catch (HttpException $e) {
            $this->assertSame(404, $e->getStatusCode());
        }
    }

    public function test_the_hub_controller_refuses_to_be_built_outside_a_local_environment(): void
    {
        $this->asEnvironment('production');
        try {
            app(DevHubController::class);
            $this->fail('The hub controller was built in production.');
        } catch (HttpException $e) {
            $this->assertSame(404, $e->getStatusCode());
        }
    }

    public function test_a_hub_test_number_gets_a_random_login_code_in_production(): void
    {
        $this->asEnvironment('production');
        $sent = [];
        $sms = Mockery::mock(Msg91Service::class);
        $sms->shouldReceive('isLive')->andReturn(true);
        $sms->shouldReceive('sendOtp')->andReturnUsing(function ($phone, $code) use (&$sent) {
            $sent[] = $code;

            return true;
        });

        $result = (new PhoneOtpService($sms))->start('+919990000001');

        $this->assertSame(['sent' => true], $result);
        $this->assertCount(1, $sent);
        $this->assertNotSame(DevHub::CODE, $sent[0], 'The fixed hub code must never be used in production.');
        $this->assertMatchesRegularExpression('/^\d{6}$/', $sent[0]);
    }

    public function test_the_fixed_hub_code_is_not_accepted_for_a_test_number_in_production(): void
    {
        $this->asEnvironment('production');
        $sms = Mockery::mock(Msg91Service::class);
        $sms->shouldReceive('isLive')->andReturn(true);
        $sms->shouldReceive('sendOtp')->andReturn(true);
        $otp = new PhoneOtpService($sms);
        $otp->start('+919990000001');

        // The stored code is random, so the hub's 123456 almost never matches. Retry a few
        // fresh codes so a one-in-a-million coincidence cannot make this test flaky.
        $accepted = false;
        for ($i = 0; $i < 3 && ! $accepted; $i++) {
            $accepted = $otp->verify('+919990000001', DevHub::CODE);
            if (! $accepted) {
                $otp->start('+919990000001');
            }
        }
        $this->assertFalse($accepted);
    }

    public function test_switching_the_hub_on_does_not_change_the_carpool_switch_in_production(): void
    {
        $this->asEnvironment('production');
        // Only the hub controller writes the carpool switch; with the hub dead the setting is untouched.
        $before = (bool) CarpoolSetting::current()->enabled;
        $this->postJson('/api/dev/switch', ['on' => ! $before])->assertNotFound();
        $this->assertSame($before, (bool) CarpoolSetting::current()->enabled);
    }
}
