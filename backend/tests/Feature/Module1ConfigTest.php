<?php

namespace Tests\Feature;

use App\Models\CitySetting;
use App\Models\Driver;
use App\Models\OperatorSetting;
use App\Models\ShuttlePassengerBooking;
use App\Models\Trip;
use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Module 1 — verification of the config foundations beyond tips:
 *  - Shuttle booking honours the global tips switch (tip zeroed when off).
 *  - The cash-exposure/debt block actually stops a driver going online.
 *  - Tolls OFF (city toll_mode != 'yes') means no toll at booking.
 */
class Module1ConfigTest extends TestCase
{
    use RefreshDatabase;

    // ───────────────────────── helpers ─────────────────────────

    /** Seed a shuttle-capable vehicle; returns the city_vehicle_type id. */
    private function seedShuttle(): int
    {
        config()->set('services.payments.split_enabled', true);
        $now = now();
        $cityId = DB::table('cities')->insertGetId(['name' => 'Shuttle City', 'country_code' => 'IN', 'created_at' => $now, 'updated_at' => $now]);
        $rideTypeId = DB::table('ride_types')->insertGetId(['name' => 'Shuttle', 'mode' => 'shuttle', 'description' => 'Shuttle', 'sort_order' => 1, 'created_at' => $now, 'updated_at' => $now]);
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId(['name' => 'Sedan Shuttle', 'sort_order' => 1, 'is_active' => true, 'created_at' => $now, 'updated_at' => $now]);
        $cvtId = DB::table('city_vehicle_types')->insertGetId([
            'city_id' => $cityId, 'ride_type_id' => $rideTypeId, 'vehicle_type_id' => $vehicleTypeId,
            'display_name' => 'Sedan Shuttle', 'display_order' => 1, 'max_people' => 4, 'luggage_capacity' => 1,
            'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
        ]);
        DB::table('pricing_rules')->insert([
            'city_id' => $cityId, 'city_vehicle_type_id' => $cvtId, 'ride_type_id' => $rideTypeId, 'vehicle_type_id' => $vehicleTypeId,
            'base_fare' => 40, 'surge_multiplier' => 1, 'threshold_distance_1_km' => 2, 'fare_per_km_after_threshold_1' => 8,
            'threshold_time_1_min' => 5, 'fare_per_min_after_threshold_time_1' => 1, 'tax_percent' => 5,
            'commission_type' => 'percent', 'commission_percent' => 20, 'fixed_commission' => 0,
            'created_at' => $now, 'updated_at' => $now,
        ]);
        OperatorSetting::instance()->forceFill(['payment_online_enabled' => true, 'payment_cash_enabled' => true, 'cash_deposit_percent' => 25])->save();

        return $cvtId;
    }

    /** Seed a private-ride vehicle; returns [cityId, rideTypeId]. */
    private function seedPrivate(): array
    {
        $now = now();
        $cityId = DB::table('cities')->insertGetId(['name' => 'Toll City', 'country_code' => 'IN', 'created_at' => $now, 'updated_at' => $now]);
        $rideTypeId = DB::table('ride_types')->insertGetId(['name' => 'Mini', 'mode' => 'private', 'description' => 'Mini', 'sort_order' => 1, 'created_at' => $now, 'updated_at' => $now]);
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId(['name' => 'Sedan', 'sort_order' => 1, 'is_active' => true, 'created_at' => $now, 'updated_at' => $now]);
        $cvtId = DB::table('city_vehicle_types')->insertGetId([
            'city_id' => $cityId, 'ride_type_id' => $rideTypeId, 'vehicle_type_id' => $vehicleTypeId,
            'display_name' => 'Sedan', 'display_order' => 1, 'max_people' => 4, 'luggage_capacity' => 2,
            'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
        ]);
        DB::table('pricing_rules')->insert([
            'city_id' => $cityId, 'city_vehicle_type_id' => $cvtId, 'ride_type_id' => $rideTypeId, 'vehicle_type_id' => $vehicleTypeId,
            'base_fare' => 50, 'surge_multiplier' => 1, 'threshold_distance_1_km' => 5, 'fare_per_km_after_threshold_1' => 10,
            'threshold_time_1_min' => 10, 'fare_per_min_after_threshold_time_1' => 1.5, 'tax_percent' => 0,
            'commission_type' => 'percent', 'commission_percent' => 20, 'fixed_commission' => 0,
            'created_at' => $now, 'updated_at' => $now,
        ]);

        return [$cityId, $rideTypeId];
    }

    private function customer(): User
    {
        $u = User::factory()->create();
        $u->addRole('customer');

        return $u;
    }

    /** An approved driver who has picked a service and can otherwise go online. */
    private function onlineReadyDriver(): User
    {
        $u = User::factory()->create();
        $u->addRole('driver');
        Driver::query()->create([
            'user_id' => $u->id,
            'approval_status' => 'approved',
            'approved_at' => now(),
            'service_scope' => 'local',
            'service_mode' => 'private',
            'is_online' => false,
        ]);

        return $u;
    }

    private function oweCommission(User $driver, float $amount): void
    {
        WalletTransaction::query()->create([
            'user_id' => $driver->id,
            'amount' => $amount,
            'type' => WalletTransaction::TYPE_DEBIT,
            'reason' => 'Cash commission owed',
            'created_by_user_id' => $driver->id,
        ]);
    }

    // ─────────────────── Item 2 — shuttle tip zeroing ───────────────────

    public function test_shuttle_booking_zeroes_tip_when_tipping_disabled(): void
    {
        $cvtId = $this->seedShuttle();
        $this->assertFalse((bool) OperatorSetting::instance()->tips_enabled);

        Sanctum::actingAs($this->customer(), ['act-as:customer']);
        $bookingId = (int) $this->postJson('/api/shuttle/bookings', [
            'city_vehicle_type_id' => $cvtId,
            'pickup_lat' => 12.9716, 'pickup_lng' => 77.5946, 'pickup_address' => 'P',
            'drop_lat' => 12.9352, 'drop_lng' => 77.6245, 'drop_address' => 'D',
            'route_distance_km' => 6, 'route_time_min' => 18,
            'payment_method' => 'razorpay', 'tip_amount' => 20,
        ])->assertCreated()->json('booking.id');

        $this->assertSame(0.0, (float) ShuttlePassengerBooking::query()->findOrFail($bookingId)->tip_amount);
    }

    public function test_shuttle_booking_keeps_tip_when_tipping_enabled(): void
    {
        $cvtId = $this->seedShuttle();
        OperatorSetting::instance()->update(['tips_enabled' => true]);

        Sanctum::actingAs($this->customer(), ['act-as:customer']);
        $bookingId = (int) $this->postJson('/api/shuttle/bookings', [
            'city_vehicle_type_id' => $cvtId,
            'pickup_lat' => 12.9716, 'pickup_lng' => 77.5946, 'pickup_address' => 'P',
            'drop_lat' => 12.9352, 'drop_lng' => 77.6245, 'drop_address' => 'D',
            'route_distance_km' => 6, 'route_time_min' => 18,
            'payment_method' => 'razorpay', 'tip_amount' => 20,
        ])->assertCreated()->json('booking.id');

        $this->assertSame(20.0, (float) ShuttlePassengerBooking::query()->findOrFail($bookingId)->tip_amount);
    }

    // ─────────────────── Item 3 — cash-exposure go-online block ───────────────────

    public function test_driver_in_debt_is_blocked_from_going_online_when_check_enabled(): void
    {
        OperatorSetting::instance()->update(['check_driver_debt' => true]);
        $driver = $this->onlineReadyDriver();
        $this->oweCommission($driver, 150);

        Sanctum::actingAs($driver, ['act-as:driver']);
        $this->postJson('/api/drivers/go-online')
            ->assertStatus(422)
            ->assertJsonPath('error_code', 'driver_debt');

        $this->assertFalse((bool) Driver::query()->where('user_id', $driver->id)->value('is_online'));
    }

    public function test_driver_in_debt_can_go_online_when_check_disabled(): void
    {
        OperatorSetting::instance()->update(['check_driver_debt' => false]);
        $driver = $this->onlineReadyDriver();
        $this->oweCommission($driver, 150);

        Sanctum::actingAs($driver, ['act-as:driver']);
        $this->postJson('/api/drivers/go-online')->assertOk();

        $this->assertTrue((bool) Driver::query()->where('user_id', $driver->id)->value('is_online'));
    }

    // ─────────────────── Item 4 — tolls OFF at booking ───────────────────

    public function test_toll_is_not_charged_at_booking_when_toll_mode_off(): void
    {
        [$cityId, $rideTypeId] = $this->seedPrivate();
        CitySetting::query()->updateOrCreate(['city_id' => $cityId], ['toll_mode' => 'no']);

        Sanctum::actingAs($this->customer(), ['act-as:customer']);
        $tripId = $this->postJson('/api/trips', [
            'city_id' => $cityId, 'ride_type_id' => $rideTypeId,
            'pickup_lat' => 12.9716, 'pickup_lng' => 77.5946,
            'drop_lat' => 12.9352, 'drop_lng' => 77.6245,
            'toll_amount' => 100,
        ])->assertCreated()->json('trip.id');

        $this->assertSame(0.0, (float) Trip::query()->findOrFail($tripId)->toll_amount);
    }

    public function test_toll_is_charged_at_booking_when_toll_mode_on(): void
    {
        [$cityId, $rideTypeId] = $this->seedPrivate();
        CitySetting::query()->updateOrCreate(['city_id' => $cityId], ['toll_mode' => 'yes']);

        Sanctum::actingAs($this->customer(), ['act-as:customer']);
        $tripId = $this->postJson('/api/trips', [
            'city_id' => $cityId, 'ride_type_id' => $rideTypeId,
            'pickup_lat' => 12.9716, 'pickup_lng' => 77.5946,
            'drop_lat' => 12.9352, 'drop_lng' => 77.6245,
            'toll_amount' => 100,
        ])->assertCreated()->json('trip.id');

        $this->assertSame(100.0, (float) Trip::query()->findOrFail($tripId)->toll_amount);
    }
}
