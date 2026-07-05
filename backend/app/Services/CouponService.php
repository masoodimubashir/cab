<?php

namespace App\Services;

use App\Models\CityVehicleType;
use App\Models\CouponAssignment;
use Illuminate\Support\Carbon;

class CouponService
{
    /**
     * Resolve a customer-typed coupon title against assignments for the user
     * and compute the discount it would apply to `$baseAmount` (the trip's
     * final fare today; could be subtotal in other flows).
     *
     * Returns:
     *   ['ok' => true,  'assignment' => CouponAssignment, 'discount' => float, 'final_amount' => float]
     *   ['ok' => false, 'error' => string]
     */
    public function resolveForUser(
        ?string $code,
        int $userId,
        int $cityId,
        float $baseAmount,
        ?int $cityVehicleTypeId = null,
        ?float $pickupLat = null,
        ?float $pickupLng = null,
        ?float $dropLat = null,
        ?float $dropLng = null,
    ): array {
        $code = trim((string) $code);
        if ($code === '') {
            return ['ok' => false, 'error' => 'Enter a coupon.'];
        }
        if ($userId <= 0) {
            return ['ok' => false, 'error' => 'Sign in to use a coupon.'];
        }
        if ($baseAmount <= 0) {
            return ['ok' => false, 'error' => 'Nothing to discount.'];
        }

        $now = Carbon::now();
        $assignment = CouponAssignment::query()
            ->join('coupons', 'coupons.id', '=', 'coupon_assignments.coupon_id')
            ->where('coupon_assignments.user_id', $userId)
            ->whereNull('coupon_assignments.used_at')
            ->where(function ($q) use ($now) {
                $q->whereNull('coupon_assignments.expires_at')
                  ->orWhere('coupon_assignments.expires_at', '>=', $now);
            })
            ->where('coupons.city_id', $cityId)
            ->where('coupons.is_active', true)
            ->whereRaw('LOWER(coupons.title) = ?', [mb_strtolower($code)])
            ->select('coupon_assignments.*')
            ->with('coupon')
            ->first();

        if (!$assignment || !$assignment->coupon) {
            return ['ok' => false, 'error' => 'No matching coupon assigned to you.'];
        }

        $coupon = $assignment->coupon;
        $tripVehicle = $cityVehicleTypeId ? CityVehicleType::query()->find($cityVehicleTypeId) : null;
        $tripFamily = $this->normalizeFamilyName($tripVehicle?->display_name);

        $allowedFamilies = is_array($coupon->allowed_vehicle_display_names)
            ? array_values(array_unique(array_filter(array_map(
                fn ($name) => $this->normalizeFamilyName((string) $name),
                $coupon->allowed_vehicle_display_names,
            ))))
            : [];
        if ($allowedFamilies) {
            if ($tripFamily === null || !in_array($tripFamily, $allowedFamilies, true)) {
                return ['ok' => false, 'error' => 'This coupon does not apply to the selected vehicle.'];
            }
        } else {
            $allowedVehicleIds = is_array($coupon->allowed_vehicle_type_ids)
                ? array_map('intval', $coupon->allowed_vehicle_type_ids)
                : [];
            if ($allowedVehicleIds && (!$cityVehicleTypeId || !in_array((int) $cityVehicleTypeId, $allowedVehicleIds, true))) {
                return ['ok' => false, 'error' => 'This coupon does not apply to the selected vehicle.'];
            }
        }

        if ($coupon->promo_type === 'location_sensitive') {
            if ($coupon->latitude === null || $coupon->longitude === null || !$coupon->radius_meters) {
                return ['ok' => false, 'error' => 'This coupon is misconfigured.'];
            }
            $useDrop = $coupon->location_type === 'drop';
            $lat = $useDrop ? $dropLat : $pickupLat;
            $lng = $useDrop ? $dropLng : $pickupLng;
            if ($lat === null || $lng === null) {
                return ['ok' => false, 'error' => 'Location required to validate this coupon.'];
            }
            $distanceM = $this->haversineMeters(
                (float) $coupon->latitude,
                (float) $coupon->longitude,
                $lat,
                $lng,
            );
            if ($distanceM > (float) $coupon->radius_meters) {
                $where = $coupon->location_name ?? 'a specific area';
                return [
                    'ok' => false,
                    'error' => $useDrop
                        ? "This coupon only applies to drops near {$where}."
                        : "This coupon only applies to pickups near {$where}.",
                ];
            }
        }

        $rawDiscount = $coupon->discount_type === 'percentage'
            ? $baseAmount * ((float) $coupon->discount_value / 100.0)
            : (float) $coupon->discount_value;

        if ($coupon->discount_maximum !== null) {
            $rawDiscount = min($rawDiscount, (float) $coupon->discount_maximum);
        }
        $discount = round(min($rawDiscount, $baseAmount), 2);
        if ($discount <= 0) {
            return ['ok' => false, 'error' => 'This coupon would not save you anything on this trip.'];
        }

        return [
            'ok' => true,
            'assignment' => $assignment,
            'discount' => $discount,
            'final_amount' => round(max(0.0, $baseAmount - $discount), 2),
        ];
    }

    private function normalizeFamilyName(?string $name): ?string
    {
        $name = trim((string) $name);
        return $name === '' ? null : mb_strtolower(preg_replace('/\s+/', ' ', $name));
    }

    private function haversineMeters(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $earthM = 6371000.0;
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) ** 2
            + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;
        return $earthM * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }
}
