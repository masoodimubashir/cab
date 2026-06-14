<?php

namespace App\Http\Controllers;

use App\Events\FareNegotiationOfferAdded;
use App\Jobs\DispatchHopJob;
use App\Models\City;
use App\Models\CityVehicleType;
use App\Models\Driver;
use App\Models\DriverLocation;
use App\Models\FareNegotiation;
use App\Models\OperatorSetting;
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
        \App\Services\NotificationCenter $notifier,
    ) {
        $data = $request->validate([
            // Primary axis: the exact per-city vehicle the customer picked.
            // Legacy combo (vehicle_type_id|ride_type_id) still accepted while
            // the customer mobile is being switched over.
            'city_vehicle_type_id' => ['nullable', 'integer', 'exists:city_vehicle_types,id'],
            'city_id' => ['required_without:city_vehicle_type_id', 'integer', 'exists:cities,id'],
            'vehicle_type_id' => ['nullable', 'integer', 'exists:vehicle_types,id'],
            'ride_type_id' => ['nullable', 'integer', 'exists:ride_types,id'],

            'pickup_address' => ['nullable', 'string', 'max:500'],
            'pickup_lat' => ['required', 'numeric', 'between:-90,90'],
            'pickup_lng' => ['required', 'numeric', 'between:-180,180'],

            'drop_address' => ['nullable', 'string', 'max:500'],
            'drop_lat' => ['required', 'numeric', 'between:-90,90'],
            'drop_lng' => ['required', 'numeric', 'between:-180,180'],

            'payment_method' => ['nullable', 'in:cash,razorpay'],
            'scheduled_at' => ['nullable', 'date'],
            // Real route metrics from the client's Google DirectionsService.
            // When present the estimator uses them instead of haversine.
            'route_distance_km' => ['nullable', 'numeric', 'min:0', 'max:10000'],
            'route_time_min' => ['nullable', 'numeric', 'min:0', 'max:1440'],
            'outstation_package_id' => ['nullable', 'integer', 'exists:outstation_packages,id'],
            // Toll the client read from Google for this route (₹). Applied only
            // when the booked vehicle's toll_mode is 'yes'; absent/blank → 0.
            'toll_amount' => ['nullable', 'numeric', 'min:0', 'max:100000'],
            'scope' => ['nullable', 'in:local,outstation'],

            // "Book a ride for a friend / family" — the booker still owns + pays
            // the trip; these identify the actual rider so the driver can reach
            // them. Name + phone are required only when booking for someone else.
            'is_for_other' => ['nullable', 'boolean'],
            'booked_for_name' => ['nullable', 'required_if:is_for_other,true', 'string', 'max:120'],
            'booked_for_phone' => ['nullable', 'required_if:is_for_other,true', 'string', 'max:20'],
        ]);

        $isForOther = (bool) ($data['is_for_other'] ?? false);

        $scheduledAt = !empty($data['scheduled_at']) ? Carbon::parse($data['scheduled_at']) : null;

        // Local vs outstation drives which per-city dispatcher row + booking
        // window applies. Honour an explicit scope from the client; otherwise a
        // private ride is outstation when it carries an outstation package.
        $scope = ($data['scope'] ?? null)
            ?: (isset($data['outstation_package_id']) ? 'outstation' : 'local');

        // Resolve the city_vehicle_type up front — it carries city_id,
        // ride_type_id and vehicle_type_id, so the downstream code stops
        // needing them as separate booking inputs.
        $cityVehicleTypeId = isset($data['city_vehicle_type_id'])
            ? (int) $data['city_vehicle_type_id']
            : CityVehicleType::resolveId(
                cityId: (int) ($data['city_id'] ?? 0),
                rideTypeId: isset($data['ride_type_id']) ? (int) $data['ride_type_id'] : null,
                vehicleTypeId: isset($data['vehicle_type_id']) ? (int) $data['vehicle_type_id'] : null,
            );
        $cvt = $cityVehicleTypeId ? CityVehicleType::query()->find($cityVehicleTypeId) : null;
        if (!$cvt) {
            return response()->json(['message' => 'No matching vehicle for this booking.'], 404);
        }
        $cityId = (int) $cvt->city_id;

        // Toll is gated by the vehicle: only an outstation vehicle with the toll
        // toggle ON carries it, using whatever Google gave the client (else 0).
        // Captured here so the same amount settles at completion.
        $tollCharge = ($cvt->toll_mode === 'yes')
            ? (float) ($data['toll_amount'] ?? 0)
            : 0.0;

        $policyError = $schedulingPolicy->validateBooking(
            customerId: $request->user()->id,
            cityId: $cityId,
            kind: $scope,
            scheduledAt: $scheduledAt,
        );
        if ($policyError) {
            return response()->json([
                'message' => $schedulingPolicy->messageFor($policyError),
                'error_code' => $policyError,
            ], 422);
        }

        $city = City::query()->find($cityId);
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

        // Reject destinations outside the city's geofence — only when the
        // operator enabled the destination check (Operator Settings → Geofence)
        // and a boundary is actually drawn for the city.
        if (
            !empty($city->boundary_polygon)
            && OperatorSetting::instance()->check_destination_outside_geofence
            && !$dynamicPricingService->pointInPolygon(
                (float) $data['drop_lat'],
                (float) $data['drop_lng'],
                $city->boundary_polygon,
            )
        ) {
            return response()->json([
                'message' => 'Destination is outside the service area for ' . $city->name . '.',
            ], 422);
        }

        $pricingRule = PricingRule::resolveFor($cityVehicleTypeId);
        if (!$pricingRule) {
            return response()->json(['message' => 'Pricing rule not set for this vehicle.'], 404);
        }

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
            'name' => $dynamicRule->name,
            'region_visible' => $dynamicPricingService->isFareVisibleToRider($dynamicRule),
        ] : null;

        $fareInput = $fareEstimationService->fareInput(
            $pricingRule->toArray(),
            isset($data['outstation_package_id']) ? (int) $data['outstation_package_id'] : null,
        );
        $estimate = $fareEstimationService->estimateFare(
            $fareInput,
            (float) $data['pickup_lat'],
            (float) $data['pickup_lng'],
            (float) $data['drop_lat'],
            (float) $data['drop_lng'],
            $dynamicFactors,
            null,
            isset($data['route_distance_km']) ? (float) $data['route_distance_km'] : null,
            isset($data['route_time_min']) ? (float) $data['route_time_min'] : null,
            $tollCharge,
        );

        // "Any vehicle / ride now" mode — client sent only city info, no
        // vehicle preference. Keep requested_vehicle_type_id null so drivers
        // of any vehicle type match this trip in /nearby-drivers and
        // /select-driver. The city_vehicle_type_id we resolved above is just
        // the city's default vehicle (used to anchor the fare estimate).
        $customerPickedVehicle = isset($data['city_vehicle_type_id'])
            || isset($data['vehicle_type_id'])
            || isset($data['ride_type_id']);

        $trip = Trip::query()->create([
            'customer_id' => $request->user()->id,
            'is_for_other' => $isForOther,
            'booked_for_name' => $isForOther ? ($data['booked_for_name'] ?? null) : null,
            'booked_for_phone' => $isForOther ? ($data['booked_for_phone'] ?? null) : null,
            'driver_id' => null,
            'city_id' => $cityId,
            'scope' => $scope,
            'city_vehicle_type_id' => $cityVehicleTypeId,
            // Denormalised legacy axes — kept so dispatcher matching and older
            // queries (driver vehicle_type_id match, etc.) still resolve when
            // the customer did pick a specific vehicle.
            'ride_type_id' => (int) $cvt->ride_type_id,
            'requested_vehicle_type_id' => $customerPickedVehicle && $cvt->vehicle_type_id
                ? (int) $cvt->vehicle_type_id
                : null,
            'outstation_package_id' => isset($data['outstation_package_id'])
                ? (int) $data['outstation_package_id']
                : null,
            'pricing_rule_id' => $pricingRule->id,
            'scheduled_at' => $scheduledAt,
            'status' => 'REQUESTED',
            'estimated_fare' => $estimate['estimated_fare'],
            'toll_amount' => $estimate['toll_amount'] ?? 0,
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

        // Scheduled ride → confirm the booking to the customer and flag it to admins.
        // (ASAP rides go straight into the live search, so no booking notice there.)
        if ($scheduledAt) {
            $whenText = $scheduledAt->copy()->timezone(config('app.timezone'))->format('D, d M · g:i A');
            $notifier->notifyUserId(
                $trip->customer_id,
                'scheduled_ride_booked',
                'Ride scheduled',
                "Your ride is booked for {$whenText}. We'll find you a driver near pickup time.",
                ['trip_id' => $trip->id, 'scheduled_at' => $scheduledAt->toIso8601String()],
                'calendar-outline',
            );
            $notifier->notifyAdmins(
                'scheduled_ride_booked',
                'New scheduled ride',
                "Trip #{$trip->id} scheduled for {$whenText}.",
                ['trip_id' => $trip->id, 'scheduled_at' => $scheduledAt->toIso8601String()],
                'calendar-outline',
            );
        }

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
            ->whereIn('status', Trip::DRIVER_BUSY_STATUSES)
            ->exists();
        if ($hasActiveTrip) {
            return response()->json(['data' => [], 'reason' => 'Driver has an active trip in progress.']);
        }

        $accepted = $user->accepted_payment_methods ?? ['cash', 'upi', 'qr'];

        // Two buckets of trips a driver can act on:
        //   1. Open auto-dispatch trips (driver_id null) — anyone in range may bid.
        //   2. Trips the customer selected *this* driver for (driver_id == me) —
        //      no one else sees them; only this driver can ACCEPT or COUNTER.
        //
        // We also require an actual PENDING customer offer to exist. Without
        // that filter, the driver-mobile would surface every trip the moment
        // it was created (POST /trips immediately transitions to NEGOTIATION),
        // even before the customer commits via /customer-offer or
        // /select-driver. Drivers should only see live, biddable requests.
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
            ->whereExists(function ($sub) {
                $sub->select(DB::raw(1))
                    ->from('fare_negotiations')
                    ->whereColumn('fare_negotiations.trip_id', 'trips.id')
                    ->whereExists(function ($inner) {
                        $inner->select(DB::raw(1))
                            ->from('fare_negotiation_offers')
                            ->whereColumn('fare_negotiation_offers.fare_negotiation_id', 'fare_negotiations.id')
                            ->where('from_role', 'customer')
                            ->where('status', 'PENDING');
                    });
            })
            ->orderByDesc('created_at')
            ->limit(20)
            ->get([
                'id', 'customer_id', 'driver_id', 'pickup_address', 'pickup_lat', 'pickup_lng',
                'drop_address', 'drop_lat', 'drop_lng', 'estimated_fare',
                'payment_method', 'created_at', 'is_for_other', 'booked_for_name',
                'city_vehicle_type_id',
            ]);

        $trips->load('cityVehicleType:id,reverse_bidding_enabled');

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
                // For a "booked for a friend" ride, show the driver who they're
                // actually picking up before they accept.
                'is_for_other' => (bool) $t->is_for_other,
                'booked_for_name' => $t->is_for_other ? $t->booked_for_name : null,
                'reverse_bidding_enabled' => $t->cityVehicleType?->reverse_bidding_enabled ?? true,
            ];
        });

        return response()->json(['data' => $payload]);
    }

    public function cancel(
        Request $request,
        Trip $trip,
        TripStateMachineService $tripStateMachineService,
        SchedulingPolicyService $schedulingPolicy,
        \App\Services\NotificationCenter $notifier,
        \App\Services\GeoService $geo,
    ) {
        $request->validate([
            'reason' => ['nullable', 'string', 'max:1000'],
        ]);

        $user = $request->user();
        if ($trip->customer_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        // EN_ROUTE_PICKUP is cancellable too — the rider may still bail while the
        // driver is approaching. The proximity gate below revokes that option
        // once the driver is within the city's configured cancel-block radius.
        if (!in_array($trip->status, ['REQUESTED', 'NEGOTIATION', 'CONFIRMED', 'ASSIGNED', 'EN_ROUTE_PICKUP'], true)) {
            return response()->json(['message' => 'Trip cannot be cancelled in current status.'], 409);
        }

        // Driver-proximity gate: block cancellation once the assigned driver is
        // within the per-city radius of the pickup. Fails OPEN (cancel allowed)
        // when we can't positively measure the driver inside that radius.
        $tooClose = $this->cancellationBlockedByProximity($trip, $geo);
        if ($tooClose !== null) {
            return response()->json([
                'message' => 'Your driver is almost at the pickup point, so this ride can no longer be cancelled.',
                'reason' => 'driver_close',
                'distance_m' => $tooClose['distance_m'],
                'block_radius_m' => $tooClose['radius_m'],
            ], 422);
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

        // For a scheduled ride, let an already-assigned driver + the admins know
        // the customer called it off (the customer initiated, so they don't need
        // a notice).
        if ($trip->scheduled_at) {
            if ($trip->driver_id) {
                $notifier->notifyUserId(
                    $trip->driver_id,
                    'scheduled_ride_cancelled',
                    'Scheduled ride cancelled',
                    "The customer cancelled scheduled trip #{$trip->id}.",
                    ['trip_id' => $trip->id],
                    'close-circle-outline',
                );
            }
            $notifier->notifyAdmins(
                'scheduled_ride_cancelled',
                'Scheduled ride cancelled',
                "Scheduled trip #{$trip->id} was cancelled by the customer.",
                ['trip_id' => $trip->id],
                'close-circle-outline',
            );
        }

        return response()->json([
            'trip' => $trip->fresh(),
            'late_cancellation' => $insideWindow,
        ]);
    }

    /**
     * Returns null when cancellation is allowed; otherwise the measured
     * distance + the configured radius that triggered the block. Only applies
     * once a driver is assigned and approaching pickup; missing coordinates or
     * an unknown driver position fail OPEN (cancel allowed).
     */
    private function cancellationBlockedByProximity(Trip $trip, \App\Services\GeoService $geo): ?array
    {
        if (!$trip->driver_id || !in_array($trip->status, ['CONFIRMED', 'ASSIGNED', 'EN_ROUTE_PICKUP'], true)) {
            return null;
        }
        if ($trip->pickup_lat === null || $trip->pickup_lng === null) {
            return null; // can't measure → allow
        }

        $settings = \App\Models\DispatcherSetting::forTrip($trip->city_id, $trip->scope ?: 'local');
        $radius = (int) ($settings?->cancel_block_radius_m ?? 0);
        if ($radius <= 0) {
            return null; // gate disabled for this city/product
        }

        // Freshest known driver position — the trip ping stream first, then the
        // driver's last-known global fix as a fallback.
        $loc = \App\Models\DriverLocation::query()
            ->where('driver_id', $trip->driver_id)
            ->orderByDesc('recorded_at')
            ->orderByDesc('id')
            ->first(['lat', 'lng']);
        $dLat = $loc?->lat ?? $trip->driver?->current_lat;
        $dLng = $loc?->lng ?? $trip->driver?->current_lng;
        if ($dLat === null || $dLng === null) {
            return null; // unknown driver position → allow
        }

        $distance = $geo->haversineMeters(
            (float) $dLat,
            (float) $dLng,
            (float) $trip->pickup_lat,
            (float) $trip->pickup_lng,
        );
        if ($distance > $radius) {
            return null; // driver still beyond the radius → allow
        }

        return ['distance_m' => (int) round($distance), 'radius_m' => $radius];
    }

    /**
     * The signed-in customer's upcoming / active scheduled rides — next pickup
     * first. Terminal trips (completed / cancelled) drop off; they live in the
     * normal trip history + the notification inbox.
     */
    public function customerScheduled(Request $request)
    {
        $trips = Trip::query()
            ->where('customer_id', $request->user()->id)
            ->whereNotNull('scheduled_at')
            ->whereNotIn('status', Trip::TERMINAL_STATUSES)
            ->with(['driver:id,name,phone,avatar_path', 'rideType:id,name'])
            ->orderBy('scheduled_at')
            ->limit(50)
            ->get();

        return response()->json([
            'data' => $trips->map(fn (Trip $t) => $this->scheduledRow($t, 'customer'))->all(),
        ]);
    }

    /**
     * The signed-in driver's upcoming scheduled rides (ones they've been
     * assigned / accepted), next pickup first.
     */
    public function driverScheduled(Request $request)
    {
        $trips = Trip::query()
            ->where('driver_id', $request->user()->id)
            ->whereNotNull('scheduled_at')
            ->whereNotIn('status', Trip::TERMINAL_STATUSES)
            ->with(['customer:id,name,phone,avatar_path', 'rideType:id,name'])
            ->orderBy('scheduled_at')
            ->limit(50)
            ->get();

        return response()->json([
            'data' => $trips->map(fn (Trip $t) => $this->scheduledRow($t, 'driver'))->all(),
        ]);
    }

    /** Shared row shape for the scheduled-rides lists. */
    private function scheduledRow(Trip $t, string $audience): array
    {
        $row = [
            'id' => $t->id,
            'status' => $t->status,
            'scheduled_at' => optional($t->scheduled_at)->toIso8601String(),
            'pickup_address' => $t->pickup_address,
            'drop_address' => $t->drop_address,
            'estimated_fare' => $t->estimated_fare,
            'final_fare' => $t->final_fare,
            'payment_method' => $t->payment_method,
            'ride_type' => $t->rideType?->name,
            'created_at' => optional($t->created_at)->toIso8601String(),
        ];

        if ($audience === 'customer') {
            $row['driver'] = $t->driver
                ? ['id' => $t->driver->id, 'name' => $t->driver->name, 'phone' => $t->driver->phone]
                : null;
        } else {
            // The driver sees the actual rider — the friend on a for-someone-else
            // booking, never the booker's number.
            $riderName = $t->booked_for_name ?: $t->customer?->name;
            $riderPhone = $t->booked_for_phone ?: $t->customer?->phone;
            $row['customer'] = ($riderName || $riderPhone)
                ? ['id' => $t->customer?->id, 'name' => $riderName, 'phone' => $riderPhone]
                : null;
            $row['pickup_lat'] = $t->pickup_lat;
            $row['pickup_lng'] = $t->pickup_lng;
            $row['drop_lat'] = $t->drop_lat;
            $row['drop_lng'] = $t->drop_lng;
        }

        return $row;
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
            'trip' => $trip->fresh()->appendDriverRiderContact(),
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

    /**
     * Generate + SMS the start-ride OTP to the rider (the friend's phone on a
     * for-someone-else booking, the booker's otherwise). The driver calls this
     * from the pickup; the rider reads the code back and the driver enters it to
     * start the ride. dev_code is returned only in mock mode (no SMS gateway).
     */
    public function requestStartOtp(Request $request, Trip $trip, \App\Services\Msg91Service $msg91)
    {
        $user = $request->user();
        if ($trip->driver_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }
        if ($trip->status !== 'ARRIVED_PICKUP') {
            return response()->json([
                'message' => 'You can request the start code once you have arrived at the pickup.',
            ], 409);
        }

        // customer_phone resolves to the friend's number on a for-friend trip.
        $phone = $trip->customer_phone;
        if (!$phone) {
            return response()->json(['message' => 'No rider phone number on this trip.'], 422);
        }

        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        // Stored plaintext (hidden from every serialization) so the booker can
        // also read it on their live-trip screen via customerStartOtp().
        $trip->forceFill([
            'start_otp' => $code,
            'start_otp_expires_at' => now()->addMinutes(10),
        ])->save();

        $msg91->sendOtp(
            $phone,
            $code,
            "Your DreamCabs ride start code is {$code}. Share it with your driver to begin the trip.",
        );

        // Nudge the booker's live-trip screen to fetch the code right away
        // (no code in the payload — the tracking channel is shared with the driver).
        broadcast(new \App\Events\StartOtpReady(tripId: $trip->id));

        return response()->json([
            'ok' => true,
            'sent_to_name' => $trip->customer_name,
            // Present ONLY in mock mode (no SMS gateway) so the flow is testable.
            'dev_code' => $msg91->isLive() ? null : $code,
        ]);
    }

    /**
     * Surface the active start-ride OTP to the BOOKER (trip owner) so they can
     * read it off their live-trip screen and, on a for-a-friend trip, relay it
     * if the SMS didn't reach the friend. Owner-only; returns the code only
     * while it is live (driver at pickup, not expired). Never exposed to the
     * driver — they must hear it from the rider.
     */
    public function customerStartOtp(Request $request, Trip $trip)
    {
        $user = $request->user();
        if ($trip->customer_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $active = $trip->start_otp
            && $trip->start_otp_expires_at
            && !$trip->start_otp_expires_at->isPast()
            && $trip->status === 'ARRIVED_PICKUP';

        return response()->json([
            'start_otp' => $active ? $trip->start_otp : null,
            'expires_at' => $active ? $trip->start_otp_expires_at->toIso8601String() : null,
            'is_for_other' => (bool) $trip->is_for_other,
            'booked_for_name' => $trip->is_for_other ? $trip->booked_for_name : null,
        ]);
    }

    public function driverProgress(Request $request, Trip $trip, TripStateMachineService $tripStateMachineService)
    {
        $data = $request->validate([
            'status' => ['required', 'string'],
            'location' => ['nullable', 'array'],
            'location.lat' => ['nullable', 'numeric', 'between:-90,90'],
            'location.lng' => ['nullable', 'numeric', 'between:-180,180'],
            // Start-ride OTP — required only for the "Start ride" transition.
            'code' => ['nullable', 'required_if:status,EN_ROUTE_DROP', 'digits:6'],
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

        // Start-ride OTP gate: the journey can only begin once the driver enters
        // the 6-digit code the rider received on their phone. This is the single
        // authoritative chokepoint, so the API rejects a start without it
        // regardless of which client calls it.
        if ($data['status'] === 'EN_ROUTE_DROP') {
            $valid = $trip->start_otp
                && $trip->start_otp_expires_at
                && !$trip->start_otp_expires_at->isPast()
                && hash_equals((string) $trip->start_otp, (string) $data['code']);
            if (!$valid) {
                return response()->json([
                    'message' => 'Incorrect or expired start code. Ask the rider to read it again.',
                ], 422);
            }
            // Single-use — clear it once accepted.
            $trip->forceFill(['start_otp' => null, 'start_otp_expires_at' => null])->save();
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
        $fresh = $trip->fresh()->appendDriverRiderContact();

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
     * Discovery-only expanding-ring search. Runs DispatchHopJob in
     * discoveryMode = true, which broadcasts DispatchRingExpanded events
     * with the driver details found in each ring — but does NOT push
     * notifications to those drivers. The customer-mobile populates the
     * driver list and map markers from the broadcasts, then picks one
     * via /select-driver to actually send the request.
     */
    public function searchDrivers(Request $request, Trip $trip)
    {
        $user = $request->user();
        if ($trip->customer_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }
        if (!in_array($trip->status, ['REQUESTED', 'NEGOTIATION'], true)) {
            return response()->json(['message' => 'Trip is not in a searchable state.'], 409);
        }
        if ($trip->driver_id !== null) {
            return response()->json(['message' => 'Trip already has a driver assigned.'], 409);
        }

        DispatchHopJob::startChain(
            $trip->id,
            (float) ($trip->estimated_fare ?? 0),
            true,
        );

        return response()->json([
            'status' => 'searching',
            'message' => 'Driver search started.',
        ]);
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
            ->whereIn('status', Trip::DRIVER_BUSY_STATUSES)
            ->pluck('driver_id');

        $candidates = Driver::query()
            ->where('approval_status', 'approved')
            ->where('is_online', true)
            ->whereNotIn('user_id', $busyDriverIds)
            ->when($trip->requested_vehicle_type_id, function ($q) use ($trip) {
                // Customer asked for a specific global vehicle_type — drivers
                // must match it. Skipped in "any vehicle / Ride Now" mode.
                $q->where('vehicle_type_id', $trip->requested_vehicle_type_id);
            })
            // Hide drivers whose vehicle isn't *configured + priced* in this
            // city. A driver shows up only if there's an active city_vehicle_
            // types row for (this city × driver's vehicle_type_id) AND that
            // row carries a pricing_rule. Vehicles without a rate card are
            // considered "not set up yet" and excluded.
            ->whereExists(function ($sub) use ($trip) {
                $sub->select(DB::raw(1))
                    ->from('city_vehicle_types')
                    ->whereColumn('city_vehicle_types.vehicle_type_id', 'drivers.vehicle_type_id')
                    ->where('city_vehicle_types.city_id', $trip->city_id)
                    ->where('city_vehicle_types.is_active', true)
                    ->whereExists(function ($sub2) {
                        $sub2->select(DB::raw(1))
                            ->from('pricing_rules')
                            ->whereColumn('pricing_rules.city_vehicle_type_id', 'city_vehicle_types.id');
                    });
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
            ->whereIn('status', Trip::DRIVER_BUSY_STATUSES)
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
        // `amount` is ALWAYS an absolute rupee value. When the operator runs
        // tips as a percentage of fare, the client converts the chosen percent
        // into rupees before posting (the in_percentage flag only changes the
        // preset *labels*), so the server must never re-interpret it — doing so
        // double-converted and overcharged (e.g. a 20% tip on a ₹200 fare was
        // billed as ₹80 instead of ₹40).
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

        // tip_amount always stores absolute rupees (the client already resolved
        // any percentage against the fare before posting).
        $amount = round((float) $data['amount'], 2);

        if ($amount <= 0) {
            return response()->json(['message' => 'Tip amount must be greater than zero.'], 422);
        }

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

