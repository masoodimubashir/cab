<?php

namespace Tests\Unit;

use App\Services\HeldEarningsService;
use App\Services\LedgerService;
use App\Services\PaymentSplitService;
use App\Services\RazorpayService;
use Mockery;
use PHPUnit\Framework\TestCase;

/**
 * Phase 2 — pure split arithmetic (paise in, paise out). No DB, no network.
 */
class PaymentSplitMathTest extends TestCase
{
    private function service(): PaymentSplitService
    {
        // computeSplit is pure; the collaborators are never touched here.
        return new PaymentSplitService(
            Mockery::mock(RazorpayService::class),
            Mockery::mock(LedgerService::class),
            Mockery::mock(HeldEarningsService::class),
        );
    }

    public function test_standard_ten_percent_split(): void
    {
        $s = $this->service()->computeSplit(10000, 10000, 1000);
        $this->assertSame(9000, $s['driver_paise']);
        $this->assertSame(1000, $s['operator_paise']);
    }

    public function test_zero_commission_gives_driver_everything(): void
    {
        // P7 — subscription override, 0% commission.
        $s = $this->service()->computeSplit(10000, 10000, 0);
        $this->assertSame(10000, $s['driver_paise']);
        $this->assertSame(0, $s['operator_paise']);
    }

    public function test_flat_commission_never_exceeds_fare(): void
    {
        // P8 — a flat ₹60 fee on a ₹50 ride is capped at the fare.
        $s = $this->service()->computeSplit(5000, 5000, 6000);
        $this->assertSame(0, $s['driver_paise']);
        $this->assertSame(5000, $s['operator_paise']);
    }

    public function test_operator_absorbs_a_coupon_discount(): void
    {
        // Fare ₹100, ₹10 coupon → customer paid ₹90. Driver still gets ₹90
        // (their full share of the gross); the operator eats the ₹10.
        $s = $this->service()->computeSplit(9000, 10000, 1000);
        $this->assertSame(9000, $s['driver_paise']);
        $this->assertSame(0, $s['operator_paise']);
    }

    public function test_never_transfers_more_than_captured(): void
    {
        $s = $this->service()->computeSplit(8000, 10000, 1000);
        $this->assertSame(8000, $s['driver_paise']);
        $this->assertSame(0, $s['operator_paise']);
    }

    public function test_paise_precision_has_no_rounding_leak(): void
    {
        // C4 — odd amounts must reconcile to the exact paise.
        $s = $this->service()->computeSplit(333, 333, 33);
        $this->assertSame(300, $s['driver_paise']);
        $this->assertSame(33, $s['operator_paise']);
        $this->assertSame(333, $s['driver_paise'] + $s['operator_paise']);
    }

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }
}
