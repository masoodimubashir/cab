<?php

namespace App\Events;

use App\Models\SafetyEvent;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class SosTriggered implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public int $tripId,
        public SafetyEvent $event,
    ) {
    }

    public function broadcastOn(): array
    {
        return [new Channel('trip.' . $this->tripId . '.sos')];
    }

    public function broadcastWith(): array
    {
        return [
            'type' => 'sos_triggered',
            'safety_event' => $this->event->toArray(),
        ];
    }
}

