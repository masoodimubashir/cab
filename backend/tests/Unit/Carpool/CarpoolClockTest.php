<?php

namespace Tests\Unit\Carpool;

use App\Services\Carpool\CarpoolClock;
use Carbon\CarbonImmutable;
use Tests\TestCase;

/** India-day rules at the day boundaries (Carpool.md P8). India is UTC+5:30. */
class CarpoolClockTest extends TestCase
{
    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();
        \Illuminate\Support\Carbon::setTestNow();
        parent::tearDown();
    }

    private function freezeIst(string $ist): void
    {
        $moment = CarbonImmutable::parse($ist, 'Asia/Kolkata');
        CarbonImmutable::setTestNow($moment);
        \Illuminate\Support\Carbon::setTestNow($moment);
    }

    public function test_today_follows_india_not_utc(): void
    {
        // 00:01 IST on the 20th is still 18:31 UTC on the 19th.
        $this->freezeIst('2026-11-20 00:01');
        $this->assertSame('2026-11-20', CarpoolClock::today());
        $this->assertSame('2026-11-19', CarbonImmutable::now('UTC')->toDateString());

        $this->freezeIst('2026-11-19 23:59');
        $this->assertSame('2026-11-19', CarpoolClock::today());
    }

    public function test_india_day_bounds_in_utc(): void
    {
        $this->assertSame('2026-11-18 18:30:00', CarpoolClock::startOfDay('2026-11-19')->format('Y-m-d H:i:s'));
        $this->assertSame('2026-11-19 18:29:59', CarpoolClock::endOfDay('2026-11-19')->format('Y-m-d H:i:s'));
    }

    public function test_date_of_a_stored_utc_moment(): void
    {
        $this->assertSame('2026-11-20', CarpoolClock::dateOf(CarbonImmutable::parse('2026-11-19 18:31', 'UTC')));
        $this->assertSame('2026-11-19', CarpoolClock::dateOf(CarbonImmutable::parse('2026-11-19 18:29', 'UTC')));
    }

    public function test_is_today_and_days_from_today_across_midnight(): void
    {
        $this->freezeIst('2026-11-19 23:59');
        $justAfterMidnight = CarbonImmutable::parse('2026-11-20 00:01', 'Asia/Kolkata')->utc();

        $this->assertFalse(CarpoolClock::isToday($justAfterMidnight));
        $this->assertSame(1, CarpoolClock::daysFromToday($justAfterMidnight));
        $this->assertSame(-1, CarpoolClock::daysFromToday(CarbonImmutable::parse('2026-11-18 12:00', 'Asia/Kolkata')));
    }

    public function test_publish_horizon_is_thirty_india_days(): void
    {
        $this->freezeIst('2026-11-19 23:59');

        $this->assertTrue(CarpoolClock::withinPublishHorizon(CarbonImmutable::parse('2026-12-19 22:00', 'Asia/Kolkata')));
        $this->assertFalse(CarpoolClock::withinPublishHorizon(CarbonImmutable::parse('2026-12-20 00:01', 'Asia/Kolkata')));
        $this->assertFalse(CarpoolClock::withinPublishHorizon(CarbonImmutable::parse('2026-11-19 23:00', 'Asia/Kolkata')), 'past');
    }
}
