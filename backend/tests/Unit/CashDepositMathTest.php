<?php

namespace Tests\Unit;

use App\Services\CashDepositService;
use PHPUnit\Framework\TestCase;

/**
 * Pure cash-deposit arithmetic (fare in → deposit + balance out). No DB.
 * quote() takes an explicit percent so the operator row is never touched here.
 */
class CashDepositMathTest extends TestCase
{
    private function service(): CashDepositService
    {
        return new CashDepositService();
    }

    public function test_twenty_percent_of_a_hundred(): void
    {
        $q = $this->service()->quote(100, 20);

        $this->assertSame(20.0, $q['deposit']);
        $this->assertSame(80.0, $q['balance']);
        $this->assertSame(20.0, $q['percent']);
    }

    public function test_percentage_scales_with_the_fare(): void
    {
        $q = $this->service()->quote(500, 20);

        $this->assertSame(100.0, $q['deposit']);
        $this->assertSame(400.0, $q['balance']);
    }

    public function test_zero_percent_means_no_deposit(): void
    {
        $q = $this->service()->quote(250, 0);

        $this->assertSame(0.0, $q['deposit']);
        $this->assertSame(250.0, $q['balance']);
    }

    public function test_full_percent_means_no_cash_balance(): void
    {
        $q = $this->service()->quote(250, 100);

        $this->assertSame(250.0, $q['deposit']);
        $this->assertSame(0.0, $q['balance']);
    }

    public function test_deposit_and_balance_always_sum_back_to_the_fare(): void
    {
        foreach ([[133.33, 15], [99.99, 33], [1000, 7.5], [49.95, 20]] as [$fare, $pct]) {
            $q = $this->service()->quote($fare, $pct);
            $this->assertEqualsWithDelta(
                round($fare, 2),
                round($q['deposit'] + $q['balance'], 2),
                0.001,
                "deposit+balance must equal the fare for {$fare} @ {$pct}%",
            );
        }
    }

    public function test_percent_is_clamped_to_zero_hundred(): void
    {
        $this->assertSame(0.0, $this->service()->quote(100, -10)['deposit']);
        $this->assertSame(100.0, $this->service()->quote(100, 150)['deposit']);
    }

    public function test_zero_fare_yields_no_deposit_and_no_balance(): void
    {
        $q = $this->service()->quote(0, 20);

        $this->assertSame(0.0, $q['deposit']);
        $this->assertSame(0.0, $q['balance']);
    }
}
