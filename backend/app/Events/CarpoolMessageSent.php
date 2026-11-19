<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/** A chat message, pushed live to everyone in the carpool conversation (P9). */
class CarpoolMessageSent implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    /** @param array<string, mixed> $message the message as the API shows it (without "mine") */
    public function __construct(public int $conversationId, public array $message)
    {
    }

    public function broadcastOn(): array
    {
        return [new PrivateChannel('carpool.conversation.' . $this->conversationId)];
    }

    public function broadcastAs(): string
    {
        return 'CarpoolMessageSent';
    }

    public function broadcastWith(): array
    {
        return ['conversation_id' => $this->conversationId, 'message' => $this->message];
    }
}
