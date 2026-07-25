<?php

namespace Tests\Feature;

use App\Models\HeldEarning;
use App\Models\LedgerEntry;
use App\Models\Payment;
use App\Models\Trip;
use App\Models\User;
use App\Services\PayoutMonitorService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Phase 4 — the read-only payout + ledger monitors that replace the manual
 * worklists. Seeds split payments across every transfer state and asserts the
 * monitor buckets them correctly and reconciles the ledger.
 */
class PayoutMonitorTest extends TestCase
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

    private function driver(string $name): User
    {
        $d = User::factory()->create(['name' => $name]);
        $d->addRole('driver');
        return $d;
    }

    private function trip(User $driver): Trip
    {
        $customer = User::factory()->create();
        $customer->addRole('customer');
        return Trip::query()->create([
            'customer_id' => $customer->id, 'driver_id' => $driver->id,
            'city_id' => $this->cityId, 'ride_type_id' => 1, 'status' => 'COMPLETED',
            'estimated_fare' => 100, 'final_fare' => 100, 'currency' => 'INR',
            'pickup_lat' => 12.97, 'pickup_lng' => 77.59, 'drop_lat' => 12.93, 'drop_lng' => 77.62,
        ]);
    }

    private function splitPayment(User $driver, string $transferStatus, float $driverAmount, ?string $transferId): Payment
    {
        $trip = $this->trip($driver);
        return Payment::query()->create([
            'trip_id' => $trip->id, 'method' => 'RAZORPAY', 'provider' => 'RAZORPAY', 'status' => 'SUCCESS',
            'amount' => 100, 'currency' => 'INR',
            'razorpay_order_id' => 'order_' . $trip->id, 'razorpay_payment_id' => 'pay_' . $trip->id,
            'commission_amount' => 100 - $driverAmount, 'driver_amount' => $driverAmount,
            'driver_transfer_id' => $transferId, 'transfer_status' => $transferStatus,
            'split_at' => now(), 'paid_at' => now(),
        ]);
    }

    public function test_monitor_buckets_transfers_by_state(): void
    {
        $driver = $this->driver('Asha');

        $this->splitPayment($driver, Payment::TRANSFER_CREATED, 90, 'trf_paid');
        $this->splitPayment($driver, Payment::TRANSFER_FAILED, 30, null);
        $this->splitPayment($driver, Payment::TRANSFER_REVERSED, 90, 'trf_rev');

        // A held ride: payment flagged held + a held_earnings row (authoritative total).
        $heldPayment = $this->splitPayment($driver, Payment::TRANSFER_HELD, 45, null);
        HeldEarning::query()->create([
            'driver_id' => $driver->id, 'trip_id' => $heldPayment->trip_id, 'payment_id' => $heldPayment->id,
            'amount_paise' => 4500, 'status' => HeldEarning::STATUS_HELD,
        ]);

        $monitor = app(PayoutMonitorService::class)->payouts();
        $s = $monitor['summary'];

        $this->assertSame(1, $s['paid_count']);
        $this->assertSame(90.0, $s['paid_amount']);
        $this->assertSame(1, $s['failed_count']);
        $this->assertSame(1, $s['reversed_count']);
        $this->assertSame(1, $s['held_count']);
        $this->assertSame(45.0, $s['held_amount']);
        $this->assertCount(4, $monitor['rows']);
    }

    public function test_monitor_filters_by_state(): void
    {
        $driver = $this->driver('Ravi');
        $this->splitPayment($driver, Payment::TRANSFER_CREATED, 90, 'trf_1');
        $this->splitPayment($driver, Payment::TRANSFER_FAILED, 30, null);

        $failed = app(PayoutMonitorService::class)->payouts('failed');

        $this->assertCount(1, $failed['rows']);
        $this->assertSame('failed', $failed['rows'][0]['state']);
        $this->assertSame('Ravi', $failed['rows'][0]['driver_name']);
    }

    public function test_ledger_reports_movements_and_reconciles_each_trip(): void
    {
        $driver = $this->driver('Meena');
        $trip = $this->trip($driver);
        $payment = Payment::query()->create([
            'trip_id' => $trip->id, 'method' => 'RAZORPAY', 'provider' => 'RAZORPAY', 'status' => 'SUCCESS',
            'amount' => 100, 'currency' => 'INR', 'razorpay_payment_id' => 'pay_x', 'paid_at' => now(),
        ]);

        // A balanced trip: captured 100 = driver 90 + operator 10.
        $ledger = app(\App\Services\LedgerService::class);
        $ledger->record(LedgerEntry::TYPE_CAPTURE, LedgerEntry::PARTY_CUSTOMER, 'in', 10000, $trip->id, $payment->id);
        $ledger->record(LedgerEntry::TYPE_RETAINED, LedgerEntry::PARTY_OPERATOR, 'in', 1000, $trip->id, $payment->id);
        $ledger->record(LedgerEntry::TYPE_TRANSFER, LedgerEntry::PARTY_DRIVER, 'out', 9000, $trip->id, $payment->id);

        $out = app(PayoutMonitorService::class)->ledger($trip->id);

        $this->assertCount(3, $out['rows']);
        $this->assertTrue($out['reconciliation'][$trip->id]['balanced']);
        $this->assertSame(100.0, $out['reconciliation'][$trip->id]['captured']);
        $this->assertSame(90.0, $out['reconciliation'][$trip->id]['driver_net']);
        $this->assertSame(10.0, $out['reconciliation'][$trip->id]['operator_net']);
    }
}
