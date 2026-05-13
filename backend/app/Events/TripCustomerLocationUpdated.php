<?php

namespace App\Events;

use App\Models\CustomerLocation;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class TripCustomerLocationUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public int $tripId,
        public CustomerLocation $location,
    ) {
    }

    public function broadcastOn(): array
    {
        return [new PrivateChannel('trip.' . $this->tripId . '.tracking')];
    }

    public function broadcastAs(): string
    {
        return 'TripCustomerLocationUpdated';
    }

    public function broadcastWith(): array
    {
        return [
            'type' => 'customer_location_updated',
            'location' => $this->location->toArray(),
        ];
    }
}
