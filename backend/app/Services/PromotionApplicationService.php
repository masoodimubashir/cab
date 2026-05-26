<?php

namespace App\Services;

use App\Models\CityWidePromotion;
use Carbon\Carbon;

/**
 * Picks the best applicable city-wide promotion for a booking.
 *
 * "Best" = the promo that produces the largest discount on the supplied
 * pre-tax subtotal. Ties break on the lowest id so the choice is stable
 * between repeated fare estimates for the same trip.
 *
 * Redemption caps (maximum_allowed, per_user_limit, per_day_limit) are
 * NOT enforced here yet — that requires a redemption tracking table which
 * will land in a follow-up.
 */
class PromotionApplicationService
{
    public function findBestForBooking(
        int $cityId,
        ?int $cityVehicleTypeId,
        float $pickupLat,
        float $pickupLng,
        float $dropLat,
        float $dropLng,
        float $subtotal,
        ?Carbon $asOf = null,
    ): ?CityWidePromotion {
        if ($subtotal <= 0) {
            return null;
        }

        $candidates = CityWidePromotion::query()
            ->where('city_id', $cityId)
            ->active($asOf)
            ->get();

        $best = null;
        $bestDiscount = 0.0;
        foreach ($candidates as $promo) {
            if (!$promo->appliesTo($cityVehicleTypeId, $pickupLat, $pickupLng, $dropLat, $dropLng)) {
                continue;
            }
            $discount = $promo->computeDiscount($subtotal);
            if ($discount <= 0) {
                continue;
            }
            $isBetter = $discount > $bestDiscount
                || ($discount === $bestDiscount && $best !== null && $promo->id < $best->id);
            if ($best === null || $isBetter) {
                $best = $promo;
                $bestDiscount = $discount;
            }
        }

        return $best;
    }
}
