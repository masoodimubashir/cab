<?php

namespace App\Http\Controllers;

use App\Models\DriverSubscription;
use App\Models\SubscriptionPlan;
use App\Services\SubscriptionService;
use App\Services\WalletService;
use Illuminate\Http\Request;
use RuntimeException;

/**
 * Driver-facing subscription endpoints: browse the plans available to the
 * driver's city + vehicle type, see the current active plan, and buy one.
 */
class DriverSubscriptionsController
{
    public function __construct(
        private SubscriptionService $subscriptions,
        private WalletService $wallet,
    ) {
    }

    /** Plans the driver can buy right now (city + vehicle-type + window). */
    public function plans(Request $request)
    {
        $user = $request->user();
        $driver = $user->driver;
        if (! $driver || ! $driver->city_id) {
            return response()->json(['data' => []]);
        }

        $rows = SubscriptionPlan::query()
            ->where('city_id', $driver->city_id)
            ->where('is_active', true)
            ->where(function ($q) use ($driver) {
                $q->whereNull('vehicle_type_id')
                  ->orWhere('vehicle_type_id', $driver->vehicle_type_id);
            })
            ->with('vehicleType')
            ->orderBy('amount')
            ->get()
            ->filter(fn (SubscriptionPlan $p) => $p->isAvailableNow())
            ->map(fn (SubscriptionPlan $p) => $this->shapePlan($p))
            ->values();

        return response()->json(['data' => $rows]);
    }

    /** The driver's current active subscription (or null) + wallet balance. */
    public function current(Request $request)
    {
        $user = $request->user();
        $driver = $user->driver;
        $vehicleTypeId = $driver?->vehicle_type_id ? (int) $driver->vehicle_type_id : null;

        $sub = $this->subscriptions->activeFor($user->id, $vehicleTypeId);
        $queued = $this->subscriptions->queuedFor($user->id);

        return response()->json([
            'subscription' => $sub
                ? $this->shapeSubscription($sub->load('plan', 'vehicleType'), $queued?->load('plan'))
                : null,
            'wallet_balance' => $this->wallet->balance($user),
            'currency' => 'INR',
        ]);
    }

    /** Buy a plan. Debits the wallet and creates the subscription. */
    public function purchase(Request $request)
    {
        $data = $request->validate([
            'plan_id' => ['required', 'integer', 'exists:subscription_plans,id'],
        ]);

        $user = $request->user();
        $driver = $user->driver;
        if (! $driver || ! $driver->city_id) {
            return response()->json(['message' => 'Complete your driver profile before subscribing.'], 422);
        }

        $plan = SubscriptionPlan::query()->findOrFail($data['plan_id']);

        // The plan must belong to the driver's city, match their vehicle type
        // (or be vehicle-agnostic), and still be inside its sale window.
        if ($plan->city_id !== (int) $driver->city_id
            || ($plan->vehicle_type_id !== null && $plan->vehicle_type_id !== (int) $driver->vehicle_type_id)
            || ! $plan->isAvailableNow()) {
            return response()->json(['message' => 'This plan is not available for you.'], 422);
        }

        $vehicleTypeId = $driver->vehicle_type_id ? (int) $driver->vehicle_type_id : null;

        // One atomic call decides active-vs-queued, checks the wallet, and
        // charges — all under a per-driver lock — so concurrent buys can't
        // double-charge or create two running subscriptions. If a plan is already
        // running, the new plan is charged NOW and queued to start when it ends.
        try {
            $result = $this->subscriptions->buy($user, $plan, $vehicleTypeId);
        } catch (RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        if ($result['queued']) {
            return response()->json([
                'queued' => true,
                'subscription' => $this->shapeSubscription(
                    $result['current']->load('plan', 'vehicleType'),
                    $result['subscription']->load('plan'),
                ),
                'wallet_balance' => $this->wallet->balance($user),
                'message' => 'Plan purchased — it starts when your current plan ends.',
            ], 201);
        }

        return response()->json([
            'queued' => false,
            'subscription' => $this->shapeSubscription($result['subscription']->load('plan', 'vehicleType')),
            'wallet_balance' => $this->wallet->balance($user),
            'message' => 'Subscription activated.',
        ], 201);
    }

    /**
     * Turn off auto-renew for the driver's active plan. The plan stays active
     * until it expires; it just won't renew. A prepaid queued plan is left alone
     * — it was already paid for and still starts when this plan ends.
     */
    public function cancel(Request $request)
    {
        $user = $request->user();
        $driver = $user->driver;
        $vehicleTypeId = $driver?->vehicle_type_id ? (int) $driver->vehicle_type_id : null;

        // Raw active row so an exhausted-but-unswept plan can still be cancelled
        // (turning off the pending auto-renewal) without waiting for the sweep.
        $sub = $this->subscriptions->currentActiveRow($user->id, $vehicleTypeId);
        if (! $sub) {
            return response()->json(['message' => 'You have no active subscription to cancel.'], 422);
        }

        $this->subscriptions->cancel($sub);

        return response()->json([
            'subscription' => $this->shapeSubscription(
                $sub->fresh()->load('plan', 'vehicleType'),
                $this->subscriptions->queuedFor($user->id)?->load('plan'),
            ),
            'wallet_balance' => $this->wallet->balance($user),
            'message' => 'Auto-renew turned off. Your plan stays active until it expires.',
        ]);
    }

    private function shapePlan(SubscriptionPlan $p): array
    {
        return [
            'id' => $p->id,
            'title' => $p->title,
            'subtitle' => $p->subtitle,
            'amount' => (float) $p->amount,
            'commission_percent' => (float) $p->commission_percent,
            'pricing_model' => $p->pricing_model,
            'meter_type' => $p->meter_type,
            'rides_count' => $p->rides_count,
            'days_count' => $p->days_count,
            'earnings_threshold' => $p->earnings_threshold !== null ? (float) $p->earnings_threshold : null,
            'plan_type' => $p->plan_type,
            'vehicle_type_name' => $p->vehicleType?->name,
            'terms' => $p->terms,
        ];
    }

    private function shapeSubscription(DriverSubscription $s, ?DriverSubscription $queued = null): array
    {
        return [
            'id' => $s->id,
            'title' => $s->plan?->title ?? 'Subscription',
            'subtitle' => $s->plan?->subtitle,
            'status' => $s->status,
            'meter_type' => $s->meter_type,
            'commission_percent' => (float) $s->commission_percent,
            'pricing_model' => $s->pricing_model,
            'amount_paid' => (float) $s->amount_paid,
            'rides_allowed' => $s->rides_allowed,
            'rides_used' => $s->rides_used,
            'rides_remaining' => $s->ridesRemaining(),
            'earnings_cap' => $s->earnings_cap !== null ? (float) $s->earnings_cap : null,
            'earnings_accrued' => (float) $s->earnings_accrued,
            'earnings_remaining' => $s->earningsRemaining(),
            'vehicle_type_name' => $s->vehicleType?->name,
            'starts_at' => optional($s->starts_at)->toIso8601String(),
            'expires_at' => optional($s->expires_at)->toIso8601String(),
            'auto_renew' => (bool) $s->auto_renew,
            'cancelled_at' => optional($s->cancelled_at)->toIso8601String(),
            // The driver's prepaid queued plan (already charged, waiting to start).
            'next_plan' => $queued ? [
                'id' => $queued->subscription_plan_id,
                'title' => $queued->plan?->title ?? 'Queued plan',
                'amount' => (float) $queued->amount_paid,
                'commission_percent' => (float) $queued->commission_percent,
                'pricing_model' => $queued->pricing_model,
                'prepaid' => true,
            ] : null,
        ];
    }
}
