<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class DriverVerificationUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public int $userId,
        public ?int $driverId,
        public string $reason,
        public ?int $documentId = null,
        public ?string $status = null,
    ) {
    }

    public function broadcastOn(): array
    {
        return [new PrivateChannel('App.Models.User.' . $this->userId)];
    }

    public function broadcastAs(): string
    {
        return 'DriverVerificationUpdated';
    }

    public function broadcastWith(): array
    {
        return [
            'type' => 'driver_verification_updated',
            'driver_id' => $this->driverId,
            'reason' => $this->reason,
            'document_id' => $this->documentId,
            'status' => $this->status,
        ];
    }
}
