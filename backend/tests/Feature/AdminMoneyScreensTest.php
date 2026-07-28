<?php

namespace Tests\Feature;

use App\Models\HeldEarning;
use App\Models\LedgerEntry;
use App\Models\Payment;
use App\Models\Trip;
use App\Models\User;
use App\Services\LedgerService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * What the operator can actually SEE, now that nobody moves money by hand.
 *
 * Three questions the admin screens have to answer, and this asserts the data
 * behind each one:
 *
 *   1. Where did the money go, and does it add up?   (the ledger)
 *   2. Who is waiting to be paid, and why?           (the payout monitor)
 *   3. What still needs a human?                     (refunds as exceptions)
 */
class AdminMoneyScreensTest extends TestCase
{
    use RefreshDatabase;

    private int $cityId;
    private int $rideTypeId;
    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('services.payments.split_enabled', true);

        $now = now();
        $this->cityId = DB::table('cities')->insertGetId([
            'name' => 'Admin City', 'country_code' => 'IN', 'created_at' => $now, 'updated_at' => $now,
        ]);
        $this->rideTypeId = DB::table('ride_types')->insertGetId([
            'name' => 'Mini', 'mode' => 'private', 'description' => 'Mini', 'sort_order' => 1,
            'created_at' => $now, 'updated_at' => $now,
        ]);

        $this->admin = User::factory()->create(['manager_all_cities' => true]);
        $this->admin->addRole('admin');
        $roleId = DB::table('manager_roles')->insertGetId([
            'slug' => 'super_admin', 'name' => 'Super Admin', 'is_system' => true,
            'created_at' => $now, 'updated_at' => $now,
        ]);
        $this->admin->forceFill(['manager_role_id' => $roleId])->save();
    }

    private function asAdmin(): void
    {
        Sanctum::actingAs($this->admin, ['act-as:admin']);
    }

    private function driver(bool $verified, string $name = 'Ravi'): User
    {
        $driver = User::factory()->create(['name' => $name]);
        $driver->addRole('driver');
        $driver->forceFill([
            'payout_account_status' => $verified ? User::PAYOUT_VERIFIED : User::PAYOUT_PENDING,
            'razorpay_linked_account_id' => $verified ? 'acc_' . $driver->id : null,
            'payout_verified_at' => $verified ? now() : null,
        ])->save();

        return $driver;
    }

    /** A settled ride: ₹100 captured, ₹10 commission, ₹90 to the driver. */
    private function settledRide(User $driver, string $transferStatus = Payment::TRANSFER_PROCESSED): Payment
    {
        $customer = User::factory()->create();
        $customer->addRole('customer');

        $trip = Trip::query()->create([
            'customer_id' => $customer->id, 'driver_id' => $driver->id,
            'city_id' => $this->cityId, 'ride_type_id' => $this->rideTypeId,
            'status' => 'COMPLETED', 'estimated_fare' => 100, 'final_fare' => 100,
            'commission_amount' => 10, 'currency' => 'INR',
            'pickup_lat' => 12.97, 'pickup_lng' => 77.59,
            'drop_lat' => 12.93, 'drop_lng' => 77.62, 'completed_at' => now(),
        ]);

        $payment = Payment::query()->create([
            'trip_id' => $trip->id,
            'method' => 'RAZORPAY', 'provider' => 'RAZORPAY', 'status' => 'SUCCESS',
            'amount' => 100, 'currency' => 'INR',
            'razorpay_payment_id' => 'pay_' . $trip->id,
            'commission_amount' => 10, 'driver_amount' => 90,
            'driver_transfer_id' => $transferStatus === Payment::TRANSFER_HELD ? null : 'trf_' . $trip->id,
            'transfer_status' => $transferStatus,
            'paid_at' => now(), 'split_at' => now(),
        ]);

        $ledger = app(LedgerService::class);
        $ledger->record(LedgerEntry::TYPE_CAPTURE, LedgerEntry::PARTY_CUSTOMER, 'in', 10000, $trip->id, $payment->id, $payment->razorpay_payment_id);
        $ledger->record(LedgerEntry::TYPE_RETAINED, LedgerEntry::PARTY_OPERATOR, 'in', 1000, $trip->id, $payment->id);

        if ($transferStatus === Payment::TRANSFER_HELD) {
            $ledger->record(LedgerEntry::TYPE_HELD, LedgerEntry::PARTY_DRIVER, 'out', 9000, $trip->id, $payment->id);
            HeldEarning::query()->create([
                'driver_id' => $driver->id, 'trip_id' => $trip->id, 'payment_id' => $payment->id,
                'amount_paise' => 9000, 'status' => HeldEarning::STATUS_HELD,
            ]);
        } else {
            $ledger->record(LedgerEntry::TYPE_TRANSFER, LedgerEntry::PARTY_DRIVER, 'out', 9000, $trip->id, $payment->id, $payment->driver_transfer_id);
        }

        return $payment->fresh();
    }

    /* ------------------------------------------------------------------ */
    /* 1) The ledger                                                       */
    /* ------------------------------------------------------------------ */

    public function test_the_ledger_shows_where_the_money_went(): void
    {
        $this->settledRide($this->driver(verified: true));
        $this->asAdmin();

        $res = $this->getJson('/api/admin/ledger')->assertOk()->json();

        $this->assertSame(100.0, (float) $res['summary']['captured']);
        $this->assertSame(90.0, (float) $res['summary']['to_driver']);
        $this->assertSame(10.0, (float) $res['summary']['to_operator']);
        $this->assertSame(1, $res['summary']['trips']);
        $this->assertSame(0, $res['summary']['unbalanced']);
        $this->assertCount(3, $res['rows']);   // capture + retained + transfer
    }

    public function test_the_ledger_flags_a_trip_that_does_not_add_up(): void
    {
        $payment = $this->settledRide($this->driver(verified: true));

        // Money recorded as going out that was never captured — exactly the kind
        // of thing this screen exists to surface.
        app(LedgerService::class)->record(
            LedgerEntry::TYPE_TRANSFER, LedgerEntry::PARTY_DRIVER, 'out',
            5000, $payment->trip_id, $payment->id, 'trf_ghost',
        );

        $this->asAdmin();
        $res = $this->getJson('/api/admin/ledger')->assertOk()->json();

        $this->assertSame(1, $res['summary']['unbalanced']);
        $this->assertFalse($res['reconciliation'][(string) $payment->trip_id]['balanced']);
        $this->assertSame(-5000, $res['reconciliation'][(string) $payment->trip_id]['imbalance_paise']);
    }

    public function test_the_ledger_can_show_only_the_trips_that_do_not_add_up(): void
    {
        $good = $this->settledRide($this->driver(verified: true, name: 'Good'));
        $bad = $this->settledRide($this->driver(verified: true, name: 'Bad'));
        app(LedgerService::class)->record(
            LedgerEntry::TYPE_TRANSFER, LedgerEntry::PARTY_DRIVER, 'out',
            5000, $bad->trip_id, $bad->id, 'trf_ghost',
        );

        $this->asAdmin();
        $res = $this->getJson('/api/admin/ledger?unbalanced=1')->assertOk()->json();

        $tripIds = collect($res['rows'])->pluck('trip_id')->unique()->values()->all();
        $this->assertSame([$bad->trip_id], $tripIds);
        $this->assertNotContains($good->trip_id, $tripIds);
    }

    public function test_the_ledger_can_be_scoped_to_one_trip(): void
    {
        $a = $this->settledRide($this->driver(verified: true, name: 'A'));
        $this->settledRide($this->driver(verified: true, name: 'B'));

        $this->asAdmin();
        $res = $this->getJson("/api/admin/ledger?trip_id={$a->trip_id}")->assertOk()->json();

        $this->assertCount(3, $res['rows']);
        $this->assertSame([$a->trip_id], collect($res['rows'])->pluck('trip_id')->unique()->values()->all());
    }

    /* ------------------------------------------------------------------ */
    /* 2) Who is waiting to be paid                                        */
    /* ------------------------------------------------------------------ */

    public function test_the_monitor_lists_who_is_owed_money_and_why(): void
    {
        $unverified = $this->driver(verified: false, name: 'Waiting on KYC');
        $this->settledRide($unverified, Payment::TRANSFER_HELD);
        $this->settledRide($unverified, Payment::TRANSFER_HELD);
        $this->settledRide($this->driver(verified: true, name: 'Paid fine'));

        $this->asAdmin();
        $owed = $this->getJson('/api/admin/payouts/monitor')->assertOk()->json('owed');

        $this->assertCount(1, $owed, 'only the driver with money parked should appear');
        $this->assertSame($unverified->id, $owed[0]['driver_id']);
        $this->assertSame(180.0, (float) $owed[0]['amount']);   // 2 × ₹90
        $this->assertSame(2, $owed[0]['rides']);
        // The distinction that decides what the operator does next.
        $this->assertTrue($owed[0]['blocked_by_kyc']);
        $this->assertNotNull($owed[0]['oldest_at']);
    }

    public function test_a_verified_driver_with_a_bounced_transfer_is_not_chased_for_kyc(): void
    {
        $verified = $this->driver(verified: true, name: 'Bank bounced');
        $this->settledRide($verified, Payment::TRANSFER_HELD);

        $this->asAdmin();
        $owed = $this->getJson('/api/admin/payouts/monitor')->assertOk()->json('owed');

        $this->assertCount(1, $owed);
        // Already being retried by the sweeper — telling the operator to chase
        // bank details they already have would be wrong.
        $this->assertFalse($owed[0]['blocked_by_kyc']);
    }

    public function test_nobody_owed_means_an_empty_list_not_a_missing_key(): void
    {
        $this->settledRide($this->driver(verified: true));

        $this->asAdmin();
        $res = $this->getJson('/api/admin/payouts/monitor')->assertOk()->json();

        $this->assertSame([], $res['owed']);
        $this->assertSame(0.0, (float) $res['summary']['held_amount']);
    }

    public function test_owed_drivers_are_ordered_worst_first(): void
    {
        $small = $this->driver(verified: false, name: 'Small');
        $big = $this->driver(verified: false, name: 'Big');
        $this->settledRide($small, Payment::TRANSFER_HELD);
        $this->settledRide($big, Payment::TRANSFER_HELD);
        $this->settledRide($big, Payment::TRANSFER_HELD);

        $this->asAdmin();
        $owed = $this->getJson('/api/admin/payouts/monitor')->assertOk()->json('owed');

        $this->assertSame($big->id, $owed[0]['driver_id']);
        $this->assertSame($small->id, $owed[1]['driver_id']);
    }

    /* ------------------------------------------------------------------ */
    /* 3) Refunds as exceptions                                            */
    /* ------------------------------------------------------------------ */

    public function test_the_refund_register_says_refunds_are_automatic_now(): void
    {
        $this->asAdmin();

        // The screen uses this to stop presenting itself as a manual worklist.
        $this->getJson('/api/admin/refunds?status=all')
            ->assertOk()
            ->assertJsonPath('auto_refunds', true);
    }

    public function test_with_the_engine_off_the_refund_register_stays_a_worklist(): void
    {
        config()->set('services.payments.split_enabled', false);
        $this->asAdmin();

        $this->getJson('/api/admin/refunds?status=all')
            ->assertOk()
            ->assertJsonPath('auto_refunds', false);
    }

    /* ------------------------------------------------------------------ */

    public function test_the_money_screens_are_behind_the_finance_permission(): void
    {
        $nobody = User::factory()->create();
        $nobody->addRole('customer');
        Sanctum::actingAs($nobody, ['act-as:customer']);

        $this->getJson('/api/admin/ledger')->assertForbidden();
        $this->getJson('/api/admin/payouts/monitor')->assertForbidden();
    }
}
