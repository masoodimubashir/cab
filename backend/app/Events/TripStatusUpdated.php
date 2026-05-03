<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class TripStatusUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public int $tripId,
        public string $status,
    ) {
    }

    public function broadcastOn(): array
    {
        // Reuse the live tracking channel for status updates as well.
        return [new Channel('trip.' . $this->tripId . '.tracking')];
    }

    public function broadcastWith(): array
    {
        return [
            'type' => 'status_updated',
            'trip_id' => $this->tripId,
            'status' => $this->status,
        ];
    }
}

