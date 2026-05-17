<?php

namespace App\Services;

use App\Models\DispatcherSetting;
use App\Models\Trip;
use Carbon\CarbonInterface;
use Illuminate\Support\Carbon;

/**
 * Centralizes the per-(city, kind) booking-window policy: lead time, days
 * limit, per-customer ride limit and cancel window.
 *
 * Returns a string error code when a request is rejected, or null when the
 * booking is allowed. Controllers map the code into a 422 + message.
 */
class SchedulingPolicyService
{
    public const ERR_SCHEDULE_DISABLED = 'schedule_disabled';
    public const ERR_LEAD_TOO_SHORT = 'lead_time_too_short';
    public const ERR_TOO_FAR_AHEAD = 'scheduled_too_far_ahead';
    public const ERR_RETURN_TOO_FAR = 'return_too_far_ahead';
    public const ERR_RIDES_LIMIT = 'scheduled_rides_limit_reached';

    /**
     * Validate a (potentially) scheduled booking. Pass null in $scheduledAt
     * for an ASAP booking — only the rides-limit check applies in that case.
     *
     * @param  int  $customerId  user.id of the booking customer
     */
    public function validateBooking(
        int $customerId,
        int $cityId,
        string $kind,
        ?CarbonInterface $scheduledAt,
        ?CarbonInterface $returnAt = null,
    ): ?string {
        $cfg = DispatcherSetting::forTrip($cityId, $kind);
        if (!$cfg) {
            return null; // No config = no constraints; fail open.
        }

        $now = Carbon::now();

        if ($scheduledAt) {
            if (!$cfg->schedule_available) {
                return self::ERR_SCHEDULE_DISABLED;
            }
            $minLead = (int) $cfg->schedule_current_time_diff_min;
            if ($scheduledAt->lt($now->copy()->addMinutes($minLead))) {
                return self::ERR_LEAD_TOO_SHORT;
            }
            $maxAhead = (int) $cfg->schedule_days_limit;
            if ($scheduledAt->gt($now->copy()->addDays($maxAhead)->endOfDay())) {
                return self::ERR_TOO_FAR_AHEAD;
            }
            if ($returnAt && $cfg->schedule_days_limit_return !== null) {
                $maxReturn = (int) $cfg->schedule_days_limit_return;
                if ($returnAt->gt($scheduledAt->copy()->addDays($maxReturn)->endOfDay())) {
                    return self::ERR_RETURN_TOO_FAR;
                }
            }
            $ridesLimit = (int) $cfg->schedule_rides_limit;
            if ($ridesLimit > 0) {
                $existing = Trip::query()
                    ->where('customer_id', $customerId)
                    ->whereNotNull('scheduled_at')
                    ->whereIn('status', ['REQUESTED', 'NEGOTIATION', 'CONFIRMED'])
                    ->count();
                if ($existing >= $ridesLimit) {
                    return self::ERR_RIDES_LIMIT;
                }
            }
        }

        return null;
    }

    /**
     * True when cancelling NOW for a scheduled trip falls inside the
     * "cancel window" — i.e. close enough to pickup that a fee should
     * apply. Cancelling earlier than the window is free.
     */
    public function isInsideCancelWindow(Trip $trip): bool
    {
        if (!$trip->scheduled_at) {
            return false;
        }
        $cfg = DispatcherSetting::forTrip($trip->city_id, $trip->product_kind ?? 'local');
        if (!$cfg) {
            return false;
        }
        $window = (int) $cfg->schedule_cancel_window_min;
        $threshold = $trip->scheduled_at->copy()->subMinutes($window);
        return Carbon::now()->gte($threshold);
    }

    public function messageFor(string $code): string
    {
        return match ($code) {
            self::ERR_SCHEDULE_DISABLED => 'Scheduled booking is not available for this product in this city.',
            self::ERR_LEAD_TOO_SHORT => 'Pickup time is too soon — please pick a later time.',
            self::ERR_TOO_FAR_AHEAD => 'Pickup is further out than this product allows.',
            self::ERR_RETURN_TOO_FAR => 'Return date is further out than this product allows.',
            self::ERR_RIDES_LIMIT => 'You already have the maximum number of pending scheduled rides.',
            default => 'Booking not allowed.',
        };
    }
}
