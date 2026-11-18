<?php

namespace App\Services\Carpool;

use App\Models\Carpool\CarpoolSetting;

/**
 * The two carpool switches (Carpool-Integration-Guide section 3).
 *
 * - Kill switch (`CARPOOL_KILL_SWITCH`): stops everything. Routes 404, jobs skip.
 * - Enabled (admin setting): hides the customer tile and stops new carpools and
 *   requests, while running carpools, chats and jobs continue (A36).
 */
class CarpoolSwitch
{
    public static function killed(): bool
    {
        return (bool) config('carpool.kill_switch');
    }

    /** True when riders and drivers may start new carpool activity. */
    public static function enabled(): bool
    {
        return ! self::killed() && CarpoolSetting::current()->enabled;
    }
}
