<?php

namespace App\Services\Carpool;

use App\Models\Carpool\CarpoolListing;
use App\Models\City;
use App\Models\Driver;
use App\Models\DriverSubscription;
use App\Models\SubscriptionPlan;

/**
 * W2 (Admin-Audit.md A-11): what the shared Subscriptions and Cities screens must not delete because
 * carpool drivers have paid for it or still depend on it. Each method answers null when the delete is
 * fine, or the sentence to show the admin. Commercial plans and cities that carpool never touched are
 * always fine, so those screens behave as they did before.
 */
class CarpoolDeleteGuard
{
    /** A carpool plan that drivers have bought is turned off, never deleted (they would lose what they paid for). */
    public static function planBlocker(SubscriptionPlan $plan): ?string
    {
        if ($plan->audience !== SubscriptionPlan::AUDIENCE_CARPOOL) {
            return null;
        }
        $bought = DriverSubscription::query()->where('subscription_plan_id', $plan->id)->count();
        if ($bought === 0) {
            return null;
        }

        return "Drivers have bought this carpool plan ({$bought}), so it can't be deleted. Turn it off instead; drivers who bought it keep it.";
    }

    /** A city that still has bought carpool plans, carpool drivers or upcoming carpools is not deleted. */
    public static function cityBlocker(City $city): ?string
    {
        $parts = [];
        $planIds = SubscriptionPlan::query()->carpool()->where('city_id', $city->id)->pluck('id');
        $bought = $planIds->isEmpty() ? 0 : DriverSubscription::query()->whereIn('subscription_plan_id', $planIds)->count();
        if ($bought > 0) {
            $parts[] = $planIds->count() . ' carpool plan' . ($planIds->count() === 1 ? '' : 's') . ' that drivers bought';
        }
        $drivers = Driver::query()->carpool()->where('city_id', $city->id)->count();
        if ($drivers > 0) {
            $parts[] = $drivers . ' carpool driver' . ($drivers === 1 ? '' : 's');
        }
        $upcoming = CarpoolListing::query()->where('city_id', $city->id)->whereIn('status', CarpoolListing::LIVE)->count();
        if ($upcoming > 0) {
            $parts[] = $upcoming . ' upcoming carpool' . ($upcoming === 1 ? '' : 's');
        }
        if (! $parts) {
            return null;
        }

        return "This city can't be deleted: it still has " . implode(', ', $parts) . '. Move or finish them first.';
    }
}
