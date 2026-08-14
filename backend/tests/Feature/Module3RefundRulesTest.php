<?php

namespace Tests\Feature;

use App\Services\AutoRefundService;
use Tests\TestCase;

/**
 * Module 3 — the Model B cancellation rulebook (pure decision, no side effects).
 * Amounts are in paise. "Online paid" = the full fare for an online ride, or the
 * deposit for a cash ride. Fixed passes chargePercent = 0 (full refund before
 * arrival); Private/Shuttle pass the city's cancellation_charge_percent.
 */
class Module3RefundRulesTest extends TestCase
{
    private function svc(): AutoRefundService
    {
        return app(AutoRefundService::class);
    }

    // ── driver's fault → full refund, always ──

    public function test_drivers_fault_is_a_full_refund_even_after_arrival(): void
    {
        $d = $this->svc()->decideModelB(AutoRefundService::BY_DRIVER, afterArrival: true, onlinePaidPaise: 20000, farePaise: 20000, chargePercent: 20);
        $this->assertSame(20000, $d['refund_paise']);
        $this->assertSame(0, $d['kept_paise']);
    }

    // ── online Private/Shuttle ──

    public function test_online_customer_cancel_before_arrival_keeps_the_charge(): void
    {
        // ₹200 fare paid online, 20% charge → refund ₹160, keep ₹40.
        $d = $this->svc()->decideModelB(AutoRefundService::BY_CUSTOMER, false, 20000, 20000, 20);
        $this->assertSame(16000, $d['refund_paise']);
        $this->assertSame(4000, $d['kept_paise']);
        $this->assertSame('refund_minus_cancel_charge', $d['reason']);
    }

    public function test_online_customer_cancel_after_arrival_refunds_nothing(): void
    {
        $d = $this->svc()->decideModelB(AutoRefundService::BY_CUSTOMER, true, 20000, 20000, 20);
        $this->assertSame(0, $d['refund_paise']);
        $this->assertSame(20000, $d['kept_paise']);
        $this->assertSame('no_refund_after_arrival', $d['reason']);
    }

    // ── Fixed (chargePercent 0) ──

    public function test_fixed_before_arrival_is_a_full_refund(): void
    {
        $d = $this->svc()->decideModelB(AutoRefundService::BY_CUSTOMER, false, 20000, 20000, 0);
        $this->assertSame(20000, $d['refund_paise']);
        $this->assertSame(0, $d['kept_paise']);
        $this->assertSame('full_refund_before_arrival', $d['reason']);
    }

    public function test_fixed_after_arrival_refunds_nothing(): void
    {
        $d = $this->svc()->decideModelB(AutoRefundService::BY_CUSTOMER, true, 20000, 20000, 0);
        $this->assertSame(0, $d['refund_paise']);
        $this->assertSame(20000, $d['kept_paise']);
    }

    // ── cash: the charge applies to the fare but is capped at the deposit ──

    public function test_cash_charge_comes_out_of_the_deposit(): void
    {
        // ₹200 fare, ₹50 deposit paid online. Charge 20% of fare = ₹40 ≤ ₹50 →
        // keep ₹40, refund ₹10.
        $d = $this->svc()->decideModelB(AutoRefundService::BY_CUSTOMER, false, onlinePaidPaise: 5000, farePaise: 20000, chargePercent: 20);
        $this->assertSame(1000, $d['refund_paise']);
        $this->assertSame(4000, $d['kept_paise']);
    }

    public function test_cash_charge_is_capped_at_the_deposit(): void
    {
        // ₹1000 fare, ₹50 deposit. Charge 20% of fare = ₹200 > ₹50 → keep the whole
        // ₹50 deposit, refund nothing (you can't take more than was paid).
        $d = $this->svc()->decideModelB(AutoRefundService::BY_CUSTOMER, false, onlinePaidPaise: 5000, farePaise: 100000, chargePercent: 20);
        $this->assertSame(0, $d['refund_paise']);
        $this->assertSame(5000, $d['kept_paise']);
    }

    public function test_cash_no_show_forfeits_the_whole_deposit(): void
    {
        $d = $this->svc()->decideModelB(AutoRefundService::BY_CUSTOMER, true, 5000, 20000, 20);
        $this->assertSame(0, $d['refund_paise']);
        $this->assertSame(5000, $d['kept_paise']);
    }
}
