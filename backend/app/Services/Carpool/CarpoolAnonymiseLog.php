<?php

namespace App\Services\Carpool;

use App\Models\Carpool\CarpoolAdminAction;
use App\Models\User;

/** The admin-log line for an anonymise: the admin who deleted, or "The account owner" for a self-delete. */
class CarpoolAnonymiseLog
{
    public static function record(User $user, ?User $by, string $reason, ?int $driverId): void
    {
        CarpoolAdminAction::query()->create([
            'admin_id' => $by?->id,
            'admin_name' => $by ? $by->name : 'The account owner',
            'action' => 'anonymise',
            'target_type' => $driverId ? 'driver' : 'user',
            'target_id' => $driverId ?: $user->id,
            'subject_user_id' => $user->id,
            'note' => mb_substr($reason, 0, 500),
            'after' => ['name' => CarpoolAnonymiser::NAME],
        ]);
    }
}
