<?php

namespace Tests\Feature;

use App\Models\CitySetting;
use App\Models\Trip;
use App\Models\User;
use App\Services\PaymentModeService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Phase 4 — cash is dead once the auto-split engine is live. The single
 * PaymentModeService gate is what both the customer screen and the payCash
 * server guard read, so proving it here proves cash can't slip through either.
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

        // A city that explicitly permits cash — so the only thing that removes
        // it is the engine flag.
        CitySetting::query()->create([
            'city_id' => $this->cityId,
            'allowed_driver_payment_modes' => ['CASH', 'RAZORPAY'],
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

    public function test_cash_is_allowed_while_the_engine_is_off(): void
    {
        config()->set('services.payments.split_enabled', false);

        $allowed = app(PaymentModeService::class)->allowedForTrip($this->trip());

        $this->assertContains('cash', $allowed);
        $this->assertContains('razorpay', $allowed);
    }

    public function test_engine_on_kills_cash_leaving_only_online(): void
    {
        config()->set('services.payments.split_enabled', true);

        $allowed = app(PaymentModeService::class)->allowedForTrip($this->trip());

        $this->assertSame(['razorpay'], $allowed);
        $this->assertNotContains('cash', $allowed);
    }
}
