<?php

namespace App\Services\Carpool;

use App\Models\Driver;
use App\Models\DriverSubscription;
use App\Models\SubscriptionPlan;
use App\Models\User;
use App\Services\RazorpayService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Carpool plans (Carpool.md P4): day-based, no commission, paid by UPI only, no
 * auto-renew. Rows live in `driver_subscriptions` (so the hourly sweep expires
 * them) but are bought and read only here, never by the commercial wallet flow.
 */
class CarpoolPlanService
{
    private const ORDER_TTL_MINUTES = 120;

    public function __construct(private RazorpayService $razorpay)
    {
    }

    /** Plans this driver may buy: carpool audience, their city, active now. */
    public function plansFor(Driver $driver)
    {
        return SubscriptionPlan::query()->carpool()
            ->where('city_id', $driver->city_id)
            ->where('is_active', true)
            ->orderBy('amount')
            ->get()
            ->filter(fn (SubscriptionPlan $p) => $p->isAvailableNow())
            ->values();
    }

    /** The running plan (not queued, not past its end), or null. */
    public function activePlan(User $user): ?DriverSubscription
    {
        return $this->carpoolRows($user)
            ->where('is_queued', false)
            ->where('starts_at', '<=', now())
            ->where('expires_at', '>', now())
            ->orderByDesc('expires_at')
            ->first();
    }

    public function queuedPlan(User $user): ?DriverSubscription
    {
        return $this->carpoolRows($user)->where('is_queued', true)->first();
    }

    /** The publish gate (M3 calls this). A plan is needed to publish; no free trial. */
    public function canPublish(User $user): bool
    {
        return $this->activePlan($user) !== null;
    }

    /** @return array<string, mixed> */
    public function createOrder(User $user, SubscriptionPlan $plan): array
    {
        $this->assertBuyable($user, $plan);

        $order = $this->razorpay->createOrder(
            (int) round((float) $plan->amount * 100),
            'cpl_' . $user->id . '_' . $plan->id . '_' . now()->format('YmdHis'),
        );
        Cache::put($this->orderKey($order['order_id']), [$user->id, $plan->id], now()->addMinutes(self::ORDER_TTL_MINUTES));

        return [
            'order_id' => $order['order_id'],
            'amount_paise' => $order['amount'],
            'amount' => (float) $plan->amount,
            'currency' => $order['currency'],
            'key_id' => config('services.razorpay.key_id'),
            'plan_id' => $plan->id,
            'plan_title' => $plan->title,
        ];
    }

    /**
     * Checks the payment and starts the plan. A plan bought while one is running
     * starts when it ends (one queued plan at a time). Safe to call twice with the
     * same payment: the second call returns the first result.
     *
     * @return array{subscription: DriverSubscription, queued: bool}
     */
    public function verifyAndActivate(User $user, SubscriptionPlan $plan, string $orderId, string $paymentId, string $signature): array
    {
        $this->assertBuyable($user, $plan);

        $done = DriverSubscription::query()->where('razorpay_payment_id', $paymentId)->first();
        if ($done) {
            if ((int) $done->driver_user_id !== (int) $user->id) {
                $this->fail('This payment was already used.');
            }

            return ['subscription' => $done, 'queued' => (bool) $done->is_queued];
        }

        $bound = Cache::get($this->orderKey($orderId));
        if ($bound !== [$user->id, $plan->id]) {
            $this->fail('This payment does not match the plan.');
        }
        if (! $this->razorpay->verifyPaymentSignature($orderId, $paymentId, $signature)) {
            $this->fail('Payment could not be verified.');
        }
        $order = $this->razorpay->fetchOrder($orderId);
        $paise = (int) round((float) $plan->amount * 100);
        if (! $order || $order['amount'] !== $paise || $order['amount_paid'] < $paise) {
            $this->fail('Payment is not complete yet.');
        }

        return DB::transaction(function () use ($user, $plan, $orderId, $paymentId) {
            User::query()->whereKey($user->id)->lockForUpdate()->first();

            $running = $this->activePlan($user);
            if ($running && $this->queuedPlan($user)) {
                $this->fail('You already have a plan waiting to start. It starts when your current plan ends.');
            }

            $now = now();
            $days = max(1, (int) $plan->days_count);
            $start = $running ? $running->expires_at->copy() : $now->copy();
            $sub = DriverSubscription::query()->create([
                'subscription_plan_id' => $plan->id,
                'driver_user_id' => $user->id,
                'city_id' => $plan->city_id,
                'vehicle_type_id' => null,
                'meter_type' => SubscriptionPlan::METER_DAYS,
                'amount_paid' => $plan->amount,
                'commission_percent' => 0,
                'pricing_model' => SubscriptionPlan::MODEL_SUBSCRIPTION,
                'payment_method' => 'upi',
                'payment_reference' => $paymentId,
                'razorpay_order_id' => $orderId,
                'razorpay_payment_id' => $paymentId,
                'days_count' => $days,
                'starts_at' => $start,
                'expires_at' => $start->copy()->addDays($days),
                'status' => DriverSubscription::STATUS_ACTIVE,
                'is_queued' => (bool) $running,
                'auto_renew' => false,
            ]);

            return ['subscription' => $sub, 'queued' => (bool) $running];
        });
    }

    private function assertBuyable(User $user, SubscriptionPlan $plan): void
    {
        $driver = Driver::query()->where('user_id', $user->id)->first();
        if (! $driver || ! $driver->isCarpool()) {
            $this->fail('Carpool plans are for carpool drivers.');
        }
        if ($driver->approval_status !== 'approved') {
            $this->fail('Your sign-up must be approved before you buy a plan.');
        }
        if ($plan->audience !== SubscriptionPlan::AUDIENCE_CARPOOL
            || (int) $plan->city_id !== (int) $driver->city_id
            || ! $plan->isAvailableNow()) {
            $this->fail('This plan is not available for you.');
        }
    }

    private function carpoolRows(User $user)
    {
        return DriverSubscription::query()
            ->where('driver_user_id', $user->id)
            ->where('status', DriverSubscription::STATUS_ACTIVE)
            ->whereHas('plan', fn ($p) => $p->where('audience', SubscriptionPlan::AUDIENCE_CARPOOL));
    }

    private function orderKey(string $orderId): string
    {
        return 'carpool_plan_order:' . $orderId;
    }

    private function fail(string $message): never
    {
        throw ValidationException::withMessages(['plan' => $message]);
    }
}
