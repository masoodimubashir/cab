<?php

namespace Tests\Feature;

use App\Models\DriverPayoutLedger;
use App\Models\Trip;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\CommissionSettlementService;
use App\Services\PayoutLedgerService;
use App\Services\WalletService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Module 5 — Financial System Refactoring: Separation of Driver Wallet & Driver Payout Ledger.
 *
 * Principle: Wallet and Payouts are completely different systems and must never be combined.
 *
 * System 1 (Driver Wallet - Liability):
 *   - Commission debits
 *   - Subscription debits
 *   - Platform charges
 *   - Wallet recharges
 *
 * System 2 (Driver Payout Ledger):
 *   - Online upfront payments collected by operator (online fare, cash ride deposit, coupon reimbursement)
 *   - Pending payouts & completed operator payouts
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

    public function test_online_private_ride_debits_commission_from_wallet_and_records_fare_in_payout_ledger(): void
    {
        $driver = $this->driver();
        $trip = $this->soloTrip($driver, 'razorpay', 100);

        app(CommissionSettlementService::class)->settle($trip);

        // Commission of ₹10 is debited from driver's wallet liability account
        $this->assertSame(-10.0, app(WalletService::class)->balance($driver->fresh()));

        $walletTxn = WalletTransaction::query()->where('user_id', $driver->id)->latest('id')->first();
        $this->assertNotNull($walletTxn);
        $this->assertSame(WalletTransaction::TYPE_DEBIT, $walletTxn->type);
        $this->assertSame(10.0, (float) $walletTxn->amount);

        // Operator collected ₹100 online fare on driver's behalf into Payout Ledger
        $this->assertSame(100.0, app(PayoutLedgerService::class)->pendingPayout($driver->fresh()));
        $payoutRow = DriverPayoutLedger::query()->where('driver_user_id', $driver->id)->first();
        $this->assertNotNull($payoutRow);
        $this->assertSame(DriverPayoutLedger::TYPE_COLLECTED, $payoutRow->type);
        $this->assertSame(100.0, (float) $payoutRow->amount);
        $this->assertSame(DriverPayoutLedger::SOURCE_ONLINE_FARE, $payoutRow->source);
    }

    public function test_cash_private_ride_debits_the_commission_from_wallet(): void
    {
        $driver = $this->driver();
        $trip = $this->soloTrip($driver, 'cash', 100);

        app(CommissionSettlementService::class)->settle($trip);

        // Driver holds the ₹100 cash; platform debits ₹10 commission from wallet liability
        $this->assertSame(-10.0, app(WalletService::class)->balance($driver->fresh()));

        $txn = WalletTransaction::query()->where('user_id', $driver->id)->latest('id')->first();
        $this->assertNotNull($txn);
        $this->assertSame(WalletTransaction::TYPE_DEBIT, $txn->type);
        $this->assertSame(10.0, (float) $txn->amount);
        $this->assertSame('Cash ride commission', $txn->reason);

        // No online money was collected by operator for this cash ride
        $this->assertSame(0.0, app(PayoutLedgerService::class)->pendingPayout($driver->fresh()));
    }

    public function test_cash_private_ride_with_a_deposit_records_deposit_in_payout_ledger_and_debits_commission_from_wallet(): void
    {
        $driver = $this->driver();
        $trip = $this->soloTrip($driver, 'cash', 100);

        // Customer paid ₹25 upfront deposit online; operator holds it on driver's behalf
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

        // Wallet records ONLY the commission deduction (₹10)
        $this->assertSame(-10.0, app(WalletService::class)->balance($driver->fresh()));
        $rows = WalletTransaction::query()->where('user_id', $driver->id)->get();
        $this->assertCount(1, $rows);
        $this->assertSame(WalletTransaction::TYPE_DEBIT, $rows[0]->type);
        $this->assertSame(10.0, (float) $rows[0]->amount);

        // Payout ledger records the ₹25 deposit waiting to be transferred to driver
        $this->assertSame(25.0, app(PayoutLedgerService::class)->pendingPayout($driver->fresh()));
        $payoutRow = DriverPayoutLedger::query()->where('driver_user_id', $driver->id)->first();
        $this->assertNotNull($payoutRow);
        $this->assertSame(DriverPayoutLedger::TYPE_COLLECTED, $payoutRow->type);
        $this->assertSame(25.0, (float) $payoutRow->amount);
        $this->assertSame(DriverPayoutLedger::SOURCE_ONLINE_DEPOSIT, $payoutRow->source);
    }
}
