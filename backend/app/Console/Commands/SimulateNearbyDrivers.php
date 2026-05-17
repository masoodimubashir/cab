<?php

namespace App\Console\Commands;

use App\Models\Driver;
use App\Models\DriverLocation;
use App\Models\User;
use App\Models\UserRole;
use Illuminate\Console\Command;

/**
 * Dev-only convenience: spawns N "ghost" drivers that are approved + online and
 * have a fresh `driver_locations` row near the given pickup. Lets you see the
 * Uber-style nearby-driver pins on the customer search screen without booting
 * a separate driver-mobile instance for each one.
 *
 * Re-running with the same indices updates positions in place (handy with
 * --jitter to make the pins move every few seconds during a demo).
 */
class SimulateNearbyDrivers extends Command
{
    protected $signature = 'drivers:simulate-nearby
                            {--lat=28.6139 : Center latitude (default: New Delhi)}
                            {--lng=77.209 : Center longitude}
                            {--count=5 : How many ghost drivers to materialize}
                            {--radius-km=2.0 : Random scatter radius around the center}
                            {--jitter : If set, also re-randomize each ghost driver\'s position}';

    protected $description = 'Create or refresh N approved+online ghost drivers with fresh locations near a pickup point. Dev/demo only.';

    public function handle(): int
    {
        $centerLat = (float) $this->option('lat');
        $centerLng = (float) $this->option('lng');
        $count = max(1, (int) $this->option('count'));
        $radiusKm = max(0.1, (float) $this->option('radius-km'));
        $jitter = (bool) $this->option('jitter');

        for ($i = 1; $i <= $count; $i++) {
            $email = "ghost-driver-{$i}@dreamcabs.local";
            $user = User::query()->firstOrCreate(
                ['email' => $email],
                [
                    'name' => "Ghost Driver {$i}",
                    'phone' => sprintf('+91900000%04d', $i),
                    'password' => bcrypt(str()->random(32)),
                ]
            );

            UserRole::query()->firstOrCreate([
                'user_id' => $user->id,
                'role' => 'driver',
            ]);

            Driver::query()->updateOrCreate(
                ['user_id' => $user->id],
                [
                    'approval_status' => 'approved',
                    'approved_at' => now(),
                    'vehicle_type' => 'sedan',
                    'vehicle_reg_no' => sprintf('SIM-%04d', $i),
                    'is_online' => true,
                    'last_online_at' => now(),
                ]
            );

            // Random scatter within radiusKm. We pick a uniform-area point by
            // sampling sqrt(uniform) for the radial component; otherwise points
            // would clump in the center.
            $u = mt_rand() / mt_getrandmax();
            $v = mt_rand() / mt_getrandmax();
            $r = sqrt($u) * ($radiusKm / 111.0); // ~111 km per degree latitude
            $theta = $v * 2 * M_PI;
            $lat = $centerLat + $r * cos($theta);
            $lng = $centerLng + ($r * sin($theta)) / max(0.0001, cos(deg2rad($centerLat)));

            DriverLocation::query()->create([
                'driver_id' => $user->id,
                'trip_id' => null,
                'lat' => $lat,
                'lng' => $lng,
                'bearing_deg' => random_int(0, 359),
                'recorded_at' => now(),
            ]);

            $verb = $jitter ? 'jittered' : 'placed';
            $this->line("- Ghost #{$i} (user_id={$user->id}) {$verb} at " . round($lat, 5) . ', ' . round($lng, 5));
        }

        $this->info("Simulated {$count} nearby driver(s) around ({$centerLat}, {$centerLng}).");
        return self::SUCCESS;
    }
}
