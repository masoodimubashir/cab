<?php

namespace Database\Seeders;

use App\Models\CityVehicleType;
use App\Models\Driver;
use App\Models\User;
use Illuminate\Database\Seeder;

/**
 * Dummy customers and drivers for local development / manual testing.
 *
 * Idempotent: every user is keyed by a stable @dreamcabs.test email, so
 * re-running updates the same rows instead of piling up duplicates.
 *
 * Drivers are attached to the *base* city_vehicle_type rows (the ones with no
 * ride_type_id — those represent the physical vehicle a driver signs up with),
 * so vehicle_type_id / city_id always stay consistent with the vehicle. If no
 * such rows exist yet (fresh DB with no vehicles), the driver half is skipped
 * with a note and only customers are seeded.
 */
class DummyUsersSeeder extends Seeder
{
    public function run(): void
    {
        $this->seedCustomers();
        $this->seedDrivers();
    }

    private function seedCustomers(): void
    {
        $names = [
            'Aarav Sharma', 'Vivaan Khan', 'Aditya Bhat', 'Vihaan Dar', 'Arjun Wani',
            'Sai Lone', 'Reyansh Mir', 'Ayaan Malik', 'Krishna Shah', 'Ishaan Butt',
            'Ananya Reddy', 'Diya Nair', 'Saanvi Rather', 'Aadhya Ganai', 'Kiara Pandit',
            'Myra Bhat', 'Anika Shah', 'Navya Wani', 'Riya Khan', 'Fatima Mir',
        ];

        foreach ($names as $i => $name) {
            $n = $i + 1;
            $user = User::query()->updateOrCreate(
                ['email' => sprintf('customer%02d@dreamcabs.test', $n)],
                [
                    'name' => $name,
                    'password' => bcrypt('password'),
                    'phone' => sprintf('90000%05d', $n),
                    'email_verified_at' => now(),
                ],
            );
            $user->addRole('customer');
        }

        $this->command?->info('Seeded '.count($names).' dummy customers.');
    }

    private function seedDrivers(): void
    {
        // Base vehicle rows only — a driver signs up against a physical vehicle,
        // not against a per-ride-type fare row.
        $vehicles = CityVehicleType::query()
            ->whereNull('ride_type_id')
            ->get();

        if ($vehicles->isEmpty()) {
            $this->command?->warn('No base city_vehicle_types found — skipping dummy drivers. Add vehicles first.');
            return;
        }

        $names = [
            'Bilal Ahmad', 'Imran Rashid', 'Tariq Bhat', 'Nasir Wani', 'Javed Dar',
            'Suhail Mir', 'Aamir Lone', 'Rashid Malik', 'Wasim Khan', 'Zahid Butt',
            'Owais Ganai', 'Sameer Rather', 'Adil Pandit', 'Feroz Shah', 'Mudasir Bhat',
        ];
        $brands = ['Maruti Suzuki', 'Hyundai', 'Tata', 'Mahindra', 'Toyota'];
        $models = ['Swift', 'i20', 'Nexon', 'Bolero', 'Innova', 'Alto', 'Ertiga'];
        $colors = ['White', 'Silver', 'Black', 'Red', 'Blue', 'Grey'];
        $modes = Driver::SERVICE_MODES;

        foreach ($names as $i => $name) {
            $n = $i + 1;
            // Spread drivers evenly across the available vehicles.
            $vehicle = $vehicles[$i % $vehicles->count()];

            $user = User::query()->updateOrCreate(
                ['email' => sprintf('driver%02d@dreamcabs.test', $n)],
                [
                    'name' => $name,
                    'password' => bcrypt('password'),
                    'phone' => sprintf('80000%05d', $n),
                    'email_verified_at' => now(),
                ],
            );
            $user->addRole('driver');

            Driver::query()->updateOrCreate(
                ['user_id' => $user->id],
                [
                    'city_id' => $vehicle->city_id,
                    'vehicle_type_id' => $vehicle->vehicle_type_id,
                    'city_vehicle_type_id' => $vehicle->id,
                    'service_scope' => Driver::SERVICE_SCOPE_LOCAL,
                    'service_mode' => $modes[$i % count($modes)],
                    'approval_status' => 'approved',
                    'approved_at' => now(),
                    'vehicle_brand' => $brands[$i % count($brands)],
                    'vehicle_model' => $models[$i % count($models)],
                    'vehicle_color' => $colors[$i % count($colors)],
                    'vehicle_reg_no' => sprintf('JK0%d-%04d', ($i % 9) + 1, 1000 + $n),
                    'is_online' => false,
                ],
            );
        }

        $this->command?->info('Seeded '.count($names).' dummy drivers across '.$vehicles->count().' vehicle(s).');
    }
}
