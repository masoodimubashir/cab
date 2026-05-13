<?php

namespace App\Events;

use App\Models\TripMessage;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class TripMessageSent implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public int $tripId,
        public TripMessage $message,
    ) {
    }

    public function broadcastOn(): array
    {
        return [new PrivateChannel('trip.' . $this->tripId . '.chat')];
    }

    public function broadcastAs(): string
    {
        return 'TripMessageSent';
    }

    public function broadcastWith(): array
    {
        return [
            'type' => 'message_sent',
            'message' => $this->message->toArray(),
        ];
    }
}

