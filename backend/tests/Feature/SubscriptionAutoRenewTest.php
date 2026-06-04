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

    private function activeCount(User $user): int
    {
        return DriverSubscription::query()
            ->where('driver_user_id', $user->id)
            ->where('status', DriverSubscription::STATUS_ACTIVE)
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

    public function test_cancel_keeps_plan_active_and_drops_queued(): void
    {
        $user = User::factory()->create();
        $this->fundWallet($user, 500);
        $planA = $this->makePlan(SubscriptionPlan::METER_DAYS, 100);
        $planB = $this->makePlan(SubscriptionPlan::METER_DAYS, 150);

        $sub = $this->service()->purchase($user, $planA);
        $this->service()->queueNext($sub, $planB);
        $this->assertSame($planB->id, $sub->fresh()->next_plan_id);

        $this->service()->cancel($sub);
        $fresh = $sub->fresh();

        $this->assertSame(DriverSubscription::STATUS_ACTIVE, $fresh->status); // still active
        $this->assertFalse((bool) $fresh->auto_renew);                       // won't renew
        $this->assertNotNull($fresh->cancelled_at);
        $this->assertNull($fresh->next_plan_id);                             // queue dropped
    }

    /**
     * Regression for the double-charge / two-active-subs bug: buying during the
     * exhausted-but-unswept window must QUEUE (not immediately purchase), and the
     * sweep must activate the queued plan exactly once.
     */
    public function test_buy_during_exhausted_window_queues_without_double_charge(): void
    {
        $user = User::factory()->create();
        $this->fundWallet($user, 500);
        $planA = $this->makePlan(SubscriptionPlan::METER_RIDES, 100); // rides_count 1
        $planB = $this->makePlan(SubscriptionPlan::METER_DAYS, 150);

        $subA = $this->service()->purchase($user, $planA);
        $this->assertSame(400.0, $this->balance($user));

        // Exhaust the rides plan (used up) but DON'T sweep yet.
        $subA->forceFill(['rides_used' => 1])->save();

        // The crux of the fix: activeFor() hides the exhausted sub (perk gone),
        // but currentActiveRow() still sees it so a new buy queues.
        $this->assertNull($this->service()->activeFor($user->id, null));
        $this->assertNotNull($this->service()->currentActiveRow($user->id, null));

        // Buy plan B during the window → queued onto the exhausted row, no charge.
        $this->service()->queueNext($this->service()->currentActiveRow($user->id, null), $planB);
        $this->assertSame(400.0, $this->balance($user)); // not charged at queue time

        // Sweep: A expires, queued B activates — charged once, single active row.
        $this->service()->expireDue();

        $this->assertSame(DriverSubscription::STATUS_EXPIRED, $subA->fresh()->status);
        $this->assertSame(1, $this->activeCount($user)); // exactly one active (no duplicate)
        $active = $this->service()->currentActiveRow($user->id, null);
        $this->assertSame($planB->id, $active->subscription_plan_id); // it's B, not a re-buy of A
        $this->assertSame(250.0, $this->balance($user)); // 500 - 100(A) - 150(B); A NOT re-charged
    }
}
