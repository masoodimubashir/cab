<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class FixedRouteCatalogUpdated implements ShouldBroadcast
{
    use Dispatchable, SerializesModels;

    public function __construct(
        public int $cityId,
        public ?int $routeId = null,
        public string $reason = 'route_changed',
    ) {}

    public function broadcastOn(): array
    {
        return [
            new Channel('fixed.catalog'),
            new Channel('fixed.city.' . $this->cityId),
        ];
    }

    public function broadcastAs(): string
    {
        return 'FixedRouteCatalogUpdated';
    }

    public function broadcastWith(): array
    {
        return [
            'type' => 'fixed_route_catalog_updated',
            'city_id' => $this->cityId,
            'route_id' => $this->routeId,
            'reason' => $this->reason,
        ];
    }
}
