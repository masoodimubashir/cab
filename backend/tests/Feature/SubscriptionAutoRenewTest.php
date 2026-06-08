<?php

namespace Tests\Feature;

use App\Models\DriverSubscription;
use App\Models\SubscriptionPlan;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\SubscriptionService;
use App\Services\WalletService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Covers the auto-renew / cancel / queued-plan engine in SubscriptionService —
 * the money-critical behaviour. Exercises the service directly against the
 * in-memory DB (no HTTP).
 */
class SubscriptionAutoRenewTest extends TestCase
{
    use RefreshDatabase;

    private int $cityId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->cityId = DB::table('cities')->insertGetId([
            'name' => 'Bengaluru',
            'country_code' => 'IN',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function service(): SubscriptionService
    {
        return app(SubscriptionService::class);
    }

    private function fundWallet(User $user, float $amount): void
    {
        DB::table('wallet_transactions')->insert([
            'user_id' => $user->id,
            'type' => WalletTransaction::TYPE_CREDIT,
            'amount' => $amount,
            'reason' => 'test funding',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function balance(User $user): float
    {
        return app(WalletService::class)->balance($user);
    }

    private function makePlan(string $meter, float $amount, array $extra = []): SubscriptionPlan
    {
        return SubscriptionPlan::create(array_merge([
            'city_id' => $this->cityId,
            'vehicle_type_id' => null,
            'title' => ucfirst($meter) . ' plan ₹' . $amount,
            'subtitle' => null,
            'amount' => $amount,
            'commission_percent' => 0,
            'meter_type' => $meter,
            'rides_count' => $meter === SubscriptionPlan::METER_RIDES ? 1 : null,
            'days_count' => $meter === SubscriptionPlan::METER_DAYS ? 30 : null,
            'earnings_threshold' => null,
            'plan_type' => 'normal',
            'terms' => null,
            'available_from' => null,
            'available_to' => null,
            'is_active' => true,
        ], $extra));
    }

    /** Running (live) subscriptions — excludes prepaid queued rows. */
    private function activeCount(User $user): int
    {
        return DriverSubscription::query()
            ->where('driver_user_id', $user->id)
            ->where('status', DriverSubscription::STATUS_ACTIVE)
            ->where('is_queued', false)
            ->count();
    }

    public function test_time_plan_auto_renews_same_plan_on_expiry(): void
    {
        $user = User::factory()->create();
        $this->fundWallet($user, 300);
        $plan = $this->makePlan(SubscriptionPlan::METER_DAYS, 100);

        $sub = $this->service()->purchase($user, $plan);
        $this->assertSame(200.0, $this->balance($user));

        // Force it past expiry, then run the sweep.
        $sub->forceFill(['expires_at' => now()->subMinute()])->save();
        $this->service()->expireDue();

        // Old row expired; exactly one active row; charged exactly once more.
        $this->assertSame(DriverSubscription::STATUS_EXPIRED, $sub->fresh()->status);
        $this->assertSame(1, $this->activeCount($user));
        $this->assertSame(100.0, $this->balance($user));
        $this->assertTrue((bool) $this->service()->currentActiveRow($user->id, null)?->auto_renew);
    }

    public function test_renewal_fails_when_wallet_short_and_notifies(): void
    {
        $user = User::factory()->create();
        $this->fundWallet($user, 150); // covers one purchase, not the renewal
        $plan = $this->makePlan(SubscriptionPlan::METER_DAYS, 100);

        $sub = $this->service()->purchase($user, $plan);
        $this->assertSame(50.0, $this->balance($user));

        $sub->forceFill(['expires_at' => now()->subMinute()])->save();
        $this->service()->expireDue();

        // No renewal: expired, nothing active, no extra debit, driver notified.
        $this->assertSame(DriverSubscription::STATUS_EXPIRED, $sub->fresh()->status);
        $this->assertSame(0, $this->activeCount($user));
        $this->assertSame(50.0, $this->balance($user));
        $this->assertDatabaseHas('app_notifications', [
            'user_id' => $user->id,
            'type' => 'subscription_renewal_failed',
        ]);
    }

    public function test_cancel_keeps_plan_active_and_keeps_prepaid_queue(): void
    {
        $user = User::factory()->create();
        $this->fundWallet($user, 500);
        $planA = $this->makePlan(SubscriptionPlan::METER_DAYS, 100);
        $planB = $this->makePlan(SubscriptionPlan::METER_DAYS, 150);

        $sub = $this->service()->purchase($user, $planA);
        $this->assertSame(400.0, $this->balance($user));

        // Buying B while A is active charges NOW and parks B as a prepaid queue.
        $queued = $this->service()->buy($user, $planB, null)['subscription'];
        $this->assertSame(250.0, $this->balance($user));         // B charged immediately
        $this->assertTrue((bool) $queued->is_queued);
        $this->assertSame(DriverSubscription::STATUS_ACTIVE, $queued->status);
        $this->assertSame(1, $this->activeCount($user));          // queued row isn't "running"

        $this->service()->cancel($sub);
        $fresh = $sub->fresh();

        $this->assertSame(DriverSubscription::STATUS_ACTIVE, $fresh->status); // still active
        $this->assertFalse((bool) $fresh->auto_renew);                       // won't renew
        $this->assertNotNull($fresh->cancelled_at);

        // Prepaid queued plan is KEPT (already paid for) — it still starts later.
        $stillQueued = $this->service()->queuedFor($user->id);
        $this->assertNotNull($stillQueued);
        $this->assertSame($queued->id, $stillQueued->id);
        $this->assertSame(250.0, $this->balance($user));         // no refund, no extra charge
    }

    /**
     * Buying during the exhausted-but-unswept window must charge NOW and queue
     * (not create a second running sub), and the sweep must activate the queued
     * plan exactly once with NO further charge.
     */
    public function test_buy_during_exhausted_window_charges_now_and_activates_once(): void
    {
        $user = User::factory()->create();
        $this->fundWallet($user, 500);
        $planA = $this->makePlan(SubscriptionPlan::METER_RIDES, 100); // rides_count 1
        $planB = $this->makePlan(SubscriptionPlan::METER_DAYS, 150);

        $subA = $this->service()->purchase($user, $planA);
        $this->assertSame(400.0, $this->balance($user));

        // Exhaust the rides plan (used up) but DON'T sweep yet.
        $subA->forceFill(['rides_used' => 1])->save();

        // activeFor() hides the exhausted sub (perk gone), but currentActiveRow()
        // still sees it so a new buy queues instead of running concurrently.
        $this->assertNull($this->service()->activeFor($user->id, null));
        $this->assertNotNull($this->service()->currentActiveRow($user->id, null));

        // Buy plan B during the window → charged NOW, parked as prepaid queue.
        $queued = $this->service()->buy($user, $planB, null)['subscription'];
        $this->assertSame(250.0, $this->balance($user)); // 500 - 100(A) - 150(B) charged now
        $this->assertTrue((bool) $queued->is_queued);

        // Sweep: A expires, queued B activates — single running row, no re-charge.
        $this->service()->expireDue();

        $this->assertSame(DriverSubscription::STATUS_EXPIRED, $subA->fresh()->status);
        $this->assertSame(1, $this->activeCount($user)); // exactly one running (no duplicate)
        $active = $this->service()->currentActiveRow($user->id, null);
        $this->assertSame($planB->id, $active->subscription_plan_id); // it's B, now live
        $this->assertFalse((bool) $active->is_queued);
        $this->assertSame(250.0, $this->balance($user)); // B NOT charged again at activation
    }

    /**
     * The headline behaviour: buying B while A is active debits the wallet NOW
     * and B starts (with no further charge) when A ends.
     */
    public function test_buy_while_active_charges_now_and_activates_on_expiry(): void
    {
        $user = User::factory()->create();
        $this->fundWallet($user, 500);
        $planA = $this->makePlan(SubscriptionPlan::METER_DAYS, 100); // days_count 30
        $planB = $this->makePlan(SubscriptionPlan::METER_DAYS, 150);

        $subA = $this->service()->purchase($user, $planA);
        $this->assertSame(400.0, $this->balance($user));

        // Buy B while A is active → charged now, queued.
        $queued = $this->service()->buy($user, $planB, null)['subscription'];
        $this->assertSame(250.0, $this->balance($user)); // B charged immediately
        $this->assertTrue((bool) $queued->is_queued);

        // While A runs, only A is the active plan; B is invisible to activeFor.
        $active = $this->service()->activeFor($user->id, null);
        $this->assertNotNull($active);
        $this->assertSame($planA->id, $active->subscription_plan_id);
        $this->assertSame(1, $this->activeCount($user));

        // A expires → B activates with NO further charge, expiry computed afresh.
        $subA->forceFill(['expires_at' => now()->subMinute()])->save();
        $this->service()->expireDue();

        $this->assertSame(DriverSubscription::STATUS_EXPIRED, $subA->fresh()->status);
        $this->assertSame(250.0, $this->balance($user)); // NOT recharged at activation
        $nowActive = $this->service()->activeFor($user->id, null);
        $this->assertNotNull($nowActive);
        $this->assertSame($planB->id, $nowActive->subscription_plan_id);
        $this->assertFalse((bool) $nowActive->is_queued);
        $this->assertNotNull($nowActive->expires_at); // days plan → expiry set at activation
        $this->assertSame(1, $this->activeCount($user));
    }

    /**
     * A ride-metered queued plan activates with no expiry date when the active
     * plan (also ride-metered, exhausted) is swept — and is usable immediately.
     */
    public function test_queued_rides_plan_activates_with_no_expiry(): void
    {
        $user = User::factory()->create();
        $this->fundWallet($user, 500);
        $planA = $this->makePlan(SubscriptionPlan::METER_RIDES, 100); // rides_count 1
        $planB = $this->makePlan(SubscriptionPlan::METER_RIDES, 150); // rides_count 1

        $this->service()->purchase($user, $planA);
        $queued = $this->service()->buy($user, $planB, null)['subscription'];
        $this->assertSame(250.0, $this->balance($user)); // both charged now
        $this->assertTrue((bool) $queued->is_queued);

        // Exhaust + sweep A → B activates.
        DriverSubscription::query()->where('id', $queued->id)->exists(); // sanity
        $subA = $this->service()->currentActiveRow($user->id, null);
        $subA->forceFill(['rides_used' => 1])->save();
        $this->service()->expireDue();

        $nowActive = $this->service()->activeFor($user->id, null);
        $this->assertNotNull($nowActive);
        $this->assertSame($planB->id, $nowActive->subscription_plan_id);
        $this->assertFalse((bool) $nowActive->is_queued);
        $this->assertNull($nowActive->expires_at);           // rides plan → no date expiry
        $this->assertSame(1, $nowActive->rides_allowed);     // usable allowance
        $this->assertSame(250.0, $this->balance($user));     // no recharge at activation
        $this->assertSame(1, $this->activeCount($user));
    }
}
