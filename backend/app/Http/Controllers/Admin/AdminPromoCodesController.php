<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Models\PromoCode;
use App\Models\PromoCodeAssignment;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;

class AdminPromoCodesController
{
    public function index(Request $request, City $city)
    {
        $q = PromoCode::query()->where('city_id', $city->id);

        if ($request->has('is_active') && $request->query('is_active') !== '') {
            $q->where('is_active', $request->boolean('is_active'));
        }

        $rows = $q->orderByDesc('id')->get()->map(fn ($r) => $this->shape($r));

        return response()->json(['city_id' => $city->id, 'data' => $rows]);
    }

    public function store(Request $request, City $city)
    {
        $data = $this->validatePayload($request, $city->id, partial: false);
        $data['city_id'] = $city->id;
        $row = PromoCode::query()->create($data);

        return response()->json([
            'promo_code' => $this->shape($row->fresh()),
            'message' => 'Promo code created.',
        ], 201);
    }

    public function show(City $city, PromoCode $promoCode)
    {
        $this->guard($city, $promoCode);
        return response()->json(['promo_code' => $this->shape($promoCode)]);
    }

    public function update(Request $request, City $city, PromoCode $promoCode)
    {
        $this->guard($city, $promoCode);
        $data = $this->validatePayload($request, $city->id, partial: true, currentId: $promoCode->id);
        $promoCode->fill($data)->save();

        return response()->json([
            'promo_code' => $this->shape($promoCode->fresh()),
            'message' => 'Promo code updated.',
        ]);
    }

    public function destroy(City $city, PromoCode $promoCode)
    {
        $this->guard($city, $promoCode);
        $promoCode->delete();
        return response()->json(['message' => 'Promo code deleted.']);
    }

    /** Paginated list of users this promo code has been issued to. */
    public function assignments(Request $request, City $city, PromoCode $promoCode)
    {
        $this->guard($city, $promoCode);

        $q = PromoCodeAssignment::query()
            ->where('promo_code_id', $promoCode->id)
            ->with(['user:id,name,phone,email']);

        if ($search = trim((string) $request->query('q', ''))) {
            $q->whereHas('user', function ($w) use ($search) {
                $w->where('name', 'like', '%' . $search . '%')
                  ->orWhere('phone', 'like', '%' . $search . '%')
                  ->orWhere('email', 'like', '%' . $search . '%');
            });
        }

        $perPage = min(100, max(1, (int) $request->query('per_page', 10)));
        $paginator = $q->orderByDesc('id')->paginate($perPage);

        return response()->json([
            'data' => $paginator->getCollection()->map(fn (PromoCodeAssignment $a) => [
                'id' => $a->id,
                'user' => $a->user ? [
                    'id' => $a->user->id,
                    'name' => $a->user->name,
                    'phone' => $a->user->phone,
                    'email' => $a->user->email,
                ] : null,
                'reason' => $a->reason,
                'push_message' => $a->push_message,
                'expires_at' => optional($a->expires_at)->toIso8601String(),
                'assigned_at' => optional($a->assigned_at)->toIso8601String(),
                'used_at' => optional($a->used_at)->toIso8601String(),
            ])->all(),
            'meta' => [
                'current_page' => $paginator->currentPage(),
                'last_page' => $paginator->lastPage(),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
            ],
        ]);
    }

    /**
     * Give this promo code to a list of customers — same shape as the
     * coupon give-to-users flow. Accepts mode=customers+user_ids[] OR
     * mode=csv+csv upload (single `user_id` column). Duplicates are
     * silently upserted via updateOrCreate.
     */
    public function give(Request $request, City $city, PromoCode $promoCode)
    {
        $this->guard($city, $promoCode);

        $data = $request->validate([
            'mode' => ['required', 'string', 'in:customers,csv'],
            'reason' => ['required', 'string', 'max:255'],
            'push_message' => ['nullable', 'string'],
            'expires_at' => ['nullable', 'date'],
            'user_ids' => ['nullable', 'array'],
            'user_ids.*' => ['integer', 'exists:users,id'],
            'csv' => ['nullable', 'file', 'mimes:csv,txt', 'max:5120'],
        ]);

        $userIds = [];
        if ($data['mode'] === 'customers') {
            $userIds = $data['user_ids'] ?? [];
        } else {
            if (! $request->hasFile('csv')) {
                return response()->json(['message' => 'CSV file is required for csv mode.'], 422);
            }
            $userIds = $this->parseUserIdsFromCsv($request->file('csv')->getRealPath());
        }

        if (empty($userIds)) {
            return response()->json(['message' => 'No users to assign the promo code to.'], 422);
        }

        $validUserIds = User::query()
            ->whereIn('id', $userIds)
            ->whereHas('roles', fn ($w) => $w->where('role', 'customer'))
            ->pluck('id')
            ->all();

        $assignedAt = now();
        $expiresAt = !empty($data['expires_at']) ? Carbon::parse($data['expires_at']) : null;
        $created = 0;
        foreach ($validUserIds as $uid) {
            PromoCodeAssignment::query()->updateOrCreate(
                ['promo_code_id' => $promoCode->id, 'user_id' => $uid],
                [
                    'reason' => $data['reason'],
                    'push_message' => $data['push_message'] ?? null,
                    'expires_at' => $expiresAt,
                    'assigned_at' => $assignedAt,
                    'assigned_by_admin_id' => $request->user()?->id,
                ],
            );
            $created++;
        }

        return response()->json([
            'assigned_count' => $created,
            'skipped_invalid' => count($userIds) - count($validUserIds),
            'message' => "Promo code issued to {$created} user(s).",
        ]);
    }

    private function parseUserIdsFromCsv(string $path): array
    {
        $ids = [];
        $handle = @fopen($path, 'r');
        if (!$handle) {
            return $ids;
        }
        $headers = null;
        while (($row = fgetcsv($handle)) !== false) {
            if ($row === [null] || empty(array_filter($row, fn ($v) => $v !== null && $v !== ''))) {
                continue;
            }
            if ($headers === null) {
                $headers = array_map(fn ($h) => strtolower(trim((string) $h)), $row);
                continue;
            }
            $assoc = @array_combine($headers, $row) ?: [];
            $raw = $assoc['user_id'] ?? $row[0] ?? null;
            $id = (int) trim((string) $raw);
            if ($id > 0) {
                $ids[] = $id;
            }
        }
        fclose($handle);
        return array_values(array_unique($ids));
    }

    private function guard(City $city, PromoCode $promoCode): void
    {
        abort_if($promoCode->city_id !== $city->id, 404);
    }

    private function validatePayload(Request $request, int $cityId, bool $partial, ?int $currentId = null): array
    {
        $sometimes = $partial ? 'sometimes' : 'required';

        $unique = Rule::unique('promo_codes', 'code')->where(fn ($q) => $q->where('city_id', $cityId));
        if ($currentId) {
            $unique = $unique->ignore($currentId);
        }

        return $request->validate([
            'code' => [$sometimes, 'string', 'max:80', $unique],
            'max_number' => ['nullable', 'integer', 'min:0'],
            'start_date' => [$sometimes, 'date'],
            'end_date' => [$sometimes, 'date', 'after_or_equal:start_date'],
            'validity_in_days' => ['nullable', 'integer', 'min:0', 'max:3650'],
            'bonus_type' => ['sometimes', 'string', 'in:cash'],
            'can_use_with_referral' => ['sometimes', 'boolean'],
            'amount' => [$sometimes, 'numeric', 'min:0'],
            'is_active' => ['sometimes', 'boolean'],
        ]);
    }

    private function shape(PromoCode $p): array
    {
        return [
            'id' => $p->id,
            'city_id' => $p->city_id,
            'code' => $p->code,
            'max_number' => $p->max_number,
            'start_date' => optional($p->start_date)->toDateString(),
            'end_date' => optional($p->end_date)->toDateString(),
            'validity_in_days' => $p->validity_in_days,
            'bonus_type' => $p->bonus_type,
            'can_use_with_referral' => (bool) $p->can_use_with_referral,
            'amount' => (float) $p->amount,
            'is_active' => (bool) $p->is_active,
            'created_at' => optional($p->created_at)->toIso8601String(),
        ];
    }
}
