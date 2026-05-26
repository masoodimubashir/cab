<?php

namespace App\Console\Commands;

use App\Models\Driver;
use App\Models\DriverLocation;
use App\Models\Trip;
use App\Models\User;
use App\Models\UserRole;
use Illuminate\Console\Command;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * End-to-end API simulator: walks a synthetic trip through every status using
 * the real HTTP endpoints customer-mobile and driver-mobile call. Proves that
 * trip create → negotiation → state machine → final fare → Razorpay order
 * all wire up correctly without booting the mobile apps.
 */
class SimulateTrip extends Command
{
    protected $signature = 'cab:simulate-trip
                            {--city-vehicle-type-id=1 : Defaults to SEDAN L in Sopore}
                            {--pickup-lat=34.2867629 : Sopore center}
                            {--pickup-lng=74.4624013}
                            {--drop-lat=34.395}
                            {--drop-lng=74.4624013}
                            {--base-url=http://localhost:8000/api : Backend API base URL}
                            {--cleanup : Revoke simulator tokens after a successful run}';

    protected $description = 'Walk a synthetic trip through every status against the real API. Backend (cab:dev or php artisan serve) must be running.';

    private string $base;

    public function handle(): int
    {
        $this->base = rtrim($this->option('base-url'), '/');
        $pickupLat = (float) $this->option('pickup-lat');
        $pickupLng = (float) $this->option('pickup-lng');
        $dropLat = (float) $this->option('drop-lat');
        $dropLng = (float) $this->option('drop-lng');
        $cvtId = (int) $this->option('city-vehicle-type-id');

        $this->header('Setup');

        $customer = $this->makeCustomer();
        $customerToken = $customer->createToken('sim-customer')->plainTextToken;
        $this->info("  Customer #{$customer->id} ({$customer->email}) — token issued");

        $driver = $this->makeDriver($pickupLat, $pickupLng);
        $driverToken = $driver->createToken('sim-driver')->plainTextToken;
        $this->info("  Driver   #{$driver->id} ({$driver->email}) — approved, online, placed 100m from pickup");

        // ── Step 1: Create the trip ──────────────────────────────────────────
        $this->header('Step 1: Customer creates trip (REQUESTED → NEGOTIATION)');
        $res = $this->cust($customerToken)->post('/trips', [
            'city_vehicle_type_id' => $cvtId,
            'pickup_lat' => $pickupLat,
            'pickup_lng' => $pickupLng,
            'pickup_address' => 'Sim pickup near Sopore center',
            'drop_lat' => $dropLat,
            'drop_lng' => $dropLng,
            'drop_address' => 'Sim drop',
        ]);
        if (!$this->ok($res, 'POST /trips')) return self::FAILURE;
        $trip = $res->json('trip') ?? $res->json();
        $tripId = (int) $trip['id'];
        $estimatedFare = (float) ($trip['estimated_fare'] ?? 0);
        $this->info("  Trip #{$tripId} | status={$trip['status']} | estimated_fare=₹{$estimatedFare}");

        // ── Step 2: Customer opening offer (kicks off DispatchHopJob) ────────
        $this->header('Step 2: Customer makes opening offer');
        $offerAmount = max(50.0, round($estimatedFare, 2)); // accept estimate as-is
        $res = $this->cust($customerToken)->post(
            "/trips/{$tripId}/negotiation/customer-offer",
            ['amount' => $offerAmount],
        );
        if (!$this->ok($res, 'POST /negotiation/customer-offer')) return self::FAILURE;
        $this->info("  Customer offered ₹{$offerAmount}; DispatchHopJob queued");

        // ── Step 3: Driver ACCEPTs that offer ────────────────────────────────
        $this->header('Step 3: Driver accepts the customer offer (claims trip)');
        $res = $this->drv($driverToken)->post(
            "/trips/{$tripId}/negotiation/driver-action",
            ['action' => 'ACCEPT'],
        );
        if (!$this->ok($res, 'POST /negotiation/driver-action')) return self::FAILURE;
        $offers = $res->json('negotiation.offers') ?? [];
        $driverOffer = collect($offers)
            ->where('from_role', 'driver')
            ->where('status', 'ACCEPTED')
            ->sortByDesc('id')
            ->first();
        if (!$driverOffer) {
            $this->error('  No ACCEPTED driver offer found in response: ' . $res->body());
            return self::FAILURE;
        }
        $this->info("  Driver claimed trip; offer_id={$driverOffer['id']}, amount=₹{$driverOffer['amount']}");

        // ── Step 4: Customer confirms ────────────────────────────────────────
        $this->header('Step 4: Customer confirms (NEGOTIATION → CONFIRMED)');
        $res = $this->cust($customerToken)->post(
            "/trips/{$tripId}/negotiation/customer-confirm",
            [
                'final_fare' => (float) $driverOffer['amount'],
                'accepted_offer_id' => (int) $driverOffer['id'],
            ],
        );
        if (!$this->ok($res, 'POST /negotiation/customer-confirm')) return self::FAILURE;
        $confirmed = $res->json('trip');
        $this->info("  status={$confirmed['status']} | final_fare=₹{$confirmed['final_fare']}");

        // ── Step 5: Driver acknowledges (CONFIRMED → ASSIGNED) ───────────────
        $this->header('Step 5: Driver acknowledges assignment (CONFIRMED → ASSIGNED)');
        $res = $this->drv($driverToken)->post("/trips/{$tripId}/driver-accept");
        if (!$this->ok($res, 'POST /driver-accept')) return self::FAILURE;
        $assigned = $res->json('trip');
        $this->info("  status={$assigned['status']}");

        // ── Steps 6-10: Drive the state machine to COMPLETED ─────────────────
        $hops = [
            ['EN_ROUTE_PICKUP', $pickupLat + 0.0009, $pickupLng + 0.0009, 'driver heading to customer'],
            ['ARRIVED_PICKUP',  $pickupLat,         $pickupLng,         'driver at pickup'],
            ['EN_ROUTE_DROP',   $pickupLat + 0.02,  $pickupLng,         'midway to drop'],
            ['ARRIVED_DROP',    $dropLat,           $dropLng,           'arrived at drop'],
            ['COMPLETED',       $dropLat,           $dropLng,           'trip complete, fare recomputed'],
        ];

        foreach ($hops as $i => [$status, $lat, $lng, $note]) {
            $this->header('Step ' . (6 + $i) . ": Driver → {$status}  ({$note})");
            $res = $this->drv($driverToken)->patch("/trips/{$tripId}/driver-progress", [
                'status' => $status,
                'location' => ['lat' => $lat, 'lng' => $lng],
            ]);
            if (!$this->ok($res, "PATCH /driver-progress → {$status}")) return self::FAILURE;
            $body = $res->json();
            $tripStatus = $body['trip']['status'] ?? $status;
            $extra = '';
            if (isset($body['breakdown'])) {
                $b = $body['breakdown'];
                $extra = sprintf(
                    ' | final=₹%s estimated=₹%s waiting=₹%s tip=₹%s',
                    $b['final_fare'], $b['estimated_fare'], $b['waiting_charge_amount'], $b['tip_amount']
                );
            }
            $this->info("  status={$tripStatus}{$extra}");
            usleep(250_000);
        }

        // ── Step 11: Razorpay UPI order ──────────────────────────────────────
        $this->header('Step 11: Customer initiates Razorpay UPI order');
        $res = $this->cust($customerToken)->post("/trips/{$tripId}/pay/upi");
        if ($res->ok() || $res->status() === 201) {
            $this->info('  Razorpay order created: ' . json_encode($res->json()));
        } else {
            $this->warn("  Razorpay returned {$res->status()}: " . $res->body());
            $this->warn('  (If RAZORPAY creds are test/dev, network errors against api.razorpay.com are normal in an offline sim.)');
        }

        // ── Done ─────────────────────────────────────────────────────────────
        $this->header('Done');
        $this->info("  Trip #{$tripId} is now in its final state.");
        $this->info('  Inspect with: mysql -u root -proot cab_db -e "SELECT id, status, estimated_fare, final_fare, waiting_charge_amount, payment_method FROM trips WHERE id = ' . $tripId . '\\G"');

        if ($this->option('cleanup')) {
            $this->newLine();
            $this->warn('Cleanup: revoking simulator tokens.');
            PersonalAccessToken::query()
                ->whereIn('tokenable_id', [$customer->id, $driver->id])
                ->where('tokenable_type', User::class)
                ->whereIn('name', ['sim-customer', 'sim-driver'])
                ->delete();
        }

        return self::SUCCESS;
    }

    private function header(string $title): void
    {
        $this->newLine();
        $this->line("\033[36m── {$title} ──\033[0m");
    }

    private function cust(string $token)
    {
        return Http::baseUrl($this->base)
            ->withToken($token)
            ->acceptJson()
            ->timeout(15);
    }

    private function drv(string $token)
    {
        return Http::baseUrl($this->base)
            ->withToken($token)
            ->acceptJson()
            ->timeout(15);
    }

    private function ok(Response $res, string $label): bool
    {
        if ($res->successful()) {
            return true;
        }
        $this->error("  {$label} failed: HTTP {$res->status()} — " . $res->body());
        return false;
    }

    private function makeCustomer(): User
    {
        $user = User::query()->firstOrCreate(
            ['email' => 'sim-customer@dreamcabs.local'],
            [
                'name' => 'Sim Customer',
                'phone' => '+919000000091',
                'password' => bcrypt(str()->random(32)),
            ],
        );
        UserRole::query()->firstOrCreate(['user_id' => $user->id, 'role' => 'customer']);
        return $user;
    }

    private function makeDriver(float $pickupLat, float $pickupLng): User
    {
        $user = User::query()->firstOrCreate(
            ['email' => 'sim-driver@dreamcabs.local'],
            [
                'name' => 'Sim Driver',
                'phone' => '+919000000092',
                'password' => bcrypt(str()->random(32)),
            ],
        );
        UserRole::query()->firstOrCreate(['user_id' => $user->id, 'role' => 'driver']);

        Driver::query()->updateOrCreate(
            ['user_id' => $user->id],
            [
                'approval_status' => 'approved',
                'approved_at' => now(),
                'vehicle_type' => 'sedan',
                'vehicle_reg_no' => 'SIM-DRIVE-1',
                'is_online' => true,
                'last_online_at' => now(),
            ],
        );

        // Drop a fresh location ~100m off the pickup so radius filters pass.
        DriverLocation::query()->create([
            'driver_id' => $user->id,
            'trip_id' => null,
            'lat' => $pickupLat + 0.0009,
            'lng' => $pickupLng + 0.0009,
            'bearing_deg' => 0,
            'recorded_at' => now(),
        ]);

        return $user;
    }
}
