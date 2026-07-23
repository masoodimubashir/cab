<?php

namespace App\Http\Controllers\Admin;

use App\Models\DriverLocation;
use App\Models\Trip;
use App\Services\ManagerScope;
use App\Services\FixedManifestService;
use Illuminate\Http\Request;

class AdminTripsController
{
    public function __construct(private readonly FixedManifestService $fixedManifest) {}

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
            ->with(['customer', 'driver', 'rideType', 'pricingRule', 'seatReservations.customer']);

        // Restrict to the manager's city scope. Super Admin sees all.
        ManagerScope::applyCityScope($query, 'city_id');

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

        if ($cvtId = $request->query('city_vehicle_type_id')) {
            $query->where('city_vehicle_type_id', (int) $cvtId);
        }

        if ($cityId = $request->query('city_id')) {
            // Additional narrowing on top of ManagerScope — safe because
            // scoped managers' allowed set already limits which cities they
            // can see; if they pass a city_id they're not allowed to see,
            // the ManagerScope where-clause silently returns nothing.
            $query->where('city_id', (int) $cityId);
        }

        if ($phone = trim((string) $request->query('phone'))) {
            // Strip non-digits so "+91 90000-12345" matches "9000012345" in DB.
            $needle = preg_replace('/\D+/', '', $phone);
            if ($needle !== '') {
                $query->where(function ($q) use ($needle) {
                    $q->whereHas('customer', fn ($c) => $c->where('phone', 'like', "%{$needle}%"))
                      ->orWhereHas('driver', fn ($d) => $d->where('phone', 'like', "%{$needle}%"))
                      ->orWhereHas('seatReservations.customer', fn ($c) => $c->where('phone', 'like', "%{$needle}%"));
                });
            }
        }

        $perPage = (int) $request->query('per_page', 25);
        $perPage = max(1, min(100, $perPage));

        // Scheduled rides read best by pickup time (next pickup first); everything
        // else stays newest-first.
        if ($category && strtolower($category) === 'scheduled') {
            $query->orderBy('scheduled_at');
        } else {
            $query->orderByDesc('created_at');
        }

        $trips = $query->paginate($perPage);

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
                // Pre-booked rides that haven't finished yet — upcoming + in-progress.
                // Completed/cancelled scheduled rides fall into their own buckets.
                $query->whereNotNull('scheduled_at')
                      ->whereNotIn('status', Trip::TERMINAL_STATUSES);
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
     * Full trip detail for the admin ride-details screen — eager-loads every
     * relation the page renders (parties, pricing axes, payment with coupon
     * snapshot) plus the latest 100 driver-location pings for the map path.
     * One round trip serves the entire page.
     */
    public function show(Trip $trip)
    {
        ManagerScope::assertCityAllowed((int) $trip->city_id);

        $trip->load([
            'customer:id,name,phone,email,avatar_path',
            'driver:id,name,phone,email,avatar_path',
            'rideType:id,name',
            'cityVehicleType:id,city_id,ride_type_id,vehicle_type_id,display_name,max_people,luggage_capacity',
            'cityVehicleType.vehicleType:id,name',
            'cityVehicleType.rideType:id,name',
            'pricingRule',
            'payment:id,trip_id,method,provider,status,amount,discount_amount,paid_at,coupon_assignment_id,razorpay_payment_id,razorpay_order_id',
            'payment.couponAssignment.coupon:id,title,discount_type,discount_value',
            'routeDeparture.route:id,city_id,name,scope,mode,origin_name,dest_name',
        ]);

        // Driver profile fields (vehicle reg, brand etc) aren't on users —
        // they're on the `drivers` row keyed by user_id. Pull that separately.
        $driverProfile = $trip->driver_id
            ? \App\Models\Driver::query()
                ->where('user_id', $trip->driver_id)
                ->first([
                    'user_id', 'vehicle_type', 'vehicle_model',
                    'vehicle_color', 'vehicle_reg_no', 'rating_avg', 'rating_count',
                ])
            : null;

        // Driver path on the trip — cap to avoid sending megabytes for very
        // long rides. 100 points is enough to render a smooth polyline.
        $path = DriverLocation::query()
            ->where('trip_id', $trip->id)
            ->orderBy('recorded_at')
            ->limit(100)
            ->get(['lat', 'lng', 'recorded_at', 'bearing_deg']);

        $fixedManifest = null;
        if ($trip->routeDeparture && $trip->routeDeparture->route?->mode === 'fixed') {
            $fixedManifest = $this->fixedManifest->manifest($trip->routeDeparture);
        }

        return response()->json([
            'trip' => $trip,
            'driver_profile' => $driverProfile,
            'path' => $path,
            'fixed_manifest' => $fixedManifest,
        ]);
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
