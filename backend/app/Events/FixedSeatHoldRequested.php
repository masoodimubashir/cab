<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class FixedSeatHoldRequested implements ShouldBroadcast
{
    use Dispatchable, SerializesModels;

    public function __construct(
        public int $driverUserId,
        public int $holdId,
        public int $routeDepartureId,
        public int $customerId,
        public string $customerName,
        public string $customerPhone,
        public array $seatLabels,
        public int $seats,
        public string $boardStopName,
        public string $dropStopName,
        public float $amount,
        public int $expiresInSec = 60,
    ) {}

    public function broadcastOn(): array
    {
        return [
            new Channel('driver.' . $this->driverUserId),
            new Channel('departure.' . $this->routeDepartureId),
            new Channel('fixed-hold.' . $this->holdId),
        ];
    }

    public function broadcastAs(): string
    {
        return 'FixedSeatHoldRequested';
    }

    public function broadcastWith(): array
    {
        return [
            'type' => 'fixed_seat_hold_requested',
            'hold_id' => $this->holdId,
            'route_departure_id' => $this->routeDepartureId,
            'customer_id' => $this->customerId,
            'customer_name' => $this->customerName,
            'customer_phone' => $this->customerPhone,
            'seat_labels' => $this->seatLabels,
            'seats' => $this->seats,
            'board_stop_name' => $this->boardStopName,
            'drop_stop_name' => $this->dropStopName,
            'amount' => $this->amount,
            'expires_in_sec' => $this->expiresInSec,
        ];
    }
}
