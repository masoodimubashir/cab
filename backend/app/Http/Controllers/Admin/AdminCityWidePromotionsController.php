<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Models\CityWidePromotion;
use Illuminate\Http\Request;

class AdminCityWidePromotionsController
{
    public function index(Request $request, City $city)
    {
        $q = CityWidePromotion::query()->where('city_id', $city->id);

        if ($request->has('is_active') && $request->query('is_active') !== '') {
            $q->where('is_active', $request->boolean('is_active'));
        }

        $rows = $q->orderByDesc('id')->get()->map(fn ($r) => $this->shape($r));

        return response()->json([
            'city_id' => $city->id,
            'data' => $rows,
        ]);
    }

    public function store(Request $request, City $city)
    {
        $data = $this->validatePayload($request, partial: false);
        $data['city_id'] = $city->id;
        $row = CityWidePromotion::query()->create($data);

        return response()->json([
            'promotion' => $this->shape($row->fresh()),
            'message' => 'Promotion created.',
        ], 201);
    }

    public function show(City $city, CityWidePromotion $promotion)
    {
        $this->guard($city, $promotion);
        return response()->json(['promotion' => $this->shape($promotion)]);
    }

    public function update(Request $request, City $city, CityWidePromotion $promotion)
    {
        $this->guard($city, $promotion);
        $data = $this->validatePayload($request, partial: true);
        $promotion->fill($data)->save();

        return response()->json([
            'promotion' => $this->shape($promotion->fresh()),
            'message' => 'Promotion updated.',
        ]);
    }

    public function destroy(City $city, CityWidePromotion $promotion)
    {
        $this->guard($city, $promotion);
        $promotion->delete();
        return response()->json(['message' => 'Promotion deleted.']);
    }

    private function guard(City $city, CityWidePromotion $promotion): void
    {
        abort_if($promotion->city_id !== $city->id, 404);
    }

    private function validatePayload(Request $request, bool $partial): array
    {
        $sometimes = $partial ? 'sometimes' : 'required';

        return $request->validate([
            'title' => [$sometimes, 'string', 'max:200'],
            'benefit_type' => ['sometimes', 'string', 'in:discount'],
            'promo_type' => [$sometimes, 'string', 'in:location_insensitive,location_sensitive,qr_code_booking'],

            'location_type' => ['nullable', 'string', 'in:pickup,drop'],
            'location_name' => ['nullable', 'string', 'max:255'],
            'latitude' => ['nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180'],
            'radius_meters' => ['nullable', 'integer', 'min:0', 'max:1000000'],

            'discount_type' => [$sometimes, 'string', 'in:percentage,flat'],
            'discount_value' => [$sometimes, 'numeric', 'min:0'],
            'discount_maximum' => ['nullable', 'numeric', 'min:0'],

            'start_date' => [$sometimes, 'date'],
            'end_date' => [$sometimes, 'date', 'after_or_equal:start_date'],

            'maximum_allowed' => ['nullable', 'integer', 'min:0'],
            'per_user_limit' => ['nullable', 'integer', 'min:0'],
            'per_day_limit' => ['nullable', 'integer', 'min:0'],

            'allowed_vehicle_type_ids' => ['nullable', 'array'],
            'allowed_vehicle_type_ids.*' => ['integer', 'exists:city_vehicle_types,id'],

            'terms_and_conditions' => ['nullable', 'string'],
            'is_active' => ['sometimes', 'boolean'],
        ]);
    }

    private function shape(CityWidePromotion $p): array
    {
        return [
            'id' => $p->id,
            'city_id' => $p->city_id,
            'title' => $p->title,
            'benefit_type' => $p->benefit_type,
            'promo_type' => $p->promo_type,
            'location_type' => $p->location_type,
            'location_name' => $p->location_name,
            'latitude' => $p->latitude !== null ? (float) $p->latitude : null,
            'longitude' => $p->longitude !== null ? (float) $p->longitude : null,
            'radius_meters' => $p->radius_meters !== null ? (int) $p->radius_meters : null,
            'discount_type' => $p->discount_type,
            'discount_value' => (float) $p->discount_value,
            'discount_maximum' => $p->discount_maximum !== null ? (float) $p->discount_maximum : null,
            'start_date' => optional($p->start_date)->toDateString(),
            'end_date' => optional($p->end_date)->toDateString(),
            'maximum_allowed' => $p->maximum_allowed,
            'per_user_limit' => $p->per_user_limit,
            'per_day_limit' => $p->per_day_limit,
            'allowed_vehicle_type_ids' => $p->allowed_vehicle_type_ids ?? [],
            'terms_and_conditions' => $p->terms_and_conditions,
            'is_active' => (bool) $p->is_active,
            'created_at' => optional($p->created_at)->toIso8601String(),
        ];
    }
}
