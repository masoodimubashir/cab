<?php

namespace App\Http\Controllers;

use App\Events\FareNegotiationLocked;
use App\Events\FareNegotiationOfferAdded;
use App\Jobs\DispatchHopJob;
use App\Jobs\SendDispatchNotificationsJob;
use App\Models\DispatcherSetting;
use App\Models\Driver;
use App\Models\DriverLocation;
use App\Models\FareNegotiation;
use App\Models\FareNegotiationOffer;
use App\Models\Trip;
use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use App\Services\NotificationService;
use App\Services\PaymentModeService;
use App\Services\TripAssignmentService;
use App\Services\TripStateMachineService;
use Illuminate\Http\Request;

class FareNegotiationController extends Controller
{
    public function show(Request $request, Trip $trip, PaymentModeService $paymentModeService)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        // The customer and the bound/winning driver always have access. During
        // a broadcast the trip has no bound driver yet, so any approved driver
        // may view it to decide whether to bid — and any driver who already
        // placed a bid keeps access to see the outcome.
        $isParticipant = $trip->customer_id === $user->id
            || $trip->driver_id === $user->id;
        if (!$isParticipant) {
            $openToDrivers = $trip->driver_id === null
                && $trip->status === 'NEGOTIATION'
                && Driver::query()
                    ->where('user_id', $user->id)
                    ->where('approval_status', 'approved')
                    ->exists();
            $hasBid = FareNegotiationOffer::query()
                ->where('from_user_id', $user->id)
                ->whereHas('fareNegotiation', function ($q) use ($trip) {
                    $q->where('trip_id', $trip->id);
                })
                ->exists();
            if (!$openToDrivers && !$hasBid) {
                return response()->json(['message' => 'Forbidden.'], 403);
            }
        }

        $negotiation = FareNegotiation::query()
            ->where('trip_id', $trip->id)
            ->with(['offers' => function ($q) {
                $q->orderBy('created_at', 'asc');
            }])
            ->first();

        $tripWithDriver = $trip->fresh()->load([
            'driver:id,name,phone,avatar_path,accepted_payment_methods,current_lat,current_lng',
            'driver.driver:id,user_id,vehicle_brand,vehicle_model,vehicle_color,vehicle_reg_no',
        ]);
        // So the driver sees + can call the actual rider (the friend on a
        // for-someone-else booking); the booker's relation stays hidden.
        $tripWithDriver->appendDriverRiderContact();

        // Best-known driver position so the customer map can show the driver
        // from the confirmation screen onward — before live trip streaming
        // begins. Uses the freshest driver_locations ping (presence pings have
        // trip_id=null; trip pings carry this trip id).
        $driverLocation = null;
        if ($trip->driver_id) {
            $row = \App\Models\DriverLocation::query()
                ->where('driver_id', $trip->driver_id)
                ->orderByDesc('recorded_at')
                ->orderByDesc('id')
                ->first(['lat', 'lng', 'recorded_at']);
            if ($row) {
                $driverLocation = [
                    'lat' => (float) $row->lat,
                    'lng' => (float) $row->lng,
                    'recorded_at' => optional($row->recorded_at)->toIso8601String(),
                ];
            }
        }

        // City-level settings — payment modes feed the pay screen, and
        // show_vehicle_make_model gates whether the rider sees the driver's
        // car make/model on the trip screen (default ON when no row exists).
        $citySetting = \App\Models\CitySetting::query()
            ->where('city_id', $trip->city_id)
            ->first();
        $cityModes = $citySetting?->allowed_driver_payment_modes;
        $cityPaymentModes = is_array($cityModes) && $cityModes
            ? array_values(array_intersect($cityModes, ['CASH', 'RAZORPAY']))
            : ['RAZORPAY'];
        $showVehicleMakeModel = $citySetting ? (bool) $citySetting->show_vehicle_make_model : true;

        // Per-(city, kind) cancel-block radius so the rider's app can hide the
        // Cancel button the moment the driver gets within range (the cancel
        // endpoint enforces the same server-side). 0 = no proximity limit.
        $dispatchSettings = DispatcherSetting::forTrip($trip->city_id, $trip->scope ?: 'local');
        $cancelBlockRadiusM = (int) ($dispatchSettings?->cancel_block_radius_m ?? 0);

        return response()->json([
            'trip_id' => $trip->id,
            'trip' => $tripWithDriver,
            'negotiation' => $negotiation,
            'city_payment_modes' => $cityPaymentModes,
            'cancel_block_radius_m' => $cancelBlockRadiusM,
            // Authoritative list the customer can actually pay with — city cap
            // ∩ driver-effective modes (driver follows the city when the
            // operator owns payment policy). The pay endpoints enforce the same.
            'available_payment_methods' => $paymentModeService->allowedForTrip($trip),
            // Per-city toggle: hide the driver's make/model from the rider when off.
            'show_vehicle_make_model' => $showVehicleMakeModel,
            'driver_location' => $driverLocation,
            // Floor + admin-configured +/- step amounts the apps render as buttons.
            'negotiation_config' => $this->negotiationConfig($trip),
        ]);
    }

    public function customerOffer(Request $request, Trip $trip, \App\Services\SchedulingPolicyService $scheduling)
    {
        $user = $request->user();
        if ($trip->customer_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        if ($trip->status !== 'NEGOTIATION') {
            return response()->json(['message' => 'Trip is not in negotiation state.'], 409);
        }

        // Fare floor: the route's minimum fare (min_fare on the pricing rule).
        // Neither side may offer below it; the apps clamp the +/- buttons to the
        // same value and this is the server backstop.
        $minAmount = $this->negotiationConfig($trip)['min_amount'];

        $data = $request->validate([
            'amount' => ['required', 'numeric', "min:{$minAmount}"],
        ]);

        $negotiation = FareNegotiation::query()->firstOrCreate(
            ['trip_id' => $trip->id],
            [
                'customer_id' => $trip->customer_id,
                'driver_id' => $trip->driver_id,
                'status' => 'NEGOTIATING',
            ]
        );

        $amount = (float) $data['amount'];

        // Supersede previous pending offers so the client can render the latest state.
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

        // Hand off to the expanding-ring auto-dispatcher. It reads the per-(city, kind)
        // dispatcher_settings row for hop interval / radius / max hops, broadcasts to
        // drivers in the current ring, then re-queues itself until acceptance or
        // exhaustion. Falls back gracefully when no settings row exists.
        $autoOn = true;
        $settings = DispatcherSetting::forTrip($trip->city_id, $trip->scope ?: 'local');
        if ($settings && !$settings->automatic_dispatcher_type) {
            $autoOn = false; // operator must dispatch manually
        }

        // A scheduled ride in DELAYED mode must NOT dispatch now — the alarm-time
        // worker (WakeScheduledTrips) fires it near pickup. INSTANT modes (and all
        // non-scheduled rides) dispatch immediately, as before.
        if ($autoOn && $scheduling->shouldDispatchOnBooking($trip)) {
            DispatchHopJob::startChain($trip->id, $amount);
        }

        return response()->json([
            'negotiation' => $negotiation->fresh('offers'),
            'offer' => $offer,
        ]);
    }

    /**
     * Filter a list of driver user IDs down to those whose latest location is
     * within radiusKm of the pickup AND was recorded in the last freshnessMinutes.
     * Drivers with no location row, or with a stale row, are excluded.
     *
     * @param  \Illuminate\Support\Collection<int, int>  $driverUserIds
     * @return \Illuminate\Support\Collection<int, int>
     */
    private function filterByPickupRadius(
        \Illuminate\Support\Collection $driverUserIds,
        float $pickupLat,
        float $pickupLng,
        float $radiusKm = 8.0,
        int $freshnessMinutes = 5,
    ): \Illuminate\Support\Collection {
        if ($driverUserIds->isEmpty()) {
            return $driverUserIds;
        }

        // Latest location per driver, restricted to the eligible set and a freshness window.
        $cutoff = now()->subMinutes($freshnessMinutes);

        $latestPerDriver = DriverLocation::query()
            ->select('driver_id', DB::raw('MAX(recorded_at) as max_recorded_at'))
            ->whereIn('driver_id', $driverUserIds)
            ->where('recorded_at', '>=', $cutoff)
            ->groupBy('driver_id');

        $locations = DriverLocation::query()
            ->joinSub($latestPerDriver, 'latest', function ($join) {
                $join->on('driver_locations.driver_id', '=', 'latest.driver_id')
                     ->on('driver_locations.recorded_at', '=', 'latest.max_recorded_at');
            })
            ->get(['driver_locations.driver_id', 'driver_locations.lat', 'driver_locations.lng']);

        return $locations
            ->filter(function ($row) use ($pickupLat, $pickupLng, $radiusKm) {
                return $this->haversineKm($pickupLat, $pickupLng, (float) $row->lat, (float) $row->lng) <= $radiusKm;
            })
            ->pluck('driver_id')
            ->values();
    }

    private function haversineKm(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $earthKm = 6371.0;
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) ** 2
            + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;
        $c = 2 * atan2(sqrt($a), sqrt(1 - $a));
        return $earthKm * $c;
    }

    public function driverAction(Request $request, Trip $trip, TripAssignmentService $tripAssignmentService)
    {
        $data = $request->validate([
            'action' => ['required', 'in:ACCEPT,COUNTER'],
            'amount' => ['nullable', 'numeric', 'min:0'],
        ]);

        $user = $request->user();

        // Eligibility check — deliberately NON-exclusive.
        //
        // A broadcast request (trip.driver_id === null) stays OPEN to every
        // nearby driver: many drivers may ACCEPT or COUNTER the same request,
        // and only the one the customer finally picks (via /customer-confirm)
        // gets bound to the trip. We must NOT set trip.driver_id here — doing so
        // would let the first responder lock everyone else out, and the customer
        // could never compare competing bids.
        //
        // A pre-assigned request (manual dispatch, or a customer who used
        // /select-driver) already carries a specific driver_id; only that driver
        // may act on it. The lockForUpdate keeps the status/driver_id read
        // race-free without writing anything.
        $trip = DB::transaction(function () use ($trip, $user) {
            $fresh = Trip::query()->where('id', $trip->id)->lockForUpdate()->first();
            if (!$fresh || $fresh->status !== 'NEGOTIATION') {
                return null;
            }
            if ($fresh->driver_id !== null && $fresh->driver_id !== $user->id) {
                return null; // pre-assigned to another driver, or already confirmed
            }
            return $fresh;
        });

        if (!$trip) {
            return response()->json(['message' => 'This request is no longer available.'], 409);
        }

        // Acceptance window (bug #7): a driver auto-pinged by the dispatcher must
        // act within driver_accept_window_sec of their ping. A late tap is
        // rejected so the ride doesn't get claimed after the rider moved on.
        // Drivers reached another way (manual pre-assign / customer select-driver)
        // have no ping record and are unaffected.
        $settings = DispatcherSetting::forTrip($trip->city_id, $trip->scope ?: 'local');
        $window = (int) ($settings->driver_accept_window_sec ?? 0);
        if ($window > 0) {
            $pingedAt = Cache::get("dispatch_ping:{$trip->id}:{$user->id}");
            if ($pingedAt !== null && (now()->timestamp - (int) $pingedAt) > $window) {
                return response()->json([
                    'message' => 'This request has expired. Please wait for the next one.',
                ], 409);
            }
        }

        // One negotiation thread per trip. For a broadcast its driver_id stays
        // null (no single owner) until the customer locks the winner; every
        // driver's bid is identified by the offer's from_user_id, not here.
        $negotiation = FareNegotiation::query()->firstOrCreate(
            ['trip_id' => $trip->id],
            [
                'customer_id' => $trip->customer_id,
                'driver_id' => $trip->driver_id,
                'status' => 'NEGOTIATING',
            ]
        );

        if ($data['action'] === 'ACCEPT') {
            $customerOffer = $negotiation->offers()
                ->where('from_role', 'customer')
                ->orderBy('created_at', 'desc')
                ->first();

            if (!$customerOffer) {
                return response()->json(['message' => 'No customer offer found to accept.'], 422);
            }

            // Supersede only THIS driver's own prior pending offers. The
            // customer's open offer and other drivers' live bids stay PENDING,
            // so the request keeps showing to the whole pool and the customer
            // can still compare competing bids.
            $negotiation->offers()
                ->where('status', 'PENDING')
                ->where('from_user_id', $user->id)
                ->update(['status' => 'SUPERSEDED']);

            $amount = (float) $customerOffer->amount;
            $offer = $negotiation->offers()->create([
                'from_user_id' => $user->id,
                'from_role' => 'driver',
                'amount' => $amount,
                'status' => 'ACCEPTED',
                'accepted_by_user_id' => $user->id,
                'decision_at' => now(),
            ]);

            $negotiation->final_amount = $amount;
            $negotiation->save();

            broadcast(new FareNegotiationOfferAdded(
                tripId: $trip->id,
                offer: $offer->fresh(),
            ))->toOthers();

            // Manual-dispatch trips have no live customer to call
            // /customer-confirm, so the dispatcher's chosen fare is the
            // confirmation. Push the trip straight to CONFIRMED here so the
            // driver can immediately call /driver-accept to enter ASSIGNED.
            if ($trip->is_manual_dispatch) {
                $confirmed = $tripAssignmentService->confirm($trip->id, (int) $offer->id, $amount);
                if ($confirmed) {
                    $negotiation->driver_id = $user->id;
                    $negotiation->status = 'LOCKED';
                    $negotiation->locked_at = now();
                    $negotiation->save();
                }
            }

            return response()->json([
                'negotiation' => $negotiation->fresh('offers'),
            ]);
        }

        // COUNTER
        if (!isset($data['amount'])) {
            return response()->json(['message' => 'amount is required for COUNTER.'], 422);
        }

        $amount = (float) $data['amount'];

        // Floor: a driver's price can't drop below the route's minimum fare
        // (the apps clamp their step buttons to the same value; this is the
        // server backstop).
        $minAmount = $this->negotiationConfig($trip)['min_amount'];
        if ($amount < $minAmount) {
            return response()->json(['message' => "Price can't be below ₹{$minAmount}."], 422);
        }

        // Supersede only THIS driver's own prior pending offer (see the ACCEPT
        // branch) so other drivers' bids and the customer's offer stay live.
        $negotiation->offers()
            ->where('status', 'PENDING')
            ->where('from_user_id', $user->id)
            ->update(['status' => 'SUPERSEDED']);

        $offer = $negotiation->offers()->create([
            'from_user_id' => $user->id,
            'from_role' => 'driver',
            'amount' => $amount,
            'status' => 'PENDING',
        ]);

        $negotiation->final_amount = $amount;
        $negotiation->save();

        broadcast(new FareNegotiationOfferAdded(
            tripId: $trip->id,
            offer: $offer->fresh(),
        ))->toOthers();

        return response()->json([
            'negotiation' => $negotiation->fresh('offers'),
            'offer' => $offer,
        ]);
    }

    public function customerConfirm(
        Request $request,
        Trip $trip,
        TripAssignmentService $tripAssignmentService,
        NotificationService $notificationService,
        \App\Services\NotificationCenter $notifier
    ) {
        $data = $request->validate([
            'final_fare' => ['required', 'numeric', 'min:0'],
            'accepted_offer_id' => ['required', 'integer', 'exists:fare_negotiation_offers,id'],
        ]);

        $user = $request->user();
        if ($trip->customer_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        if ($trip->status !== 'NEGOTIATION') {
            return response()->json(['message' => 'Trip is not in negotiation state.'], 409);
        }

        $negotiation = FareNegotiation::query()
            ->where('trip_id', $trip->id)
            ->first();

        if (!$negotiation) {
            return response()->json(['message' => 'Nothing to confirm yet.'], 409);
        }

        $finalFare = (float) $data['final_fare'];
        $acceptedOffer = $negotiation->offers()
            ->where('id', $data['accepted_offer_id'])
            ->where('from_role', 'driver')
            ->first();

        if (!$acceptedOffer || !$acceptedOffer->from_user_id) {
            return response()->json(['message' => 'Selected offer was not found on this trip.'], 422);
        }

        if (abs($finalFare - (float) $acceptedOffer->amount) > 0.01) {
            return response()->json(['message' => 'final_fare must match the selected offer amount.'], 422);
        }

        $confirmed = $tripAssignmentService->confirm($trip->id, (int) $acceptedOffer->id, $finalFare);
        if (!$confirmed) {
            return response()->json(['message' => 'Trip could not be confirmed (already taken or no longer in negotiation).'], 409);
        }

        // Record the winning bid + the winning driver, then close out every
        // other still-live bid now that the customer has chosen. confirm() has
        // already moved the trip out of NEGOTIATION, so the pool stops seeing it.
        $acceptedOffer->status = 'ACCEPTED';
        $acceptedOffer->accepted_by_user_id = $user->id;
        $acceptedOffer->decision_at = now();
        $acceptedOffer->save();

        $negotiation->offers()
            ->where('status', 'PENDING')
            ->where('id', '!=', $acceptedOffer->id)
            ->update(['status' => 'SUPERSEDED']);

        $negotiation->driver_id = $acceptedOffer->from_user_id;
        $negotiation->final_amount = $finalFare;
        $negotiation->status = 'LOCKED';
        $negotiation->locked_at = now();
        $negotiation->save();

        // FCM: notify the driver whose counter-offer was accepted.
        $driver = User::query()->find($acceptedOffer->from_user_id);
        if ($driver) {
            $notificationService->sendToUser(
                $driver,
                'You got the trip',
                "Trip #{$confirmed->id} confirmed at \u{20B9}" . number_format($finalFare, 0),
                [
                    'type' => 'trip_confirmed',
                    'trip_id' => $confirmed->id,
                    'final_fare' => $finalFare,
                ]
            );
        }

        // Scheduled ride → record inbox notifications (with the pickup time) for
        // the customer, the assigned driver and the admins.
        if ($confirmed->scheduled_at) {
            $whenText = $confirmed->scheduled_at->copy()->timezone(config('app.timezone'))->format('D, d M · g:i A');
            $payload = ['trip_id' => $confirmed->id, 'scheduled_at' => $confirmed->scheduled_at->toIso8601String()];

            $notifier->notifyUserId($trip->customer_id, 'scheduled_ride_driver_assigned',
                'Driver confirmed', "A driver is confirmed for your {$whenText} ride.", $payload, 'car-outline');

            if ($driver) {
                $notifier->notify($driver, 'scheduled_ride_driver_assigned',
                    'Upcoming scheduled ride', "You're booked for trip #{$confirmed->id} on {$whenText}.", $payload, 'calendar-outline', push: false);
            }

            $notifier->notifyAdmins('scheduled_ride_driver_assigned',
                'Scheduled ride assigned', "Trip #{$confirmed->id} ({$whenText}) now has a driver.", $payload, 'car-outline');
        }

        return response()->json(['trip' => $confirmed->fresh()]);
    }

    /**
     * The one knob the apps need: the minimum offer for this route (the pricing
     * rule's min_fare). Neither side may offer below it; the apps disable their
     * send button below it and this is the server backstop.
     *
     * @return array{min_amount: float}
     */
    private function negotiationConfig(Trip $trip): array
    {
        $minFare = 0.0;
        if ($trip->city_vehicle_type_id) {
            $rule = \App\Models\PricingRule::resolveFor((int) $trip->city_vehicle_type_id);
            if ($rule && isset($rule['min_fare'])) {
                $minFare = (float) $rule['min_fare'];
            }
        }
        // If a city has no min_fare configured, fall back to a safe floor so a
        // missing pricing row can't reopen ₹1 spam.
        if ($minFare <= 0) {
            $minFare = max(50.0, round(((float) ($trip->estimated_fare ?? 0)) * 0.4, 2));
        }

        return ['min_amount' => round($minFare, 2)];
    }
}

