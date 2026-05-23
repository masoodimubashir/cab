<?php

namespace App\Http\Controllers;

use App\Events\FareNegotiationOfferAdded;
use App\Models\City;
use App\Models\CityVehicleType;
use App\Models\Driver;
use App\Models\DriverLocation;
use App\Models\FareNegotiation;
use App\Models\PricingRule;
use App\Models\Trip;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\DynamicPricingService;
use App\Services\FareEstimationService;
use App\Services\NotificationService;
use App\Services\SchedulingPolicyService;
use App\Services\TripStateMachineService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class TripsController extends Controller
{
    public function store(
        Request $request,
        FareEstimationService $fareEstimationService,
        TripStateMachineService $tripStateMachineService,
        DynamicPricingService $dynamicPricingService,
        SchedulingPolicyService $schedulingPolicy,
    ) {
        $data = $request->validate([
            'city_id' => ['required', 'integer', 'exists:cities,id'],
            // Pricing axis: either vehicle_type_id (new, preferred) or
            // ride_type_id (legacy). At least one is required.
            'vehicle_type_id' => ['nullable', 'integer', 'exists:vehicle_types,id', 'required_without:ride_type_id'],
            'ride_type_id' => ['nullable', 'integer', 'exists:ride_types,id', 'required_without:vehicle_type_id'],
            'product_kind' => ['nullable', 'in:local,rental,outstation'],

            'pickup_address' => ['nullable', 'string', 'max:500'],
            'pickup_lat' => ['required', 'numeric', 'between:-90,90'],
            'pickup_lng' => ['required', 'numeric', 'between:-180,180'],

            'drop_address' => ['nullable', 'string', 'max:500'],
            'drop_lat' => ['required', 'numeric', 'between:-90,90'],
            'drop_lng' => ['required', 'numeric', 'between:-180,180'],

            'payment_method' => ['nullable', 'in:cash,upi,qr'],
            'scheduled_at' => ['nullable', 'date'],
            // Real route metrics from the client's Google DirectionsService.
            // When present the estimator uses them instead of haversine.
            'route_distance_km' => ['nullable', 'numeric', 'min:0', 'max:10000'],
            'route_time_min' => ['nullable', 'numeric', 'min:0', 'max:1440'],
            'outstation_package_id' => ['nullable', 'integer', 'exists:outstation_packages,id'],
        ]);

        $kind = $data['product_kind'] ?? 'local';
        $scheduledAt = !empty($data['scheduled_at']) ? Carbon::parse($data['scheduled_at']) : null;

        $policyError = $schedulingPolicy->validateBooking(
            customerId: $request->user()->id,
            cityId: (int) $data['city_id'],
            kind: $kind,
            scheduledAt: $scheduledAt,
        );
        if ($policyError) {
            return response()->json([
                'message' => $schedulingPolicy->messageFor($policyError),
                'error_code' => $policyError,
            ], 422);
        }

        $city = City::query()->find((int) $data['city_id']);
        if (!$city) {
            return response()->json(['message' => 'City not found.'], 404);
        }

        // Reject pickups outside the city's geofence (when one is configured).
        if (!empty($city->boundary_polygon)) {
            $inside = $dynamicPricingService->pointInPolygon(
                (float) $data['pickup_lat'],
                (float) $data['pickup_lng'],
                $city->boundary_polygon,
            );
            if (!$inside) {
                return response()->json([
                    'message' => 'Pickup location is outside the service area for ' . $city->name . '.',
                ], 422);
            }
        }

        $pricingRule = PricingRule::resolveFor(
            cityId: (int) $data['city_id'],
            vehicleTypeId: isset($data['vehicle_type_id']) ? (int) $data['vehicle_type_id'] : null,
            productKind: $kind,
            rideTypeId: isset($data['ride_type_id']) ? (int) $data['ride_type_id'] : null,
        );

        if (!$pricingRule) {
            return response()->json(['message' => 'Pricing rule not found.'], 404);
        }

        // Surge is keyed by the per-city vehicle (city_vehicle_types). Resolve
        // it from the booking axes so a rule scoped to e.g. "SWIFT/SEDAN O"
        // only surges that exact vehicle.
        $cityVehicleTypeId = CityVehicleType::resolveId(
            cityId: (int) $data['city_id'],
            productKind: $kind,
            rideTypeId: isset($data['ride_type_id'])
                ? (int) $data['ride_type_id']
                : ($pricingRule->ride_type_id ? (int) $pricingRule->ride_type_id : null),
            vehicleTypeId: isset($data['vehicle_type_id'])
                ? (int) $data['vehicle_type_id']
                : ($pricingRule->vehicle_type_id ? (int) $pricingRule->vehicle_type_id : null),
        );
        $dynamicRule = $dynamicPricingService->findApplicable(
            (float) $data['pickup_lat'],
            (float) $data['pickup_lng'],
            $cityVehicleTypeId,
        );

        $dynamicFactors = $dynamicRule ? [
            'customer_factor' => (float) $dynamicRule->customer_fare_factor,
            'driver_factor' => (float) $dynamicRule->driver_fare_factor,
            'rule_id' => $dynamicRule->id,
            'fare_type' => $dynamicRule->fare_type,
        ] : null;

        $estimate = $fareEstimationService->estimateFare(
            $fareEstimationService->fareInput(
                $pricingRule->toArray(),
                isset($data['outstation_package_id']) ? (int) $data['outstation_package_id'] : null,
            ),
            (float) $data['pickup_lat'],
            (float) $data['pickup_lng'],
            (float) $data['drop_lat'],
            (float) $data['drop_lng'],
            $dynamicFactors,
            null,
            isset($data['route_distance_km']) ? (float) $data['route_distance_km'] : null,
            isset($data['route_time_min']) ? (float) $data['route_time_min'] : null,
        );

        $trip = Trip::query()->create([
            'customer_id' => $request->user()->id,
            'driver_id' => null,
            'city_id' => (int) $data['city_id'],
            // Persist both axes so legacy reads (ride_type) and new dispatch
            // (vehicle_type) both work. Either may be null depending on what
            // the client sent.
            'ride_type_id' => isset($data['ride_type_id'])
                ? (int) $data['ride_type_id']
                : ($pricingRule->ride_type_id ? (int) $pricingRule->ride_type_id : null),
            'requested_vehicle_type_id' => isset($data['vehicle_type_id'])
                ? (int) $data['vehicle_type_id']
                : ($pricingRule->vehicle_type_id ? (int) $pricingRule->vehicle_type_id : null),
            'product_kind' => $kind,
            'outstation_package_id' => isset($data['outstation_package_id'])
                ? (int) $data['outstation_package_id']
                : null,
            'pricing_rule_id' => $pricingRule->id,
            'scheduled_at' => $scheduledAt,
            'status' => 'REQUESTED',
            'estimated_fare' => $estimate['estimated_fare'],
            'final_fare' => null,
            'currency' => 'INR',
            'pickup_address' => $data['pickup_address'] ?? null,
            'pickup_lat' => (float) $data['pickup_lat'],
            'pickup_lng' => (float) $data['pickup_lng'],
            'drop_address' => $data['drop_address'] ?? null,
            'drop_lat' => (float) $data['drop_lat'],
            'drop_lng' => (float) $data['drop_lng'],
            'payment_method' => $data['payment_method'] ?? null,
        ]);

        // Immediately start negotiation stage.
        $tripStateMachineService->transition($trip, 'NEGOTIATION');

        // NOTE: fare_negotiations + negotiation offers are created in `fare-negotiation`.
        return response()->json([
            'trip' => $trip->fresh(),
            'estimate' => $estimate,
        ], 201);
    }

    /**
     * Trips a driver can currently bid on (in NEGOTIATION, no driver claimed yet,
     * payment method matches the driver's accepted_payment_methods).
     * Returns the latest customer offer amount alongside each trip.
     */
    public function available(Request $request)
    {
        $user = $request->user();

        $driverProfile = Driver::query()->where('user_id', $user->id)->first();
        if (!$driverProfile) {
            return response()->json(['message' => 'Driver profile not found.'], 404);
        }
        if ($driverProfile->approval_status !== 'approved' || !$driverProfile->is_online) {
            return response()->json(['data' => [], 'reason' => 'Driver must be approved and online.']);
        }

        // A driver already mid-trip cannot accept a second one. Hide the available
        // queue from busy drivers so they don't even see the trips.
        $hasActiveTrip = Trip::query()
            ->where('driver_id', $user->id)
            ->whereIn('status', Trip::ACTIVE_DRIVER_STATUSES)
            ->exists();
        if ($hasActiveTrip) {
            return response()->json(['data' => [], 'reason' => 'Driver has an active trip in progress.']);
        }

        $accepted = $user->accepted_payment_methods ?? ['cash', 'upi', 'qr'];

        // Two buckets of trips a driver can act on:
        //   1. Open auto-dispatch trips (driver_id null) — anyone in range may bid.
        //   2. Trips the customer selected *this* driver for (driver_id == me) —
        //      no one else sees them; only this driver can ACCEPT or COUNTER.
        $trips = Trip::query()
            ->where('status', 'NEGOTIATION')
            ->where(function ($q) use ($user) {
                $q->whereNull('driver_id')
                  ->orWhere('driver_id', $user->id);
            })
            ->where(function ($q) use ($accepted) {
                $q->whereNull('payment_method')
                  ->orWhereIn('payment_method', $accepted);
            })
            ->orderByDesc('created_at')
            ->limit(20)
            ->get([
                'id', 'customer_id', 'driver_id', 'pickup_address', 'pickup_lat', 'pickup_lng',
                'drop_address', 'drop_lat', 'drop_lng', 'estimated_fare',
                'payment_method', 'created_at',
            ]);

        $tripIds = $trips->pluck('id')->all();

        // Fetch the latest customer offer per trip in a single query.
        $latestOffers = FareNegotiation::query()
            ->whereIn('trip_id', $tripIds)
            ->with(['offers' => function ($q) {
                $q->where('from_role', 'customer')->orderByDesc('created_at');
            }])
            ->get()
            ->keyBy('trip_id');

        $payload = $trips->map(function (Trip $t) use ($latestOffers, $user) {
            $negotiation = $latestOffers->get($t->id);
            $latestAmount = $negotiation?->offers?->first()?->amount;

            return [
                'id' => $t->id,
                // True when the customer specifically picked this driver via
                // /trips/{id}/select-driver. UI surfaces these as "Requested for you".
                'is_selected_for_me' => $t->driver_id === $user->id,
                'pickup_address' => $t->pickup_address,
                'pickup_lat' => (float) $t->pickup_lat,
                'pickup_lng' => (float) $t->pickup_lng,
                'drop_address' => $t->drop_address,
                'drop_lat' => (float) $t->drop_lat,
                'drop_lng' => (float) $t->drop_lng,
                'estimated_fare' => $t->estimated_fare !== null ? (float) $t->estimated_fare : null,
                'customer_offer' => $latestAmount !== null ? (float) $latestAmount : null,
                'payment_method' => $t->payment_method,
                'created_at' => $t->created_at,
            ];
        });

        return response()->json(['data' => $payload]);
    }

    public function cancel(
        Request $request,
        Trip $trip,
        TripStateMachineService $tripStateMachineService,
        SchedulingPolicyService $schedulingPolicy,
    ) {
        $request->validate([
            'reason' => ['nullable', 'string', 'max:1000'],
        ]);

        $user = $request->user();
        if ($trip->customer_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        if (!in_array($trip->status, ['REQUESTED', 'NEGOTIATION', 'CONFIRMED', 'ASSIGNED'], true)) {
            return response()->json(['message' => 'Trip cannot be cancelled in current status.'], 409);
        }

        // Late-cancellation fee for scheduled rides cancelled inside the
        // per-product cancel window. Pricing rule provides the flat fee.
        $insideWindow = $schedulingPolicy->isInsideCancelWindow($trip);
        if ($insideWindow && $trip->pricing_rule_id) {
            $rule = \App\Models\PricingRule::query()->find($trip->pricing_rule_id);
            $fee = (float) ($rule->cancellation_charges ?? 0.0);
            if ($fee > 0) {
                $trip->cancellation_fee_amount = $fee;
                $trip->save();
            }
        }

        $tripStateMachineService->transition($trip, 'CANCELLED', [
            'cancelled_reason' => $request->input('reason'),
        ]);

        return response()->json([
            'trip' => $trip->fresh(),
            'late_cancellation' => $insideWindow,
        ]);
    }

    /**
     * Mark a trip as a no-show (driver waited at pickup, customer never arrived; or
     * mirror for the customer if the driver never arrived). Cancels the trip and
     * computes a cancellation fee from the trip's PricingRule.
     */
    public function markNoShow(Request $request, Trip $trip, TripStateMachineService $tripStateMachineService)
    {
        $data = $request->validate([
            'role' => ['required', 'in:customer,driver'],
        ]);

        $user = $request->user();
        $role = $data['role'];

        // 'customer' role here means "the customer was a no-show" (driver-side action).
        if ($role === 'customer') {
            if ($trip->driver_id !== $user->id) {
                return response()->json(['message' => 'Forbidden.'], 403);
            }
            if ($trip->status !== 'ARRIVED_PICKUP') {
                return response()->json(['message' => 'Driver must be at pickup to mark a customer no-show.'], 409);
            }
        } else {
            // 'driver' role here means "the driver was a no-show" (customer-side action).
            if ($trip->customer_id !== $user->id) {
                return response()->json(['message' => 'Forbidden.'], 403);
            }
            if (!in_array($trip->status, ['ASSIGNED', 'EN_ROUTE_PICKUP'], true)) {
                return response()->json(['message' => 'Customer can only flag driver no-show before pickup.'], 409);
            }
        }

        // Threshold check — based on PricingRule.no_show_threshold_minutes against
        // the relevant timestamp. Falls back to 5 minutes if the rule is missing the field.
        $pricingRule = $trip->pricing_rule_id ? PricingRule::query()->find($trip->pricing_rule_id) : null;
        $thresholdMinutes = (float) ($pricingRule?->no_show_threshold_minutes ?? 5);
        $perMinuteFee = (float) ($pricingRule?->no_show_charges_per_minute ?? 0);

        $waitStartedAt = $role === 'customer'
            ? $trip->arrived_pickup_at
            : ($trip->assigned_at ?? $trip->confirmed_at);

        if ($waitStartedAt) {
            $waitedMinutes = now()->diffInMinutes($waitStartedAt, true);
            if ($waitedMinutes < $thresholdMinutes) {
                return response()->json([
                    'message' => "No-show threshold not yet met. Wait at least {$thresholdMinutes} minutes.",
                    'waited_minutes' => $waitedMinutes,
                    'threshold_minutes' => $thresholdMinutes,
                ], 409);
            }
            $fee = round($perMinuteFee * $waitedMinutes, 2);
        } else {
            $fee = 0.0;
        }

        $trip->cancellation_fee_amount = $fee;
        $trip->no_show_by = $role;
        $trip->save();

        $tripStateMachineService->transition($trip, 'CANCELLED', [
            'cancelled_reason' => "no_show_by:{$role}",
        ]);

        return response()->json([
            'trip' => $trip->fresh(),
            'fee' => $fee,
        ]);
    }

    public function confirm(Request $request, Trip $trip, TripStateMachineService $tripStateMachineService)
    {
        $data = $request->validate([
            'final_fare' => ['required', 'numeric', 'min:0'],
        ]);

        $user = $request->user();
        if ($trip->customer_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        if ($trip->status !== 'NEGOTIATION') {
            return response()->json(['message' => 'Trip is not in negotiation state.'], 409);
        }

        $tripStateMachineService->transition($trip, 'CONFIRMED', [
            'final_fare' => (float) $data['final_fare'],
        ]);

        return response()->json(['trip' => $trip->fresh()]);
    }

    public function driverProgress(Request $request, Trip $trip, TripStateMachineService $tripStateMachineService)
    {
        $data = $request->validate([
            'status' => ['required', 'string'],
            'location' => ['nullable', 'array'],
            'location.lat' => ['nullable', 'numeric', 'between:-90,90'],
            'location.lng' => ['nullable', 'numeric', 'between:-180,180'],
        ]);

        $user = $request->user();
        if ($trip->driver_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $allowedStatuses = [
            'EN_ROUTE_PICKUP',
            'ARRIVED_PICKUP',
            'EN_ROUTE_DROP',
            'ARRIVED_DROP',
            'COMPLETED',
        ];

        if (!in_array($data['status'], $allowedStatuses, true)) {
            return response()->json(['message' => 'Invalid progress status.'], 422);
        }

        if ($trip->status === 'COMPLETED' || $trip->status === 'CANCELLED') {
            return response()->json(['message' => 'Trip already finished.'], 409);
        }

        // Stamp the location BEFORE the transition so a COMPLETED recompute
        // sees the final ping in driver_locations.
        if (!empty($data['location']['lat']) && !empty($data['location']['lng'])) {
            DriverLocation::query()->create([
                'driver_id' => $user->id,
                'trip_id' => $trip->id,
                'lat' => (float) $data['location']['lat'],
                'lng' => (float) $data['location']['lng'],
            ]);
        }

        $tripStateMachineService->transition($trip, $data['status']);
        $fresh = $trip->fresh();

        // On COMPLETED, return the breakdown so the driver app can render the
        // summary modal without an extra round-trip.
        $payload = ['trip' => $fresh];
        if ($data['status'] === 'COMPLETED') {
            $payload['breakdown'] = [
                'final_fare' => (float) ($fresh->final_fare ?? 0),
                'waiting_charge_amount' => (float) ($fresh->waiting_charge_amount ?? 0),
                'tip_amount' => (float) ($fresh->tip_amount ?? 0),
                'estimated_fare' => (float) ($fresh->estimated_fare ?? 0),
                'payment_method' => $fresh->payment_method,
            ];
        }

        return response()->json($payload);
    }

    /**
     * Drivers who can serve this trip — the list the customer picks from
     * before negotiation. Filters:
     *   - approved + online + not on another active trip
     *   - latest location ping within the last 5 minutes
     *   - inside the trip's city polygon (if one is configured)
     *   - vehicle_type matches the trip's requested_vehicle_type_id (when set)
     *   - within `radius_km` of pickup (default 8 km, capped at 25)
     *
     * Returns lat/lng + name + vehicle summary so the customer UI can render
     * a list of cards with distance.
     */
    public function nearbyDrivers(
        Request $request,
        Trip $trip,
        DynamicPricingService $dynamicPricingService,
    ) {
        $user = $request->user();
        if ($trip->customer_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }
        // Only meaningful while the customer is still picking a driver.
        if (!in_array($trip->status, ['REQUESTED', 'NEGOTIATION'], true) || $trip->driver_id !== null) {
            return response()->json(['message' => 'Trip is no longer open for driver selection.'], 409);
        }

        $data = $request->validate([
            'radius_km' => ['nullable', 'numeric', 'min:0.5', 'max:25'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:50'],
        ]);
        $radiusKm = (float) ($data['radius_km'] ?? 8.0);
        $limit = (int) ($data['limit'] ?? 20);

        $busyDriverIds = Trip::query()
            ->whereNotNull('driver_id')
            ->whereIn('status', Trip::ACTIVE_DRIVER_STATUSES)
            ->pluck('driver_id');

        $candidates = Driver::query()
            ->where('approval_status', 'approved')
            ->where('is_online', true)
            ->whereNotIn('user_id', $busyDriverIds)
            ->when($trip->requested_vehicle_type_id, function ($q) use ($trip) {
                // Match drivers whose registered vehicle_type matches what the
                // customer asked for. Falls back to "any" when the trip has no
                // requested_vehicle_type_id (legacy bookings).
                $q->where('vehicle_type_id', $trip->requested_vehicle_type_id);
            })
            ->with(['user:id,name,phone,avatar_path'])
            ->get([
                'id', 'user_id', 'vehicle_type_id', 'vehicle_type', 'vehicle_brand',
                'vehicle_model', 'vehicle_color', 'vehicle_reg_no', 'rating_avg', 'rating_count',
            ]);

        if ($candidates->isEmpty()) {
            return response()->json(['data' => []]);
        }

        $driverIds = $candidates->pluck('user_id')->all();

        // Latest location per driver in the freshness window.
        $cutoff = now()->subMinutes(5);
        $latestPerDriver = DriverLocation::query()
            ->select('driver_id', DB::raw('MAX(recorded_at) as max_recorded_at'))
            ->whereIn('driver_id', $driverIds)
            ->where('recorded_at', '>=', $cutoff)
            ->groupBy('driver_id');

        $locationRows = DriverLocation::query()
            ->joinSub($latestPerDriver, 'latest', function ($join) {
                $join->on('driver_locations.driver_id', '=', 'latest.driver_id')
                     ->on('driver_locations.recorded_at', '=', 'latest.max_recorded_at');
            })
            ->get(['driver_locations.driver_id', 'driver_locations.lat', 'driver_locations.lng', 'driver_locations.bearing_deg'])
            ->keyBy('driver_id');

        $pickupLat = (float) $trip->pickup_lat;
        $pickupLng = (float) $trip->pickup_lng;
        $cityPolygon = $trip->city_id
            ? (City::query()->find($trip->city_id)?->boundary_polygon ?? null)
            : null;

        $rows = $candidates
            ->map(function (Driver $d) use ($locationRows, $pickupLat, $pickupLng, $cityPolygon, $dynamicPricingService) {
                $loc = $locationRows->get($d->user_id);
                if (!$loc) {
                    return null;
                }
                $lat = (float) $loc->lat;
                $lng = (float) $loc->lng;

                // Geofence: drop drivers outside the trip's city polygon.
                if ($cityPolygon && !$dynamicPricingService->pointInPolygon($lat, $lng, $cityPolygon)) {
                    return null;
                }

                $distanceKm = $this->haversineKm($pickupLat, $pickupLng, $lat, $lng);
                return [
                    'driver_id' => (int) $d->user_id,
                    'name' => $d->user?->name,
                    'avatar_path' => $d->user?->avatar_path,
                    'rating_avg' => (float) $d->rating_avg,
                    'rating_count' => (int) $d->rating_count,
                    'vehicle' => [
                        'type' => $d->vehicle_type,
                        'brand' => $d->vehicle_brand,
                        'model' => $d->vehicle_model,
                        'color' => $d->vehicle_color,
                        'reg_no' => $d->vehicle_reg_no,
                    ],
                    'lat' => $lat,
                    'lng' => $lng,
                    'bearing_deg' => $loc->bearing_deg !== null ? (int) $loc->bearing_deg : null,
                    'distance_km' => round($distanceKm, 3),
                ];
            })
            ->filter()
            ->filter(fn ($r) => $r['distance_km'] <= $radiusKm)
            ->sortBy('distance_km')
            ->take($limit)
            ->values();

        return response()->json(['data' => $rows]);
    }

    /**
     * Customer picks a specific driver from the nearbyDrivers list and opens
     * a 1:1 negotiation with them.
     *
     * Atomically pre-claims trip.driver_id for the chosen driver (so other
     * drivers can't see it in /trips/available), creates the negotiation row
     * and the customer's opening offer, transitions REQUESTED → NEGOTIATION,
     * and pushes a direct FCM to that driver. The driver then ACCEPT / COUNTER
     * via the usual /negotiation/driver-action endpoint.
     */
    public function selectDriver(
        Request $request,
        Trip $trip,
        TripStateMachineService $tripStateMachineService,
        NotificationService $notificationService,
    ) {
        $user = $request->user();
        if ($trip->customer_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $estimated = (float) ($trip->estimated_fare ?? 0);
        $minAmount = max(50.0, round($estimated * 0.4, 2));

        $data = $request->validate([
            'driver_id' => ['required', 'integer', 'exists:users,id'],
            'amount' => ['required', 'numeric', "min:{$minAmount}"],
        ]);
        $driverUserId = (int) $data['driver_id'];
        $amount = (float) $data['amount'];

        // Verify the chosen driver is still serviceable (online, approved,
        // not busy, matching vehicle type). Cheaper to re-check here than to
        // race the list endpoint.
        $driverProfile = Driver::query()->where('user_id', $driverUserId)->first();
        if (!$driverProfile || $driverProfile->approval_status !== 'approved' || !$driverProfile->is_online) {
            return response()->json(['message' => 'Driver is no longer available.'], 409);
        }
        $driverBusy = Trip::query()
            ->where('driver_id', $driverUserId)
            ->whereIn('status', Trip::ACTIVE_DRIVER_STATUSES)
            ->exists();
        if ($driverBusy) {
            return response()->json(['message' => 'Driver just took another ride.'], 409);
        }
        if ($trip->requested_vehicle_type_id
            && $driverProfile->vehicle_type_id
            && (int) $driverProfile->vehicle_type_id !== (int) $trip->requested_vehicle_type_id
        ) {
            return response()->json(['message' => 'Driver vehicle type does not match the booking.'], 422);
        }

        // Atomic pre-claim. Reject if trip already has a driver assigned by
        // someone else, or it's no longer in a claimable state.
        $claimed = DB::transaction(function () use ($trip, $driverUserId) {
            $locked = Trip::query()->where('id', $trip->id)->lockForUpdate()->first();
            if (!$locked) {
                return null;
            }
            if (!in_array($locked->status, ['REQUESTED', 'NEGOTIATION'], true)) {
                return null;
            }
            if ($locked->driver_id !== null && $locked->driver_id !== $driverUserId) {
                return null;
            }
            if ($locked->driver_id === null) {
                $locked->driver_id = $driverUserId;
                $locked->save();
            }
            return $locked->fresh();
        });

        if (!$claimed) {
            return response()->json(['message' => 'Trip is no longer open for driver selection.'], 409);
        }
        $trip = $claimed;

        if ($trip->status === 'REQUESTED') {
            $tripStateMachineService->transition($trip, 'NEGOTIATION');
            $trip = $trip->fresh();
        }

        // Open the negotiation row + customer opening offer.
        $negotiation = FareNegotiation::query()->firstOrCreate(
            ['trip_id' => $trip->id],
            [
                'customer_id' => $trip->customer_id,
                'driver_id' => $trip->driver_id,
                'status' => 'NEGOTIATING',
            ]
        );
        if ($negotiation->driver_id !== $trip->driver_id) {
            $negotiation->driver_id = $trip->driver_id;
            $negotiation->save();
        }

        $negotiation->offers()
            ->where('status', 'PENDING')
            ->update(['status' => 'SUPERSEDED']);

        $offer = $negotiation->offers()->create([
            'from_user_id' => $user->id,
            'from_role' => 'customer',
            'amount' => $amount,
            'status' => 'PENDING',
        ]);

        broadcast(new FareNegotiationOfferAdded(
            tripId: $trip->id,
            offer: $offer->fresh(),
        ))->toOthers();

        // Direct push to the chosen driver. No expanding-ring broadcast.
        $driverUser = User::query()->find($driverUserId);
        if ($driverUser) {
            $notificationService->sendToUser(
                $driverUser,
                'New ride request',
                'You were selected for a ride at \u{20B9}' . number_format($amount, 0),
                [
                    'type' => 'trip_selected',
                    'trip_id' => $trip->id,
                    'amount' => $amount,
                ]
            );
        }

        return response()->json([
            'trip' => $trip->fresh(),
            'negotiation' => $negotiation->fresh('offers'),
            'offer' => $offer,
        ], 201);
    }

    private function haversineKm(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $earthKm = 6371.0;
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) ** 2
            + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;
        return $earthKm * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }

    /**
     * Customer adds a tip for the driver after a completed ride.
     *
     * One tip per trip — `trips.tip_amount` acts as the idempotency key.
     * Tip is recorded both on the trip (for invoices/history) and as a
     * wallet_transactions credit row for the driver (for the earnings tab).
     */
    public function tip(Request $request, Trip $trip)
    {
        $data = $request->validate([
            'amount' => ['required', 'numeric', 'min:1', 'max:10000'],
        ]);

        $user = $request->user();
        if ($trip->customer_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }
        if ($trip->status !== 'COMPLETED') {
            return response()->json(['message' => 'You can only tip a completed ride.'], 409);
        }
        if (!$trip->driver_id) {
            return response()->json(['message' => 'No driver on this trip.'], 422);
        }
        if ($trip->tip_amount !== null) {
            return response()->json(['message' => 'A tip has already been added to this ride.'], 409);
        }

        $amount = round((float) $data['amount'], 2);

        \DB::transaction(function () use ($trip, $amount, $user) {
            $trip->tip_amount = $amount;
            $trip->save();

            WalletTransaction::query()->create([
                'user_id' => $trip->driver_id,
                'amount' => $amount,
                'type' => WalletTransaction::TYPE_CREDIT,
                'engagement_id' => $trip->id,
                'reason' => 'Customer tip',
                'created_by_user_id' => $user->id,
            ]);
        });

        return response()->json([
            'message' => 'Tip added. Thank you!',
            'trip' => $trip->fresh(),
        ], 201);
    }
}

