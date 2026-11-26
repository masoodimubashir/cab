<?php

namespace Tests\Feature\Carpool;

use App\Models\AppNotification;
use App\Models\Carpool\CarpoolSetting;
use App\Models\City;
use App\Models\Driver;
use App\Models\DriverSubscription;
use App\Models\SubscriptionPlan;
use App\Models\User;
use App\Services\Carpool\CarpoolPlanService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * W4 plan timing (Admin-Audit.md A-07, A-08, A-09, BK-11): no publishing gap when a waiting plan takes
 * over, carpool wording for the plan-ending push (none when a plan is waiting), push hours as a setting,
 * and the shared commercial expiry push left exactly as it was for commercial rows.
 */
class CarpoolPlanTimingTest extends TestCase
{
    use RefreshDatabase;

    private City $city;
    private User $user;
    private SubscriptionPlan $plan;

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow('2026-11-26 06:00:00');
        $this->city = City::create(['name' => 'Timing City', 'country_code' => 'IN']);
        $this->user = $this->makeDriver('9990003001', 'carpool');
        $this->plan = $this->makePlan('carpool', ['title' => 'Carpool 30 days']);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function makeDriver(string $phone, string $type): User
    {
        $user = User::factory()->create(['phone' => $phone]);
        $user->addRole('driver');
        $driver = new Driver(['user_id' => $user->id, 'city_id' => $this->city->id, 'approval_status' => 'approved']);
        $driver->user_id = $user->id;
        $driver->driver_type = $type;
        $driver->save();

        return $user;
    }

    private function makePlan(string $audience, array $over = []): SubscriptionPlan
    {
        $plan = new SubscriptionPlan($over + [
            'city_id' => $this->city->id, 'title' => 'P', 'amount' => 199, 'meter_type' => 'days',
            'days_count' => 30, 'commission_percent' => 0, 'pricing_model' => 'subscription', 'is_active' => true,
        ]);
        $plan->audience = $audience;
        $plan->save();

        return $plan;
    }

    private function sub(User $user, SubscriptionPlan $plan, string $start, string $end, bool $queued = false, array $over = []): DriverSubscription
    {
        return DriverSubscription::query()->create($over + [
            'subscription_plan_id' => $plan->id, 'driver_user_id' => $user->id, 'city_id' => $this->city->id,
            'meter_type' => 'days', 'amount_paid' => 199, 'commission_percent' => 0, 'pricing_model' => 'subscription',
            'payment_method' => 'upi', 'days_count' => 30, 'starts_at' => $start, 'expires_at' => $end,
            'status' => DriverSubscription::STATUS_ACTIVE, 'is_queued' => $queued, 'auto_renew' => false,
        ]);
    }

    private function notes(User $user, string $type)
    {
        return AppNotification::query()->where('user_id', $user->id)->where('type', $type)->get();
    }

    public function test_a_waiting_plan_covers_the_hand_over_minute_and_the_hour_before_the_sweep(): void
    {
        $this->sub($this->user, $this->plan, '2026-10-27 09:00:00', '2026-11-26 09:00:00');
        $next = $this->sub($this->user, $this->plan, '2026-11-26 09:00:00', '2026-12-26 09:00:00', true);
        $plans = app(CarpoolPlanService::class);

        Carbon::setTestNow('2026-11-26 09:00:00'); // the exact minute the first plan ends
        $this->assertTrue($plans->canPublish($this->user));
        $this->assertSame($next->id, $plans->activePlan($this->user)?->id);
        $this->assertNull($plans->queuedPlan($this->user), 'a plan that has started is not "waiting" any more');

        Carbon::setTestNow('2026-11-26 09:40:00'); // the hourly sweep has not run yet
        Sanctum::actingAs($this->user, ['act-as:driver']);
        $this->getJson('/api/carpool/plan')->assertOk()
            ->assertJsonPath('can_publish', true)
            ->assertJsonPath('plan.id', $next->id)
            ->assertJsonPath('next_plan', null);

        Carbon::setTestNow('2026-11-26 08:59:00'); // before the hand-over it is still waiting
        $this->assertSame($next->id, $plans->queuedPlan($this->user)?->id);
        $this->assertNotSame($next->id, $plans->activePlan($this->user)?->id);
    }

    public function test_the_shared_expiry_push_skips_carpool_plans_and_still_tells_commercial_drivers(): void
    {
        $this->sub($this->user, $this->plan, '2026-10-27 16:00:00', '2026-11-26 16:00:00');
        $cab = $this->makeDriver('9990003002', 'commercial');
        $commercial = $this->makePlan('commercial', ['title' => 'Gold', 'commission_percent' => 5]);
        $this->sub($cab, $commercial, '2026-10-27 16:00:00', '2026-11-26 16:00:00', false, ['commission_percent' => 5, 'payment_method' => 'wallet']);

        $this->artisan('subscriptions:notify-expiring')->assertSuccessful();

        $this->assertCount(0, $this->notes($this->user, 'subscription_expiring_soon'), 'no commission wording for carpool');
        $cabNote = $this->notes($cab, 'subscription_expiring_soon');
        $this->assertCount(1, $cabNote);
        $this->assertStringContainsString('Resubscribe to keep your commission rate.', $cabNote->first()->body);
    }

    public function test_carpool_plan_ending_push_has_carpool_wording_and_is_sent_once(): void
    {
        $this->sub($this->user, $this->plan, '2026-10-27 16:00:00', '2026-11-26 16:00:00'); // 10 hours from now

        $this->artisan('carpool:lifecycle')->assertSuccessful();
        $this->artisan('carpool:lifecycle')->assertSuccessful();

        $notes = $this->notes($this->user, 'carpool_plan_ending');
        $this->assertCount(1, $notes);
        $this->assertSame('Your carpool plan ends soon', $notes->first()->title);
        $this->assertSame('Your carpool plan ends on 26 Nov, 9:30 pm. Buy your next plan to keep publishing carpools.', $notes->first()->body);
        $this->assertStringNotContainsString('commission', $notes->first()->body);
    }

    public function test_no_plan_ending_push_when_the_next_plan_is_waiting(): void
    {
        $this->sub($this->user, $this->plan, '2026-10-27 16:00:00', '2026-11-26 16:00:00');
        $this->sub($this->user, $this->plan, '2026-11-26 16:00:00', '2026-12-26 16:00:00', true);

        $this->artisan('carpool:lifecycle')->assertSuccessful();

        $this->assertCount(0, $this->notes($this->user, 'carpool_plan_ending'));
        $this->assertCount(0, $this->notes($this->user, 'subscription_expiring_soon'));
    }

    public function test_admin_plan_counts_follow_the_hand_over(): void
    {
        $this->sub($this->user, $this->plan, '2026-10-27 09:00:00', '2026-11-26 09:00:00');
        $this->sub($this->user, $this->plan, '2026-11-26 09:00:00', '2026-12-26 09:00:00', true);
        $role = \App\Models\ManagerRole::query()->firstOrCreate(['slug' => 'super_admin'], ['name' => 'Super Admin', 'is_system' => true]);
        $admin = User::factory()->create(['manager_role_id' => $role->id, 'manager_all_cities' => true]);
        $admin->addRole('admin');
        Sanctum::actingAs($admin, ['act-as:admin']);

        $this->getJson('/api/admin/carpool/plans')->assertOk()
            ->assertJsonPath('data.0.running', 1)->assertJsonPath('data.0.waiting', 1);

        Carbon::setTestNow('2026-11-26 09:30:00'); // hand-over done, hourly sweep not run yet
        $this->getJson('/api/admin/carpool/plans')->assertOk()
            ->assertJsonPath('data.0.running', 1)->assertJsonPath('data.0.waiting', 0);
    }

    public function test_push_hours_is_an_admin_setting(): void
    {
        $this->assertSame(24, CarpoolSetting::number('plan_push_hours'));
        $this->assertSame(['min' => 1, 'max' => 72, 'default' => 24, 'unit' => 'hours', 'nullable' => false], CarpoolSetting::LIMITS['plan_push_hours']);

        $role = \App\Models\ManagerRole::query()->firstOrCreate(['slug' => 'super_admin'], ['name' => 'Super Admin', 'is_system' => true]);
        $admin = User::factory()->create(['manager_role_id' => $role->id, 'manager_all_cities' => true]);
        $admin->addRole('admin');
        Sanctum::actingAs($admin, ['act-as:admin']);
        $s = $this->getJson('/api/admin/carpool/settings')->assertOk()->assertJsonPath('data.plan_push_hours', 24)->json('data');
        $this->patchJson('/api/admin/carpool/settings', ['version' => $s['version'], 'plan_push_hours' => 0])->assertStatus(422);
        $this->patchJson('/api/admin/carpool/settings', ['version' => $s['version'], 'plan_push_hours' => 6])
            ->assertOk()->assertJsonPath('data.plan_push_hours', 6);

        $this->sub($this->user, $this->plan, '2026-10-27 16:00:00', '2026-11-26 16:00:00'); // 10 hours away
        $this->artisan('carpool:lifecycle')->assertSuccessful();
        $this->assertCount(0, $this->notes($this->user, 'carpool_plan_ending'), 'too early with a 6-hour setting');

        Carbon::setTestNow('2026-11-26 10:30:00'); // now 5.5 hours away
        $this->artisan('carpool:lifecycle')->assertSuccessful();
        $this->assertCount(1, $this->notes($this->user, 'carpool_plan_ending'));
    }
}
