<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Fired by DispatchHopJob each time the expanding-ring auto-dispatcher steps
 * out. Lets the customer-mobile match screen animate the search radius in
 * real time and reveal nearby drivers as the ring grows.
 */
class DispatchRingExpanded implements ShouldBroadcastNow
{
    use Dispatchable;
    use InteractsWithSockets;
    use SerializesModels;

    /**
     * @param  array<int, array{driver_id:int,name:?string,vehicle:?string,reg_no:?string,lat:?float,lng:?float,distance_km:?float}>  $drivers
     */
    public function __construct(
        public int $tripId,
        public int $hop,
        public int $maxHops,
        public int $radiusMeters,
        public int $hopIntervalSec,
        public int $eligibleDriverCount,
        public array $drivers = [],
    ) {
    }

    public function broadcastOn(): array
    {
        // Dispatch hops happen during NEGOTIATION (before a driver is locked
        // in), so the customer is subscribed to the negotiation channel.
        return [new PrivateChannel('trip.' . $this->tripId . '.negotiation')];
    }

    public function broadcastAs(): string
    {
        return 'DispatchRingExpanded';
    }

    public function broadcastWith(): array
    {
        return [
            'type' => 'dispatch_ring_expanded',
            'trip_id' => $this->tripId,
            'hop' => $this->hop,
            'max_hops' => $this->maxHops,
            'radius_m' => $this->radiusMeters,
            'hop_interval_sec' => $this->hopIntervalSec,
            'eligible_drivers' => $this->eligibleDriverCount,
            'drivers' => $this->drivers,
        ];
    }
}
