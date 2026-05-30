<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Models\DriverSubscription;
use App\Models\SubscriptionPlan;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * CRUD for driver subscription plans within a city. Mirrors the other
 * city-scoped admin modules (promotions, coupons): nested under
 * /admin/cities/{city}/subscription-plans and guarded by manager.city.
 */
class AdminSubscriptionsController
{
    public function index(Request $request, City $city)
    {
        $q = SubscriptionPlan::query()
            ->where('city_id', $city->id)
            ->with('vehicleType')
            ->withCount(['driverSubscriptions as active_subscribers_count' => function ($w) {
                $w->where('status', DriverSubscription::STATUS_ACTIVE);
            }]);

        if ($request->has('is_active') && $request->query('is_active') !== '') {
            $q->where('is_active', $request->boolean('is_active'));
        }

        if ($meter = $request->query('meter_type')) {
            $q->where('meter_type', $meter);
        }

        if ($search = trim((string) $request->query('q', ''))) {
            $q->where(function ($w) use ($search) {
                $w->where('title', 'like', '%' . $search . '%')
                  ->orWhere('subtitle', 'like', '%' . $search . '%');
            });
        }

        $rows = $q->orderByDesc('id')->limit(500)->get()
            ->map(fn (SubscriptionPlan $p) => $this->shape($p));

        return response()->json(['city_id' => $city->id, 'data' => $rows]);
    }

    public function store(Request $request, City $city)
    {
        $data = $this->validatePayload($request, partial: false);
        $data['city_id'] = $city->id;
        $row = SubscriptionPlan::query()->create($data);

        return response()->json([
            'plan' => $this->shape($row->fresh('vehicleType')),
            'message' => 'Subscription plan created.',
        ], 201);
    }

    public function show(City $city, SubscriptionPlan $plan)
    {
        $this->guard($city, $plan);
        return response()->json(['plan' => $this->shape($plan->load('vehicleType'))]);
    }

    public function update(Request $request, City $city, SubscriptionPlan $plan)
    {
        $this->guard($city, $plan);
        $data = $this->validatePayload($request, partial: true);
        $plan->fill($data)->save();

        return response()->json([
            'plan' => $this->shape($plan->fresh('vehicleType')),
            'message' => 'Subscription plan updated.',
        ]);
    }

    public function destroy(City $city, SubscriptionPlan $plan)
    {
        $this->guard($city, $plan);
        $plan->delete();
        return response()->json(['message' => 'Subscription plan deleted.']);
    }

    private function guard(City $city, SubscriptionPlan $plan): void
    {
        abort_if($plan->city_id !== $city->id, 404);
    }

    private function validatePayload(Request $request, bool $partial): array
    {
        $sometimes = $partial ? 'sometimes' : 'required';

        $data = $request->validate([
            'title' => [$sometimes, 'string', 'max:191'],
            'subtitle' => ['nullable', 'string', 'max:191'],
            'amount' => [$sometimes, 'numeric', 'min:0', 'max:1000000'],
            'commission_percent' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'meter_type' => [$sometimes, Rule::in(SubscriptionPlan::METER_TYPES)],
            'rides_count' => ['nullable', 'integer', 'min:1', 'max:100000'],
            'days_count' => ['nullable', 'integer', 'min:1', 'max:3650'],
            'earnings_threshold' => ['nullable', 'numeric', 'min:1', 'max:100000000'],
            'plan_type' => ['nullable', Rule::in(SubscriptionPlan::PLAN_TYPES)],
            'vehicle_type_id' => ['nullable', 'integer', 'exists:vehicle_types,id'],
            'terms' => ['nullable', 'string', 'max:5000'],
            'available_from' => ['nullable', 'date'],
            'available_to' => ['nullable', 'date', 'after_or_equal:available_from'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        // The meter type dictates which limit field is required. Only enforce
        // when the meter type is actually present in this request.
        $meter = $data['meter_type'] ?? null;
        if ($meter === SubscriptionPlan::METER_RIDES && empty($data['rides_count'])) {
            abort(422, 'Number of rides is required for a ride-based plan.');
        }
        if ($meter === SubscriptionPlan::METER_DAYS && empty($data['days_count'])) {
            abort(422, 'Number of days is required for a duration-based plan.');
        }
        if ($meter === SubscriptionPlan::METER_EARNINGS && empty($data['earnings_threshold'])) {
            abort(422, 'Earnings threshold is required for an earnings-based plan.');
        }
        // A daily plan is always a single day.
        if ($meter === SubscriptionPlan::METER_DAILY) {
            $data['days_count'] = 1;
        }

        return $data;
    }

    private function shape(SubscriptionPlan $p): array
    {
        return [
            'id' => $p->id,
            'city_id' => $p->city_id,
            'vehicle_type_id' => $p->vehicle_type_id,
            'vehicle_type_name' => $p->vehicleType?->name,
            'title' => $p->title,
            'subtitle' => $p->subtitle,
            'amount' => (float) $p->amount,
            'commission_percent' => (float) $p->commission_percent,
            'meter_type' => $p->meter_type,
            'rides_count' => $p->rides_count,
            'days_count' => $p->days_count,
            'earnings_threshold' => $p->earnings_threshold !== null ? (float) $p->earnings_threshold : null,
            'plan_type' => $p->plan_type,
            'terms' => $p->terms,
            'available_from' => optional($p->available_from)->toDateString(),
            'available_to' => optional($p->available_to)->toDateString(),
            'is_active' => (bool) $p->is_active,
            'active_subscribers_count' => (int) ($p->active_subscribers_count ?? 0),
            'created_at' => optional($p->created_at)->toIso8601String(),
        ];
    }
}
