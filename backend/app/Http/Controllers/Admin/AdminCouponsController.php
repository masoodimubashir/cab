<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Models\Coupon;
use Illuminate\Http\Request;

class AdminCouponsController
{
    public function index(Request $request, City $city)
    {
        $q = Coupon::query()->where('city_id', $city->id);

        if ($request->has('is_active') && $request->query('is_active') !== '') {
            $q->where('is_active', $request->boolean('is_active'));
        }

        $rows = $q->orderByDesc('id')->get()->map(fn ($r) => $this->shape($r));

        return response()->json(['city_id' => $city->id, 'data' => $rows]);
    }

    public function store(Request $request, City $city)
    {
        $data = $this->validatePayload($request, partial: false);
        $data['city_id'] = $city->id;
        $row = Coupon::query()->create($data);

        return response()->json([
            'coupon' => $this->shape($row->fresh()),
            'message' => 'Coupon created.',
        ], 201);
    }

    public function show(City $city, Coupon $coupon)
    {
        $this->guard($city, $coupon);
        return response()->json(['coupon' => $this->shape($coupon)]);
    }

    public function update(Request $request, City $city, Coupon $coupon)
    {
        $this->guard($city, $coupon);
        $data = $this->validatePayload($request, partial: true);
        $coupon->fill($data)->save();

        return response()->json([
            'coupon' => $this->shape($coupon->fresh()),
            'message' => 'Coupon updated.',
        ]);
    }

    public function destroy(City $city, Coupon $coupon)
    {
        $this->guard($city, $coupon);
        $coupon->delete();
        return response()->json(['message' => 'Coupon deleted.']);
    }

    private function guard(City $city, Coupon $coupon): void
    {
        abort_if($coupon->city_id !== $city->id, 404);
    }

    private function validatePayload(Request $request, bool $partial): array
    {
        $sometimes = $partial ? 'sometimes' : 'required';

        return $request->validate([
            'title' => [$sometimes, 'string', 'max:200'],
            'subtitle' => ['nullable', 'string', 'max:200'],
            'benefit_type' => ['sometimes', 'string', 'in:discount'],
            'description' => ['nullable', 'string'],
            'promo_type' => [$sometimes, 'string', 'in:location_insensitive,pickup_based,drop_based'],

            'latitude' => ['nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180'],
            'radius_meters' => ['nullable', 'integer', 'min:0', 'max:1000000'],
            'location_name' => ['nullable', 'string', 'max:255'],

            'per_user_limit' => ['nullable', 'integer', 'min:0'],

            'discount_type' => [$sometimes, 'string', 'in:percentage,flat'],
            'discount_value' => [$sometimes, 'numeric', 'min:0'],
            'discount_maximum' => ['nullable', 'numeric', 'min:0'],

            'allowed_vehicle_type_ids' => ['nullable', 'array'],
            'allowed_vehicle_type_ids.*' => ['integer', 'exists:city_vehicle_types,id'],

            'is_active' => ['sometimes', 'boolean'],
        ]);
    }

    private function shape(Coupon $c): array
    {
        return [
            'id' => $c->id,
            'city_id' => $c->city_id,
            'title' => $c->title,
            'subtitle' => $c->subtitle,
            'benefit_type' => $c->benefit_type,
            'description' => $c->description,
            'promo_type' => $c->promo_type,
            'latitude' => $c->latitude !== null ? (float) $c->latitude : null,
            'longitude' => $c->longitude !== null ? (float) $c->longitude : null,
            'radius_meters' => $c->radius_meters !== null ? (int) $c->radius_meters : null,
            'location_name' => $c->location_name,
            'per_user_limit' => $c->per_user_limit,
            'discount_type' => $c->discount_type,
            'discount_value' => (float) $c->discount_value,
            'discount_maximum' => $c->discount_maximum !== null ? (float) $c->discount_maximum : null,
            'allowed_vehicle_type_ids' => $c->allowed_vehicle_type_ids ?? [],
            'is_active' => (bool) $c->is_active,
            'created_at' => optional($c->created_at)->toIso8601String(),
        ];
    }
}
