<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Models\DriverSubscription;
use App\Models\SubscriptionPlan;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * CRUD for driver subscription plans.
 * Supports both city-scoped and global endpoints with multi-city / multi-vehicle support.
 */
class AdminSubscriptionsController
{
    /** Global index across all cities or filtered by city_id / vehicle_type_id */
    public function globalIndex(Request $request)
    {
        $q = SubscriptionPlan::query()
            ->with(['city', 'vehicleType'])
            ->withCount(['driverSubscriptions as active_subscribers_count' => function ($w) {
                $w->where('status', DriverSubscription::STATUS_ACTIVE)->where('is_queued', false);
            }]);

        if ($cityId = $request->query('city_id')) {
            if ($cityId !== 'all') {
                $q->where('city_id', (int) $cityId);
            }
        }

        if ($vehicleTypeId = $request->query('vehicle_type_id')) {
            if ($vehicleTypeId !== 'all') {
                if ($vehicleTypeId === 'null') {
                    $q->whereNull('vehicle_type_id');
                } else {
                    $q->where('vehicle_type_id', (int) $vehicleTypeId);
                }
            }
        }

        if ($request->has('is_active') && $request->query('is_active') !== '') {
            $q->where('is_active', $request->boolean('is_active'));
        }

        if ($meter = $request->query('meter_type')) {
            $q->where('meter_type', $meter);
        }

        if (($model = $request->query('pricing_model')) && in_array($model, SubscriptionPlan::PRICING_MODELS, true)) {
            $q->where('pricing_model', $model);
        }

        if ($search = trim((string) $request->query('q', ''))) {
            $q->where(function ($w) use ($search) {
                $w->where('title', 'like', '%' . $search . '%')
                  ->orWhere('subtitle', 'like', '%' . $search . '%');
            });
        }

        $rows = $q->orderByDesc('id')->limit(500)->get()
            ->map(fn (SubscriptionPlan $p) => $this->shape($p));

        return response()->json(['data' => $rows]);
    }

    /** Global batch store — allows creating a plan for all/multiple cities and all/multiple vehicle types */
    public function globalStore(Request $request)
    {
        $data = $this->validatePayload($request, partial: false);

        // Resolve cities
        $cityIdsRaw = $request->input('city_ids', []);
        if (! is_array($cityIdsRaw)) {
            $cityIdsRaw = [$cityIdsRaw];
        }
        if (empty($cityIdsRaw) || in_array('all', $cityIdsRaw, true)) {
            $cityIds = City::query()->pluck('id')->all();
        } else {
            $cityIds = array_map('intval', array_filter($cityIdsRaw, fn ($v) => $v !== null && $v !== ''));
        }

        if (empty($cityIds)) {
            abort(422, 'At least one valid city must be selected.');
        }

        // Resolve vehicle types
        $vehicleTypeIdsRaw = $request->input('vehicle_type_ids', []);
        if (! is_array($vehicleTypeIdsRaw)) {
            $vehicleTypeIdsRaw = [$vehicleTypeIdsRaw];
        }
        if (empty($vehicleTypeIdsRaw) || in_array('all', $vehicleTypeIdsRaw, true)) {
            $vehicleTypeIds = [null];
        } else {
            $vehicleTypeIds = array_map(fn ($v) => ($v === null || $v === '' || $v === 'null') ? null : (int) $v, $vehicleTypeIdsRaw);
        }

        $createdPlans = [];
        DB::transaction(function () use ($data, $cityIds, $vehicleTypeIds, &$createdPlans) {
            foreach ($cityIds as $cityId) {
                foreach ($vehicleTypeIds as $vtId) {
                    $payload = array_merge($data, [
                        'city_id' => $cityId,
                        'vehicle_type_id' => $vtId,
                    ]);
                    $row = SubscriptionPlan::query()->create($payload);
                    $createdPlans[] = $this->shape($row->fresh(['city', 'vehicleType']));
                }
            }
        });

        return response()->json([
            'plans' => $createdPlans,
            'plan' => $createdPlans[0] ?? null,
            'message' => count($createdPlans) > 1
                ? count($createdPlans) . ' subscription plans created across cities/vehicles.'
                : 'Subscription plan created.',
        ], 201);
    }

    public function globalShow(SubscriptionPlan $plan)
    {
        return response()->json(['plan' => $this->shape($plan->load(['city', 'vehicleType']))]);
    }

    public function globalUpdate(Request $request, SubscriptionPlan $plan)
    {
        $data = $this->validatePayload($request, partial: true, plan: $plan);

        if ($request->has('city_id')) {
            $data['city_id'] = $request->input('city_id');
        }
        if ($request->has('vehicle_type_id')) {
            $data['vehicle_type_id'] = $request->input('vehicle_type_id');
        }

        $plan->fill($data)->save();

        return response()->json([
            'plan' => $this->shape($plan->fresh(['city', 'vehicleType'])),
            'message' => 'Subscription plan updated.',
        ]);
    }

    public function globalDestroy(SubscriptionPlan $plan)
    {
        $plan->delete();
        return response()->json(['message' => 'Subscription plan deleted.']);
    }

    // ── City-scoped legacy routes (backwards compatibility) ───────────
    public function index(Request $request, City $city)
    {
        $request->merge(['city_id' => $city->id]);
        return $this->globalIndex($request);
    }

    public function store(Request $request, City $city)
    {
        $request->merge(['city_ids' => [$city->id]]);
        return $this->globalStore($request);
    }

    public function show(City $city, SubscriptionPlan $plan)
    {
        $this->guard($city, $plan);
        return $this->globalShow($plan);
    }

    public function update(Request $request, City $city, SubscriptionPlan $plan)
    {
        $this->guard($city, $plan);
        return $this->globalUpdate($request, $plan);
    }

    public function destroy(City $city, SubscriptionPlan $plan)
    {
        $this->guard($city, $plan);
        return $this->globalDestroy($plan);
    }

    private function guard(City $city, SubscriptionPlan $plan): void
    {
        abort_if($plan->city_id !== $city->id, 404);
    }

    private function validatePayload(Request $request, bool $partial, ?SubscriptionPlan $plan = null): array
    {
        $sometimes = $partial ? 'sometimes' : 'required';

        $data = $request->validate([
            'title' => [$sometimes, 'string', 'max:191'],
            'subtitle' => ['nullable', 'string', 'max:191'],
            'amount' => [$sometimes, 'numeric', 'min:0', 'max:1000000'],
            'commission_percent' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'pricing_model' => ['sometimes', Rule::in(SubscriptionPlan::PRICING_MODELS)],
            'meter_type' => [$sometimes, Rule::in(SubscriptionPlan::METER_TYPES)],
            'rides_count' => ['nullable', 'integer', 'min:1', 'max:100000'],
            'days_count' => ['nullable', 'integer', 'min:1', 'max:3650'],
            'earnings_threshold' => ['nullable', 'numeric', 'min:1', 'max:100000000'],
            'vehicle_type_id' => ['nullable'],
            'terms' => ['nullable', 'string', 'max:5000'],
            'available_from' => ['nullable', 'date'],
            'available_to' => ['nullable', 'date', 'after_or_equal:available_from'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        $model = $data['pricing_model']
            ?? $plan?->pricing_model
            ?? SubscriptionPlan::MODEL_SUBSCRIPTION;
        $data['pricing_model'] = $model;

        $hasAmount = array_key_exists('amount', $data);
        $hasCommission = array_key_exists('commission_percent', $data);
        $amount = $hasAmount ? (float) $data['amount'] : (float) ($plan?->amount ?? 0);
        $commission = $hasCommission ? (float) ($data['commission_percent'] ?? 0) : (float) ($plan?->commission_percent ?? 0);

        if ($model === SubscriptionPlan::MODEL_SUBSCRIPTION) {
            $data['commission_percent'] = 0;
            $commission = 0.0;
        } elseif ($model === SubscriptionPlan::MODEL_COMMISSION) {
            $data['amount'] = 0;
            $amount = 0.0;
        }

        $modelGiven = array_key_exists('pricing_model', $request->all());
        $checkRequired = ! $partial || $modelGiven;
        $needsAmount = in_array($model, [SubscriptionPlan::MODEL_SUBSCRIPTION, SubscriptionPlan::MODEL_HYBRID], true);
        $needsCommission = in_array($model, [SubscriptionPlan::MODEL_COMMISSION, SubscriptionPlan::MODEL_HYBRID], true);

        if ($needsAmount && ($checkRequired || $hasAmount) && $amount <= 0) {
            abort(422, $model === SubscriptionPlan::MODEL_HYBRID
                ? 'A hybrid plan needs a one-time amount greater than zero.'
                : 'A subscription plan needs a one-time amount greater than zero.');
        }
        if ($needsCommission && ($checkRequired || $hasCommission) && $commission <= 0) {
            abort(422, $model === SubscriptionPlan::MODEL_HYBRID
                ? 'A hybrid plan needs a commission percentage greater than zero.'
                : 'A commission plan needs a commission percentage greater than zero.');
        }

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
            'city_name' => $p->city?->name ?? 'All cities',
            'vehicle_type_id' => $p->vehicle_type_id,
            'vehicle_type_name' => $p->vehicleType?->name,
            'title' => $p->title,
            'subtitle' => $p->subtitle,
            'amount' => (float) $p->amount,
            'commission_percent' => (float) $p->commission_percent,
            'pricing_model' => $p->pricing_model,
            'meter_type' => $p->meter_type,
            'rides_count' => $p->rides_count,
            'days_count' => $p->days_count,
            'earnings_threshold' => $p->earnings_threshold !== null ? (float) $p->earnings_threshold : null,
            'terms' => $p->terms,
            'available_from' => optional($p->available_from)->toDateString(),
            'available_to' => optional($p->available_to)->toDateString(),
            'is_active' => (bool) $p->is_active,
            'active_subscribers_count' => (int) ($p->active_subscribers_count ?? 0),
            'created_at' => optional($p->created_at)->toIso8601String(),
        ];
    }
}
