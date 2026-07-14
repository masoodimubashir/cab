<?php

namespace App\Services;

use App\Events\AppNotificationCreated;
use App\Models\AppNotification;
use App\Models\User;
use App\Models\UserRole;
use Illuminate\Support\Facades\Log;

class NotificationCenter
{
    public function notify(
        User $user,
        string $type,
        string $title,
        string $body,
        array $data = [],
        ?string $icon = null,
        bool $push = true,
    ): AppNotification {
        $note = AppNotification::create([
            "user_id" => $user->id,
            "type" => $type,
            "title" => $title,
            "body" => $body,
            "data" => $data ?: null,
            "icon" => $icon,
        ]);

        $this->broadcastSafely($note);
        $this->deliverOperatorChannelsSafely($user, $type, $title, $body, $data);

        if ($push) {
            $this->pushSafely($user, $title, $body, array_merge($data, [
                "type" => $type,
                "notification_id" => $note->id,
            ]));
        }

        return $note;
    }

    public function notifyUserId(
        ?int $userId,
        string $type,
        string $title,
        string $body,
        array $data = [],
        ?string $icon = null,
        bool $push = true,
    ): ?AppNotification {
        if (!$userId) {
            return null;
        }
        $user = User::query()->find($userId);
        if (!$user) {
            return null;
        }
        return $this->notify($user, $type, $title, $body, $data, $icon, $push);
    }

    public function notifyAdmins(
        string $type,
        string $title,
        string $body,
        array $data = [],
        ?string $icon = null,
        bool $push = false,
    ): void {
        $adminIds = UserRole::query()->where("role", "admin")->pluck("user_id")->unique();
        foreach ($adminIds as $adminId) {
            $this->notifyUserId((int) $adminId, $type, $title, $body, $data, $icon, $push);
        }
    }

    private function deliverOperatorChannelsSafely(User $user, string $type, string $title, string $body, array $data): void
    {
        try {
            app(OperatorNotificationDeliveryService::class)->deliver($user, $type, $title, $body, $data);
        } catch (\Throwable $e) {
            Log::warning("Operator notification delivery failed", [
                "user_id" => $user->id,
                "type" => $type,
                "error" => $e->getMessage(),
            ]);
        }
    }

    private function pushSafely(User $user, string $title, string $body, array $data): void
    {
        if ($user->push_unsubscribed) {
            return;
        }

        try {
            app(NotificationService::class)->sendToUser($user, $title, $body, $data);
        } catch (\Throwable $e) {
            Log::warning("In-app push failed (notification still recorded)", [
                "user_id" => $user->id,
                "error" => $e->getMessage(),
            ]);
        }
    }

    private function broadcastSafely(AppNotification $notification): void
    {
        try {
            broadcast(new AppNotificationCreated($notification));
        } catch (\Throwable $e) {
            Log::warning("In-app notification broadcast failed", [
                "notification_id" => $notification->id,
                "user_id" => $notification->user_id,
                "error" => $e->getMessage(),
            ]);
        }
    }
}
