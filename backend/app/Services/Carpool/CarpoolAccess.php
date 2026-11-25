<?php

namespace App\Services\Carpool;

use App\Models\Carpool\CarpoolAdminAction;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * The one carpool access check (W5, Admin-Audit.md BK-05 and BK-08).
 *
 * Publish, join, chat, pickup answers, driver sign-up and the rider and driver home answers all ask here,
 * so a rule is written once. A person is stopped when
 *  - their carpool access is paused (admin pause),
 *  - their account is blocked (the normal Block on Customers and Drivers), or
 *  - their phone number is on the paused-numbers list (a paused person deleted the account and came
 *    back with a new one). That new account then inherits the pause, so every screen that shows
 *    "Paused" and every Restore button works as it does for any other pause.
 * Driver approval and deactivation stay checked where the driver is loaded (CarpoolListingService::driverFor).
 */
class CarpoolAccess
{
    public const PAUSED = 'Your carpool access is paused. Contact support.';
    public const BLOCKED = 'Your account is blocked. Contact support.';

    /** Why this person may not use carpool right now, or null when they may. */
    public static function reason(User $user): ?string
    {
        self::inheritPausedNumber($user);
        if ($user->carpool_banned_at) {
            return self::PAUSED;
        }
        if ($user->is_suspended) {
            return self::BLOCKED;
        }

        return null;
    }

    public static function blocked(User $user): bool
    {
        return self::reason($user) !== null;
    }

    /** @throws ValidationException when the person may not use carpool */
    public static function assertAllowed(User $user, string $field = 'carpool'): void
    {
        if ($reason = self::reason($user)) {
            throw ValidationException::withMessages([$field => $reason]);
        }
    }

    /** Remembers a paused person's phone (hashed). Called when they are paused and when a paused person deletes the account. */
    public static function rememberNumber(User $user): void
    {
        if (! $user->phone || ! $user->carpool_banned_at) {
            return;
        }
        DB::table('carpool_banned_phones')->updateOrInsert(['phone_hash' => CarpoolAnonymiser::phoneHash($user->phone)], [
            'reason' => mb_substr((string) $user->carpool_ban_reason, 0, 255), 'banned_at' => $user->carpool_banned_at,
            'source_user_id' => $user->id, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    /** Forgets the phone on restore. Returns true when an entry was removed. */
    public static function forgetNumber(User $user): bool
    {
        if (! $user->phone) {
            return false;
        }

        return DB::table('carpool_banned_phones')->where('phone_hash', CarpoolAnonymiser::phoneHash($user->phone))->delete() > 0;
    }

    /** Is this person's number on the paused list while their own account is not paused? */
    public static function numberIsPaused(User $user): bool
    {
        return (bool) $user->phone
            && DB::table('carpool_banned_phones')->where('phone_hash', CarpoolAnonymiser::phoneHash($user->phone))->exists();
    }

    /** A new account with a paused number gets the pause on first use, with the old reason and a line in the admin log. */
    private static function inheritPausedNumber(User $user): void
    {
        if ($user->carpool_banned_at || ! $user->phone) {
            return;
        }
        $row = DB::table('carpool_banned_phones')->where('phone_hash', CarpoolAnonymiser::phoneHash($user->phone))->first();
        if (! $row) {
            return;
        }
        $user->carpool_banned_at = now();
        $user->carpool_ban_reason = mb_substr('Banned earlier (deleted account): ' . ($row->reason ?: 'no reason kept'), 0, 255);
        $user->save();
        CarpoolAdminAction::query()->create([
            'admin_id' => null, 'admin_name' => 'Automatic', 'action' => 'ban_inherited', 'target_type' => 'user', 'target_id' => $user->id,
            'subject_user_id' => $user->id, 'note' => 'A new account with a paused phone number', 'after' => ['source_user_id' => $row->source_user_id],
        ]);
    }
}
