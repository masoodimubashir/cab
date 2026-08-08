<?php

namespace Tests\Feature;

use App\Models\Driver;
use App\Models\LedgerEntry;
use App\Models\OperatorSetting;
use App\Models\Payment;
use App\Models\Route;
use App\Models\RouteDeparture;
use App\Models\RouteStop;
use App\Models\SeatReservation;
use App\Models\User;
use App\Services\FixedRefundService;
use App\Services\RazorpayService;
use App\Services\RefundRegisterService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\Support\SeatLayoutFactory;
use Tests\TestCase;

/**
 * Module 7 (Fixed) — cancelling a CASH seat auto-refunds the online DEPOSIT
 * (only the deposit ever went online; the balance was cash to the driver and is
 * never returned here). The admin refund register then labels the row as a cash
 * deposit-auto refund, with the cash balance shown for context — a physical-cash
 * dispute stays a manual matter.
 *
 * ₹120 seat, 25% deposit → ₹30 online, ₹90 cash.
 */
class FixedCashRefundTest extends TestCase
{
    use RefreshDatabase;

    private const SEAT_FARE = 120.0;
    private const COMMISSION_PCT = 20.0;
    private const DEPOSIT_PCT = 25.0;

    private int $routeId;
    private RouteStop $pickup;
    private RouteStop $drop;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('services.payments.split_enabled', true);
        config()->set('services.razorpay.key_id', 'rzp_test_cashrefund');

        OperatorSetting::instance()->forceFill([
            'payment_cash_enabled' => true,
            'cash_deposit_percent' => self::DEPOSIT_PCT,
        ])->save();

        $cityId = DB::table('cities')->insertGetId([
            'name' => 'CashRefund City', 'country_code' => 'IN', 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('ride_types')->insert([
            'id' => 1, 'name' => 'Fixed Vehicle', 'description' => 'Cash', 'sort_order' => 1,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Ertiga', 'sort_order' => 1, 'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
        ]);
        SeatLayoutFactory::standardErtiga6P($cityId, $vehicleTypeId);

        $route = Route::query()->create([
            'city_id' => $cityId, 'scope' => 'local', 'mode' => 'fixed',
            'name' => 'CashRefund Route', 'origin_name' => 'A', 'dest_name' => 'B',
            'origin_lat' => 34.0, 'origin_lng' => 74.0, 'dest_lat' => 34.1, 'dest_lng' => 74.1,
            'fare_config' => [
                'seat_fare' => self::SEAT_FARE,
                'commission_type' => 'percent',
                'commission_percent' => self::COMMISSION_PCT,
            ],
            'booking_window_hours' => 6, 'max_seats_per_booking' => 4,
            'waiting_time_per_stop_minutes' => 5,
            'luggage_surcharge_amount' => 25, 'max_luggage_per_vehicle' => 3,
            'requires_prepaid' => true, 'board_anywhere' => false, 'is_active' => true,
        ]);
        $this->routeId = $route->id;

        $this->pickup = RouteStop::query()->create([
            'route_id' => $route->id, 'seq' => 1, 'name' => 'A', 'lat' => 34.0, 'lng' => 74.0,
            'is_pickup' => true, 'is_drop' => false, 'is_active' => true, 'is_temporarily_unavailable' => false,
        ]);
        $this->drop = RouteStop::query()->create([
            'route_id' => $route->id, 'seq' => 2, 'name' => 'B', 'lat' => 34.1, 'lng' => 74.1,
            'is_pickup' => false, 'is_drop' => true, 'is_active' => true, 'is_temporarily_unavailable' => false,
        ]);
    }

    private function mockRazorpay(): void
    {
        $mock = Mockery::mock(RazorpayService::class);
        $mock->shouldReceive('createOrder')->andReturnUsing(
            fn ($amountPaise, $receipt) => ['order_id' => 'order_' . $amountPaise, 'amount' => $amountPaise, 'currency' => 'INR']
        );
        // Encode the requested paise into the refund id so the test can assert
        // exactly how much was sent back (the deposit, not the fare).
        $mock->shouldReceive('refundPayment')->andReturnUsing(
            fn ($paymentId, $amountPaise, $notes = []) => ['id' => 'rfnd_' . $amountPaise, 'status' => 'processed']
        );
        $this->app->instance(RazorpayService::class, $mock);
    }

    private function makeCustomer(): User
    {
        $u = User::factory()->create();
        $u->addRole('customer');

        return $u;
    }

    private function makeDriver(): User
    {
        $driver = User::factory()->create();
        $driver->addRole('driver');
        Driver::query()->create([
            'user_id' => $driver->id, 'approval_status' => 'approved',
            'service_scope' => 'local', 'service_mode' => 'fixed',
            'active_service_scope' => 'local', 'active_service_mode' => 'fixed',
            'is_online' => true, 'last_online_at' => now(),
        ]);

        return $driver;
    }

    private function openDeparture(User $driver): RouteDeparture
    {
        return RouteDeparture::query()->create([
            'route_id' => $this->routeId, 'driver_id' => $driver->id,
            'vehicle_seat_layout_id' => DB::table('vehicle_seat_layouts')->value('id'),
            'service_date' => now()->toDateString(), 'departure_kind' => 'driver_opened',
            'depart_at' => now()->addHours(2), 'announced_depart_at' => now()->addHours(2),
            'boarding_opened_at' => now(), 'visible_to_customers' => true,
            'capacity' => 6, 'seats_taken' => 0, 'luggage_capacity' => 3, 'luggage_taken' => 0,
            'status' => 'FORMING',
        ]);
    }

    private function bookCashSeat(User $customer, RouteDeparture $departure, array $labels): SeatReservation
    {
        Sanctum::actingAs($customer, ['act-as:customer']);
        $holdId = $this->withHeaders(['Idempotency-Key' => 'cr-hold'])
            ->postJson('/api/fixed/seat-holds', [
                'route_departure_id' => $departure->id,
                'board_stop_id' => $this->pickup->id,
                'drop_stop_id' => $this->drop->id,
                'seat_labels' => $labels,
                'payment_method' => 'cash',
            ])->assertCreated()->json('hold.id');

        $reservationId = (int) $this->withHeaders(['Idempotency-Key' => 'cr-pay'])
            ->postJson("/api/fixed/seat-holds/{$holdId}/test-confirm-payment", [
                'booking_channel' => 'advance',
            ])->assertCreated()->json('reservation.id');

        return SeatReservation::query()->findOrFail($reservationId);
    }

    public function test_cancelling_a_cash_seat_before_pickup_refunds_only_the_deposit(): void
    {
        $this->mockRazorpay();
        $customer = $this->makeCustomer();
        $driver = $this->makeDriver();
        $departure = $this->openDeparture($driver);
        $reservation = $this->bookCashSeat($customer, $departure, ['1A']);

        $payment = Payment::query()->where('razorpay_payment_id', $reservation->payment_reference)->firstOrFail();
        $this->assertSame(30.0, (float) $payment->cash_deposit_amount);

        // Customer cancels while the bus is still forming — the seat is resellable,
        // so the deposit goes back automatically.
        $result = app(FixedRefundService::class)->cancelByCustomer($reservation);

        $this->assertTrue($result['refunded']);
        $this->assertSame('REFUNDED', $result['refund_status']);

        // The booking records the DEPOSIT as refunded, not the ₹120 fare.
        $reservation->refresh();
        $this->assertSame('REFUNDED', $reservation->refund_status);
        $this->assertSame(30.0, (float) $reservation->refund_amount);
        $this->assertSame('razorpay', $reservation->refund_method);
        // rfnd_3000 proves exactly ₹30 (3000 paise) was sent to Razorpay.
        $this->assertSame('rfnd_3000', $reservation->refund_reference);

        // The mirrored payment is closed out as refunded for the deposit only.
        $payment->refresh();
        $this->assertSame('REFUNDED', $payment->status);
        $this->assertSame(30.0, (float) $payment->refund_amount);

        // The ledger nets to zero for this payment: ₹30 captured, ₹30 refunded.
        $captured = (int) LedgerEntry::query()->where('payment_id', $payment->id)->where('type', LedgerEntry::TYPE_CAPTURE)->sum('amount_paise');
        $refunded = (int) LedgerEntry::query()->where('payment_id', $payment->id)->where('type', LedgerEntry::TYPE_REFUND)->sum('amount_paise');
        $this->assertSame(3000, $captured);
        $this->assertSame(3000, $refunded);
    }

    public function test_the_refund_register_labels_the_cancelled_cash_booking_as_a_deposit_refund(): void
    {
        $this->mockRazorpay();
        $customer = $this->makeCustomer();
        $driver = $this->makeDriver();
        $departure = $this->openDeparture($driver);
        $reservation = $this->bookCashSeat($customer, $departure, ['1A']);

        app(FixedRefundService::class)->cancelByCustomer($reservation);

        $list = app(RefundRegisterService::class)->adminList('all');
        $row = collect($list['rows'])->firstWhere('key', 'fixed:' . $reservation->id);

        $this->assertNotNull($row, 'the cancelled cash booking should appear in the register');
        $this->assertTrue($row['is_cash']);
        $this->assertSame('cash', $row['payment_method']);
        $this->assertSame('refunded', $row['state']);
        // The register tracks the DEPOSIT (₹30), with the ₹90 cash balance shown
        // for context — the driver collected that in person, it's never refunded here.
        $this->assertSame(30.0, (float) $row['amount']);
        $this->assertSame(30.0, (float) $row['cash_deposit']);
        $this->assertSame(90.0, (float) $row['cash_balance']);
        $this->assertSame('razorpay', $row['refund_method']);
    }
}
