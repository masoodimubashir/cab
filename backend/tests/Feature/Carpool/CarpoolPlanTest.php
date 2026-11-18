<?php

namespace Tests\Feature\Carpool;

use App\Models\City;
use App\Models\Driver;
use App\Models\DriverSubscription;
use App\Models\ManagerRole;
use App\Models\SubscriptionPlan;
use App\Models\User;
use App\Services\Carpool\CarpoolPlanService;
use App\Services\RazorpayService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\TestCase;

/** M2: carpool plans by audience, UPI purchase and the publish gate. */
class CarpoolPlanTest extends TestCase
{
    use RefreshDatabase;

    private City $city;
    private User $user;
    private SubscriptionPlan $plan;

    protected function setUp(): void
    {
        parent::setUp();
        $this->city = City::create(['name' => 'Plan City', 'country_code' => 'IN']);
        $this->user = $this->makeDriver('9990002001', 'carpool');
        $this->plan = $this->makePlan('carpool', ['title' => 'Carpool 30 days', 'amount' => 199, 'days_count' => 30]);
    }

    private function makeDriver(string $phone, string $type, string $approval = 'approved'): User
    {
        $user = User::factory()->create(['phone' => $phone]);
        $user->addRole('driver');
        $driver = new Driver(['user_id' => $user->id, 'city_id' => $this->city->id, 'approval_status' => $approval]);
        $driver->user_id = $user->id;
        $driver->driver_type = $type;
        $driver->save();

        return $user;
    }

    private function makePlan(string $audience, array $over = []): SubscriptionPlan
    {
        $plan = new SubscriptionPlan($over + [
            'city_id' => $this->city->id, 'title' => 'P', 'amount' => 100, 'meter_type' => 'days',
            'days_count' => 30, 'commission_percent' => 0, 'pricing_model' => 'subscription', 'is_active' => true,
        ]);
        $plan->audience = $audience;
        $plan->save();

        return $plan;
    }

    private function razorpay(int $paidPaise = 19900, int $orderPaise = 19900, bool $validSig = true): void
    {
        $mock = Mockery::mock(RazorpayService::class);
        $mock->shouldReceive('createOrder')->andReturnUsing(fn ($p) => ['order_id' => 'order_' . $p, 'amount' => $p, 'currency' => 'INR']);
        $mock->shouldReceive('verifyPaymentSignature')->andReturn($validSig);
        $mock->shouldReceive('fetchOrder')->andReturn(['id' => 'x', 'status' => 'paid', 'amount' => $orderPaise, 'amount_paid' => $paidPaise]);
        $this->app->instance(RazorpayService::class, $mock);
    }

    private function buy(User $user, SubscriptionPlan $plan, string $payment = 'pay_1')
    {
        Sanctum::actingAs($user, ['act-as:driver']);
        $order = $this->postJson('/api/carpool/plan/upi/order', ['plan_id' => $plan->id])->assertOk()->json();

        return $this->postJson('/api/carpool/plan/upi/verify', [
            'plan_id' => $plan->id, 'razorpay_order_id' => $order['order_id'],
            'razorpay_payment_id' => $payment, 'razorpay_signature' => 'sig',
        ]);
    }

    public function test_driver_sees_only_carpool_plans_and_commercial_list_hides_them(): void
    {
        $commercial = $this->makePlan('commercial', ['title' => 'Commercial plan']);

        Sanctum::actingAs($this->user, ['act-as:driver']);
        $ids = collect($this->getJson('/api/carpool/plans')->assertOk()->json('data'))->pluck('id');
        $this->assertEquals([$this->plan->id], $ids->all());

        $cab = $this->makeDriver('9990002002', 'commercial');
        Sanctum::actingAs($cab, ['act-as:driver']);
        $ids = collect($this->getJson('/api/drivers/me/subscriptions/plans')->assertOk()->json('data'))->pluck('id');
        $this->assertEquals([$commercial->id], $ids->all());
    }

    public function test_plans_never_cross_types(): void
    {
        $commercial = $this->makePlan('commercial');
        $cab = $this->makeDriver('9990002002', 'commercial');
        $this->razorpay();

        Sanctum::actingAs($cab, ['act-as:driver']);
        $this->postJson('/api/carpool/plan/upi/order', ['plan_id' => $this->plan->id])->assertStatus(422);

        Sanctum::actingAs($this->user, ['act-as:driver']);
        $this->postJson('/api/carpool/plan/upi/order', ['plan_id' => $commercial->id])->assertStatus(422);
        $this->postJson('/api/drivers/me/subscriptions', ['plan_id' => $this->plan->id, 'payment_method' => 'upi'])->assertStatus(422);
    }

    public function test_buying_a_plan_activates_it_and_opens_the_publish_gate(): void
    {
        $this->razorpay();
        $this->assertFalse(app(CarpoolPlanService::class)->canPublish($this->user));

        $this->buy($this->user, $this->plan)->assertCreated()->assertJsonPath('queued', false);

        $this->assertTrue(app(CarpoolPlanService::class)->canPublish($this->user));
        $sub = DriverSubscription::firstOrFail();
        $this->assertFalse($sub->auto_renew);
        $this->assertSame('upi', $sub->payment_method);
        $this->assertEquals(0, $sub->commission_percent);
        $this->assertSame(30, (int) round($sub->starts_at->diffInDays($sub->expires_at)));

        $this->getJson('/api/carpool/plan')->assertOk()->assertJsonPath('can_publish', true)->assertJsonPath('ending_soon', false);
    }

    public function test_payment_checks(): void
    {
        $this->razorpay(validSig: false);
        $this->buy($this->user, $this->plan)->assertStatus(422);

        $this->razorpay(paidPaise: 0);
        $this->buy($this->user, $this->plan)->assertStatus(422);

        $this->razorpay(orderPaise: 100, paidPaise: 100);
        $this->buy($this->user, $this->plan)->assertStatus(422);

        $this->assertSame(0, DriverSubscription::count());
    }

    public function test_an_order_cannot_be_used_for_a_different_plan(): void
    {
        $cheap = $this->makePlan('carpool', ['amount' => 1]);
        $this->razorpay(paidPaise: 100, orderPaise: 100);
        Sanctum::actingAs($this->user, ['act-as:driver']);
        $order = $this->postJson('/api/carpool/plan/upi/order', ['plan_id' => $cheap->id])->json();

        $this->postJson('/api/carpool/plan/upi/verify', [
            'plan_id' => $this->plan->id, 'razorpay_order_id' => $order['order_id'],
            'razorpay_payment_id' => 'pay_x', 'razorpay_signature' => 's',
        ])->assertStatus(422);
        $this->assertSame(0, DriverSubscription::count());
    }

    public function test_same_payment_twice_gives_one_plan(): void
    {
        $this->razorpay();
        $this->buy($this->user, $this->plan, 'pay_same')->assertCreated();
        $this->buy($this->user, $this->plan, 'pay_same')->assertCreated();

        $this->assertSame(1, DriverSubscription::count());
    }

    public function test_second_plan_is_queued_and_a_third_is_refused(): void
    {
        $this->razorpay();
        $this->buy($this->user, $this->plan, 'pay_a')->assertCreated();
        $first = DriverSubscription::first();

        $this->buy($this->user, $this->plan, 'pay_b')->assertCreated()->assertJsonPath('queued', true);
        $queued = DriverSubscription::where('is_queued', true)->firstOrFail();
        $this->assertTrue($queued->starts_at->equalTo($first->expires_at));

        $this->buy($this->user, $this->plan, 'pay_c')->assertStatus(422);
        $this->assertSame(2, DriverSubscription::count());
    }

    public function test_unapproved_driver_cannot_buy(): void
    {
        $pending = $this->makeDriver('9990002003', 'carpool', 'pending');
        $this->razorpay();
        Sanctum::actingAs($pending, ['act-as:driver']);
        $this->postJson('/api/carpool/plan/upi/order', ['plan_id' => $this->plan->id])->assertStatus(422);
    }

    public function test_ending_soon_and_expired_plan(): void
    {
        $this->razorpay();
        $this->buy($this->user, $this->plan)->assertCreated();
        $sub = DriverSubscription::first();

        $sub->update(['expires_at' => now()->addDays(2)]);
        $this->getJson('/api/carpool/plan')->assertJsonPath('ending_soon', true)->assertJsonPath('can_publish', true);

        $sub->update(['expires_at' => now()->subMinute()]);
        $this->getJson('/api/carpool/plan')->assertJsonPath('can_publish', false)->assertJsonPath('plan', null);
    }

    public function test_hourly_sweep_expires_a_carpool_plan_without_renewing(): void
    {
        $this->razorpay();
        $this->buy($this->user, $this->plan)->assertCreated();
        DriverSubscription::first()->update(['expires_at' => now()->subMinute()]);

        app(\App\Services\SubscriptionService::class)->expireDue();

        $this->assertSame('expired', DriverSubscription::first()->status);
        $this->assertSame(1, DriverSubscription::count());
    }

    public function test_carpool_plan_payments_stay_out_of_the_commercial_ledger_scope(): void
    {
        $this->razorpay();
        $this->buy($this->user, $this->plan)->assertCreated();

        $this->assertSame(0, DriverSubscription::ofCommercialPlans()->count());
    }

    public function test_admin_plan_audience_and_carpool_rules(): void
    {
        $role = ManagerRole::query()->firstOrCreate(['slug' => 'super_admin'], ['name' => 'Super Admin', 'is_system' => true]);
        $admin = User::factory()->create(['manager_role_id' => $role->id, 'manager_all_cities' => true]);
        $admin->addRole('admin');
        Sanctum::actingAs($admin, ['act-as:admin']);

        $res = $this->postJson('/api/admin/subscription-plans', [
            'audience' => 'carpool', 'title' => 'Admin carpool', 'amount' => 149, 'meter_type' => 'rides',
            'rides_count' => 5, 'days_count' => 15, 'commission_percent' => 12, 'pricing_model' => 'hybrid',
            'vehicle_type_ids' => [3], 'city_ids' => [$this->city->id],
        ])->assertCreated();
        $row = SubscriptionPlan::findOrFail($res->json('plan.id'));
        $this->assertSame('carpool', $row->audience);
        $this->assertSame('days', $row->meter_type);
        $this->assertSame('subscription', $row->pricing_model);
        $this->assertEquals(0, $row->commission_percent);
        $this->assertNull($row->vehicle_type_id);

        $commercial = $this->getJson('/api/admin/subscription-plans')->json('data');
        $this->assertNotContains($row->id, collect($commercial)->pluck('id')->all());
        $carpool = $this->getJson('/api/admin/subscription-plans?audience=carpool')->json('data');
        $this->assertContains($row->id, collect($carpool)->pluck('id')->all());
    }
}
