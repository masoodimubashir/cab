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
        // Ride types ARE seeded. Unlike cities and vehicle types they have no
        // admin screen — the CRUD API exists (/admin/ride-types-crud) but
        // nothing in the panel calls it — so without this the three service
        // modes cannot be created at all and "Create Normal/Shuttle fare setup"
        // fails with "… ride type is not available".
        //
        // These three names are what the mode mapping keys off, everywhere:
        // a name containing "shuttle" is Shuttle, one containing "fixed" is
        // Fixed, anything else is Normal.
        //
        // "Outstation" is deliberately NOT seeded. That mapping would classify
        // it as Normal, and since the lookup takes the first match by
        // sort_order, an Outstation row could be attached when the operator
        // asks for a Normal fare setup — which then renders the outstation
        // package panel instead of the base fare card. Add it only alongside an
        // explicit rule for it in the mapping.
        $rideTypes = [
            ['name' => 'Fixed',  'description' => 'Regular point-to-point ride',            'sort_order' => 10],
            ['name' => 'Fixed',   'description' => 'Prepaid fixed route with mapped stops',  'sort_order' => 20],
            ['name' => 'Shuttle', 'description' => 'Shared shuttle service',                 'sort_order' => 30],
        ];

        foreach ($rideTypes as $rt) {
            RideType::updateOrCreate(
                ['name' => $rt['name']],
                ['description' => $rt['description'], 'sort_order' => $rt['sort_order']],
            );
        }

        // Cities and vehicle types stay disabled — both have admin screens, and
        // seeding them would inject records the operator did not create.
        /*
        // Default city for fare estimation / booking during development.
        $city = City::updateOrCreate(
            ['name' => 'Default City'],
            ['country_code' => 'IN'],
        );

        $vehicleTypes = [
            ['name' => 'Sedan', 'sort_order' => 10],
            ['name' => 'SUV', 'sort_order' => 20],
            ['name' => 'Hatchback', 'sort_order' => 30],
            ['name' => 'Van', 'sort_order' => 40],
            ['name' => 'Motorcycle', 'sort_order' => 50],
        ];

        foreach ($vehicleTypes as $vt) {
            VehicleType::updateOrCreate(
                ['name' => $vt['name']],
                ['sort_order' => $vt['sort_order']],
            );
        }
        */

        // Pricing rules are now keyed by city_vehicle_type_id (one rate card
        // per vehicle). The seeder skips here in dev since vehicles are added
        // through the admin UI; PricingRule rows are created when the operator
        // saves the Base Pricing tab for each vehicle.
        // $pricing = [
        //     'Sedan' => [
        //         'base_fare' => 50,
        //         'surge_multiplier' => 1.0, 'commission_percent' => 20,
        //         'threshold_distance_1_km' => 10, 'fare_per_km_after_threshold_1' => 7,
        //         'threshold_distance_2_km' => 20, 'fare_per_km_after_threshold_2' => 5,
        //         'threshold_time_1_min' => 30, 'fare_per_min_after_threshold_time_1' => 1.0,
        //         'threshold_waiting_time_min' => 3, 'fare_per_waiting_minute' => 2,
        //         'cancellation_charges' => 30, 'cancel_threshold_time_min' => 2,
        //         'no_show_charges_per_minute' => 2, 'no_show_threshold_minutes' => 5,
        //         'pickup_charge_before_threshold' => 0, 'pickup_charge_after_threshold' => 25,
        //         'pickup_threshold_distance_km' => 3, 'tax_percent' => 5,
        //     ],
        //     'SUV' => [
        //         'base_fare' => 80,
        //         'surge_multiplier' => 1.0, 'commission_percent' => 20,
        //         'threshold_distance_1_km' => 10, 'fare_per_km_after_threshold_1' => 10,
        //         'threshold_distance_2_km' => 20, 'fare_per_km_after_threshold_2' => 8,
        //         'threshold_time_1_min' => 30, 'fare_per_min_after_threshold_time_1' => 1.5,
        //         'threshold_waiting_time_min' => 3, 'fare_per_waiting_minute' => 3,
        //         'cancellation_charges' => 50, 'tax_percent' => 5,
        //     ],
        //     'Hatchback' => [
        //         'base_fare' => 40,
        //         'surge_multiplier' => 1.0, 'commission_percent' => 18,
        //         'threshold_distance_1_km' => 10, 'fare_per_km_after_threshold_1' => 6,
        //         'threshold_time_1_min' => 30, 'fare_per_min_after_threshold_time_1' => 0.8,
        //         'cancellation_charges' => 20, 'tax_percent' => 5,
        //     ],
        //     'Van' => [
        //         'base_fare' => 120,
        //         'surge_multiplier' => 1.0, 'commission_percent' => 22,
        //         'threshold_distance_1_km' => 10, 'fare_per_km_after_threshold_1' => 14,
        //         'cancellation_charges' => 80, 'tax_percent' => 5,
        //     ],
        //     'Motorcycle' => [
        //         'base_fare' => 20,
        //         'surge_multiplier' => 1.0, 'commission_percent' => 15,
        //         'threshold_distance_1_km' => 10, 'fare_per_km_after_threshold_1' => 4,
        //         'cancellation_charges' => 10, 'tax_percent' => 5,
        //     ],
        // ];

        // Pricing seeding is intentionally skipped now — see comment above.
        // unset($pricing);

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
