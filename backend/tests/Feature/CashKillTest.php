<?php

namespace Tests\Feature;

use App\Models\OperatorSetting;
use App\Models\Trip;
use App\Models\User;
use App\Services\PaymentModeService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Payment methods are a global operator policy now (Operator Settings →
 * Payments), no longer per-city and no longer killed by the split engine —
 * cash is back and gated purely by the operator's Cash switch. The single
 * PaymentModeService gate is what both the customer screen and the pay-endpoint
 * guards read, so proving it here proves the rails can't disagree.
 */
class CashKillTest extends TestCase
{
    use RefreshDatabase;

    private int $cityId;

    protected function setUp(): void
    {
        parent::setUp();

        $now = now();
        $this->cityId = \Illuminate\Support\Facades\DB::table('cities')->insertGetId([
            'name' => 'Bengaluru', 'country_code' => 'IN', 'created_at' => $now, 'updated_at' => $now,
        ]);
        \Illuminate\Support\Facades\DB::table('ride_types')->insert([
            'id' => 1, 'name' => 'Mini', 'description' => 'Mini', 'sort_order' => 1, 'created_at' => $now, 'updated_at' => $now,
        ]);
    }

    private function trip(): Trip
    {
        $customer = User::factory()->create();
        $customer->addRole('customer');

        return Trip::query()->create([
            'customer_id' => $customer->id,
            'city_id' => $this->cityId,
            'ride_type_id' => 1,
            'status' => 'COMPLETED',
            'estimated_fare' => 100, 'final_fare' => 100, 'currency' => 'INR',
            'pickup_lat' => 12.97, 'pickup_lng' => 77.59, 'drop_lat' => 12.93, 'drop_lng' => 77.62,
        ]);
    }

    private function setSwitches(bool $online, bool $gpay, bool $cash): void
    {
        OperatorSetting::instance()->forceFill([
            'payment_online_enabled' => $online,
            'payment_gpay_enabled' => $gpay,
            'payment_cash_enabled' => $cash,
        ])->save();
    }

    public function test_cash_switch_on_makes_cash_payable(): void
    {
        $this->setSwitches(online: true, gpay: false, cash: true);

        $allowed = app(PaymentModeService::class)->allowedForTrip($this->trip());

        $this->assertContains('cash', $allowed);
        $this->assertContains('razorpay', $allowed);
    }

    public function test_cash_switch_off_drops_cash(): void
    {
        $this->setSwitches(online: true, gpay: true, cash: false);

        $allowed = app(PaymentModeService::class)->allowedForTrip($this->trip());

        $this->assertSame(['razorpay'], $allowed);
        $this->assertNotContains('cash', $allowed);
    }

    public function test_cash_survives_even_when_the_split_engine_is_on(): void
    {
        // The old "engine kills cash" rule is gone — the switch is the only gate.
        config()->set('services.payments.split_enabled', true);
        $this->setSwitches(online: true, gpay: false, cash: true);

        $allowed = app(PaymentModeService::class)->allowedForTrip($this->trip());

        $this->assertContains('cash', $allowed);
    }

    public function test_online_or_gpay_both_map_to_the_razorpay_rail(): void
    {
        // Only GPay on (Online off) still offers the razorpay rail; the app draws
        // the Online-vs-GPay choice from the switches, not from this list.
        $this->setSwitches(online: false, gpay: true, cash: false);

        $allowed = app(PaymentModeService::class)->allowedForTrip($this->trip());

        $this->assertSame(['razorpay'], $allowed);
    }
}
