<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * A rider on a shuttle pool boarded, was dropped, or otherwise changed — nudges
 * the driver's live pool screen (and riders' screens) to refresh the manifest.
 * Rides on the trip's existing tracking channel, so no new subscription is needed.
 */
class ShuttleManifestUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public int $tripId,
        public int $journeyId,
    ) {
    }

    public function broadcastOn(): array
    {
        return [new PrivateChannel('trip.' . $this->tripId . '.tracking')];
    }

    public function broadcastAs(): string
    {
        return 'ShuttleManifestUpdated';
    }

    public function broadcastWith(): array
    {
        return [
            'type' => 'shuttle_manifest_updated',
            'trip_id' => $this->tripId,
            'journey_id' => $this->journeyId,
        ];
    }
}
