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

        return response()->json([
            'subscription' => $sub ? $this->shapeSubscription($sub->load('plan', 'vehicleType')) : null,
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

        try {
            $sub = $this->subscriptions->purchase($user, $plan);
        } catch (RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response()->json([
            'subscription' => $this->shapeSubscription($sub->load('plan', 'vehicleType')),
            'wallet_balance' => $this->wallet->balance($user),
            'message' => 'Subscription activated.',
        ], 201);
    }

    private function shapePlan(SubscriptionPlan $p): array
    {
        return [
            'id' => $p->id,
            'title' => $p->title,
            'subtitle' => $p->subtitle,
            'amount' => (float) $p->amount,
            'commission_percent' => (float) $p->commission_percent,
            'meter_type' => $p->meter_type,
            'rides_count' => $p->rides_count,
            'days_count' => $p->days_count,
            'earnings_threshold' => $p->earnings_threshold !== null ? (float) $p->earnings_threshold : null,
            'plan_type' => $p->plan_type,
            'vehicle_type_name' => $p->vehicleType?->name,
            'terms' => $p->terms,
        ];
    }

    private function shapeSubscription(DriverSubscription $s): array
    {
        return [
            'id' => $s->id,
            'title' => $s->plan?->title ?? 'Subscription',
            'subtitle' => $s->plan?->subtitle,
            'status' => $s->status,
            'meter_type' => $s->meter_type,
            'commission_percent' => (float) $s->commission_percent,
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
        ];
    }
}
