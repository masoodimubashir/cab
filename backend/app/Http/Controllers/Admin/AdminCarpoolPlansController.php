<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Models\DriverSubscription;
use App\Models\SubscriptionPlan;
use App\Services\Carpool\CarpoolAdminLog;
use App\Services\Carpool\CarpoolAdminScope;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Carpool > Plans (Admin-Audit.md S-01): carpool plans only, managed in the carpool section.
 * Same rows as the shared Subscriptions screen (`subscription_plans`, audience carpool), with the
 * carpool rules forced (days meter, one-time amount, no commission, no vehicle type) and safer edits:
 * the audience and city never change, a plan someone bought can't be deleted (turn it off instead),
 * "apply to all plans with this title" edits a group in one go, and every change is logged.
 * Payments are not touched here (on hold, Dev-Plan section 8).
 */
class AdminCarpoolPlansController
{
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'city_id' => ['sometimes', 'nullable', 'integer'],
            'status' => ['sometimes', 'nullable', 'in:all,on,off'],
            'search' => ['sometimes', 'nullable', 'string', 'max:80'],
        ]);
        $q = SubscriptionPlan::query()->carpool()->with('city:id,name');
        CarpoolAdminScope::listings($q);
        if (! empty($data['city_id'])) {
            $q->where('city_id', $data['city_id']);
        }
        if (($data['status'] ?? 'all') !== 'all') {
            $q->where('is_active', $data['status'] === 'on');
        }
        if (! empty($data['search'])) {
            $q->where('title', 'like', '%' . trim($data['search']) . '%');
        }
        $plans = $q->orderBy('title')->orderBy('city_id')->get();

        $ids = $plans->pluck('id');
        $bought = DriverSubscription::query()->whereIn('subscription_plan_id', $ids)->groupBy('subscription_plan_id')
            ->selectRaw('subscription_plan_id, count(*) n')->pluck('n', 'subscription_plan_id');
        $running = DriverSubscription::query()->whereIn('subscription_plan_id', $ids)
            ->where('status', DriverSubscription::STATUS_ACTIVE)->where('is_queued', false)->where('expires_at', '>', now())
            ->groupBy('subscription_plan_id')->selectRaw('subscription_plan_id, count(*) n')->pluck('n', 'subscription_plan_id');
        $waiting = DriverSubscription::query()->whereIn('subscription_plan_id', $ids)
            ->where('status', DriverSubscription::STATUS_ACTIVE)->where('is_queued', true)
            ->groupBy('subscription_plan_id')->selectRaw('subscription_plan_id, count(*) n')->pluck('n', 'subscription_plan_id');
        $groupSize = $plans->countBy('title');

        return response()->json([
            'data' => $plans->map(fn (SubscriptionPlan $p) => $this->row($p) + [
                'bought' => (int) ($bought[$p->id] ?? 0),
                'running' => (int) ($running[$p->id] ?? 0),
                'waiting' => (int) ($waiting[$p->id] ?? 0),
                'group_size' => (int) ($groupSize[$p->title] ?? 1),
            ])->values(),
            'cities' => $this->scopedCities(),
            'can_edit' => $this->canEdit($request),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $this->assertCanEdit($request);
        $data = $request->validate($this->rules(false) + [
            'city_ids' => ['required', 'array', 'min:1'],
            'city_ids.*' => ['required'],
        ]);
        $allowed = collect($this->scopedCities())->pluck('id')->all();
        $raw = $data['city_ids'];
        $cityIds = in_array('all', $raw, true)
            ? collect($this->scopedCities())->where('is_active', true)->pluck('id')->all()
            : array_values(array_unique(array_map('intval', $raw)));
        if (! $cityIds || array_diff($cityIds, $allowed)) {
            abort(422, 'Choose cities you manage.');
        }

        // One plan of a given name per city: two identical plans would show twice in the driver app.
        $clash = SubscriptionPlan::query()->carpool()->where('title', trim($data['title']))->whereIn('city_id', $cityIds)->with('city:id,name')->get();
        if ($clash->isNotEmpty()) {
            abort(422, 'A plan called "' . trim($data['title']) . '" already exists in ' . $clash->pluck('city.name')->filter()->implode(', ') . '. Pick another name or edit that plan.');
        }

        $created = DB::transaction(function () use ($data, $cityIds) {
            $rows = [];
            foreach ($cityIds as $cityId) {
                $rows[] = SubscriptionPlan::query()->create($this->carpoolFields($data) + ['city_id' => $cityId]);
            }

            return $rows;
        });
        CarpoolAdminLog::record('plan_create', 'plan', $created[0]->id, [
            'after' => ['title' => $data['title'], 'amount' => (float) $data['amount'], 'days' => (int) $data['days_count'], 'plan_ids' => array_map(fn ($p) => $p->id, $created)],
        ]);

        return response()->json([
            'message' => count($created) > 1 ? count($created) . ' plans created, one per city.' : 'Plan created.',
            'data' => array_map(fn ($p) => $this->row($p->fresh('city')), $created),
        ], 201);
    }

    public function update(Request $request, SubscriptionPlan $plan): JsonResponse
    {
        $this->assertCarpool($plan);
        $this->assertCanEdit($request);
        $data = $request->validate($this->rules(true) + ['apply_to_group' => ['sometimes', 'boolean']]);
        $targets = $this->targets($plan, (bool) ($data['apply_to_group'] ?? false));
        $fields = array_intersect_key($this->carpoolFields($data, true), $data + ['meter_type' => 1, 'pricing_model' => 1, 'commission_percent' => 1]);

        $before = $plan->only(['title', 'subtitle', 'amount', 'days_count', 'terms', 'available_from', 'available_to', 'is_active']);
        DB::transaction(function () use ($targets, $fields) {
            foreach ($targets as $t) {
                $t->fill($fields)->save();
            }
        });
        CarpoolAdminLog::record('plan_update', 'plan', $plan->id, [
            'before' => $before, 'after' => array_intersect_key($fields, $before) + ['plan_ids' => $targets->pluck('id')->all()],
        ]);

        return response()->json(['message' => $targets->count() > 1 ? $targets->count() . ' plans updated.' : 'Plan updated.']);
    }

    public function setActive(Request $request, SubscriptionPlan $plan): JsonResponse
    {
        $this->assertCarpool($plan);
        $this->assertCanEdit($request);
        $data = $request->validate(['active' => ['required', 'boolean'], 'apply_to_group' => ['sometimes', 'boolean']]);
        $targets = $this->targets($plan, (bool) ($data['apply_to_group'] ?? false));
        SubscriptionPlan::query()->whereIn('id', $targets->pluck('id'))->update(['is_active' => $data['active']]);
        CarpoolAdminLog::record('plan_active', 'plan', $plan->id, ['after' => ['active' => (bool) $data['active'], 'plan_ids' => $targets->pluck('id')->all()]]);

        return response()->json(['message' => $data['active'] ? 'Plan is on sale.' : 'Plan is off sale. Drivers who bought it keep it.']);
    }

    /** Only a plan nobody has bought can be deleted; otherwise drivers would lose what they paid for (A-11). */
    public function destroy(Request $request, SubscriptionPlan $plan): JsonResponse
    {
        $this->assertCarpool($plan);
        $this->assertCanEdit($request);
        if (DriverSubscription::query()->where('subscription_plan_id', $plan->id)->exists()) {
            return response()->json(['message' => 'Drivers have bought this plan, so it can\'t be deleted. Turn it off instead.'], 409);
        }
        CarpoolAdminLog::record('plan_delete', 'plan', $plan->id, ['before' => $plan->only(['title', 'amount', 'days_count', 'city_id'])]);
        $plan->delete();

        return response()->json(['message' => 'Plan deleted.']);
    }

    // ---- Internals ----

    private function rules(bool $partial): array
    {
        $req = $partial ? 'sometimes' : 'required';

        return [
            'title' => [$req, 'string', 'max:120'],
            'subtitle' => ['sometimes', 'nullable', 'string', 'max:191'],
            'amount' => [$req, 'numeric', 'min:1', 'max:100000'],
            'days_count' => [$req, 'integer', 'min:1', 'max:365'],
            'terms' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'available_from' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'available_to' => ['sometimes', 'nullable', 'date_format:Y-m-d', 'after_or_equal:available_from'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }

    /** The carpool rules every carpool plan follows, plus the fields the admin sent. */
    private function carpoolFields(array $data, bool $partial = false): array
    {
        $out = array_intersect_key($data, array_flip(['title', 'subtitle', 'amount', 'days_count', 'terms', 'available_from', 'available_to', 'is_active']));

        return $out + [
            'audience' => SubscriptionPlan::AUDIENCE_CARPOOL,
            'pricing_model' => SubscriptionPlan::MODEL_SUBSCRIPTION,
            'meter_type' => SubscriptionPlan::METER_DAYS,
            'commission_percent' => 0,
            'vehicle_type_id' => null,
        ] + ($partial ? [] : ['is_active' => true]);
    }

    /** The plan itself, or every carpool plan with the same title in the manager's cities. */
    private function targets(SubscriptionPlan $plan, bool $group)
    {
        if (! $group) {
            return collect([$plan]);
        }
        $q = SubscriptionPlan::query()->carpool()->where('title', $plan->title);

        return CarpoolAdminScope::listings($q)->get();
    }

    private function row(SubscriptionPlan $p): array
    {
        return [
            'id' => $p->id,
            'title' => $p->title,
            'subtitle' => $p->subtitle,
            'amount' => (float) $p->amount,
            'days_count' => (int) $p->days_count,
            'terms' => $p->terms,
            'city_id' => $p->city_id,
            'city' => $p->city?->name,
            'available_from' => $p->available_from?->toDateString(),
            'available_to' => $p->available_to?->toDateString(),
            'is_active' => (bool) $p->is_active,
            'on_sale_now' => (bool) $p->is_active && $p->isAvailableNow(),
            'created_at' => $p->created_at?->toIso8601String(),
        ];
    }

    private function scopedCities(): array
    {
        $ids = CarpoolAdminScope::cities();

        return City::query()->when($ids !== null, fn ($q) => $q->whereIn('id', $ids))->orderBy('name')
            ->get(['id', 'name', 'is_active'])->map(fn ($c) => ['id' => $c->id, 'name' => $c->name, 'is_active' => (bool) $c->is_active])->all();
    }

    private function assertCarpool(SubscriptionPlan $plan): void
    {
        if ($plan->audience !== SubscriptionPlan::AUDIENCE_CARPOOL) {
            abort(404);
        }
        CarpoolAdminScope::assertCity($plan->city_id);
    }

    private function canEdit(Request $request): bool
    {
        $u = $request->user();

        return (bool) ($u?->hasPermission('carpool_settings') || $u?->hasPermission('subscriptions'));
    }

    private function assertCanEdit(Request $request): void
    {
        if (! $this->canEdit($request)) {
            abort(403, 'You can view plans but not change them.');
        }
    }
}
