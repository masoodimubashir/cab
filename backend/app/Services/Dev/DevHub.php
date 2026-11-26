<?php

namespace App\Services\Dev;

use App\Models\Carpool\CarpoolListing;
use App\Models\Carpool\CarpoolRating;
use App\Models\Carpool\CarpoolRequest;
use App\Models\Carpool\CarpoolSetting;
use App\Models\Carpool\CarpoolVehicle;
use App\Models\City;
use App\Models\Driver;
use App\Models\DriverSubscription;
use App\Models\SubscriptionPlan;
use App\Models\User;
use App\Services\Carpool\CarpoolChatService;
use App\Services\Carpool\CarpoolTracking;
use App\Services\Carpool\RouteGeometry;
use Database\Seeders\CarpoolDemoSeeder;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * The developer hub's backend (Saqib, 2026-11-19): ready-made test people,
 * scenarios that put the database in a given state, a time offset and a few
 * switches. Local only: it does nothing unless APP_ENV=local and DEV_HUB=true.
 * Test numbers are 99900xxxxx and always take the code 123456.
 */
class DevHub
{
    public const PHONE_PREFIX = '99900';
    public const CODE = '123456';
    private const OFFSET_KEY = 'dev_hub.time_offset_minutes';

    /** key => [label, role, phone, state] */
    public const PEOPLE = [
        'c-new' => ['New rider, no photo', 'customer', '9990000001', 'rider'],
        'c-photo' => ['Rider with a photo', 'customer', '9990000002', 'rider+photo'],
        'c-banned' => ['Rider with carpool paused', 'customer', '9990000003', 'rider+photo+banned'],
        'd-pending' => ['Carpool driver waiting for approval', 'driver', '9990000011', 'pending'],
        'd-rejected' => ['Carpool driver rejected', 'driver', '9990000012', 'rejected'],
        'd-noplan' => ['Carpool driver approved, no plan', 'driver', '9990000013', 'approved'],
        'd-plan' => ['Carpool driver with a plan', 'driver', '9990000014', 'plan'],
        'd-ending' => ['Carpool driver, plan ends in 2 days', 'driver', '9990000015', 'plan-ending'],
        'd-banned' => ['Carpool driver with carpool paused', 'driver', '9990000016', 'plan+banned'],
        'd-commercial' => ['Commercial driver (approved)', 'driver', '9990000017', 'commercial'],
    ];

    public static function on(): bool
    {
        return app()->environment('local') && (bool) config('dev_hub.enabled');
    }

    public static function guard(): void
    {
        abort_unless(self::on(), 404);
    }

    public static function isTestPhone(string $phone): bool
    {
        $digits = preg_replace('/\D+/', '', $phone) ?? '';
        if (strlen($digits) === 12 && str_starts_with($digits, '91')) {
            $digits = substr($digits, 2);
        }

        return self::on() && str_starts_with($digits, self::PHONE_PREFIX);
    }

    // ---- time ----

    public static function timeOffset(): int
    {
        return (int) Cache::get(self::OFFSET_KEY, 0);
    }

    public static function setTimeOffset(int $minutes): void
    {
        $minutes === 0 ? Cache::forget(self::OFFSET_KEY) : Cache::forever(self::OFFSET_KEY, $minutes);
    }

    /** Called on every boot: moves the clock for requests, jobs and the scheduler. */
    public static function applyTime(): void
    {
        if (! self::on()) {
            return;
        }
        $m = self::timeOffset();
        if ($m !== 0) {
            $at = now()->addMinutes($m);
            \Illuminate\Support\Carbon::setTestNow($at);
            \Carbon\CarbonImmutable::setTestNow($at->toImmutable());
        }
    }

    // ---- people ----

    public static function people(): array
    {
        $out = [];
        foreach (self::PEOPLE as $key => [$label, $role, $phone]) {
            $out[] = ['key' => $key, 'label' => $label, 'role' => $role, 'phone' => '+91' . $phone];
        }

        return $out;
    }

    /** Makes (or resets) a preset person and returns their user. */
    public function person(string $key): User
    {
        abort_unless(isset(self::PEOPLE[$key]), 422, 'Unknown person.');
        [$label, $role, $phone, $state] = self::PEOPLE[$key];
        $this->bootstrap();

        $user = User::query()->firstOrCreate(['phone' => '+91' . $phone], [
            'name' => $label,
            'email' => "dev-{$key}@dreamcabs.test",
            'password' => Hash::make(Str::random(32)),
        ]);
        $user->forceFill(['name' => explode(',', $label)[0], 'carpool_banned_at' => null, 'carpool_ban_reason' => null])->save();
        if (! $user->hasRole($role)) {
            $user->addRole($role);
        }

        if ($role === 'customer') {
            $this->rider($user, str_contains($state, 'photo'));
            if (str_contains($state, 'banned')) {
                $user->forceFill(['carpool_banned_at' => now(), 'carpool_ban_reason' => 'Dev hub test ban'])->save();
            }

            return $user->fresh();
        }

        $this->wipeCarpoolOf($user, false);
        $city = $this->city();
        $driver = Driver::query()->firstOrNew(['user_id' => $user->id]);
        $commercial = $state === 'commercial';
        $plate = 'JK01DV' . substr($phone, -4);
        $driver->fill([
            'city_id' => $city->id,
            'vehicle_reg_no' => $plate,
            'approval_status' => in_array($state, ['pending', 'rejected'], true) ? $state : 'approved',
            'approved_at' => in_array($state, ['pending', 'rejected'], true) ? null : now(),
        ]);
        $driver->driver_type = $commercial ? Driver::TYPE_COMMERCIAL : Driver::TYPE_CARPOOL;
        $driver->save();
        if (! $commercial) {
            $car = $driver->carpoolVehicle ?? new CarpoolVehicle();
            $car->driver_id = $driver->id;
            $car->fill(['make' => 'Tata', 'model' => 'Nexon', 'colour' => 'Blue', 'seats' => 4, 'plate' => $plate])->save();
            $this->avatar($user, 'driver-' . $key);
            // Documents that match the state, so the status page counts them like a real sign-up.
            $this->documents($driver, match ($state) { 'pending' => 'sent', 'rejected' => 'fix', default => 'approved' });
        }
        if (str_contains($state, 'plan')) {
            $this->plan($user, $state === 'plan-ending' ? 2 : 30);
        }
        if (str_contains($state, 'banned')) {
            $user->forceFill(['carpool_banned_at' => now(), 'carpool_ban_reason' => 'Dev hub test ban'])->save();
        }

        return $user->fresh();
    }

    public function plan(User $user, int $days): void
    {
        $plan = SubscriptionPlan::query()->where('title', 'Demo carpool 30 days')->first();
        DriverSubscription::query()->where('driver_user_id', $user->id)->delete();
        DriverSubscription::query()->create([
            'subscription_plan_id' => $plan->id, 'driver_user_id' => $user->id, 'city_id' => $plan->city_id,
            'meter_type' => 'days', 'amount_paid' => 0, 'commission_percent' => 0, 'pricing_model' => 'subscription',
            'payment_method' => 'upi', 'payment_reference' => 'dev-hub', 'days_count' => $days,
            'starts_at' => now()->subDays(max(0, 30 - $days)), 'expires_at' => now()->addDays($days),
            'status' => 'active', 'is_queued' => false, 'auto_renew' => false,
        ]);
    }

    public function rider(User $user, bool $photo): void
    {
        if ($photo) {
            $this->avatar($user, 'rider-' . $user->id);
        } else {
            $user->forceFill(['avatar_path' => null])->save();
        }
    }

    private function avatar(User $user, string $name): void
    {
        if ($user->avatar_path || ! function_exists('imagecreatetruecolor')) {
            return;
        }
        $img = imagecreatetruecolor(96, 96);
        imagefill($img, 0, 0, imagecolorallocate($img, 70 + crc32($name) % 120, 140, 110));
        ob_start();
        imagepng($img);
        $path = "avatars/dev-{$name}.png";
        Storage::disk('public')->put($path, (string) ob_get_clean());
        $user->forceFill(['avatar_path' => $path])->save();
    }

    /**
     * Puts a carpool driver's documents in one state: 'sent' (all waiting to be checked),
     * 'fix' (one image rejected as blurry, one document not sent, the rest approved) or
     * 'approved'. Makes the four carpool documents first on a database that has none.
     */
    public function documents(Driver $driver, string $state): void
    {
        $docs = \App\Models\Document::query()->forDrivers()->forDriverType(Driver::TYPE_CARPOOL)
            ->whereIn('required', ['mandatory_register', 'mandatory_drive'])->orderBy('id')->get();
        if ($docs->isEmpty()) {
            foreach (['Driving licence (carpool)' => 2, 'Vehicle RC (carpool)' => 2, 'Insurance (carpool)' => 1, 'Government ID (carpool)' => 2] as $name => $images) {
                $docs->push(\App\Models\Document::query()->create([
                    'name' => $name, 'category' => 'driver_document', 'required' => 'mandatory_register',
                    'applies_to' => Driver::TYPE_CARPOOL, 'no_of_images' => $images,
                ]));
            }
        }
        \App\Models\DriverDocument::query()->where('driver_id', $driver->id)->delete();
        $path = 'dev-hub/document.png';
        if (! Storage::disk('local')->exists($path) && function_exists('imagecreatetruecolor')) {
            $img = imagecreatetruecolor(320, 200);
            imagefill($img, 0, 0, imagecolorallocate($img, 226, 236, 230));
            ob_start();
            imagepng($img);
            Storage::disk('local')->put($path, (string) ob_get_clean());
        }
        foreach ($docs->values() as $i => $doc) {
            $last = $i === $docs->count() - 1;
            if ($state === 'fix' && $last) {
                continue; // not sent
            }
            $labels = $doc->labels()->exists() ? $doc->labels()->pluck('label')->mapWithKeys(fn ($l) => [$l => now()->addYear()->toDateString()])->all() : null;
            for ($n = 1; $n <= max(1, (int) $doc->no_of_images); $n++) {
                $status = match ($state) {
                    'sent' => 'uploaded',
                    'fix' => ($i === 1 && $n === 1) ? 'rejected' : 'approved',
                    default => 'approved',
                };
                \App\Models\DriverDocument::query()->create([
                    'driver_id' => $driver->id, 'document_id' => $doc->id, 'image_index' => $n,
                    'file_path' => $path, 'label_values' => $labels, 'status' => $status,
                    'rejection_reason' => $status === 'rejected' ? 'Photo is blurry' : null,
                ]);
            }
        }
    }

    /** A phone number nobody has used, for sign-up from scratch. */
    public function freshNumber(): string
    {
        do {
            $n = self::PHONE_PREFIX . random_int(10000, 99999);
        } while (User::query()->where('phone', 'like', '%' . $n)->exists());

        return '+91' . $n;
    }

    // ---- clean-up ----

    /** Removes everything carpool-related that belongs to this person. */
    public function wipeCarpoolOf(User $user, bool $deleteAccount): void
    {
        DB::transaction(function () use ($user, $deleteAccount) {
            $driver = Driver::query()->where('user_id', $user->id)->first();
            $listingIds = $driver ? CarpoolListing::query()->where('driver_id', $driver->id)->pluck('id') : collect();
            $listings = CarpoolListing::query()->whereIn('id', $listingIds);
            \App\Models\Carpool\CarpoolConversation::query()->whereIn('listing_id', $listingIds)->delete();
            CarpoolRequest::query()->whereIn('listing_id', $listingIds)->delete();
            CarpoolRating::query()->whereIn('listing_id', $listingIds)->delete();
            \App\Models\Carpool\CarpoolReport::query()->whereIn('listing_id', $listingIds)->delete();
            $listings->delete();

            $mine = CarpoolRequest::query()->where('rider_id', $user->id)->pluck('id');
            \App\Models\Carpool\CarpoolConversation::query()->whereIn('request_id', $mine)->delete();
            CarpoolRequest::query()->whereIn('id', $mine)->delete();
            CarpoolRating::query()->where('rater_id', $user->id)->orWhere('rated_id', $user->id)->delete();
            \App\Models\Carpool\CarpoolReport::query()->where('reporter_id', $user->id)->orWhere('reported_user_id', $user->id)->delete();
            \App\Models\Carpool\CarpoolConversationMember::query()->where('user_id', $user->id)->delete();
            $user->forceFill(['carpool_banned_at' => null, 'carpool_ban_reason' => null])->save();
            DB::table('app_notifications')->where('user_id', $user->id)->delete();

            if ($deleteAccount) {
                DriverSubscription::query()->where('driver_user_id', $user->id)->delete();
                if ($driver) {
                    CarpoolVehicle::query()->where('driver_id', $driver->id)->delete();
                    $driver->documents()->delete();
                    $driver->delete();
                }
                $user->tokens()->delete();
                $user->delete();
            }
        });
    }

    /**
     * L1.6 Simulate drive: sends the driver's position for the carpool on the road that `$me` drives or rides in.
     * 'step' moves the car `$metres` along the saved route; 'pickup' puts it at the next waiting rider's pickup,
     * which starts their wait (No-show countdown). Goes through the same code as the driver's phone.
     */
    public function drive(User $me, string $to, int $metres = 300): string
    {
        $listing = CarpoolListing::query()->where('status', CarpoolListing::STATUS_IN_PROGRESS)
            ->whereHas('driver', fn ($q) => $q->where('user_id', $me->id))->latest('id')->first()
            ?? CarpoolListing::query()->where('status', CarpoolListing::STATUS_IN_PROGRESS)
                ->whereHas('requests', fn ($q) => $q->where('rider_id', $me->id)->where('status', CarpoolRequest::STATUS_ACCEPTED))
                ->latest('id')->first();
        if (! $listing) {
            return 'No carpool of yours is on the road. Start one first (scenario "On the road with riders").';
        }
        $driverUser = User::query()->findOrFail(Driver::query()->whereKey($listing->driver_id)->value('user_id'));
        $geo = RouteGeometry::of($listing->route_polyline ?? []);
        $tracking = app(CarpoolTracking::class);

        if ($to === 'pickup') {
            $r = CarpoolRequest::query()->where('listing_id', $listing->id)->where('status', CarpoolRequest::STATUS_ACCEPTED)
                ->whereNull('picked_up_at')->whereNull('arrived_at')->orderBy('pickup_m')->first();
            if (! $r) {
                return 'No rider is waiting for a pickup the car has not reached yet.';
            }
            $point = ['lat' => (float) $r->pickup_lat, 'lng' => (float) $r->pickup_lng];
            $done = 'The car is at the pickup of ' . ($r->rider?->name ?? 'the rider') . ' (' . $r->pickup_name . '). Their wait has started.';
        } else {
            $last = (int) \App\Models\Carpool\CarpoolPosition::query()->where('listing_id', $listing->id)->latest('recorded_at')->latest('id')->value('along_m');
            $along = min($geo->length(), $last + max(50, $metres));
            $point = $geo->pointAt($along);
            $done = sprintf('The car is %.1f km along the route (of %.1f km).', $along / 1000, $geo->length() / 1000)
                . ($along >= $geo->length() ? ' It has reached the end.' : '');
        }

        return $tracking->record($driverUser, $listing, $point)
            ? $done
            : 'Too soon after the last position (the server keeps at most one every 3 seconds). Try again in a moment.';
    }

    public function wipeAllCarpool(): void
    {
        foreach (['carpool_messages', 'carpool_pickup_proposals', 'carpool_conversation_members', 'carpool_conversations',
            'carpool_reports', 'carpool_ratings', 'carpool_requests', 'carpool_listings'] as $t) {
            DB::table($t)->delete();
        }
    }

    // ---- setup shared by everything ----

    public function bootstrap(): void
    {
        if (! Cache::get('dev_hub.bootstrapped') || ! SubscriptionPlan::query()->where('title', 'Demo carpool 30 days')->exists()) {
            (new CarpoolDemoSeeder())->run();
            Cache::forever('dev_hub.bootstrapped', true);
        }
        CarpoolSetting::current();
    }

    public function city(): City
    {
        return City::query()->orderBy('id')->firstOrFail();
    }

    /** The two demo riders and the demo driver Asif, made by the demo seeder. */
    public function demo(string $who): User
    {
        $this->bootstrap();
        $email = ['asif' => 'demo-carpool-approved-1', 'bilal' => 'demo-carpool-rider-1', 'sana' => 'demo-carpool-rider-2'][$who];

        return User::query()->where('email', "{$email}@dreamcabs.test")->firstOrFail();
    }

    // ---- building blocks for scenarios ----

    public function listing(User $driverUser, int $departsInMinutes, array $over = []): CarpoolListing
    {
        $driver = Driver::query()->where('user_id', $driverUser->id)->firstOrFail();
        $line = [];
        for ($i = 0; $i <= 20; $i++) {
            $line[] = [34.07 + 0.06 * $i / 20, 74.77 + 0.07 * $i / 20];
        }
        $l = (new CarpoolListing())->forceFill(array_merge([
            'start_lat' => 34.07, 'start_lng' => 74.77, 'start_name' => 'Bemina Bypass', 'start_address' => 'Bemina, Srinagar',
            'end_lat' => 34.13, 'end_lng' => 74.84, 'end_name' => 'Kashmir University', 'end_address' => 'Hazratbal, Srinagar',
            'route_summary' => 'Via Rajbagh', 'route_polyline' => $line, 'distance_m' => 10500, 'duration_s' => 1440,
            'min_lat' => 34.07, 'max_lat' => 34.13, 'min_lng' => 74.77, 'max_lng' => 74.84,
            'departs_at' => now()->addMinutes($departsInMinutes),
            'seats_total' => 4, 'price_per_seat' => 60, 'is_free' => false, 'accepting_requests' => true,
        ], array_diff_key($over, array_flip(['status', 'started_at', 'completed_at', 'cancel_reason']))));
        $l->driver_id = $driver->id;
        $l->vehicle_id = $driver->carpoolVehicle?->id;
        $l->city_id = $driver->city_id;
        $l->status = $over['status'] ?? CarpoolListing::STATUS_PUBLISHED;
        foreach (['started_at', 'completed_at', 'cancel_reason'] as $k) {
            if (isset($over[$k])) {
                $l->{$k} = $over[$k];
            }
        }
        $l->save();

        return $l;
    }

    public function request(CarpoolListing $l, User $rider, string $status, array $over = []): CarpoolRequest
    {
        $r = (new CarpoolRequest())->forceFill(array_merge([
            'seats' => 1, 'pickup_lat' => 34.08, 'pickup_lng' => 74.78, 'pickup_name' => 'Rajbagh', 'pickup_m' => 1500,
            'drop_lat' => 34.11, 'drop_lng' => 74.82, 'drop_name' => 'Nigeen', 'drop_m' => 7000,
            'price_per_seat' => 60, 'is_free' => false,
        ], $over));
        $r->listing_id = $l->id;
        $r->rider_id = $rider->id;
        $r->status = $status;
        if ($status === CarpoolRequest::STATUS_ACCEPTED || $status === CarpoolRequest::STATUS_COMPLETED) {
            $r->code = (string) random_int(1000, 9999);
        }
        $r->save();
        $l->seats_taken = (int) CarpoolRequest::query()->where('listing_id', $l->id)->whereIn('status', CarpoolRequest::SEATED)->sum('seats');
        $l->save();

        $chat = app(CarpoolChatService::class);
        try {
            if (in_array($status, [CarpoolRequest::STATUS_PENDING, CarpoolRequest::STATUS_ACCEPTED], true)) {
                $chat->openDirect($r);
            }
            if ($status === CarpoolRequest::STATUS_ACCEPTED) {
                $chat->joinGroup($r);
            }
        } catch (\Throwable $e) {
            // chats are a bonus here, the request itself is what the scenario needs
        }

        return $r->fresh();
    }

    public function say(User $from, \App\Models\Carpool\CarpoolConversation $c, string $text): void
    {
        app(CarpoolChatService::class)->send($from, $c, $text);
    }

    public function scenarios(): DevScenarios
    {
        return new DevScenarios($this);
    }

    public function fail(string $m): never
    {
        throw new RuntimeException($m);
    }
}
