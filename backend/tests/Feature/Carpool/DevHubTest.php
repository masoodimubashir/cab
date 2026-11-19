<?php

namespace Tests\Feature\Carpool;

use App\Models\Carpool\CarpoolListing;
use App\Models\Carpool\CarpoolRequest;
use App\Models\City;
use App\Services\Dev\DevHub;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** The developer hub (local only): every test person and every scenario can be built. */
class DevHubTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        City::create(['name' => 'Hub City', 'country_code' => 'IN']);
        $this->app['env'] = 'local';
        config(['dev_hub.enabled' => true]);
    }

    public function test_the_hub_does_nothing_outside_a_local_environment(): void
    {
        $this->app['env'] = 'production';
        $this->assertFalse(DevHub::on());
        $this->assertFalse(DevHub::isTestPhone('9990000001'));
        $this->app['env'] = 'local';
        config(['dev_hub.enabled' => false]);
        $this->assertFalse(DevHub::on());
    }

    public function test_every_test_person_can_be_made_and_has_the_right_state(): void
    {
        $hub = new DevHub();
        foreach (array_keys(DevHub::PEOPLE) as $key) {
            $user = $hub->person($key);
            $this->assertStringStartsWith('+9199900', $user->phone, $key);
            $this->assertTrue($user->hasRole(DevHub::PEOPLE[$key][1]), $key);
        }
        $this->assertNotNull($hub->person('c-banned')->carpool_banned_at);
        $this->assertNull($hub->person('c-new')->avatar_path);
        $this->assertNotNull($hub->person('c-photo')->avatar_path);
        $this->assertTrue(app(\App\Services\Carpool\CarpoolPlanService::class)->canPublish($hub->person('d-plan')));
        $this->assertFalse(app(\App\Services\Carpool\CarpoolPlanService::class)->canPublish($hub->person('d-noplan')));
        $this->assertSame('pending', \App\Models\Driver::query()->where('user_id', $hub->person('d-pending')->id)->value('approval_status'));
    }

    public function test_every_scenario_builds_without_errors(): void
    {
        $hub = new DevHub();
        foreach ($hub->scenarios()->catalogue() as $s) {
            $me = $hub->person($s['role'] === 'customer' ? 'c-photo' : 'd-plan');
            $msg = $hub->scenarios()->run($s['key'], $me);
            $this->assertNotSame('', $msg, $s['key']);
        }
        $this->assertGreaterThan(10, CarpoolListing::query()->count());
        $this->assertGreaterThan(10, CarpoolRequest::query()->count());
    }

    public function test_a_rider_scenario_gives_a_code_and_reset_clears_it(): void
    {
        $hub = new DevHub();
        $me = $hub->person('c-photo');
        $hub->scenarios()->run('r-accepted', $me);
        $r = CarpoolRequest::query()->where('rider_id', $me->id)->firstOrFail();
        $this->assertSame('accepted', $r->status);
        $this->assertNotNull($r->code);
        $hub->wipeCarpoolOf($me, false);
        $this->assertSame(0, CarpoolRequest::query()->where('rider_id', $me->id)->count());
    }

    public function test_test_numbers_get_the_fixed_code(): void
    {
        $this->assertTrue(DevHub::isTestPhone('+919990000042'));
        $this->assertFalse(DevHub::isTestPhone('+919876543210'));
        $this->assertStringStartsWith('+9199900', (new DevHub())->freshNumber());
    }

    public function test_time_offset_is_stored_and_cleared(): void
    {
        DevHub::setTimeOffset(90);
        $this->assertSame(90, DevHub::timeOffset());
        DevHub::setTimeOffset(0);
        $this->assertSame(0, DevHub::timeOffset());
    }
}
