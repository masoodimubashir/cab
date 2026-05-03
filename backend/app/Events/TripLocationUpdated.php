<?php

namespace App\Events;

use App\Models\DriverLocation;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class TripLocationUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public int $tripId,
        public DriverLocation $location,
    ) {
    }

    public function broadcastOn(): array
    {
        return [new Channel('trip.' . $this->tripId . '.tracking')];
    }

    public function broadcastWith(): array
    {
        return [
            'type' => 'location_updated',
            'location' => $this->location->toArray(),
        ];
    }
}

