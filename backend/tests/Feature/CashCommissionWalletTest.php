<?php

namespace Tests\Feature;

use App\Models\CitySetting;
use App\Models\Trip;
use App\Models\User;
use App\Services\CommissionSettlementService;
use App\Services\WalletService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Module 5 — on a CASH ride the operator's commission comes from the driver's
 * wallet float, whatever the split engine flag says (only the deposit is online,
 * and that goes wholly to the driver). This is what the wallet debt engine and
 * the go-online block run on. An online ride under the engine is unchanged: its
 * commission is retained at source, so the wallet is left alone.
 */
class CashCommissionWalletTest extends TestCase
{
    use RefreshDatabase;

    private int $cityId;
    private int $cvtId;

    protected function setUp(): void
    {
        parent::setUp();

        $now = now();
        $this->cityId = DB::table('cities')->insertGetId([
            'name' => 'Pune', 'country_code' => 'IN', 'created_at' => $now, 'updated_at' => $now,
        ]);
        DB::table('ride_types')->insert([
            'id' => 1, 'name' => 'Mini', 'description' => 'Mini', 'sort_order' => 1, 'created_at' => $now, 'updated_at' => $now,
        ]);
        // 10% commission on the vehicle's rate card (commission lives here now).
        $this->cvtId = $this->vehicleWithCommission(10);
    }

    /** A city-vehicle-type with a rate card carrying a % commission. */
    private function vehicleWithCommission(float $percent): int
    {
        $now = now();
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Mini ' . uniqid(), 'sort_order' => 1, 'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
        ]);
        $cvtId = DB::table('city_vehicle_types')->insertGetId([
            'city_id' => $this->cityId, 'ride_type_id' => 1, 'vehicle_type_id' => $vehicleTypeId,
            'display_name' => 'Mini', 'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
        ]);
        \App\Models\PricingRule::query()->create([
            'city_id' => $this->cityId, 'ride_type_id' => 1, 'vehicle_type_id' => $vehicleTypeId,
            'city_vehicle_type_id' => $cvtId, 'base_fare' => 0, 'surge_multiplier' => 1,
            'commission_type' => 'percent', 'commission_percent' => $percent, 'fixed_commission' => 0,
        ]);

        return $cvtId;
    }

    private function driver(): User
    {
        $driver = User::factory()->create();
        $driver->addRole('driver');

        return $driver;
    }

    private function cashTrip(User $driver, string $method = 'cash'): Trip
    {
        $customer = User::factory()->create();
        $customer->addRole('customer');

        return Trip::query()->create([
            'customer_id' => $customer->id,
            'driver_id' => $driver->id,
            'city_id' => $this->cityId,
            'ride_type_id' => 1,
            'city_vehicle_type_id' => $this->cvtId,
            'status' => 'COMPLETED',
            'payment_method' => $method,
            'estimated_fare' => 100, 'final_fare' => 100, 'currency' => 'INR',
            'pickup_lat' => 18.52, 'pickup_lng' => 73.85, 'drop_lat' => 18.50, 'drop_lng' => 73.80,
        ]);
    }

    public function test_cash_ride_debits_commission_from_the_wallet_even_with_the_engine_on(): void
    {
        config()->set('services.payments.split_enabled', true);

        $driver = $this->driver();
        $trip = $this->cashTrip($driver);

        app(CommissionSettlementService::class)->settle($trip);

        // ₹10 commission on a ₹100 fare, taken from the wallet → driver at -10.
        $this->assertSame(-10.0, app(WalletService::class)->balance($driver->fresh()));
        $this->assertSame(10.0, (float) $trip->fresh()->commission_amount);
    }

    public function test_online_ride_under_the_engine_does_not_touch_the_wallet(): void
    {
        config()->set('services.payments.split_enabled', true);

        $driver = $this->driver();
        $trip = $this->cashTrip($driver, method: 'razorpay');

        app(CommissionSettlementService::class)->settle($trip);

        // Commission is retained at source for online — wallet untouched.
        $this->assertSame(0.0, app(WalletService::class)->balance($driver->fresh()));
    }

    public function test_cash_ride_debits_commission_with_the_engine_off_too(): void
    {
        config()->set('services.payments.split_enabled', false);

        $driver = $this->driver();
        $trip = $this->cashTrip($driver);

        app(CommissionSettlementService::class)->settle($trip);

        $this->assertSame(-10.0, app(WalletService::class)->balance($driver->fresh()));
    }
}
