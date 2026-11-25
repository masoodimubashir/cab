<?php

namespace App\Services\Carpool;

use App\Models\Carpool\CarpoolAdminAction;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Auth;

/** Writes and reads the carpool admin log (one place, so every action is recorded the same way). */
class CarpoolAdminLog
{
    /**
     * @param array<string, mixed> $context subject_user_id, listing_id, note, before, after
     */
    public static function record(string $action, string $targetType, ?int $targetId, array $context = []): CarpoolAdminAction
    {
        $admin = Auth::user();

        return CarpoolAdminAction::query()->create([
            'admin_id' => $admin?->id,
            'admin_name' => $admin?->name,
            'action' => $action,
            'target_type' => $targetType,
            'target_id' => $targetId,
            'subject_user_id' => $context['subject_user_id'] ?? null,
            'listing_id' => $context['listing_id'] ?? null,
            'note' => isset($context['note']) && trim((string) $context['note']) !== '' ? trim((string) $context['note']) : null,
            'before' => $context['before'] ?? null,
            'after' => $context['after'] ?? null,
        ]);
    }

    /** History of one thing (a carpool, a report, a plan...). */
    public static function forTarget(string $targetType, int $targetId, int $limit = 50): Collection
    {
        return CarpoolAdminAction::query()->where('target_type', $targetType)->where('target_id', $targetId)
            ->orderByDesc('id')->limit($limit)->get()->map->toEntry()->values();
    }

    /** Everything done on a carpool, including to its requests. */
    public static function forListing(int $listingId, int $limit = 50): Collection
    {
        return CarpoolAdminAction::query()
            ->where(fn ($q) => $q->where('listing_id', $listingId)->orWhere(fn ($w) => $w->where('target_type', 'listing')->where('target_id', $listingId)))
            ->orderByDesc('id')->limit($limit)->get()->map->toEntry()->values();
    }

    /** Everything done about one person (bans, restores, reports closed about them...). */
    public static function forPerson(int $userId, int $limit = 50): Collection
    {
        return CarpoolAdminAction::query()->where('subject_user_id', $userId)
            ->orderByDesc('id')->limit($limit)->get()->map->toEntry()->values();
    }
}
