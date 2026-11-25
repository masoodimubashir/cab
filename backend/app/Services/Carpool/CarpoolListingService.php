<?php

namespace App\Services\Carpool;

use App\Models\Carpool\CarpoolListing;
use App\Models\Carpool\CarpoolSetting;
use App\Models\Driver;
use App\Models\User;
use App\Services\GeoService;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Driver side of carpools (M3): publish, edit, delay, cancel, the requests
 * switch and the Carpools tab filters. Since M4 a cancel closes the waiting
 * requests and tells every rider, and fewer seats close requests that no
 * longer fit. Riders hear about time and route changes from M6 (customer 8i).
 */
class CarpoolListingService
{
    public function __construct(
        private CarpoolPlanService $plans,
        private GeoService $geo,
        private CarpoolRequestService $requests,
    ) {
    }

    /** The approved carpool driver behind a user, or a validation error. */
    public function driverFor(User $user): Driver
    {
        $driver = Driver::query()->with('carpoolVehicle')->where('user_id', $user->id)->first();
        if (! $driver || ! $driver->isCarpool()) {
            $this->fail('Carpools are for carpool drivers.');
        }
        if ($driver->approval_status !== 'approved' || $driver->deactivated_at) {
            $this->fail('Your sign-up must be approved before you publish.');
        }
        if (! $driver->carpoolVehicle) {
            $this->fail('Add your car first.');
        }

        return $driver;
    }

    /** @param array<string, mixed> $data validated input */
    public function publish(User $user, array $data): CarpoolListing
    {
        if (! CarpoolSwitch::enabled()) {
            $this->fail('Carpool is not open yet.');
        }
        if ($reason = CarpoolAccess::reason($user)) {
            $this->fail($reason);
        }
        $driver = $this->driverFor($user);
        if (! $this->plans->canPublish($user)) {
            $this->fail('You need an active plan to publish carpools.');
        }

        $departs = $this->departure($data['departs_at']);
        $this->assertPlanCovers($user, $departs);

        $seatsMax = (int) $driver->carpoolVehicle->seats;
        if ((int) $data['seats'] > $seatsMax) {
            $this->fail("Your car has {$seatsMax} seats.", 'seats');
        }

        $listing = new CarpoolListing();
        $listing->driver_id = $driver->id;
        $listing->vehicle_id = $driver->carpoolVehicle->id;
        // The car as it is today, kept with the carpool so its record never changes if the car is edited later.
        $listing->car_plate = $driver->carpoolVehicle->plate;
        $listing->car_label = trim($driver->carpoolVehicle->make . ' ' . $driver->carpoolVehicle->model . ', ' . $driver->carpoolVehicle->colour, ' ,');
        $listing->city_id = $driver->city_id;
        $listing->fill([
            'start_lat' => $data['start']['lat'], 'start_lng' => $data['start']['lng'],
            'start_name' => $data['start']['name'], 'start_address' => $data['start']['address'],
            'end_lat' => $data['end']['lat'], 'end_lng' => $data['end']['lng'],
            'end_name' => $data['end']['name'], 'end_address' => $data['end']['address'],
            'departs_at' => $departs,
            'seats_total' => (int) $data['seats'],
            'is_free' => (bool) $data['is_free'],
            'price_per_seat' => $data['is_free'] ? 0 : (int) $data['price_per_seat'],
            'accepting_requests' => (bool) ($data['accepting_requests'] ?? true),
        ]);
        $this->applyRoute($listing, $data['route']);
        $listing->status = CarpoolListing::STATUS_PUBLISHED;
        $listing->save();

        return $listing;
    }

    /**
     * Edit before the ride starts (mockup 8h): time, seats, price and route.
     * Start and destination stay; a different trip is a new carpool.
     *
     * @param array<string, mixed> $data validated input
     */
    public function update(User $user, CarpoolListing $listing, array $data): CarpoolListing
    {
        $driver = $this->owned($user, $listing);
        if (! $listing->isEditable()) {
            $this->fail('This carpool can no longer be changed.');
        }

        $changed = null;
        $saved = DB::transaction(function () use ($user, $driver, $listing, $data, &$changed) {
            $listing = CarpoolListing::query()->lockForUpdate()->findOrFail($listing->id);
            $wasAt = $listing->departs_at->copy();

            if (array_key_exists('departs_at', $data)) {
                $departs = $this->departure($data['departs_at']);
                if (! $departs->equalTo($listing->departs_at)) {
                    $this->assertPlanCovers($user, $departs);
                }
                $listing->departs_at = $departs;
                if (! $departs->equalTo($wasAt)) {
                    $changed = 'time';
                }
            }
            if (array_key_exists('seats', $data)) {
                $seats = (int) $data['seats'];
                if ($seats > (int) $driver->carpoolVehicle->seats) {
                    $this->fail("Your car has {$driver->carpoolVehicle->seats} seats.", 'seats');
                }
                if ($seats < $listing->seats_taken) {
                    $this->fail("{$listing->seats_taken} seats are taken, so not below {$listing->seats_taken}.", 'seats');
                }
                $listing->seats_total = $seats;
            }
            if (array_key_exists('is_free', $data)) {
                $listing->is_free = (bool) $data['is_free'];
            }
            if (array_key_exists('price_per_seat', $data) && ! $listing->is_free) {
                $listing->price_per_seat = (int) $data['price_per_seat'];
            }
            if ($listing->is_free) {
                $listing->price_per_seat = 0;
            } elseif ($listing->price_per_seat < 1) {
                $this->fail('Set a price per seat, or turn on Free ride.', 'price_per_seat');
            }
            if (array_key_exists('accepting_requests', $data)) {
                $listing->accepting_requests = (bool) $data['accepting_requests'];
            }
            if (! empty($data['route'])) {
                $this->applyRoute($listing, $data['route']);
                $changed ??= 'route';
            }
            if ($changed) {
                $listing->changed_kind = $changed;
                $listing->changed_from_at = $wasAt;
                $listing->changed_at = now();
            }

            $listing->save();

            return $listing;
        });
        if (array_key_exists('seats', $data)) {
            $this->requests->seatsChanged($saved);
        }
        if ($changed) {
            $this->requests->listingChanged($saved);
        }

        return $saved;
    }

    /** "+10 min delay" (mockup 8): moves the departure on. Allowed again and again. */
    public function delay(User $user, CarpoolListing $listing): CarpoolListing
    {
        $this->owned($user, $listing);
        if (! $listing->isEditable()) {
            $this->fail('This carpool can no longer be changed.');
        }
        $listing->changed_kind = 'time';
        $listing->changed_from_at = $listing->departs_at->copy();
        $listing->changed_at = now();
        $listing->departs_at = $listing->departs_at->copy()->addMinutes((int) config('carpool.delay_minutes', 10));
        $listing->save();
        $this->requests->listingChanged($listing);

        return $listing;
    }

    /** Driver cancel (mockup 8g). Only before the ride starts. */
    public function cancel(User $user, CarpoolListing $listing, ?string $note): CarpoolListing
    {
        $this->owned($user, $listing);
        if (! $listing->isEditable()) {
            $this->fail('This carpool can no longer be cancelled.');
        }
        $listing->status = CarpoolListing::STATUS_CANCELLED;
        $listing->cancel_reason = CarpoolListing::CANCEL_DRIVER;
        $listing->cancel_note = $note !== null && trim($note) !== '' ? trim($note) : null;
        $listing->cancelled_at = now();
        $listing->accepting_requests = false;
        $listing->save();
        $this->requests->listingCancelled($listing);

        return $listing;
    }

    /**
     * The Home "Requests on/off" switch (A2): one switch for every carpool not
     * yet started. Returns the new state.
     */
    public function setRequests(User $user, bool $on): bool
    {
        $driver = $this->driverFor($user);
        CarpoolListing::query()->where('driver_id', $driver->id)
            ->where('status', CarpoolListing::STATUS_PUBLISHED)
            ->update(['accepting_requests' => $on]);

        return $this->requestsOn($driver);
    }

    /** On unless every carpool not yet started has requests turned off. */
    public function requestsOn(Driver $driver): bool
    {
        $q = CarpoolListing::query()->where('driver_id', $driver->id)->where('status', CarpoolListing::STATUS_PUBLISHED);

        return ! (clone $q)->exists() || (clone $q)->where('accepting_requests', true)->exists();
    }

    /**
     * The Carpools tab (mockup 2b), in India days:
     * - today: leaving today and not ended, plus any ride in progress;
     * - upcoming: not started and leaving after today;
     * - past: completed or cancelled, or leaving before today.
     */
    public function listFor(Driver $driver, string $filter, int $page = 1, bool $peek = false): Collection
    {
        $size = max(1, (int) config('carpool.past_page_size', 50));
        $today = CarpoolClock::today();
        $dayStart = CarpoolClock::startOfDay($today);
        $dayEnd = CarpoolClock::endOfDay($today);
        $q = CarpoolListing::query()->where('driver_id', $driver->id);

        return match ($filter) {
            'today' => $q->where(fn ($w) => $w
                ->where('status', CarpoolListing::STATUS_IN_PROGRESS)
                ->orWhere(fn ($t) => $t->where('status', CarpoolListing::STATUS_PUBLISHED)->whereBetween('departs_at', [$dayStart, $dayEnd])))
                ->orderBy('departs_at')->get(),
            'past' => $q->where(fn ($w) => $w
                ->whereIn('status', [CarpoolListing::STATUS_COMPLETED, CarpoolListing::STATUS_CANCELLED])
                ->orWhere(fn ($t) => $t->where('status', CarpoolListing::STATUS_PUBLISHED)->where('departs_at', '<', $dayStart)))
                ->orderByDesc('departs_at')->offset((max(1, $page) - 1) * $size)->limit($size + ($peek ? 1 : 0))->get(),
            default => $q->where('status', CarpoolListing::STATUS_PUBLISHED)->where('departs_at', '>', $dayEnd)
                ->orderBy('departs_at')->get(),
        };
    }

    /** Home's "Next carpool": a ride in progress, else the soonest one not started from today on. */
    public function nextFor(Driver $driver): ?CarpoolListing
    {
        $base = CarpoolListing::query()->where('driver_id', $driver->id);

        return (clone $base)->where('status', CarpoolListing::STATUS_IN_PROGRESS)->orderBy('departs_at')->first()
            ?? (clone $base)->where('status', CarpoolListing::STATUS_PUBLISHED)
                ->where('departs_at', '>=', CarpoolClock::startOfDay(CarpoolClock::today()))
                ->orderBy('departs_at')->first();
    }

    /** Recent start/destination pairs for publish step 1 ("Your recent carpools"). */
    public function recentFor(Driver $driver): Collection
    {
        return CarpoolListing::query()->where('driver_id', $driver->id)
            ->orderByDesc('created_at')->limit(20)->get()
            ->unique(fn (CarpoolListing $l) => $l->start_name . '|' . $l->end_name)
            ->take(3)->values();
    }

    public function owned(User $user, CarpoolListing $listing): Driver
    {
        $driver = Driver::query()->with('carpoolVehicle')->where('user_id', $user->id)->first();
        if (! $driver || (int) $listing->driver_id !== (int) $driver->id) {
            abort(404);
        }

        return $driver;
    }

    /**
     * Route check (P5): the line starts and ends near the chosen places, has a
     * sensible length, and agrees with the distance the app sent. Long lines
     * are thinned to the stored maximum. Sets the line, numbers and bounding box.
     *
     * @param array<string, mixed> $route
     */
    private function applyRoute(CarpoolListing $listing, array $route): void
    {
        $path = $this->geo->usablePath($route['polyline'] ?? []);
        if (count($path) < 2) {
            $this->fail('The route is missing. Pick a route again.', 'route');
        }
        $path = $this->thin($path, (int) config('carpool.route_max_points', 500));

        $endMax = (float) config('carpool.route_endpoint_max_m', 2000);
        [$first, $last] = [$path[0], $path[count($path) - 1]];
        if ($this->geo->haversineMeters($first[0], $first[1], $listing->start_lat, $listing->start_lng) > $endMax
            || $this->geo->haversineMeters($last[0], $last[1], $listing->end_lat, $listing->end_lng) > $endMax) {
            $this->fail("This route doesn't start and end at your places. Pick a route again.", 'route');
        }

        $straight = $this->geo->haversineMeters($listing->start_lat, $listing->start_lng, $listing->end_lat, $listing->end_lng);
        if ($straight < (float) config('carpool.route_min_m', 1000)) {
            $this->fail('Start and destination are too close together.', 'route');
        }

        $distance = (int) $route['distance_m'];
        if ($distance < $straight * 0.9 || $distance > (int) config('carpool.route_max_m', 1500000)) {
            $this->fail("This route's length doesn't look right. Pick a route again.", 'route');
        }
        $lineLength = 0.0;
        for ($i = 1; $i < count($path); $i++) {
            $lineLength += $this->geo->haversineMeters($path[$i - 1][0], $path[$i - 1][1], $path[$i][0], $path[$i][1]);
        }
        if ($lineLength < $distance * 0.5 || $lineLength > $distance * 1.5) {
            $this->fail("This route's length doesn't look right. Pick a route again.", 'route');
        }

        $lats = array_column($path, 0);
        $lngs = array_column($path, 1);
        $listing->fill([
            'route_summary' => isset($route['summary']) ? mb_substr(trim((string) $route['summary']), 0, 120) : null,
            'route_polyline' => array_map(fn ($p) => [round($p[0], 6), round($p[1], 6)], $path),
            'distance_m' => $distance,
            'duration_s' => (int) $route['duration_s'],
            'min_lat' => min($lats), 'max_lat' => max($lats),
            'min_lng' => min($lngs), 'max_lng' => max($lngs),
        ]);
    }

    /** Keeps the first and last points and evenly spaced ones between. */
    private function thin(array $path, int $max): array
    {
        $n = count($path);
        if ($n <= $max) {
            return $path;
        }
        $out = [];
        for ($i = 0; $i < $max; $i++) {
            $out[] = $path[(int) round($i * ($n - 1) / ($max - 1))];
        }

        return $out;
    }

    private function departure(string $value): CarbonImmutable
    {
        $at = CarbonImmutable::parse($value)->utc()->startOfMinute();
        if ($at->lt(now()->startOfMinute())) {
            $this->fail('Pick a time that is still to come.', 'departs_at');
        }
        if (! CarpoolClock::withinPublishHorizon($at->addSecond())) {
            $days = CarpoolSetting::number('publish_horizon_days');
            $this->fail("You can publish up to {$days} days ahead.", 'departs_at');
        }

        return $at;
    }

    /**
     * Carpools on the plan's last day and the day after continue when it ends
     * (section 2), so a departure may be at most one India day after the plan
     * (or the plan waiting after it) ends. Later ones would only be cancelled.
     */
    private function assertPlanCovers(User $user, CarbonImmutable $departs): void
    {
        $plan = $this->plans->queuedPlan($user) ?? $this->plans->activePlan($user);
        if (! $plan) {
            $this->fail('You need an active plan to publish carpools.');
        }
        $lastDay = CarbonImmutable::parse(CarpoolClock::dateOf($plan->expires_at), CarpoolClock::timezone())->addDays(CarpoolSetting::number('plan_grace_days'));
        if (CarpoolClock::dateOf($departs) > $lastDay->toDateString()) {
            $this->fail('Your plan ends on ' . CarpoolClock::local($plan->expires_at)->format('j M')
                . '. Pick a day up to ' . $lastDay->format('j M') . ', or buy your next plan first.', 'departs_at');
        }
    }

    private function fail(string $message, string $field = 'listing'): never
    {
        throw ValidationException::withMessages([$field => $message]);
    }
}
