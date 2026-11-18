<?php

namespace Database\Seeders;

use App\Models\City;
use App\Models\Driver;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * Local carpool demo data, so any carpool screen can be reached in a minute.
 *
 *   php artisan db:seed --class=CarpoolDemoSeeder
 *
 * Not called from DatabaseSeeder, and refuses to run in production. Safe to
 * run again: rows are found by their @dreamcabs.test email. Each milestone
 * adds its own data here (M1 vehicles and documents, M2 plans, M3 listings...).
 *
 * M0: carpool drivers only, for checking the commercial fence by hand.
 */
class CarpoolDemoSeeder extends Seeder
{
    /** [key, name, approval status] */
    private const DRIVERS = [
        ['approved-1', 'Demo Carpool Asif', 'approved'],
        ['approved-2', 'Demo Carpool Nida', 'approved'],
        ['pending-1', 'Demo Carpool Rafiq', 'pending'],
    ];

    public function run(): void
    {
        if (app()->environment('production')) {
            throw new RuntimeException('CarpoolDemoSeeder never runs in production.');
        }

        $city = City::query()->orderBy('id')->first();
        if (! $city) {
            throw new RuntimeException('Create a city first: carpool drivers belong to one city.');
        }

        foreach (self::DRIVERS as $i => [$key, $name, $status]) {
            $email = "demo-carpool-{$key}@dreamcabs.test";
            $user = User::query()->firstOrCreate(['email' => $email], [
                'name' => $name,
                // Fake numbers outside any real Indian mobile range (no 6-9 start).
                'phone' => '+9100000001' . str_pad((string) ($i + 1), 2, '0', STR_PAD_LEFT),
                'password' => Hash::make(Str::random(32)),
            ]);
            if (! $user->hasRole('driver')) {
                $user->addRole('driver');
            }

            $driver = Driver::query()->firstOrNew(['user_id' => $user->id]);
            $driver->fill([
                'city_id' => $city->id,
                'vehicle_reg_no' => 'JK01DEMO' . ($i + 1),
                'approval_status' => $status,
                'approved_at' => $status === 'approved' ? now() : null,
            ]);
            $driver->driver_type = Driver::TYPE_CARPOOL;
            $driver->save();
        }

        $this->seedDocuments();
        $this->seedVehicles();

        $this->command?->info('Carpool demo: ' . count(self::DRIVERS) . " carpool drivers with cars in {$city->name}, and the carpool documents.");
    }

    /**
     * The four carpool sign-up documents (Carpool.md section 2). On live these
     * are created by an admin in Documents Catalog with Applies to = Carpool.
     */
    private function seedDocuments(): void
    {
        $docs = [
            ['Driving licence (carpool)', 2, 'Front and back of your driving licence.', []],
            ['Vehicle RC (carpool)', 2, 'Front and back. It shows the car is registered as private, not commercial.', []],
            ['Insurance (carpool)', 1, 'The current insurance certificate for this car.', [['Expiry date', 'date']]],
            ['Government ID (carpool)', 2, 'One ID: Aadhaar (masked, only the last 4 digits visible), passport, voter ID or PAN.', []],
        ];

        foreach ($docs as [$name, $images, $instructions, $labels]) {
            $doc = \App\Models\Document::query()->firstOrCreate(['name' => $name], [
                'no_of_images' => $images,
                'category' => 'driver_document',
                'required' => 'mandatory_register',
                'document_type' => 'normal',
                'gallery_restricted' => false,
                'instructions' => $instructions,
                'status' => 'mandatory_register',
                'applies_to' => 'carpool',
            ]);
            foreach ($labels as $i => [$label, $type]) {
                $doc->labels()->firstOrCreate(['label' => $label], ['label_type' => $type, 'mandatory' => true, 'sort_order' => $i]);
            }
        }
    }

    private function seedVehicles(): void
    {
        $cars = [['Maruti', 'Swift', 'White', 4], ['Hyundai', 'i20', 'Grey', 4], ['Mahindra', 'XUV300', 'Red', 6]];

        foreach (self::DRIVERS as $i => [$key]) {
            $driver = Driver::query()->whereHas('user', fn ($q) => $q->where('email', "demo-carpool-{$key}@dreamcabs.test"))->first();
            if (! $driver) {
                continue;
            }
            [$make, $model, $colour, $seats] = $cars[$i % count($cars)];
            $vehicle = $driver->carpoolVehicle ?? new \App\Models\Carpool\CarpoolVehicle();
            $vehicle->driver_id = $driver->id;
            $vehicle->fill([
                'make' => $make, 'model' => $model, 'colour' => $colour, 'seats' => $seats,
                'plate' => $driver->vehicle_reg_no,
            ])->save();
            $driver->forceFill(['vehicle_brand' => $make, 'vehicle_color' => $colour])->save();
        }
    }
}
