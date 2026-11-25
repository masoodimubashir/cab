<?php

namespace App\Services\Carpool;

use App\Models\Carpool\CarpoolListing;
use App\Models\Carpool\CarpoolReport;
use App\Models\Driver;
use App\Models\User;
use App\Services\ManagerScope;
use Illuminate\Database\Eloquent\Builder;

/**
 * Keeps a city-limited manager inside their cities on every carpool admin screen (Admin-Audit.md D-01).
 * Super admins and all-cities managers see everything (ManagerScope::cityIds() returns null for them).
 * Out-of-scope single records answer 404, like a record that doesn't exist.
 */
class CarpoolAdminScope
{
    /** @return array<int>|null */
    public static function cities(): ?array
    {
        return ManagerScope::cityIds();
    }

    public static function listings(Builder $q): Builder
    {
        $ids = self::cities();

        return $ids === null ? $q : $q->whereIn('city_id', $ids);
    }

    /** A report belongs to the carpool's city; a report with no carpool to the reported person's city. */
    public static function reports(Builder $q): Builder
    {
        $ids = self::cities();
        if ($ids === null) {
            return $q;
        }

        return $q->where(fn ($w) => $w->whereHas('listing', fn ($l) => $l->whereIn('city_id', $ids))
            ->orWhere(fn ($n) => $n->whereNull('listing_id')->whereHas('reported.driver', fn ($d) => $d->whereIn('city_id', $ids)))
            ->orWhere(fn ($n) => $n->whereNull('listing_id')->whereIn('reported_user_id', self::ridersIn($ids))));
    }

    /** People who are carpool drivers in, or riders on carpools in, the manager's cities. */
    public static function people(Builder $q): Builder
    {
        $ids = self::cities();
        if ($ids === null) {
            return $q;
        }

        return $q->where(fn ($w) => $w->whereHas('driver', fn ($d) => $d->where('driver_type', Driver::TYPE_CARPOOL)->whereIn('city_id', $ids))
            ->orWhereIn('id', self::ridersIn($ids)));
    }

    /** Subquery: user ids of riders who asked to join a carpool in these cities. */
    private static function ridersIn(array $ids): \Illuminate\Database\Query\Builder
    {
        return \Illuminate\Support\Facades\DB::table('carpool_requests')->join('carpool_listings', 'carpool_listings.id', '=', 'carpool_requests.listing_id')
            ->whereIn('carpool_listings.city_id', $ids)->select('carpool_requests.rider_id');
    }

    public static function assertCity(?int $cityId): void
    {
        $ids = self::cities();
        if ($ids !== null && ! in_array((int) $cityId, $ids, true)) {
            abort(404);
        }
    }

    public static function assertListing(?CarpoolListing $l): void
    {
        if (! $l) {
            abort(404);
        }
        self::assertCity($l->city_id);
    }

    public static function assertReport(CarpoolReport $r): void
    {
        if (self::cities() !== null && ! self::reports(CarpoolReport::query()->whereKey($r->id))->exists()) {
            abort(404);
        }
    }

    public static function assertPerson(User $u): void
    {
        if (self::cities() !== null && ! self::people(User::query()->whereKey($u->id))->exists()) {
            abort(404);
        }
    }
}
