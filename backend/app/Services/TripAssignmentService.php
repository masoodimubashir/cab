<?php

namespace App\Services;

use App\Events\FareNegotiationLocked;
use App\Models\FareNegotiationOffer;
use App\Models\Trip;
use Illuminate\Support\Facades\DB;

class TripAssignmentService
{
    public function __construct(private TripStateMachineService $stateMachine)
    {
    }

    /**
     * Atomically claim an unassigned trip for a driver during negotiation.
     *
     * Returns the fresh Trip on success. Returns null when the trip is no
     * longer claimable: already taken by another driver, no longer in
     * NEGOTIATION, or doesn't exist.
     *
     * Callers should treat null as a 409 (someone else won, or customer cancelled).
     */
    public function claim(int $tripId, int $driverUserId): ?Trip
    {
        return DB::transaction(function () use ($tripId, $driverUserId) {
            $trip = Trip::query()
                ->where('id', $tripId)
                ->lockForUpdate()
                ->first();

            if (!$trip || $trip->status !== 'NEGOTIATION') {
                return null;
            }

            if ($trip->driver_id !== null && $trip->driver_id !== $driverUserId) {
                return null;
            }

            if ($trip->driver_id === null) {
                $trip->driver_id = $driverUserId;
                $trip->save();
            }

            return $trip->fresh();
        });
    }

    /**
     * Atomically confirm a trip against a specific driver offer.
     *
     * Locks the trip, validates the offer belongs to it and is from a driver,
     * binds the driver, writes the final fare, and transitions NEGOTIATION
     * -> CONFIRMED. Broadcasts the lock event after the DB transaction commits
     * so listeners never read stale state.
     *
     * Returns the fresh trip on success, null if the trip is no longer in
     * NEGOTIATION or the offer is invalid for this trip.
     */
    public function confirm(int $tripId, int $acceptedOfferId, float $finalFare): ?Trip
    {
        $result = DB::transaction(function () use ($tripId, $acceptedOfferId, $finalFare) {
            $trip = Trip::query()
                ->where('id', $tripId)
                ->lockForUpdate()
                ->first();

            if (!$trip || $trip->status !== 'NEGOTIATION') {
                return null;
            }

            $offer = FareNegotiationOffer::query()
                ->where('id', $acceptedOfferId)
                ->where('from_role', 'driver')
                ->first();

            if (!$offer || !$offer->from_user_id) {
                return null;
            }

            // Ensure offer is for this trip's negotiation.
            if ($trip->fareNegotiation && $offer->fare_negotiation_id !== $trip->fareNegotiation->id) {
                return null;
            }

            if ($trip->driver_id === null) {
                $trip->driver_id = $offer->from_user_id;
                $trip->save();
            } elseif ($trip->driver_id !== $offer->from_user_id) {
                return null;
            }

            $this->stateMachine->transition($trip, 'CONFIRMED', [
                'final_fare' => $finalFare,
            ]);

            return $trip->fresh();
        });

        if ($result) {
            DB::afterCommit(function () use ($result, $finalFare) {
                broadcast(new FareNegotiationLocked(
                    tripId: $result->id,
                    finalFare: $finalFare,
                ))->toOthers();
            });
        }

        return $result;
    }
}
