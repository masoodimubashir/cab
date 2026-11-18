<?php

namespace App\Http\Controllers\Carpool;

use App\Http\Controllers\Controller;
use App\Models\Driver;
use App\Models\DriverSubscription;
use App\Models\SubscriptionPlan;
use App\Services\Carpool\CarpoolPlanService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Carpool plans: list, current plan, UPI order and verify (M2). */
class PlanController extends Controller
{
    public function __construct(private CarpoolPlanService $plans)
    {
    }

    public function index(Request $request): JsonResponse
    {
        $driver = Driver::query()->where('user_id', $request->user()->id)->first();
        if (! $driver || ! $driver->isCarpool() || ! $driver->city_id) {
            return response()->json(['data' => []]);
        }

        return response()->json(['data' => $this->plans->plansFor($driver)->map(fn ($p) => $this->shapePlan($p))->values()]);
    }

    public function current(Request $request): JsonResponse
    {
        $user = $request->user();
        $active = $this->plans->activePlan($user);
        $queued = $this->plans->queuedPlan($user);
        $warnDays = (int) config('carpool.plan_warning_days', 3);

        return response()->json([
            'plan' => $active ? $this->shapeSub($active) : null,
            'next_plan' => $queued ? $this->shapeSub($queued) : null,
            'can_publish' => $active !== null,
            'ending_soon' => $active !== null && $queued === null && now()->addDays($warnDays)->greaterThanOrEqualTo($active->expires_at),
        ]);
    }

    public function createOrder(Request $request): JsonResponse
    {
        $data = $request->validate(['plan_id' => ['required', 'integer', 'exists:subscription_plans,id']]);

        return response()->json($this->plans->createOrder($request->user(), SubscriptionPlan::findOrFail($data['plan_id'])));
    }

    public function verify(Request $request): JsonResponse
    {
        $data = $request->validate([
            'plan_id' => ['required', 'integer', 'exists:subscription_plans,id'],
            'razorpay_order_id' => ['required', 'string', 'max:64'],
            'razorpay_payment_id' => ['required', 'string', 'max:64'],
            'razorpay_signature' => ['required', 'string', 'max:255'],
        ]);

        $result = $this->plans->verifyAndActivate(
            $request->user(),
            SubscriptionPlan::findOrFail($data['plan_id']),
            $data['razorpay_order_id'],
            $data['razorpay_payment_id'],
            $data['razorpay_signature'],
        );

        return response()->json([
            'queued' => $result['queued'],
            'subscription' => $this->shapeSub($result['subscription']),
            'message' => $result['queued'] ? 'Plan bought. It starts when your current plan ends.' : 'Plan active.',
        ], 201);
    }

    private function shapePlan(SubscriptionPlan $p): array
    {
        return [
            'id' => $p->id,
            'title' => $p->title,
            'subtitle' => $p->subtitle,
            'amount' => (float) $p->amount,
            'days_count' => $p->days_count,
            'terms' => $p->terms,
        ];
    }

    private function shapeSub(DriverSubscription $s): array
    {
        $s->loadMissing('plan');

        return [
            'id' => $s->id,
            'title' => $s->plan?->title ?? 'Carpool plan',
            'amount_paid' => (float) $s->amount_paid,
            'days_count' => $s->days_count,
            'starts_at' => $s->starts_at?->toIso8601String(),
            'expires_at' => $s->expires_at?->toIso8601String(),
            'is_queued' => (bool) $s->is_queued,
        ];
    }
}
