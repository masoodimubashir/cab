<?php

namespace Tests\Feature;

use App\Models\DriverSettlement;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\NetSettlementService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Module 7 — the reconciliation "Check" behind the driver's Wallet hub. The
 * wallet's recorded payouts must match the settlement records; a gap is drift and
 * is flagged so it's caught before a driver disputes it.
 */
class Module7ReconciliationTest extends TestCase
{
    use RefreshDatabase;

    private function driver(): User
    {
        $u = User::factory()->create();
        $u->addRole('driver');

        return $u;
    }

    private function tx(User $u, string $type, float $amount, string $reason): void
    {
        WalletTransaction::query()->create([
            'user_id' => $u->id, 'amount' => $amount, 'type' => $type, 'reason' => $reason,
        ]);
    }

    public function test_wallet_payouts_matching_settlement_records_reconcile(): void
    {
        $driver = $this->driver();
        $this->tx($driver, WalletTransaction::TYPE_CREDIT, 100, 'Ride earnings');
        $this->tx($driver, WalletTransaction::TYPE_DEBIT, 60, 'Payout — GPay, ref UTR1');
        DriverSettlement::query()->create([
            'user_id' => $driver->id, 'owed_by_company' => 100, 'owed_by_driver' => 0,
            'net' => 100, 'amount_paid' => 60, 'method' => 'gpay',
        ]);

        $r = app(NetSettlementService::class)->reconcile($driver);

        $this->assertSame(60.0, $r['paid_out']);
        $this->assertSame(60.0, $r['settlements_recorded']);
        $this->assertSame(0.0, $r['drift']);
        $this->assertTrue($r['balanced']);
        // The identity holds: earnings − commission − paid_out (+ deposits) = balance.
        $this->assertSame(40.0, $r['balance']);
    }

    public function test_a_payout_with_no_settlement_record_is_flagged_as_drift(): void
    {
        $driver = $this->driver();
        $this->tx($driver, WalletTransaction::TYPE_CREDIT, 100, 'Ride earnings');
        // A payout left the wallet, but no settlement snapshot was recorded.
        $this->tx($driver, WalletTransaction::TYPE_DEBIT, 60, 'Payout — Bank');

        $r = app(NetSettlementService::class)->reconcile($driver);

        $this->assertSame(60.0, $r['paid_out']);
        $this->assertSame(0.0, $r['settlements_recorded']);
        $this->assertSame(60.0, $r['drift']);
        $this->assertFalse($r['balanced']);
    }
}
