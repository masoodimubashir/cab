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
        $reqs = fn (string $key) => collect(app(\App\Services\DriverDocumentRequirements::class)->forDriver(\App\Models\Driver::query()->where('user_id', $hub->person($key)->id)->first()));
        $this->assertSame(['approved'], $reqs('d-plan')->pluck('status')->unique()->values()->all());
        $this->assertSame(['pending'], $reqs('d-pending')->pluck('status')->unique()->values()->all());
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

    /** Sign-up and Plans screens (1f to 1i): each scenario puts the driver in the state that screen shows. */
    public function test_sign_up_and_plan_scenarios_set_up_the_status_and_plans_screens(): void
    {
        $hub = new DevHub();
        $me = $hub->person('d-pending');
        $driver = fn () => \App\Models\Driver::query()->where('user_id', $me->id)->first();
        $reqs = fn () => collect(app(\App\Services\DriverDocumentRequirements::class)->forDriver($driver()));
        $plans = app(\App\Services\Carpool\CarpoolPlanService::class);

        $hub->scenarios()->run('d-docs-sent', $me);
        $this->assertSame('pending', $driver()->approval_status);
        $this->assertCount(4, $reqs());
        $this->assertSame(['pending'], $reqs()->pluck('status')->unique()->values()->all());

        $hub->scenarios()->run('d-docs-fix', $me);
        $this->assertSame('pending', $driver()->approval_status);
        $this->assertSame(1, $reqs()->where('status', 'rejected')->count());
        $this->assertSame(1, $reqs()->where('status', 'missing')->count());
        $this->assertSame('Photo is blurry', collect($reqs()->firstWhere('status', 'rejected')['slots'])->pluck('rejection_reason')->filter()->first());

        $hub->scenarios()->run('d-approve-me', $me);
        $this->assertSame('approved', $driver()->approval_status);
        $this->assertSame(['approved'], $reqs()->pluck('status')->unique()->values()->all());

        $hub->scenarios()->run('d-no-plan', $me);
        $this->assertNull($plans->activePlan($me));

        $hub->scenarios()->run('d-plan-30', $me);
        $this->assertTrue($plans->activePlan($me)->expires_at->between(now()->addDays(29), now()->addDays(31)));

        $hub->scenarios()->run('d-plan-ending', $me);
        $this->assertTrue($plans->activePlan($me)->expires_at->lessThan(now()->addDays(3)));
        $this->assertNull($plans->queuedPlan($me));

        $hub->scenarios()->run('d-plan-waiting', $me);
        $this->assertNotNull($plans->activePlan($me));
        $queued = $plans->queuedPlan($me);
        $this->assertNotNull($queued);
        $this->assertTrue($queued->starts_at->equalTo($plans->activePlan($me)->expires_at));
    }

    /** L1.6: Simulate drive plays the car along the saved route, for the rider map and the wait at a pickup. */
    public function test_simulate_drive_moves_the_car_along_the_route_and_to_the_next_pickup(): void
    {
        $hub = new DevHub();
        $me = $hub->person('d-plan');
        $this->assertSame('No carpool of yours is on the road. Start one first (scenario "On the road with riders").', $hub->drive($me, 'step', 300));

        $hub->scenarios()->run('d-onroad', $me);
        $l = CarpoolListing::query()->where('status', CarpoolListing::STATUS_IN_PROGRESS)->latest('id')->firstOrFail();
        $along = fn () => (int) \App\Models\Carpool\CarpoolPosition::query()->where('listing_id', $l->id)->latest('id')->value('along_m');

        $this->assertMatchesRegularExpression('/^The car is 0\.3 km along the route \(of [0-9.]+ km\)/', $hub->drive($me, 'step', 300));
        $this->assertEqualsWithDelta(300, $along(), 5);
        $this->travel(5)->seconds();
        $hub->drive($me, 'step', 300);
        $this->assertEqualsWithDelta(600, $along(), 5);

        // To the next rider still waiting: the car stops at their pickup, so the wait starts.
        $this->travel(5)->seconds();
        $waiting = CarpoolRequest::query()->where('listing_id', $l->id)->where('status', 'accepted')->whereNull('picked_up_at')->firstOrFail();
        $this->assertStringContainsString('at the pickup of', $hub->drive($me, 'pickup'));
        $this->assertNotNull($waiting->fresh()->arrived_at);
        $this->assertSame('No rider is waiting for a pickup the car has not reached yet.', $hub->drive($me, 'pickup'));

        // Too soon after the last position: the server drops it, and the hub says so.
        $this->assertStringContainsString('Too soon', $hub->drive($me, 'step', 300));

        // A rider on the same ride can drive it from their own hub.
        $this->travel(5)->seconds();
        $rider = \App\Models\User::query()->findOrFail($waiting->rider_id);
        $this->assertStringContainsString('km along the route', $hub->drive($rider, 'step', 300));
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
