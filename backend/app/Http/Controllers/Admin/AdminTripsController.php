<?php

namespace App\Http\Controllers\Admin;

use App\Models\DriverLocation;
use App\Models\Trip;
use Illuminate\Http\Request;

class AdminTripsController
{
    /**
     * Lists trips for the admin ride-monitoring screens.
     *
     * Filters (all optional):
     *   - category:     ongoing | completed | cancelled | scheduled | missed | pending
     *                   (preset bundles of statuses; takes precedence over `status`)
     *   - status:       single status string (overridden by category)
     *   - date_from:    YYYY-MM-DD (filters trips.created_at >=)
     *   - date_to:      YYYY-MM-DD (filters trips.created_at <= end of day)
     *   - ride_type_id: int
     *   - phone:        substring matched against customer.phone OR driver.phone
     *
     * Without any filter, defaults to "ongoing" so the admin doesn't get a wall
     * of historical trips on first load.
     */
    public function index(Request $request)
    {
        $query = Trip::query()
            ->with(['customer', 'driver', 'rideType', 'pricingRule']);

        $category = $request->query('category');
        $status = $request->query('status');

        $this->applyCategoryFilter($query, $category, $status);

        if ($from = $request->query('date_from')) {
            $query->whereDate('trips.created_at', '>=', $from);
        }
        if ($to = $request->query('date_to')) {
            $query->whereDate('trips.created_at', '<=', $to);
        }

        if ($rideTypeId = $request->query('ride_type_id')) {
            $query->where('ride_type_id', (int) $rideTypeId);
        }

        if ($phone = trim((string) $request->query('phone'))) {
            // Strip non-digits so "+91 90000-12345" matches "9000012345" in DB.
            $needle = preg_replace('/\D+/', '', $phone);
            if ($needle !== '') {
                $query->where(function ($q) use ($needle) {
                    $q->whereHas('customer', fn ($c) => $c->where('phone', 'like', "%{$needle}%"))
                      ->orWhereHas('driver', fn ($d) => $d->where('phone', 'like', "%{$needle}%"));
                });
            }
        }

        $trips = $query->orderByDesc('created_at')->paginate(50);

        return response()->json(['data' => $trips]);
    }

    private function applyCategoryFilter($query, ?string $category, ?string $status): void
    {
        $category = $category ? strtolower($category) : null;

        switch ($category) {
            case 'ongoing':
                $query->whereIn('status', Trip::ACTIVE_DRIVER_STATUSES);
                return;

            case 'completed':
                $query->where('status', 'COMPLETED');
                return;

            case 'cancelled':
                // "Plain" cancellations only — no-shows live under the missed bucket.
                $query->where('status', 'CANCELLED')->whereNull('no_show_by');
                return;

            case 'missed':
                // Trips that ended because someone didn't show up.
                $query->where('status', 'CANCELLED')->whereNotNull('no_show_by');
                return;

            case 'pending':
                // Awaiting driver acceptance or driver assigned but not yet en-route.
                $query->whereIn('status', ['NEGOTIATION', 'ASSIGNED']);
                return;

            case 'scheduled':
                // No scheduling feature yet — return an empty set on purpose so the UI
                // renders an "empty" state instead of leaking historical trips.
                $query->whereRaw('1 = 0');
                return;

            case 'all':
                if ($status) {
                    $query->where('status', $status);
                }
                return;

            default:
                if ($status) {
                    $query->where('status', $status);
                    return;
                }
                // Legacy default (kept for the existing /trips screen): hide terminals.
                $query->whereNotIn('status', ['COMPLETED', 'CANCELLED']);
        }
    }

    /**
     * Returns the latest stored driver location for a trip (used by admin ride monitoring).
     */
    public function latestLocation(Trip $trip)
    {
        $latest = DriverLocation::query()
            ->where('trip_id', $trip->id)
            ->orderByDesc('recorded_at')
            ->first();

        return response()->json([
            'trip_id' => $trip->id,
            'latest_location' => $latest,
        ]);
    }
}
