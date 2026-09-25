<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class AppBannerUpdated implements ShouldBroadcastNow
{
    use Dispatchable, SerializesModels;

    public function __construct(
        public string $targetApp = 'both',
        public string $action = 'updated',
        public ?int $bannerId = null,
    ) {}

    public function broadcastOn(): array
    {
        return [
            new Channel('app-banners'),
        ];
    }

    public function broadcastAs(): string
    {
        return 'AppBannerUpdated';
    }

    public function broadcastWith(): array
    {
        return [
            'type' => 'app_banner_updated',
            'target_app' => $this->targetApp,
            'action' => $this->action,
            'banner_id' => $this->bannerId,
        ];
    }
}
