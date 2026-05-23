<?php

namespace Database\Seeders;

use App\Models\User;
use App\Models\City;
use App\Models\RideType;
use App\Models\PricingRule;
use App\Models\VehicleType;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        // Default city for fare estimation / booking during development.
        $city = City::updateOrCreate(
            ['name' => 'Default City'],
            ['country_code' => 'IN'],
        );

        $rideTypes = [
            ['name' => 'Shuttle', 'description' => 'Car rental service', 'sort_order' => 30],
            ['name' => 'Outstation', 'description' => 'Package delivery', 'sort_order' => 40],
            ['name' => 'Normal', 'description' => 'Regular ride', 'sort_order' => 50],
        ];

        $vehicleTypes = [
            ['name' => 'Sedan', 'description' => 'Standard sedan car', 'sort_order' => 10],
            ['name' => 'SUV', 'description' => 'Sport Utility Vehicle', 'sort_order' => 20],
            ['name' => 'Hatchback', 'description' => 'Compact hatchback car', 'sort_order' => 30],
            ['name' => 'Van', 'description' => 'Spacious van for groups', 'sort_order' => 40],
            ['name' => 'Motorcycle', 'description' => 'Two-wheeler motorcycle', 'sort_order' => 50],
        ];

        foreach ($rideTypes as $rt) {
            RideType::updateOrCreate(
                ['name' => $rt['name']],
                ['description' => $rt['description'], 'sort_order' => $rt['sort_order']],
            );
        }

        foreach ($vehicleTypes as $vt) {
            VehicleType::updateOrCreate(
                ['name' => $vt['name']],
                ['description' => $vt['description'], 'sort_order' => $vt['sort_order']],
            );
        }

        // Pricing rules are now keyed by (city_id, vehicle_type_id, product_kind).
        // Each rule has thresholded distance + time slabs so the fare estimator
        // returns 10×10 + 3×7 = ₹121 for a 13 km Sedan ride, etc.
        $pricing = [
            'Sedan' => [
                'base_fare' => 50, 'per_km' => 10, 'per_min' => 1.5,
                'surge_multiplier' => 1.0, 'commission_percent' => 20, 'min_fare' => 100,
                'threshold_distance_1_km' => 10, 'fare_per_km_after_threshold_1' => 7,
                'threshold_distance_2_km' => 20, 'fare_per_km_after_threshold_2' => 5,
                'threshold_time_1_min' => 30, 'fare_per_min_after_threshold_time_1' => 1.0,
                'threshold_waiting_time_min' => 3, 'fare_per_waiting_minute' => 2,
                'cancellation_charges' => 30, 'cancel_threshold_time_min' => 2,
                'no_show_charges_per_minute' => 2, 'no_show_threshold_minutes' => 5,
                'pickup_charge_before_threshold' => 0, 'pickup_charge_after_threshold' => 25,
                'pickup_threshold_distance_km' => 3, 'tax_percent' => 5,
            ],
            'SUV' => [
                'base_fare' => 80, 'per_km' => 14, 'per_min' => 2.0,
                'surge_multiplier' => 1.0, 'commission_percent' => 20, 'min_fare' => 150,
                'threshold_distance_1_km' => 10, 'fare_per_km_after_threshold_1' => 10,
                'threshold_distance_2_km' => 20, 'fare_per_km_after_threshold_2' => 8,
                'threshold_time_1_min' => 30, 'fare_per_min_after_threshold_time_1' => 1.5,
                'threshold_waiting_time_min' => 3, 'fare_per_waiting_minute' => 3,
                'cancellation_charges' => 50, 'tax_percent' => 5,
            ],
            'Hatchback' => [
                'base_fare' => 40, 'per_km' => 8, 'per_min' => 1.2,
                'surge_multiplier' => 1.0, 'commission_percent' => 18, 'min_fare' => 80,
                'threshold_distance_1_km' => 10, 'fare_per_km_after_threshold_1' => 6,
                'threshold_time_1_min' => 30, 'fare_per_min_after_threshold_time_1' => 0.8,
                'cancellation_charges' => 20, 'tax_percent' => 5,
            ],
            'Van' => [
                'base_fare' => 120, 'per_km' => 18, 'per_min' => 2.5,
                'surge_multiplier' => 1.0, 'commission_percent' => 22, 'min_fare' => 250,
                'threshold_distance_1_km' => 10, 'fare_per_km_after_threshold_1' => 14,
                'cancellation_charges' => 80, 'tax_percent' => 5,
            ],
            'Motorcycle' => [
                'base_fare' => 20, 'per_km' => 5, 'per_min' => 0.8,
                'surge_multiplier' => 1.0, 'commission_percent' => 15, 'min_fare' => 40,
                'threshold_distance_1_km' => 10, 'fare_per_km_after_threshold_1' => 4,
                'cancellation_charges' => 10, 'tax_percent' => 5,
            ],
        ];

        // Apply the same rate card to every existing city so the customer app
        // never hits a "pricing rule not found" 404 just because the active
        // city was set up by hand without rules.
        $allCities = City::query()->get();
        foreach ($allCities as $c) {
            foreach ($pricing as $vehicleName => $rule) {
                $vehicleType = VehicleType::query()->where('name', $vehicleName)->first();
                if (!$vehicleType) {
                    continue;
                }
                PricingRule::updateOrCreate(
                    [
                        'city_id' => $c->id,
                        'vehicle_type_id' => $vehicleType->id,
                        'product_kind' => 'local',
                    ],
                    $rule + ['product_kind' => 'local'],
                );
            }
        }

        // Create a simple dev user for quick manual API testing (optional).
        // $testUser = User::query()->updateOrCreate(
        //     ['email' => 'test@example.com'],
        //     [
        //         'name' => 'Test User',
        //         'password' => bcrypt('password'),
        //     ],
        // );
        // $testUser->addRole('customer');

        // Create an admin user for the web/admin panel.
        // Credentials are read from env: ADMIN_EMAIL / ADMIN_PASSWORD.
        $this->call(AdminUserSeeder::class);

        // RBAC: seed permissions + default roles, and pin admin@example.com as Super Admin.
        $this->call(RbacSeeder::class);

        // Sample trips for dashboards and API manual testing (pickup_address starts with "(seed) ").
        // $this->call(TripSeeder::class);
    }
}
