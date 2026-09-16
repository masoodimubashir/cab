<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Models\DriverLocation;
use App\Models\OperatorSetting;
use App\Models\PricingRule;
use App\Models\SeatReservation;
use App\Models\Trip;
use App\Services\AutoRefundService;
use App\Services\DynamicPricingService;
use App\Services\FareEstimationService;
use App\Services\GeoService;
use App\Services\ManagerScope;
use App\Services\NotificationCenter;
use App\Services\FixedManifestService;
use App\Services\ShuttleRefundService;
use App\Services\TripStateMachineService;
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

    /**
     * Force-start a ride from the admin panel (bypasses OTP check).
     */
    public function start(
        Request $request,
        Trip $trip,
        TripStateMachineService $tripStateMachine,
        NotificationCenter $notifier,
    ) {
        ManagerScope::assertCityAllowed((int) $trip->city_id);

        if (in_array($trip->status, ['COMPLETED', 'CANCELLED', 'EN_ROUTE_DROP', 'ARRIVED_DROP'], true)) {
            return response()->json(['message' => 'Trip cannot be started in current status (' . $trip->status . ').'], 409);
        }

        if (!$trip->driver_id) {
            return response()->json(['message' => 'Cannot start a trip without an assigned driver.'], 422);
        }

        // Clear active start OTP
        $trip->forceFill([
            'start_otp' => null,
            'start_otp_expires_at' => null,
        ])->save();

        // Advance through intermediate states if needed to arrive at EN_ROUTE_DROP
        if (in_array($trip->status, ['REQUESTED', 'NEGOTIATION', 'CONFIRMED'], true)) {
            $tripStateMachine->transition($trip, 'ASSIGNED');
            $trip = $trip->fresh();
        }
        if ($trip->status === 'ASSIGNED') {
            $tripStateMachine->transition($trip, 'EN_ROUTE_PICKUP');
            $trip = $trip->fresh();
        }
        if ($trip->status === 'EN_ROUTE_PICKUP') {
            $tripStateMachine->transition($trip, 'ARRIVED_PICKUP');
            $trip = $trip->fresh();
        }
        if ($trip->status === 'ARRIVED_PICKUP') {
            $tripStateMachine->transition($trip, 'EN_ROUTE_DROP');
            $trip = $trip->fresh();
        }

        // In-app notifications
        if ($trip->driver_id) {
            $notifier->notifyUserId(
                $trip->driver_id,
                'trip_started_by_admin',
                'Trip started',
                "Trip #{$trip->id} was started by operator.",
                ['trip_id' => $trip->id, 'status' => 'EN_ROUTE_DROP'],
                'car-outline',
            );
        }
        if ($trip->customer_id) {
            $notifier->notifyUserId(
                $trip->customer_id,
                'trip_started_by_admin',
                'Trip started',
                "Your trip #{$trip->id} has begun.",
                ['trip_id' => $trip->id, 'status' => 'EN_ROUTE_DROP'],
                'car-outline',
            );
        }

        return response()->json([
            'message' => 'Trip started successfully.',
            'trip' => $trip->fresh(),
        ]);
    }

    /**
     * Cancel a ride from the admin panel.
     */
    public function cancel(
        Request $request,
        Trip $trip,
        TripStateMachineService $tripStateMachine,
        NotificationCenter $notifier,
        ShuttleRefundService $shuttleRefunds,
    ) {
        ManagerScope::assertCityAllowed((int) $trip->city_id);

        $data = $request->validate([
            'reason' => ['required', 'string', 'max:500'],
            'waive_fee' => ['nullable', 'boolean'],
            'cancelled_by' => ['nullable', 'string', 'in:operator,driver,customer,system'],
        ]);

        if (in_array($trip->status, ['COMPLETED', 'CANCELLED'], true)) {
            return response()->json(['message' => 'Trip is already completed or cancelled.'], 409);
        }

        $waiveFee = (bool) ($data['waive_fee'] ?? false);
        if ($waiveFee) {
            $trip->cancellation_fee_amount = 0.0;
            $trip->save();
        }

        $cancelledBy = $data['cancelled_by'] ?? AutoRefundService::BY_OPERATOR;
        $reason = $data['reason'];

        $tripStateMachine->transition($trip, 'CANCELLED', [
            'cancelled_reason' => $reason,
            'cancelled_by' => $cancelledBy,
        ]);

        $shuttleRefunds->markCancelledForTrip($trip->fresh(), $reason);

        // In-app notifications
        if ($trip->driver_id) {
            $notifier->notifyUserId(
                $trip->driver_id,
                'trip_cancelled_by_admin',
                'Trip cancelled',
                "Trip #{$trip->id} was cancelled by operator. Reason: {$reason}",
                ['trip_id' => $trip->id],
                'close-circle-outline',
            );
        }
        if ($trip->customer_id) {
            $notifier->notifyUserId(
                $trip->customer_id,
                'trip_cancelled_by_admin',
                'Trip cancelled',
                "Your trip #{$trip->id} was cancelled by operator. Reason: {$reason}",
                ['trip_id' => $trip->id],
                'close-circle-outline',
            );
        }

        return response()->json([
            'message' => 'Trip cancelled successfully.',
            'trip' => $trip->fresh(),
        ]);
    }

    /**
     * Change drop destination from admin panel with scope-aware validations and metered fare recalculation.
     */
    public function changeDrop(
        Request $request,
        Trip $trip,
        FareEstimationService $fareEstimationService,
        DynamicPricingService $dynamicPricingService,
        GeoService $geo,
        NotificationCenter $notifier,
    ) {
        ManagerScope::assertCityAllowed((int) $trip->city_id);

        $data = $request->validate([
            'drop_stop_id' => ['nullable', 'integer', 'exists:route_stops,id'],
            'drop_lat' => ['nullable', 'numeric', 'between:-90,90'],
            'drop_lng' => ['nullable', 'numeric', 'between:-180,180'],
            'drop_address' => ['nullable', 'string', 'max:500'],
        ]);

        if (in_array($trip->status, ['COMPLETED', 'CANCELLED'], true)) {
            return response()->json(['message' => 'Cannot change drop destination for a finished trip.'], 409);
        }

        if (!empty($data['drop_stop_id'])) {
            $stop = \App\Models\RouteStop::query()->findOrFail((int) $data['drop_stop_id']);
            $newDropLat = (float) $stop->lat;
            $newDropLng = (float) $stop->lng;
            $dropAddress = $stop->name;
        } else {
            if (!isset($data['drop_lat']) || !isset($data['drop_lng'])) {
                return response()->json(['message' => 'Coordinates or a valid route stop must be provided.'], 422);
            }
            $newDropLat = (float) $data['drop_lat'];
            $newDropLng = (float) $data['drop_lng'];
            $dropAddress = $data['drop_address'] ?? null;
        }

        $pickupLat = (float) $trip->pickup_lat;
        $pickupLng = (float) $trip->pickup_lng;

        // Minimum distance check between pickup and drop
        if ($pickupLat && $pickupLng) {
            $distFromPickup = $geo->haversineMeters($pickupLat, $pickupLng, $newDropLat, $newDropLng);
            if ($distFromPickup < 50) {
                return response()->json(['message' => 'Drop location cannot be the same as the pickup location.'], 422);
            }
        }

        // If in-progress, check against driver's current position
        if (in_array($trip->status, ['EN_ROUTE_DROP', 'ARRIVED_DROP'], true)) {
            $driverLoc = DriverLocation::query()
                ->where('trip_id', $trip->id)
                ->orderByDesc('recorded_at')
                ->first(['lat', 'lng']);
            if ($driverLoc && $driverLoc->lat !== null && $driverLoc->lng !== null) {
                $distFromDriver = $geo->haversineMeters((float) $driverLoc->lat, (float) $driverLoc->lng, $newDropLat, $newDropLng);
                if ($distFromDriver < 50) {
                    return response()->json(['message' => 'Drop location is too close to driver current position.'], 422);
                }
            }
        }

        // City geofence check (Local non-shared rides only)
        $isLocal = ($trip->scope === 'local' || !$trip->scope) && !$trip->isShared() && !$trip->outstation_package_id;
        if ($isLocal && $trip->city_id) {
            $city = City::query()->find($trip->city_id);
            if ($city && !empty($city->boundary_polygon) && OperatorSetting::instance()->check_destination_outside_geofence) {
                $inside = $dynamicPricingService->pointInPolygon($newDropLat, $newDropLng, $city->boundary_polygon);
                if (!$inside) {
                    return response()->json(['message' => 'Drop location is outside the service area for ' . $city->name . '.'], 422);
                }
            }
        }

        // Fare recalculation:
        // - Fixed corridor / shared: flat fare remains unchanged
        // - Outstation package: base package fare remains unchanged
        // - Local metered: recalculate estimated / final fare
        if ($isLocal && $trip->city_vehicle_type_id) {
            $pricingRule = $trip->pricing_rule_id
                ? PricingRule::query()->find($trip->pricing_rule_id)
                : PricingRule::resolveFor($trip->city_vehicle_type_id);

            if ($pricingRule) {
                $fareInput = $fareEstimationService->fareInput($pricingRule->toArray(), $trip->outstation_package_id);
                $estimate = $fareEstimationService->estimateFare(
                    $fareInput,
                    $pickupLat,
                    $pickupLng,
                    $newDropLat,
                    $newDropLng,
                    null,
                    null,
                    null,
                    null,
                    (float) ($trip->toll_amount ?? 0),
                );
                $trip->estimated_fare = $estimate['estimated_fare'];
                if ($trip->status === 'EN_ROUTE_DROP' && $trip->final_fare !== null) {
                    $trip->final_fare = $estimate['estimated_fare'];
                }
            }
        }

        $trip->drop_lat = $newDropLat;
        $trip->drop_lng = $newDropLng;
        if ($dropAddress) {
            $trip->drop_address = $dropAddress;
        }
        $trip->save();

        // In-app notifications
        $addrText = $trip->drop_address ?: 'new location';
        if ($trip->driver_id) {
            $notifier->notifyUserId(
                $trip->driver_id,
                'trip_destination_updated',
                'Destination updated',
                "Operator updated the drop location to {$addrText}.",
                [
                    'trip_id' => $trip->id,
                    'drop_lat' => $newDropLat,
                    'drop_lng' => $newDropLng,
                    'drop_address' => $trip->drop_address,
                ],
                'navigate-outline',
            );
        }
        if ($trip->customer_id) {
            $notifier->notifyUserId(
                $trip->customer_id,
                'trip_destination_updated',
                'Destination updated',
                "Your drop location was updated to {$addrText}.",
                [
                    'trip_id' => $trip->id,
                    'drop_lat' => $newDropLat,
                    'drop_lng' => $newDropLng,
                    'drop_address' => $trip->drop_address,
                ],
                'navigate-outline',
            );
        }

        return response()->json([
            'message' => 'Drop location updated successfully.',
            'trip' => $trip->fresh(),
        ]);
    }

    /**
     * Change drop stop for an individual passenger booking on a shared / fixed departure.
     */
    public function changePassengerDrop(
        Request $request,
        Trip $trip,
        SeatReservation $passenger,
        NotificationCenter $notifier,
    ) {
        ManagerScope::assertCityAllowed((int) $trip->city_id);

        if ($passenger->trip_id && (int) $passenger->trip_id !== (int) $trip->id) {
            abort(404);
        }
        if ($trip->route_departure_id && (int) $passenger->route_departure_id !== (int) $trip->route_departure_id) {
            abort(404);
        }

        if (in_array($trip->status, ['COMPLETED', 'CANCELLED'], true)) {
            return response()->json(['message' => 'Cannot change drop destination for a finished or cancelled trip.'], 409);
        }

        if (in_array($passenger->status, ['COMPLETED', 'DROPPED', 'CANCELLED', 'NO_SHOW'], true)) {
            return response()->json(['message' => 'Cannot change drop stop for a finished or cancelled passenger booking.'], 409);
        }

        $data = $request->validate([
            'drop_stop_id' => ['required', 'integer', 'exists:route_stops,id'],
        ]);

        $newStop = \App\Models\RouteStop::query()->findOrFail((int) $data['drop_stop_id']);

        // Validate sequence: new drop stop must be after boarding stop
        if ($passenger->board_stop_id) {
            $boardStop = \App\Models\RouteStop::query()->find($passenger->board_stop_id);
            if ($boardStop && $newStop->seq <= $boardStop->seq) {
                return response()->json(['message' => 'Drop stop must be after the pickup stop.'], 422);
            }
        }

        $passenger->drop_stop_id = $newStop->id;
        $passenger->drop_lat = $newStop->lat;
        $passenger->drop_lng = $newStop->lng;
        $passenger->drop_address = $newStop->name;
        $passenger->save();

        // Send notifications
        $customerName = $passenger->customer?->name ?: 'Customer';
        if ($trip->driver_id) {
            $notifier->notifyUserId(
                $trip->driver_id,
                'passenger_destination_updated',
                'Passenger drop updated',
                "Operator updated {$customerName}'s drop to Stop #{$newStop->seq}: {$newStop->name}.",
                [
                    'trip_id' => $trip->id,
                    'reservation_id' => $passenger->id,
                    'drop_stop_id' => $newStop->id,
                    'drop_name' => $newStop->name,
                ],
                'navigate-outline',
            );
        }
        if ($passenger->customer_id) {
            $notifier->notifyUserId(
                $passenger->customer_id,
                'trip_destination_updated',
                'Destination updated',
                "Your drop stop was updated to Stop #{$newStop->seq}: {$newStop->name}.",
                [
                    'trip_id' => $trip->id,
                    'reservation_id' => $passenger->id,
                    'drop_stop_id' => $newStop->id,
                    'drop_name' => $newStop->name,
                ],
                'navigate-outline',
            );
        }

        return response()->json([
            'message' => "Passenger drop updated to Stop #{$newStop->seq} ({$newStop->name}).",
            'passenger' => $passenger->fresh(['boardStop', 'dropStop', 'customer']),
        ]);
    }
}
