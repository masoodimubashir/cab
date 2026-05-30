<?php

namespace App\Services;

use App\Models\Trip;
use App\Models\User;
use App\Events\TripStatusUpdated;
use Illuminate\Support\Facades\DB;

class TripStateMachineService
{
    public function __construct(
        private NotificationService $notificationService,
        private FareEstimationService $fareEstimationService,
        private CommissionSettlementService $commissionSettlementService,
    ) {
    }


    /**
     * Allowed transitions for trip status.
     *
     * @return array<string, array<string, true>>
     */
    private function allowedTransitions(): array
    {
        return [
            'REQUESTED' => ['NEGOTIATION' => true, 'CANCELLED' => true],
            'NEGOTIATION' => ['CONFIRMED' => true, 'CANCELLED' => true],
            'CONFIRMED' => ['ASSIGNED' => true, 'CANCELLED' => true],
            'ASSIGNED' => [
                'EN_ROUTE_PICKUP' => true,
                'CANCELLED' => true,
            ],
            'EN_ROUTE_PICKUP' => ['ARRIVED_PICKUP' => true, 'CANCELLED' => true],
            'ARRIVED_PICKUP' => ['EN_ROUTE_DROP' => true, 'CANCELLED' => true],
            'EN_ROUTE_DROP' => ['ARRIVED_DROP' => true, 'CANCELLED' => true],
            'ARRIVED_DROP' => ['COMPLETED' => true, 'CANCELLED' => true],
            'COMPLETED' => [],
            'CANCELLED' => [],
        ];
    }

    public function transition(Trip $trip, string $to, array $meta = []): Trip
    {
        $from = $trip->status;
        $allowed = $this->allowedTransitions();

        if (!isset($allowed[$from][$to])) {
            throw new \InvalidArgumentException("Invalid trip transition from {$from} to {$to}.");
        }

        $trip->status = $to;

        switch ($to) {
            case 'NEGOTIATION':
                $trip->negotiation_started_at = now();
                break;
            case 'CONFIRMED':
                $trip->confirmed_at = now();
                if (isset($meta['final_fare'])) {
                    $trip->final_fare = (float) $meta['final_fare'];
                }
                break;
            case 'ASSIGNED':
                $trip->assigned_at = now();
                break;
            case 'EN_ROUTE_PICKUP':
                $trip->en_route_pickup_at = now();
                break;
            case 'ARRIVED_PICKUP':
                $trip->arrived_pickup_at = now();
                break;
            case 'EN_ROUTE_DROP':
                $trip->en_route_drop_at = now();
                break;
            case 'ARRIVED_DROP':
                $trip->arrived_drop_at = now();
                break;
            case 'COMPLETED':
                // Stamp completion first so recomputeFinal sees the closed window
                // when summing telemetry.
                $trip->completed_at = now();
                $negotiatedFloor = (float) ($trip->final_fare ?? $trip->estimated_fare ?? 0);
                $settle = $this->fareEstimationService->recomputeFinal($trip, $negotiatedFloor);
                $trip->final_fare = $settle['final_fare'];
                $trip->waiting_charge_amount = $settle['waiting_charge_amount'];
                break;
            case 'CANCELLED':
                $trip->cancelled_at = now();
                $trip->cancelled_reason = $meta['cancelled_reason'] ?? $trip->cancelled_reason;
                break;
        }

        $trip->save();

        // On completion, settle the operator's commission (honouring any
        // active subscription) and draw down the driver's subscription usage.
        if ($to === 'COMPLETED') {
            $this->commissionSettlementService->settle($trip);
        }

        $tripId = $trip->id;
        $customerId = $trip->customer_id;

        // Defer broadcast + FCM until any enclosing transaction commits, so
        // listeners and recipients never observe a status that's about to roll
        // back. afterCommit() fires immediately when no transaction is active.
        DB::afterCommit(function () use ($tripId, $to, $customerId, $meta) {
            broadcast(new TripStatusUpdated(tripId: $tripId, status: $to))->toOthers();

            $customerMessages = [
                'ASSIGNED' => ['Driver assigned', 'Your driver is on the way.'],
                'ARRIVED_PICKUP' => ['Driver has arrived', 'Your driver is at the pickup point.'],
                'EN_ROUTE_DROP' => ['Trip started', 'You are on your way to the destination.'],
                'COMPLETED' => ['Trip completed', 'Thanks for riding. Tap to pay and rate.'],
                'CANCELLED' => ['Trip cancelled', $meta['cancelled_reason'] ?? 'Your trip was cancelled.'],
            ];

            if (isset($customerMessages[$to]) && $customerId) {
                $customer = User::query()->find($customerId);
                if ($customer) {
                    [$title, $body] = $customerMessages[$to];
                    $this->notificationService->sendToUser($customer, $title, $body, [
                        'type' => 'trip_status',
                        'trip_id' => $tripId,
                        'status' => $to,
                    ]);
                }
            }
        });

        return $trip->fresh();
    }
}

