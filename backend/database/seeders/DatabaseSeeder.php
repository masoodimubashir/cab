<?php

namespace Database\Seeders;

use App\Models\User;
use App\Models\City;
use App\Models\RideType;
use App\Models\PricingRule;
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
        // User::factory(10)->create();

        // Minimal seed data for fare estimation during early development.
        $city = City::updateOrCreate(
            ['name' => 'Default City'],
            ['country_code' => 'IN'],
        );

        $rideTypes = [
            ['name' => 'Mini', 'description' => 'Budget ride', 'sort_order' => 10],
            ['name' => 'Sedan', 'description' => 'Standard ride', 'sort_order' => 20],
            ['name' => 'SUV', 'description' => 'Premium ride', 'sort_order' => 30],
            ['name' => 'Outstation', 'description' => 'Inter-city ride', 'sort_order' => 40],
            ['name' => 'Rental', 'description' => 'Hourly rental', 'sort_order' => 50],
        ];

        foreach ($rideTypes as $rt) {
            RideType::updateOrCreate(
                ['name' => $rt['name']],
                ['description' => $rt['description'], 'sort_order' => $rt['sort_order']],
            );
        }

        $pricing = [
            'Mini' => ['base_fare' => 30, 'per_km' => 10, 'per_min' => 1.2, 'surge_multiplier' => 1.0, 'commission_percent' => 20],
            'Sedan' => ['base_fare' => 50, 'per_km' => 14, 'per_min' => 1.5, 'surge_multiplier' => 1.0, 'commission_percent' => 20],
            'SUV' => ['base_fare' => 80, 'per_km' => 20, 'per_min' => 1.8, 'surge_multiplier' => 1.0, 'commission_percent' => 20],
            'Outstation' => ['base_fare' => 120, 'per_km' => 30, 'per_min' => 2.0, 'surge_multiplier' => 1.0, 'commission_percent' => 18],
            'Rental' => ['base_fare' => 150, 'per_km' => 0, 'per_min' => 8.0, 'surge_multiplier' => 1.0, 'commission_percent' => 15, 'min_fare' => 300],
        ];

        foreach ($pricing as $rideTypeName => $rule) {
            $rideType = RideType::query()->where('name', $rideTypeName)->first();
            if (!$rideType) {
                continue;
            }

            PricingRule::updateOrCreate(
                ['city_id' => $city->id, 'ride_type_id' => $rideType->id],
                [
                    'base_fare' => $rule['base_fare'],
                    'per_km' => $rule['per_km'],
                    'per_min' => $rule['per_min'],
                    'surge_multiplier' => $rule['surge_multiplier'],
                    'commission_percent' => $rule['commission_percent'],
                    'min_fare' => $rule['min_fare'] ?? null,
                ],
            );
        }

        // Create a simple dev user for quick manual API testing (optional).
        $testUser = User::query()->updateOrCreate(
            ['email' => 'test@example.com'],
            [
                'name' => 'Test User',
                'password' => bcrypt('password'),
            ],
        );
        $testUser->addRole('customer');

        // Create an admin user for the web/admin panel.
        // Credentials are read from env: ADMIN_EMAIL / ADMIN_PASSWORD.
        $this->call(AdminUserSeeder::class);

        // RBAC: seed permissions + default roles, and pin admin@example.com as Super Admin.
        $this->call(RbacSeeder::class);

        // Sample trips for dashboards and API manual testing (pickup_address starts with "(seed) ").
        $this->call(TripSeeder::class);
    }
}
