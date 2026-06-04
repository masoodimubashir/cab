<?php

namespace App\Http\Controllers;

use App\Models\AppNotification;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/**
 * The in-app notification inbox. Role-agnostic — it always operates on the
 * authenticated user's own notifications, so the same endpoints serve the
 * customer app, driver app and admin panel.
 */
class NotificationsController
{
    /**
     * Paginated inbox, newest first. Pass ?unread=1 to only get unread rows.
     * Always includes the current unread_count for badges.
     */
    public function index(Request $request)
    {
        $user = $request->user();

        $query = AppNotification::query()->where('user_id', $user->id);

        if ($request->boolean('unread')) {
            $query->whereNull('read_at');
        }

        $perPage = (int) $request->query('per_page', 20);
        $perPage = max(1, min(50, $perPage));

        $notifications = $query->orderByDesc('created_at')->paginate($perPage);

        $unreadCount = AppNotification::query()
            ->where('user_id', $user->id)
            ->whereNull('read_at')
            ->count();

        return response()->json([
            'data' => $notifications,
            'unread_count' => $unreadCount,
        ]);
    }

    /** Lightweight unread count for a badge — cheap to poll. */
    public function unreadCount(Request $request)
    {
        $count = AppNotification::query()
            ->where('user_id', $request->user()->id)
            ->whereNull('read_at')
            ->count();

        return response()->json(['count' => $count]);
    }

    /** Mark a single notification read (must belong to the caller). */
    public function markRead(Request $request, AppNotification $appNotification)
    {
        abort_unless($appNotification->user_id === $request->user()->id, 404);

        if ($appNotification->read_at === null) {
            $appNotification->update(['read_at' => Carbon::now()]);
        }

        return response()->json(['notification' => $appNotification]);
    }

    /** Mark every unread notification read. */
    public function markAllRead(Request $request)
    {
        AppNotification::query()
            ->where('user_id', $request->user()->id)
            ->whereNull('read_at')
            ->update(['read_at' => Carbon::now()]);

        return response()->json(['ok' => true, 'unread_count' => 0]);
    }
}
