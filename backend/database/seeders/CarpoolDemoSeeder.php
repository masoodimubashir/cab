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

        $this->command?->info('Carpool demo: ' . count(self::DRIVERS) . " carpool drivers in {$city->name}.");
    }
}
