<?php

namespace App\Services;

use App\Events\FareNegotiationLocked;
use App\Models\Driver;
use App\Models\FareNegotiationOffer;
use App\Models\Trip;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class TripAssignmentService
{
    public function __construct(
        private TripStateMachineService $stateMachine,
        private WalletService $walletService,
        private CommissionSettlementService $commissionService,
        private SubscriptionService $subscriptionService,
    ) {
    }

    /**
     * Atomically confirm a trip against a specific driver offer.
     *
     * Validates:
     *   1. Trip is in NEGOTIATION
     *   2. Offer belongs to trip and is from driver
     *   3. Driver is not busy with another trip
     *   4. Driver's wallet projected balance meets the minimum limit for the commission
     *
     * Returns the fresh trip on success, null if invalid or ineligible.
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
                ->whereIn('status', ['PENDING', 'ACCEPTED'])
                ->first();

            if (!$offer || !$offer->from_user_id) {
                return null;
            }

            // Ensure offer is for this trip's negotiation.
            if ($trip->fareNegotiation && $offer->fare_negotiation_id !== $trip->fareNegotiation->id) {
                return null;
            }

            $driver = Driver::query()->where('user_id', $offer->from_user_id)->lockForUpdate()->first();
            if ($driver && $driver->service_modes !== null) {
                $trip->loadMissing('cityVehicleType.rideType');
                $mode = $trip->cityVehicleType?->rideType?->isShuttle()
                    ? Driver::SERVICE_MODE_SHUTTLE : Driver::SERVICE_MODE_PRIVATE;
                if (!$driver->is_online || $driver->approval_status !== 'approved' || $driver->active_service_mode !== $mode
                    || !in_array($driver->active_service_scope, [$trip->scope ?: Driver::SERVICE_SCOPE_LOCAL, Driver::SERVICE_SCOPE_BOTH], true)
                    || app(DriverServiceModeService::class)->hasActiveWork($driver, $trip->id)) {
                    return null;
                }
            }

            // Concurrency protection: Lock the driver user record so simultaneous
            // confirmations on different trips cannot both claim the same driver.
            $driverUser = User::query()->where('id', $offer->from_user_id)->lockForUpdate()->first();
            if (!$driverUser) {
                return null;
            }

            // Universal Wallet Validation Rule during ride allocation
            $subPct = $this->subscriptionService->effectiveCommissionPercentForTrip($trip, -1.0);
            $comm = $this->commissionService->commissionForFare(
                $trip->city_vehicle_type_id,
                $finalFare,
                (float) ($trip->toll_amount ?? 0),
                $subPct
            )['amount'];

            if (!$this->walletService->canAffordCommission($driverUser, $comm)) {
                return null;
            }

            // One-trip-per-driver guard (evaluated safely under the driver row lock)
            $driverBusy = Trip::query()
                ->where('driver_id', $offer->from_user_id)
                ->where('id', '!=', $trip->id)
                ->whereIn('status', Trip::DRIVER_BUSY_STATUSES)
                ->exists();
            if ($driverBusy) {
                return null;
            }

            if ($trip->driver_id === null) {
                $trip->driver_id = $offer->from_user_id;
                $trip->save();
            } elseif ($trip->driver_id !== $offer->from_user_id) {
                return null;
            }

            $this->stateMachine->transition($trip, 'PAYMENT_PENDING', [
                'final_fare' => $finalFare,
            ]);

            app(ShuttleBookingService::class)->driverApproved($trip);
            app(BookingConfirmationService::class)->confirmIfReady($trip);

            return $trip->fresh();
        }, 3);

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
