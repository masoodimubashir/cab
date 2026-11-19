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
 * M1: their cars and the four carpool documents.
 * M3: switches carpool on (local only), adds a carpool plan in the city and
 * gives "Demo Carpool Asif" a running plan, so Publish can be tried at once.
 * Log in as Asif with +910000000101; the code is in storage/logs/laravel.log.
 * M4: two riders with profile photos (+910000000201, +910000000202), so
 * search and ask to join can be tried from the customer app.
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
        $this->seedPlans($city);
        $this->seedRiders();
        \App\Models\Carpool\CarpoolSetting::current()->update(['enabled' => true]);

        $this->command?->info('Carpool demo: ' . count(self::DRIVERS) . " carpool drivers with cars in {$city->name}, the carpool documents, a carpool plan (Asif's is running) and "
            . count(self::RIDERS) . ' riders with photos. Carpool is switched on.');
    }

    /** [key, name] customers who can ask to join (M4). Each has a profile photo. */
    private const RIDERS = [
        ['rider-1', 'Demo Rider Bilal'],
        ['rider-2', 'Demo Rider Sana'],
    ];

    /**
     * M4: riders with a profile photo (a plain coloured square), so asking to
     * join works straight away. Phones +910000000201 and up.
     */
    private function seedRiders(): void
    {
        foreach (self::RIDERS as $i => [$key, $name]) {
            $user = User::query()->firstOrCreate(['email' => "demo-carpool-{$key}@dreamcabs.test"], [
                'name' => $name,
                'phone' => '+9100000002' . str_pad((string) ($i + 1), 2, '0', STR_PAD_LEFT),
                'password' => Hash::make(Str::random(32)),
            ]);
            if (! $user->hasRole('customer')) {
                $user->addRole('customer');
            }
            if (! $user->avatar_path && function_exists('imagecreatetruecolor')) {
                $img = imagecreatetruecolor(96, 96);
                imagefill($img, 0, 0, imagecolorallocate($img, 60 + 70 * $i, 140, 110));
                ob_start();
                imagepng($img);
                $path = "avatars/demo-carpool-{$key}.png";
                \Illuminate\Support\Facades\Storage::disk('public')->put($path, (string) ob_get_clean());
                $user->forceFill(['avatar_path' => $path])->save();
            }
        }
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

    private function seedPlans(City $city): void
    {
        $plan = \App\Models\SubscriptionPlan::query()->where('city_id', $city->id)->where('title', 'Demo carpool 30 days')->first()
            ?? new \App\Models\SubscriptionPlan();
        $plan->fill([
            'city_id' => $city->id, 'title' => 'Demo carpool 30 days', 'amount' => 199, 'meter_type' => 'days',
            'days_count' => 30, 'commission_percent' => 0, 'pricing_model' => 'subscription', 'is_active' => true,
        ]);
        $plan->audience = 'carpool';
        $plan->save();

        $user = User::query()->where('email', 'demo-carpool-approved-1@dreamcabs.test')->first();
        if (! $user || app(\App\Services\Carpool\CarpoolPlanService::class)->activePlan($user)) {
            return;
        }
        \App\Models\DriverSubscription::query()->create([
            'subscription_plan_id' => $plan->id, 'driver_user_id' => $user->id, 'city_id' => $city->id,
            'meter_type' => 'days', 'amount_paid' => 0, 'commission_percent' => 0, 'pricing_model' => 'subscription',
            'payment_method' => 'upi', 'payment_reference' => 'demo-seed', 'days_count' => 30,
            'starts_at' => now(), 'expires_at' => now()->addDays(30),
            'status' => 'active', 'is_queued' => false, 'auto_renew' => false,
        ]);
    }
}
