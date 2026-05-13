<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
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
        return [new PrivateChannel('trip.' . $this->tripId . '.tracking')];
    }

    /**
     * Override the default fully-qualified-class name so mobile clients can
     * `channel.bind('TripStatusUpdated', ...)` without having to escape the
     * namespace.
     */
    public function broadcastAs(): string
    {
        return 'TripStatusUpdated';
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

