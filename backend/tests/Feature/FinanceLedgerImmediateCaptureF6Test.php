<?php

namespace Tests\Feature;

use App\Models\LedgerEntry;
use App\Models\Payment;
use App\Models\Route;
use App\Models\RouteDeparture;
use App\Models\RouteStop;
use App\Models\SeatReservation;
use App\Models\Trip;
use App\Models\User;
use App\Services\BookingPaymentService;
use App\Services\PaymentSplitService;
use App\Services\PayoutMonitorService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Support\SeatLayoutFactory;
use Tests\TestCase;

class FinanceLedgerImmediateCaptureF6Test extends TestCase
{
    use RefreshDatabase;

    private int $cityId;
    private int $routeId;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('services.payments.split_enabled', true);

        $this->cityId = DB::table('cities')->insertGetId([
            'name' => 'F6 Test City',
            'country_code' => 'IN',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('ride_types')->insert([
            'id' => 1,
            'name' => 'Fixed Vehicle',
            'description' => 'F6 Test',
            'sort_order' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Ertiga',
            'sort_order' => 1,
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        SeatLayoutFactory::standardErtiga6P($this->cityId, $vehicleTypeId);

        $route = Route::query()->create([
            'city_id' => $this->cityId,
            'scope' => 'local',
            'mode' => 'fixed',
            'name' => 'F6 Route',
            'origin_name' => 'A',
            'dest_name' => 'B',
            'origin_lat' => 34.0,
            'origin_lng' => 74.0,
            'dest_lat' => 34.1,
            'dest_lng' => 74.1,
            'fare_config' => [
                'seat_fare' => 150.0,
                'commission_type' => 'percent',
                'commission_percent' => 20.0,
            ],
            'booking_window_hours' => 6,
            'max_seats_per_booking' => 4,
            'waiting_time_per_stop_minutes' => 5,
            'luggage_surcharge_amount' => 25,
            'max_luggage_per_vehicle' => 3,
            'requires_prepaid' => true,
            'board_anywhere' => false,
            'is_active' => true,
        ]);
        $this->routeId = $route->id;

        RouteStop::query()->create([
            'route_id' => $route->id, 'seq' => 1, 'name' => 'A',
            'lat' => 34.0, 'lng' => 74.0,
            'is_pickup' => true, 'is_drop' => false, 'is_active' => true,
            'is_temporarily_unavailable' => false,
        ]);
        RouteStop::query()->create([
            'route_id' => $route->id, 'seq' => 2, 'name' => 'B',
            'lat' => 34.1, 'lng' => 74.1,
            'is_pickup' => false, 'is_drop' => true, 'is_active' => true,
            'is_temporarily_unavailable' => false,
        ]);
    }

    public function test_booking_payment_capture_creates_ledger_entry_immediately(): void
    {
        $bookingService = app(BookingPaymentService::class);
        $monitorService = app(PayoutMonitorService::class);

        // 1. Record capture for a booking before any trip or driver exists
        $payment = $bookingService->recordCapture(
            tripId: null,
            razorpayPaymentId: 'pay_f6_test_123',
            fareAmount: 150.0,
            commissionAmount: 30.0,
        );

        $this->assertNotNull($payment);
        $this->assertEquals('SUCCESS', $payment->status);

        // Assert that a TYPE_CAPTURE ledger entry was written IMMEDIATELY upon payment capture
        $captureLedger = LedgerEntry::query()
            ->where('payment_id', $payment->id)
            ->where('type', LedgerEntry::TYPE_CAPTURE)
            ->first();

        $this->assertNotNull($captureLedger, 'Finance ledger entry must be created immediately on capture (F6 fix)');
        $this->assertEquals(15000, $captureLedger->amount_paise);
        $this->assertEquals('pay_f6_test_123', $captureLedger->razorpay_ref);

        // Assert that the transaction appears immediately on /admin/ledger
        $ledgerData = $monitorService->ledger();
        $this->assertNotEmpty($ledgerData['rows']);
        $this->assertEquals($payment->id, $ledgerData['rows'][0]['payment_id']);

        // 2. Now simulate departure dispatch & trip completion
        $departure = RouteDeparture::query()->create([
            'route_id' => $this->routeId,
            'scheduled_departure_at' => now()->addHour(),
            'status' => 'FORMING',
            'is_cancelled' => false,
        ]);

        $driverUser = User::factory()->create(['user_type' => 'driver']);
        $driver = DB::table('drivers')->insertGetId([
            'user_id' => $driverUser->id, 'city_id' => $this->cityId,
            'approval_status' => 'APPROVED', 'is_online' => true, 'is_on_trip' => false,
            'created_at' => now(), 'updated_at' => now(),
        ]);

        $trip = Trip::query()->create([
            'customer_id' => User::factory()->create()->id,
            'driver_id' => $driverUser->id,
            'city_id' => $this->cityId,
            'status' => 'COMPLETED',
            'route_departure_id' => $departure->id,
            'estimated_fare' => 150.0,
            'final_fare' => 150.0,
            'commission_amount' => 30.0,
            'commission_percent' => 20.0,
        ]);

        // Link trip to booking
        $bookingService->linkTrip($trip, ['pay_f6_test_123']);

        // Assert that trip_id was backfilled on the ledger entry
        $captureLedger->refresh();
        $this->assertEquals($trip->id, $captureLedger->trip_id);

        // 3. Complete trip settlement
        $bookingService->settleTrip($trip);

        // Assert that no duplicate TYPE_CAPTURE entry was created
        $captureCount = LedgerEntry::query()
            ->where('payment_id', $payment->id)
            ->where('type', LedgerEntry::TYPE_CAPTURE)
            ->count();
        $this->assertEquals(1, $captureCount);

        // Assert trip balance reconciles to the paise
        $ledgerService = app(\App\Services\LedgerService::class);
        $balance = $ledgerService->tripBalance($trip->id);
        $this->assertTrue($balance['balanced']);
        $this->assertEquals(0, $balance['imbalance']);
    }
}
