<?php

namespace App\Events;

use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class FixedSeatHoldAccepted implements ShouldBroadcast
{
    use Dispatchable, SerializesModels;

    public function __construct(
        public int $customerId,
        public int $holdId,
        public int $routeDepartureId,
        public array $seatLabels,
        public float $amount,
        public string $expiresAt,
        public int $paymentWindowSec = 300,
    ) {}

    public function broadcastOn(): array
    {
        return [
            new PrivateChannel('customer.' . $this->customerId),
            new PrivateChannel('fixed-hold.' . $this->holdId),
            new PrivateChannel('departure.' . $this->routeDepartureId),
        ];
    }

    public function broadcastAs(): string
    {
        return 'FixedSeatHoldAccepted';
    }

    public function broadcastWith(): array
    {
        return [
            'type' => 'fixed_seat_hold_accepted',
            'hold_id' => $this->holdId,
            'route_departure_id' => $this->routeDepartureId,
            'departure_id' => $this->routeDepartureId,
            'seat_labels' => $this->seatLabels,
            'amount' => $this->amount,
            'expires_at' => $this->expiresAt,
            'payment_window_sec' => $this->paymentWindowSec,
        ];
    }
}
