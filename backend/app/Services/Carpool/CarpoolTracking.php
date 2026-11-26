<?php

namespace App\Services\Carpool;

use App\Models\Carpool\CarpoolListing;
use App\Models\Carpool\CarpoolPosition;
use App\Models\Carpool\CarpoolRequest;
use App\Models\Carpool\CarpoolSetting;
use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Support\Carbon;
use Illuminate\Validation\ValidationException;

/**
 * L1 live location: the driver's phone sends its position while the carpool is on the road; riders on
 * the carpool see the car until they are dropped; reaching a pickup starts the no-show wait.
 * Minutes to a pickup come from how far along the saved route the car is, never from a paid map call.
 */
class CarpoolTracking
{
    /** Walking pace used when a listing has no usable planned speed. */
    private const FALLBACK_SPEED_MPS = 8.0;

    public function __construct(private CarpoolListingService $listings) {}

    /**
     * Stores one position from the driver's phone. Points closer than 3 s to the last one, older than
     * it (late delivery), or rougher than 100 m are dropped quietly so the phone never retries them.
     *
     * @param  array{lat: float, lng: float, accuracy?: float|null, speed?: float|null, heading?: float|null, at?: int|null}  $data
     */
    public function record(User $driverUser, CarpoolListing $listing, array $data): bool
    {
        $this->listings->owned($driverUser, $listing);
        if ($listing->status !== CarpoolListing::STATUS_IN_PROGRESS) {
            throw ValidationException::withMessages(['listing' => 'This ride is not on the road.']);
        }

        $accuracy = isset($data['accuracy']) ? (int) round((float) $data['accuracy']) : null;
        if ($accuracy !== null && $accuracy > (int) config('carpool.position_max_accuracy_m', 100)) {
            return false;
        }
        $at = $this->recordedAt($data['at'] ?? null);
        $last = $this->latest($listing);
        if ($last && $at->lte($last->recorded_at->copy()->addSeconds((int) config('carpool.position_min_gap_seconds', 3) - 1))) {
            return false;
        }

        $lat = (float) $data['lat'];
        $lng = (float) $data['lng'];
        $geo = RouteGeometry::of($listing->route_polyline ?? []);
        $on = $geo->isUsable() ? $geo->nearest($lat, $lng) : null;

        $p = new CarpoolPosition([
            'lat' => $lat, 'lng' => $lng, 'accuracy_m' => $accuracy,
            'speed_mps' => isset($data['speed']) ? max(0.0, (float) $data['speed']) : null,
            'heading' => isset($data['heading']) ? ((int) round((float) $data['heading'])) % 360 : null,
            'along_m' => $on ? (int) round($on['along_m']) : null,
            'recorded_at' => $at,
        ]);
        $p->listing_id = $listing->id;
        $p->save();
        if (! $listing->location_shared_at) {
            $listing->forceFill(['location_shared_at' => $at])->save(); // L1.5: kept after the positions are removed
        }

        $this->markArrivals($listing, $lat, $lng, $at);

        return true;
    }

    /**
     * What an accepted rider sees: the car, whether the position is fresh, and the minutes and metres
     * to their pickup (to their drop once picked up). 404 for anyone else, and once they are dropped.
     *
     * @return array<string, mixed>
     */
    public function riderView(User $rider, CarpoolListing $listing): array
    {
        $r = CarpoolRequest::query()->where('listing_id', $listing->id)->where('rider_id', $rider->id)
            ->where('status', CarpoolRequest::STATUS_ACCEPTED)->whereNull('dropped_at')->whereNull('no_show_at')
            ->latest('id')->first();
        if (! $r) {
            abort(404);
        }
        $target = $r->picked_up_at ? 'drop' : 'pickup';
        $p = $listing->status === CarpoolListing::STATUS_IN_PROGRESS ? $this->latest($listing) : null;
        if (! $p) {
            return ['position' => null, 'stale' => true, 'target' => $target, 'metres' => null, 'minutes' => null];
        }

        $age = max(0, (int) $p->recorded_at->diffInSeconds(now(), true));
        $stale = $age > (int) config('carpool.position_stale_seconds', 60);
        $metres = null;
        $minutes = null;
        if (! $stale && $p->along_m !== null) {
            $metres = max(0, ($target === 'drop' ? $r->drop_m : $r->pickup_m) - $p->along_m);
            $minutes = (int) ceil($metres / $this->plannedSpeed($listing) / 60);
        }

        return [
            'position' => ['lat' => $p->lat, 'lng' => $p->lng, 'heading' => $p->heading, 'at' => $p->recorded_at->toIso8601String(), 'age_s' => $age],
            'stale' => $stale,
            'target' => $target,
            'metres' => $metres,
            'minutes' => $minutes,
        ];
    }

    /**
     * When No-show opens for a waiting rider. Null means "any time": the driver's location is not being
     * shared (never, or nothing for a minute), so the rule cannot be checked and the driver is never stuck.
     * A far-future answer is never given: before arriving the caller gets 'not_arrived'.
     *
     * @return array{state: 'any'|'not_arrived'|'waiting'|'open', opens_at: CarbonInterface|null}
     */
    public function noShowWindow(CarpoolRequest $r, ?CarpoolListing $listing = null): array
    {
        $listing ??= $r->listing;
        if (! $listing || ! $this->sharing($listing)) {
            return ['state' => 'any', 'opens_at' => null];
        }
        if (! $r->arrived_at) {
            return ['state' => 'not_arrived', 'opens_at' => null];
        }
        $opens = $r->arrived_at->copy()->addMinutes(CarpoolSetting::number('no_show_wait_minutes'));

        return ['state' => now()->lt($opens) ? 'waiting' : 'open', 'opens_at' => $opens];
    }

    /** Throws when the wait at the pickup is not over (L1.4). */
    public function assertNoShowOpen(CarpoolRequest $r): void
    {
        $w = $this->noShowWindow($r);
        if ($w['state'] === 'not_arrived') {
            throw ValidationException::withMessages(['request' => 'Reach the pickup first.']);
        }
        if ($w['state'] === 'waiting') {
            $left = (int) ceil(now()->diffInSeconds($w['opens_at'], true) / 60);
            throw ValidationException::withMessages(['request' => "No-show opens in {$left} min. Keep waiting or send a message."]);
        }
    }

    /** True while the driver's phone has sent a position in the last minute. */
    public function sharing(CarpoolListing $listing): bool
    {
        $last = $this->latest($listing);

        return $last !== null && $last->recorded_at->gte(now()->subSeconds((int) config('carpool.position_stale_seconds', 60)));
    }

    /** Removes positions older than the retention setting; returns how many. */
    public function prune(): int
    {
        return CarpoolPosition::query()
            ->where('recorded_at', '<', now()->subDays(CarpoolSetting::number('position_retention_days')))
            ->delete();
    }

    public function latest(CarpoolListing $listing): ?CarpoolPosition
    {
        return CarpoolPosition::query()->where('listing_id', $listing->id)->orderByDesc('recorded_at')->orderByDesc('id')->first();
    }

    /** Riders still to be picked up whose pickup is within the arrival distance get arrived_at, once. */
    private function markArrivals(CarpoolListing $listing, float $lat, float $lng, CarbonInterface $at): void
    {
        $radius = CarpoolSetting::number('arrival_radius_m');
        $waiting = CarpoolRequest::query()->where('listing_id', $listing->id)->where('status', CarpoolRequest::STATUS_ACCEPTED)
            ->whereNull('picked_up_at')->whereNull('arrived_at')->get();
        foreach ($waiting as $r) {
            if (RouteGeometry::metres($lat, $lng, (float) $r->pickup_lat, (float) $r->pickup_lng) <= $radius) {
                $r->arrived_at = $at;
                $r->save();
            }
        }
    }

    /** The phone's time when it is believable (late delivery up to 10 min), else the server's. */
    private function recordedAt(mixed $ms): Carbon
    {
        $now = now();
        if (! is_numeric($ms)) {
            return $now;
        }
        $at = Carbon::createFromTimestampMs((int) $ms)->setTimezone(config('app.timezone'));

        return $at->between($now->copy()->subMinutes(10), $now->copy()->addMinute()) ? $at->min($now) : $now;
    }

    private function plannedSpeed(CarpoolListing $l): float
    {
        return $l->duration_s > 0 && $l->distance_m > 0 ? $l->distance_m / $l->duration_s : self::FALLBACK_SPEED_MPS;
    }
}
