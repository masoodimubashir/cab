<?php

namespace App\Services;

use App\Models\Trip;
use App\Events\TripStatusUpdated;

class TripStateMachineService
{
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
                $trip->completed_at = now();
                break;
            case 'CANCELLED':
                $trip->cancelled_at = now();
                $trip->cancelled_reason = $meta['cancelled_reason'] ?? $trip->cancelled_reason;
                break;
        }

        $trip->save();

        // Emit real-time status updates (used by customer/admin live tracking).
        //broadcast(new TripStatusUpdated(tripId: $trip->id, status: $to))->toOthers();

        return $trip->fresh();
    }
}

