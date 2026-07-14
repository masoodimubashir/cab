<?php

namespace App\Events;

use App\Models\AppNotification;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class AppNotificationCreated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(public AppNotification $notification)
    {
    }

    public function broadcastOn(): array
    {
        return [new PrivateChannel("App.Models.User." . $this->notification->user_id)];
    }

    public function broadcastAs(): string
    {
        return "AppNotificationCreated";
    }

    public function broadcastWith(): array
    {
        return [
            "type" => "app_notification_created",
            "notification" => [
                "id" => $this->notification->id,
                "type" => $this->notification->type,
                "title" => $this->notification->title,
                "body" => $this->notification->body,
                "data" => $this->notification->data,
                "icon" => $this->notification->icon,
                "read_at" => optional($this->notification->read_at)->toIso8601String(),
                "created_at" => optional($this->notification->created_at)->toIso8601String(),
            ],
        ];
    }
}
