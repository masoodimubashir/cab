<?php

namespace App\Services;

use App\Models\AppNotification;
use App\Models\User;
use App\Models\UserRole;
use Illuminate\Support\Facades\Log;

/**
 * Single entry point for notifying people. Records an in-app notification row
 * (the inbox the apps render) and, optionally, fires an FCM push to the user's
 * devices via NotificationService.
 *
 * Push is best-effort: if Firebase isn't configured (e.g. local dev) or the
 * send fails, the in-app row is still written and the caller never sees an
 * exception.
 */
class NotificationCenter
{
    /**
     * Notify a single user.
     *
     * @param  array<string, mixed>  $data  extra payload (e.g. ['trip_id' => 12])
     */
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
            'user_id' => $user->id,
            'type' => $type,
            'title' => $title,
            'body' => $body,
            'data' => $data ?: null,
            'icon' => $icon,
        ]);

        if ($push) {
            $this->pushSafely($user, $title, $body, array_merge($data, [
                'type' => $type,
                'notification_id' => $note->id,
            ]));
        }

        return $note;
    }

    /**
     * Notify by user id — no-op if the user no longer exists.
     */
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

    /**
     * Notify every admin (in-app only by default — admins use the web panel and
     * usually have no push tokens). Best-effort; never throws.
     */
    public function notifyAdmins(
        string $type,
        string $title,
        string $body,
        array $data = [],
        ?string $icon = null,
        bool $push = false,
    ): void {
        $adminIds = UserRole::query()->where('role', 'admin')->pluck('user_id')->unique();
        foreach ($adminIds as $adminId) {
            $this->notifyUserId((int) $adminId, $type, $title, $body, $data, $icon, $push);
        }
    }

    /**
     * Push without ever bubbling an exception to the caller. The NotificationService
     * constructor throws when Firebase isn't configured, so we resolve it lazily
     * inside the try/catch.
     */
    private function pushSafely(User $user, string $title, string $body, array $data): void
    {
        try {
            app(NotificationService::class)->sendToUser($user, $title, $body, $data);
        } catch (\Throwable $e) {
            Log::warning('In-app push failed (notification still recorded)', [
                'user_id' => $user->id,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
