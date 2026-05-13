<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class FareNegotiationLocked implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public int $tripId,
        public float $finalFare,
    ) {
    }

    public function broadcastOn(): array
    {
        return [new PrivateChannel('trip.' . $this->tripId . '.negotiation')];
    }

    public function broadcastAs(): string
    {
        return 'FareNegotiationLocked';
    }

    public function broadcastWith(): array
    {
        return [
            'type' => 'negotiation_locked',
            'final_fare' => $this->finalFare,
        ];
    }
}

