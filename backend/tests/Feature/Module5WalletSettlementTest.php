<?php

namespace Tests\Feature;

use App\Models\Trip;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\CommissionSettlementService;
use App\Services\WalletService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Module 5 — Wallet as the single settlement ledger (Model B, Route off).
 *
 * With the split/Route engine OFF the wallet becomes the one record of who owes
 * whom:
 *   - Online ride  → the operator collected the fare, so it OWES the driver
 *                    (fare − commission) → wallet CREDIT ("Ride earnings").
 *   - Cash ride    → the driver holds the fare, so they OWE the commission
 *                    → wallet DEBIT ("Cash ride commission").
 * The wallet balance then equals exactly what the operator owes the driver.
 *
 * Route mode (engine ON) is unchanged and guarded here as a regression: an
 * online ride under Route never touches the wallet (it settles via Route).
 */
class Module5WalletSettlementTest extends TestCase
{
    use RefreshDatabase;

    private const COMMISSION_PCT = 10.0;

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
        $this->cvtId = $this->vehicleWithCommission(self::COMMISSION_PCT);
    }

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

    private function soloTrip(User $driver, string $method, float $fare = 100): Trip
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
            'estimated_fare' => $fare, 'final_fare' => $fare, 'currency' => 'INR',
            'pickup_lat' => 18.52, 'pickup_lng' => 73.85, 'drop_lat' => 18.50, 'drop_lng' => 73.80,
        ]);
    }

    public function test_online_private_ride_credits_the_earning_to_the_wallet_when_route_is_off(): void
    {
        config()->set('services.payments.split_enabled', false);

        $driver = $this->driver();
        $trip = $this->soloTrip($driver, 'razorpay', 100);

        app(CommissionSettlementService::class)->settle($trip);

        // ₹100 fare − ₹10 commission = ₹90 owed to the driver by the operator.
        $this->assertSame(90.0, app(WalletService::class)->balance($driver->fresh()));

        $txn = WalletTransaction::query()->where('user_id', $driver->id)->latest('id')->first();
        $this->assertNotNull($txn);
        $this->assertSame(WalletTransaction::TYPE_CREDIT, $txn->type);
        $this->assertSame(90.0, (float) $txn->amount);
        $this->assertSame('Ride earnings', $txn->reason);
        $this->assertSame($trip->id, (int) $txn->engagement_id);
    }

    public function test_cash_private_ride_debits_the_commission_when_route_is_off(): void
    {
        config()->set('services.payments.split_enabled', false);

        $driver = $this->driver();
        $trip = $this->soloTrip($driver, 'cash', 100);

        app(CommissionSettlementService::class)->settle($trip);

        // Driver holds the ₹100 cash; owes ₹10 commission → wallet at −10.
        $this->assertSame(-10.0, app(WalletService::class)->balance($driver->fresh()));

        $txn = WalletTransaction::query()->where('user_id', $driver->id)->latest('id')->first();
        $this->assertNotNull($txn);
        $this->assertSame(WalletTransaction::TYPE_DEBIT, $txn->type);
        $this->assertSame(10.0, (float) $txn->amount);
        $this->assertSame('Cash ride commission', $txn->reason);
    }

    public function test_cash_private_ride_with_a_deposit_credits_the_deposit_and_debits_commission(): void
    {
        config()->set('services.payments.split_enabled', false);

        $driver = $this->driver();
        $trip = $this->soloTrip($driver, 'cash', 100);

        // The customer paid a ₹25 deposit online; it now sits with the operator.
        \App\Models\Payment::query()->create([
            'trip_id' => $trip->id,
            'method' => 'CASH',
            'provider' => 'RAZORPAY',
            'status' => 'SUCCESS',
            'amount' => 25,
            'cash_deposit_amount' => 25,
            'cash_balance_due' => 75,
            'currency' => 'INR',
            'razorpay_payment_id' => 'pay_deposit_' . $trip->id,
            'paid_at' => now(),
            'settlement_mode' => \App\Models\Payment::SETTLE_BOOKING,
        ]);

        app(CommissionSettlementService::class)->settle($trip);

        // Operator holds ₹25 deposit, less ₹10 commission → owes the driver ₹15.
        $this->assertSame(15.0, app(WalletService::class)->balance($driver->fresh()));

        $rows = WalletTransaction::query()->where('user_id', $driver->id)->orderBy('id')->get();
        $this->assertCount(2, $rows);
        $this->assertSame(WalletTransaction::TYPE_CREDIT, $rows[0]->type);
        $this->assertSame(25.0, (float) $rows[0]->amount);
        $this->assertSame('Cash deposit collected', $rows[0]->reason);
        $this->assertSame(WalletTransaction::TYPE_DEBIT, $rows[1]->type);
        $this->assertSame(10.0, (float) $rows[1]->amount);
        $this->assertSame('Cash ride commission', $rows[1]->reason);
    }

    public function test_online_private_ride_leaves_the_wallet_untouched_under_route(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        config()->set('services.payments.split_enabled', true);

        $driver = $this->driver();
        $trip = $this->soloTrip($driver, 'razorpay', 100);

        app(CommissionSettlementService::class)->settle($trip);

        // Route settles the driver's share at source — the wallet is not used.
        $this->assertSame(0.0, app(WalletService::class)->balance($driver->fresh()));
        $this->assertSame(0, WalletTransaction::query()->where('user_id', $driver->id)->count());
    }
}
