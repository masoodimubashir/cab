<?php

namespace Tests\Unit;

use App\Services\AutoRefundService;
use App\Services\HeldEarningsService;
use App\Services\LedgerService;
use App\Services\RazorpayService;
use Mockery;
use PHPUnit\Framework\TestCase;

/**
 * Phase 3 — the refund rulebook (§5) as pure arithmetic (paise in, paise out).
 * No DB, no network. One row of the rulebook table per test.
 */
class AutoRefundDecisionTest extends TestCase
{
    private function service(): AutoRefundService
    {
        // decide() is pure; the collaborators are never touched here.
        return new AutoRefundService(
            Mockery::mock(RazorpayService::class),
            Mockery::mock(LedgerService::class),
            Mockery::mock(HeldEarningsService::class),
        );
    }

    public function test_no_driver_found_is_a_full_refund(): void
    {
        // R1 — nobody accepted; the service never happened.
        $d = $this->service()->decide(AutoRefundService::BY_SYSTEM, false, 10000, 1000);
        $this->assertSame(10000, $d['refund_paise']);
    }

    public function test_driver_cancel_is_a_full_refund(): void
    {
        // R2 — not the customer's fault, even mid-ride.
        $d = $this->service()->decide(AutoRefundService::BY_DRIVER, true, 10000, 1000);
        $this->assertSame(10000, $d['refund_paise']);
    }

    public function test_operator_cancel_is_a_full_refund(): void
    {
        // R3
        $d = $this->service()->decide(AutoRefundService::BY_OPERATOR, false, 10000, 1000);
        $this->assertSame(10000, $d['refund_paise']);
    }

    public function test_customer_cancel_before_pickup_keeps_the_cancel_fee(): void
    {
        // R4 — refund fare minus the commission (the cancel fee).
        $d = $this->service()->decide(AutoRefundService::BY_CUSTOMER, false, 10000, 1000);
        $this->assertSame(9000, $d['refund_paise']);
    }

    public function test_customer_cancel_after_arrival_gets_nothing_back(): void
    {
        // R5 — the split stands.
        $d = $this->service()->decide(AutoRefundService::BY_CUSTOMER, true, 10000, 1000);
        $this->assertSame(0, $d['refund_paise']);
    }

    public function test_zero_commission_customer_cancel_is_a_full_refund(): void
    {
        // A 0% (subscription) ride has no cancel fee, so a pre-pickup cancel
        // gives everything back.
        $d = $this->service()->decide(AutoRefundService::BY_CUSTOMER, false, 10000, 0);
        $this->assertSame(10000, $d['refund_paise']);
    }

    public function test_cancel_fee_never_exceeds_what_was_captured(): void
    {
        // A flat fee larger than the fare is clamped, so the refund is never negative.
        $d = $this->service()->decide(AutoRefundService::BY_CUSTOMER, false, 5000, 6000);
        $this->assertSame(0, $d['refund_paise']);
    }

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }
}
