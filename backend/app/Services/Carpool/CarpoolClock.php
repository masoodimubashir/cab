<?php

namespace App\Services\Carpool;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;

/**
 * Every carpool "day" rule goes through here (Carpool.md P8): end-of-day
 * cancel, plan grace on D and D+1, the 30-day publish horizon, and the
 * Today / Upcoming / Past filters. Days are India days; values returned for
 * storage or queries are UTC, like the rest of the database.
 */
class CarpoolClock
{
    public static function timezone(): string
    {
        return (string) config('carpool.timezone', 'Asia/Kolkata');
    }

    /** The current moment in India time. */
    public static function now(): CarbonImmutable
    {
        return CarbonImmutable::now(self::timezone());
    }

    /** A stored (UTC) moment shown in India time. */
    public static function local(CarbonInterface $moment): CarbonImmutable
    {
        return CarbonImmutable::instance($moment)->setTimezone(self::timezone());
    }

    /** India date (Y-m-d) that a moment falls on. */
    public static function dateOf(CarbonInterface $moment): string
    {
        return self::local($moment)->toDateString();
    }

    /** Today's India date (Y-m-d). */
    public static function today(): string
    {
        return self::now()->toDateString();
    }

    /** Start of an India day, in UTC. `$date` is Y-m-d. */
    public static function startOfDay(string $date): CarbonImmutable
    {
        return CarbonImmutable::parse($date, self::timezone())->startOfDay()->utc();
    }

    /** Last moment of an India day, in UTC. `$date` is Y-m-d. */
    public static function endOfDay(string $date): CarbonImmutable
    {
        return CarbonImmutable::parse($date, self::timezone())->endOfDay()->utc();
    }

    /** True when a moment falls on today's India date. */
    public static function isToday(CarbonInterface $moment): bool
    {
        return self::dateOf($moment) === self::today();
    }

    /** Days from today to a moment's India date (0 = today, negative = past). */
    public static function daysFromToday(CarbonInterface $moment): int
    {
        $today = CarbonImmutable::parse(self::today(), self::timezone());
        $day = CarbonImmutable::parse(self::dateOf($moment), self::timezone());

        return (int) $today->diffInDays($day, false);
    }

    /** True when a departure may be published: not before now, at most the horizon ahead. */
    public static function withinPublishHorizon(CarbonInterface $departsAt): bool
    {
        if ($departsAt->lt(self::now())) {
            return false;
        }

        return self::daysFromToday($departsAt) <= \App\Models\Carpool\CarpoolSetting::number('publish_horizon_days');
    }
}
