<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Models\PromoCode;
use Illuminate\Http\Request;
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
