<?php

namespace App\Events;

use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Carbon;

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
        public ?string $expiresAt = null,
    ) {}

    public function broadcastOn(): array
    {
        return [
            new PrivateChannel('driver.' . $this->driverUserId),
            new PrivateChannel('departure.' . $this->routeDepartureId),
            new PrivateChannel('fixed-hold.' . $this->holdId),
        ];
    }

    public function broadcastAs(): string
    {
        return 'FixedSeatHoldRequested';
    }

    public function broadcastWith(): array
    {
        $expiresAtStr = $this->expiresAt ?? now()->addSeconds($this->expiresInSec)->toIso8601String();
        $targetTime = Carbon::parse($expiresAtStr);
        $remainingSec = max(0, (int) now()->diffInSeconds($targetTime, false));

        return [
            'type' => 'fixed_seat_hold_requested',
            'hold_id' => $this->holdId,
            'departure_id' => $this->routeDepartureId,
            'route_departure_id' => $this->routeDepartureId,
            'customer_id' => $this->customerId,
            'customer_name' => $this->customerName,
            'seat_labels' => $this->seatLabels,
            'seats' => $this->seats,
            'board_name' => $this->boardStopName,
            'drop_name' => $this->dropStopName,
            'board_stop' => $this->boardStopName,
            'drop_stop' => $this->dropStopName,
            'board_stop_name' => $this->boardStopName,
            'drop_stop_name' => $this->dropStopName,
            'amount' => $this->amount,
            'expires_at' => $expiresAtStr,
            'expires_in_sec' => $remainingSec,
        ];
    }
}
