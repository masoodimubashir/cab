<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Fired the instant the driver requests the start-ride OTP, nudging the booker's
 * live-trip screen to fetch the code immediately (via the owner-only endpoint)
 * instead of waiting for the next poll.
 *
 * Carries NO code. The tracking channel is shared with the driver, so the
 * payload is a bare signal — the booker still has to call the owner-only
 * endpoint to obtain the actual digits.
 */
class StartOtpReady implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(public int $tripId)
    {
    }

    public function broadcastOn(): array
    {
        // Reuse the live tracking channel (same one status updates ride on).
        return [new PrivateChannel('trip.' . $this->tripId . '.tracking')];
    }

    public function broadcastAs(): string
    {
        return 'StartOtpReady';
    }

    public function broadcastWith(): array
    {
        return [
            'type' => 'start_otp_ready',
            'trip_id' => $this->tripId,
        ];
    }
}
