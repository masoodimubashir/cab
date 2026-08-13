<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Fired the instant a shuttle rider's boarding code is generated (the driver just
 * requested boarding), nudging that rider's live-trip screen to fetch the code
 * immediately (via the owner-only endpoint) so the full-screen prompt pops with
 * no poll delay. Mirrors StartOtpReady for the private start-ride code.
 *
 * Carries NO code — the tracking channel is shared, so the payload is a bare
 * signal; each rider still fetches their OWN code from the owner-only endpoint.
 */
class ShuttleBoardingCodeReady implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(public int $tripId)
    {
    }

    public function broadcastOn(): array
    {
        return [new PrivateChannel('trip.' . $this->tripId . '.tracking')];
    }

    public function broadcastAs(): string
    {
        return 'ShuttleBoardingCodeReady';
    }

    public function broadcastWith(): array
    {
        return [
            'type' => 'shuttle_boarding_code_ready',
            'trip_id' => $this->tripId,
        ];
    }
}
