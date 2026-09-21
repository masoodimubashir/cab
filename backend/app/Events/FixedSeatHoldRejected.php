<?php

namespace App\Events;

use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class FixedSeatHoldRejected implements ShouldBroadcast
{
    use Dispatchable, SerializesModels;

    public function __construct(
        public int $customerId,
        public int $holdId,
        public int $routeDepartureId,
        public string $reason = 'driver_rejected',
    ) {}

    public function broadcastOn(): array
    {
        return [
            new PrivateChannel('customer.' . $this->customerId),
            new PrivateChannel('fixed-hold.' . $this->holdId),
            new PrivateChannel('departure.' . $this->routeDepartureId),
        ];
    }

    public function broadcastAs(): string
    {
        return 'FixedSeatHoldRejected';
    }

    public function broadcastWith(): array
    {
        return [
            'type' => 'fixed_seat_hold_rejected',
            'hold_id' => $this->holdId,
            'route_departure_id' => $this->routeDepartureId,
            'departure_id' => $this->routeDepartureId,
            'reason' => $this->reason,
        ];
    }
}
