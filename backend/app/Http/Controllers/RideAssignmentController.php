<?php

namespace App\Http\Controllers;

use App\Models\Driver;
use App\Models\FareNegotiation;
use App\Models\RouteDeparture;
use App\Models\SeatReservation;
use App\Models\Trip;
use App\Models\TripAssignment;
use App\Services\TripStateMachineService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class RideAssignmentController extends Controller
{
    public function accept(Request $request, Trip $trip, TripStateMachineService $tripStateMachineService)
    {
        $user = $request->user();

        if ($trip->status !== 'CONFIRMED') {
            return response()->json(['message' => 'Trip is not ready for assignment.'], 409);
        }

        $driverProfile = Driver::query()->where('user_id', $user->id)->first();
        if (!$driverProfile) {
            return response()->json(['message' => 'Driver profile not found.'], 404);
        }

        if ($driverProfile->approval_status !== 'approved' || !$driverProfile->is_online) {
            return response()->json(['message' => 'Driver must be approved and online.'], 422);
        }

        if ($trip->route_departure_id === null) {
            $trip->loadMissing("cityVehicleType.rideType:id,name");
            $serviceMode = ($trip->cityVehicleType?->rideType?->isShuttle() ?? false)
                ? Driver::SERVICE_MODE_SHUTTLE
                : Driver::SERVICE_MODE_PRIVATE;
            if ($driverProfile->active_service_scope !== ($trip->scope ?: Driver::SERVICE_SCOPE_LOCAL) || $driverProfile->active_service_mode !== $serviceMode) {
                $label = $serviceMode === Driver::SERVICE_MODE_SHUTTLE ? "Shuttle" : "private";
                return response()->json(['message' => "Choose " . $label . " ride mode before accepting this ride."], 422);
            }
        }

        if ($trip->driver_id && $trip->driver_id !== $user->id) {
            return response()->json(['message' => 'Trip already assigned to another driver.'], 409);
        }

        if ($trip->payment_method && !$user->acceptsPaymentMethod($trip->payment_method)) {
            return response()->json([
                'message' => 'You do not accept this payment method. Update your settings to accept ' . strtoupper($trip->payment_method) . '.',
            ], 422);
        }

        // Commission Validation During Ride Allocation
        $fare = (float) ($trip->final_fare ?? $trip->estimated_fare ?? 0);
        $subPct = app(\App\Services\SubscriptionService::class)->effectiveCommissionPercentForTrip($trip, -1.0);
        $expectedCommission = app(\App\Services\CommissionSettlementService::class)->commissionForFare(
            $trip->city_vehicle_type_id,
            $fare,
            (float) ($trip->toll_amount ?? 0),
            $subPct
        )['amount'];

        if (!app(\App\Services\WalletService::class)->canAffordCommission($user, $expectedCommission)) {
            $minLimit = app(\App\Services\WalletService::class)->minimumLimit();
            return response()->json([
                'message' => "Your wallet balance is too low to accept this ride. Projected balance would fall below the minimum limit of ₹{$minLimit} after the ₹{$expectedCommission} commission charge. Please recharge your wallet.",
                'error_code' => 'insufficient_wallet_for_commission',
            ], 422);
        }

        // Authoritative one-trip-per-driver guard: serialise on the driver row
        // and reject if they already hold another committed trip (e.g. a
        // pre-assigned shared trip). This is the backstop that makes a
        // double-booking impossible regardless of which feed surfaced it.
        $conflict = DB::transaction(function () use ($user, $trip) {
            Driver::query()->where('user_id', $user->id)->lockForUpdate()->first();
            $other = Trip::query()
                ->where('driver_id', $user->id)
                ->where('id', '!=', $trip->id)
                ->whereIn('status', Trip::DRIVER_BUSY_STATUSES)
                ->exists();
            if ($other) {
                return true;
            }

            TripAssignment::query()->updateOrCreate(
                ['trip_id' => $trip->id, 'driver_id' => $user->id],
                ['status' => 'ACCEPTED', 'assigned_at' => now(), 'decided_at' => now()]
            );
            $trip->driver_id = $user->id;
            $trip->save();
            return false;
        });

        if ($conflict) {
            return response()->json(['message' => 'You already have an active trip.'], 409);
        }

        // Link negotiation thread to the assigned driver.
        $negotiation = FareNegotiation::query()->where('trip_id', $trip->id)->first();
        if ($negotiation) {
            $negotiation->driver_id = $user->id;
            $negotiation->save();
        }

        $tripStateMachineService->transition($trip, 'ASSIGNED');

        return response()->json(['trip' => $trip->fresh()->appendDriverRiderContact()]);
    }

    public function reject(Request $request, Trip $trip)
    {
        $user = $request->user();

        if ($trip->status === 'PAYMENT_PENDING') {
            if ((int) $trip->driver_id !== (int) $user->id) {
                abort(403);
            }
            DB::transaction(function () use ($trip) {
                $locked = Trip::query()->lockForUpdate()->findOrFail($trip->id);
                if ($locked->status !== 'PAYMENT_PENDING') {
                    abort(409, 'This request has changed. Refresh and try again.');
                }
                app(TripStateMachineService::class)->transition($locked, 'CANCELLED', ['cancelled_reason' => 'driver_rejected']);
                app(\App\Services\ShuttleRefundService::class)->markCancelledForTrip($locked, 'driver_rejected');
            });
            return response()->json(['message' => 'Request rejected.']);
        }

        if ($trip->status !== 'CONFIRMED' && $trip->status !== 'NEGOTIATION') {
            return response()->json(['message' => 'Trip is not in an assignable state.'], 409);
        }

        $driverProfile = Driver::query()->where('user_id', $user->id)->first();
        if (!$driverProfile) {
            return response()->json(['message' => 'Driver profile not found.'], 404);
        }

        TripAssignment::query()->updateOrCreate(
            ['trip_id' => $trip->id, 'driver_id' => $user->id],
            ['status' => 'REJECTED', 'decided_at' => now()]
        );

        // Supersede any pending offers from this driver on this trip
        $negotiation = FareNegotiation::query()->where('trip_id', $trip->id)->first();
        if ($negotiation) {
            $negotiation->offers()
                ->where('status', 'PENDING')
                ->where('from_user_id', $user->id)
                ->update(['status' => 'SUPERSEDED']);
        }

        // Shared route departure rejection
        if ($trip->isShared() && (int) $trip->driver_id === (int) $user->id) {
            DB::transaction(function () use ($trip) {
                $dep = RouteDeparture::query()->lockForUpdate()->find($trip->route_departure_id);
                if ($dep) {
                    $dep->update([
                        'trip_id' => null,
                        'driver_id' => null,
                        'status' => $dep->route_schedule_id ? 'SCHEDULED' : 'FORMING',
                    ]);
                }
                SeatReservation::query()->where('trip_id', $trip->id)->update(['trip_id' => null]);
                $trip->update([
                    'driver_id' => null,
                    'status' => 'CANCELLED',
                    'cancelled_at' => now(),
                    'cancelled_reason' => 'shared_driver_rejected',
                ]);
            });
        } elseif (!$trip->isShared()) {
            // Private ride rejection: unbind the driver, revert trip to NEGOTIATION, and re-dispatch
            DB::transaction(function () use ($trip, $user) {
                if ((int) $trip->driver_id === (int) $user->id) {
                    $trip->update([
                        'driver_id' => null,
                        'status' => 'NEGOTIATION',
                    ]);
                }
            });

            // Start a new dispatch chain if fare exists
            $fare = (float) ($trip->final_fare ?? $trip->estimated_fare ?? 0);
            if ($fare > 0 && $trip->status === 'NEGOTIATION') {
                \App\Jobs\DispatchHopJob::startChain($trip->id, $fare);
            }

            if ($trip->customer_id) {
                app(\App\Services\NotificationCenter::class)->notifyUserId(
                    (int) $trip->customer_id,
                    'driver_declined_redispatching',
                    'Searching for another driver',
                    'Your driver was unable to accept. We are finding another driver for you.',
                    ['trip_id' => $trip->id],
                    'car-outline'
                );
            }
        }

        return response()->json(['message' => 'Rejected.']);
    }
}
