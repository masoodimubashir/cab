<?php

namespace Database\Seeders;

use App\Models\Driver;
use App\Models\PricingRule;
use App\Models\RideType;
use App\Models\Trip;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Database\Seeder;

class TripSeeder extends Seeder
{
    private const ADDRESS_PREFIX = '(seed) ';

    public function run(): void
    {
        $customer = User::query()->where('email', 'test@example.com')->first();
        if (! $customer) {
            $this->command?->warn('TripSeeder skipped: no test@example.com user. Run DatabaseSeeder first.');

            return;
        }

        // Use ride types DatabaseSeeder actually creates (Normal / Outstation);
        // 'Mini'/'Sedan' are vehicle types, not ride types, so the old lookups
        // always missed and this seeder silently no-opped.
        $rideMini = RideType::query()->where('name', 'Normal')->first();
        $rideSedan = RideType::query()->where('name', 'Outstation')->first();
        if (! $rideMini || ! $rideSedan) {
            $this->command?->warn('TripSeeder skipped: ride types missing. Run DatabaseSeeder first.');

            return;
        }

        $pricingMini = PricingRule::query()
            ->where('ride_type_id', $rideMini->id)
            ->first();
        $pricingSedan = PricingRule::query()
            ->where('ride_type_id', $rideSedan->id)
            ->first();

        $driverUser = User::query()->updateOrCreate(
            ['email' => 'driver@example.com'],
            [
                'name' => 'Test Driver',
                'password' => bcrypt('password'),
                'phone' => '+919999000001',
            ],
        );
        $driverUser->addRole('driver');

        Driver::query()->updateOrCreate(
            ['user_id' => $driverUser->id],
            [
                'approval_status' => 'approved',
                'approved_at' => Carbon::now()->subDays(30),
                'vehicle_type' => 'Sedan',
                'vehicle_brand' => 'Maruti',
                'vehicle_model' => 'Dzire',
                'vehicle_color' => 'White',
                'vehicle_reg_no' => 'KA01SEED01',
                'rating_avg' => 4.7,
                'rating_count' => 12,
            ],
        );

        Trip::query()
            ->where('pickup_address', 'like', self::ADDRESS_PREFIX.'%')
            ->delete();

        $now = Carbon::now();

        $rows = [
            [
                'customer_id' => $customer->id,
                'driver_id' => null,
                'ride_type_id' => $rideMini->id,
                'pricing_rule_id' => $pricingMini?->id,
                'status' => 'REQUESTED',
                'estimated_fare' => 189.50,
                'final_fare' => null,
                'pickup_address' => self::ADDRESS_PREFIX.'Indiranagar Metro, Bengaluru',
                'pickup_lat' => 12.9784,
                'pickup_lng' => 77.6408,
                'drop_address' => self::ADDRESS_PREFIX.'Forum Mall, Koramangala',
                'drop_lat' => 12.9347,
                'drop_lng' => 77.6113,
                'negotiation_started_at' => null,
                'confirmed_at' => null,
                'assigned_at' => null,
                'en_route_pickup_at' => null,
                'arrived_pickup_at' => null,
                'en_route_drop_at' => null,
                'arrived_drop_at' => null,
                'completed_at' => null,
            ],
            [
                'customer_id' => $customer->id,
                'driver_id' => null,
                'ride_type_id' => $rideSedan->id,
                'pricing_rule_id' => $pricingSedan?->id,
                'status' => 'NEGOTIATION',
                'estimated_fare' => 245.00,
                'final_fare' => null,
                'pickup_address' => self::ADDRESS_PREFIX.'Cubbon Park, Bengaluru',
                'pickup_lat' => 12.9763,
                'pickup_lng' => 77.5929,
                'drop_address' => self::ADDRESS_PREFIX.'Kempegowda Airport T1',
                'drop_lat' => 13.1986,
                'drop_lng' => 77.7066,
                'negotiation_started_at' => $now->copy()->subMinutes(12),
                'confirmed_at' => null,
                'assigned_at' => null,
                'en_route_pickup_at' => null,
                'arrived_pickup_at' => null,
                'en_route_drop_at' => null,
                'arrived_drop_at' => null,
                'completed_at' => null,
            ],
            [
                'customer_id' => $customer->id,
                'driver_id' => $driverUser->id,
                'ride_type_id' => $rideSedan->id,
                'pricing_rule_id' => $pricingSedan?->id,
                'status' => 'ASSIGNED',
                'estimated_fare' => 320.00,
                'final_fare' => null,
                'pickup_address' => self::ADDRESS_PREFIX.'MG Road, Bengaluru',
                'pickup_lat' => 12.9748,
                'pickup_lng' => 77.6066,
                'drop_address' => self::ADDRESS_PREFIX.'Whitefield ITPL',
                'drop_lat' => 12.9876,
                'drop_lng' => 77.7374,
                'negotiation_started_at' => $now->copy()->subHour(),
                'confirmed_at' => $now->copy()->subMinutes(45),
                'assigned_at' => $now->copy()->subMinutes(40),
                'en_route_pickup_at' => null,
                'arrived_pickup_at' => null,
                'en_route_drop_at' => null,
                'arrived_drop_at' => null,
                'completed_at' => null,
            ],
            [
                'customer_id' => $customer->id,
                'driver_id' => $driverUser->id,
                'ride_type_id' => $rideMini->id,
                'pricing_rule_id' => $pricingMini?->id,
                'status' => 'EN_ROUTE_DROP',
                'estimated_fare' => 156.00,
                'final_fare' => null,
                'pickup_address' => self::ADDRESS_PREFIX.'HSR Layout Sector 2',
                'pickup_lat' => 12.9116,
                'pickup_lng' => 77.6389,
                'drop_address' => self::ADDRESS_PREFIX.'Electronic City Phase 1',
                'drop_lat' => 12.8456,
                'drop_lng' => 77.6633,
                'negotiation_started_at' => $now->copy()->subHours(2),
                'confirmed_at' => $now->copy()->subHours(2)->addMinutes(10),
                'assigned_at' => $now->copy()->subHours(2)->addMinutes(15),
                'en_route_pickup_at' => $now->copy()->subHours(2)->addMinutes(20),
                'arrived_pickup_at' => $now->copy()->subHours(2)->addMinutes(35),
                'en_route_drop_at' => $now->copy()->subHours(2)->addMinutes(40),
                'arrived_drop_at' => null,
                'completed_at' => null,
            ],
            [
                'customer_id' => $customer->id,
                'driver_id' => $driverUser->id,
                'ride_type_id' => $rideSedan->id,
                'pricing_rule_id' => $pricingSedan?->id,
                'status' => 'COMPLETED',
                'estimated_fare' => 280.00,
                'final_fare' => 265.50,
                'pickup_address' => self::ADDRESS_PREFIX.'UB City, Bengaluru',
                'pickup_lat' => 12.9716,
                'pickup_lng' => 77.5946,
                'drop_address' => self::ADDRESS_PREFIX.'Jayanagar 4th Block',
                'drop_lat' => 12.9250,
                'drop_lng' => 77.5938,
                'negotiation_started_at' => $now->copy()->subDays(2)->subHour(),
                'confirmed_at' => $now->copy()->subDays(2)->subMinutes(50),
                'assigned_at' => $now->copy()->subDays(2)->subMinutes(45),
                'en_route_pickup_at' => $now->copy()->subDays(2)->subMinutes(40),
                'arrived_pickup_at' => $now->copy()->subDays(2)->subMinutes(25),
                'en_route_drop_at' => $now->copy()->subDays(2)->subMinutes(20),
                'arrived_drop_at' => $now->copy()->subDays(2)->subMinutes(5),
                'completed_at' => $now->copy()->subDays(2),
            ],
            [
                'customer_id' => $customer->id,
                'driver_id' => null,
                'ride_type_id' => $rideMini->id,
                'pricing_rule_id' => $pricingMini?->id,
                'status' => 'CANCELLED',
                'estimated_fare' => 95.00,
                'final_fare' => null,
                'pickup_address' => self::ADDRESS_PREFIX.'Malleshwaram 8th Cross',
                'pickup_lat' => 12.9991,
                'pickup_lng' => 77.5683,
                'drop_address' => self::ADDRESS_PREFIX.'Rajajinagar',
                'drop_lat' => 12.9912,
                'drop_lng' => 77.5497,
                'cancelled_reason' => 'Customer cancelled — schedule change',
                'cancelled_at' => $now->copy()->subDays(1),
                'negotiation_started_at' => $now->copy()->subDays(1)->subMinutes(5),
                'confirmed_at' => null,
                'assigned_at' => null,
                'en_route_pickup_at' => null,
                'arrived_pickup_at' => null,
                'en_route_drop_at' => null,
                'arrived_drop_at' => null,
                'completed_at' => null,
            ],
        ];

        foreach ($rows as $row) {
            Trip::query()->create(array_merge([
                'currency' => 'INR',
            ], $row));
        }

        $this->command?->info('TripSeeder: created '.count($rows).' trips (prefix '.self::ADDRESS_PREFIX.').');
    }
}
