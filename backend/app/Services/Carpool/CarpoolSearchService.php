<?php

namespace App\Services\Carpool;

use App\Models\Carpool\CarpoolListing;
use App\Models\Carpool\CarpoolRequest;
use App\Models\Carpool\CarpoolSetting;
use App\Models\Driver;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;

/**
 * Rider search along the whole saved route (P6, customer mockup 3 and 3b).
 * 1. The database narrows to live carpools on the day whose route box, widened
 *    by the search distance, holds both places.
 * 2. RouteGeometry checks both places are within the search distance of the
 *    line, pickup first.
 * 3. Ranked: ones the rider can ask to join first, then by walking (in
 *    500 m steps), then by time.
 * Full carpools, ones without enough seats and ones not taking requests stay
 * in the list but can't be requested (section 2, A2, A14).
 */
class CarpoolSearchService
{
    private const WALK_STEP_M = 500;
    private const MAX_CANDIDATES = 300;

    public function __construct(private CarpoolPresenter $present)
    {
    }

    /**
     * @param array{from_lat: float, from_lng: float, to_lat: float, to_lng: float, date: string, seats: int} $q
     * @return array{results: list<array<string, mixed>>, other_days: list<array<string, mixed>>, distance_m: int}
     */
    public function search(User $rider, array $q): array
    {
        if (! CarpoolSwitch::enabled()) {
            throw ValidationException::withMessages(['search' => 'Carpool is not open right now.']);
        }
        $today = CarpoolClock::today();
        $horizon = CarpoolSetting::number('publish_horizon_days');
        $last = CarbonImmutable::parse($today, CarpoolClock::timezone())->addDays($horizon)->toDateString();
        if ($q['date'] < $today || $q['date'] > $last) {
            throw ValidationException::withMessages(['date' => "Pick a day from today to {$horizon} days ahead."]);
        }

        $maxM = (float) CarpoolSetting::current()->search_distance_m;
        $seats = (int) $q['seats'];
        $listings = $this->candidates($rider, $q, CarpoolClock::startOfDay($q['date']), CarpoolClock::endOfDay($q['date']), $maxM);
        $results = $this->matches($rider, $listings, $q, $seats, $maxM);

        return [
            'results' => $results,
            'other_days' => $results ? [] : $this->otherDays($rider, $q, $seats, $maxM, $today, $last),
            'distance_m' => (int) $maxM,
        ];
    }

    /** @return Collection<int, CarpoolListing> */
    private function candidates(User $rider, array $q, CarbonImmutable $from, CarbonImmutable $to, float $maxM): Collection
    {
        $own = Driver::query()->where('user_id', $rider->id)->pluck('id');
        $query = CarpoolListing::query()
            ->with(['driver.user', 'vehicle'])
            ->whereIn('status', CarpoolListing::LIVE)
            ->whereBetween('departs_at', [$from, $to])
            ->whereHas('driver', fn (Builder $d) => $d->where('approval_status', 'approved')->whereNull('deactivated_at')
                ->whereHas('user', fn (Builder $u) => $u->where('is_suspended', false)->whereNull('carpool_banned_at')))
            ->when($own->isNotEmpty(), fn (Builder $b) => $b->whereNotIn('driver_id', $own));
        foreach ([[$q['from_lat'], $q['from_lng']], [$q['to_lat'], $q['to_lng']]] as [$lat, $lng]) {
            $dLat = $maxM / 111320.0;
            $dLng = $maxM / (111320.0 * max(0.2, cos(deg2rad((float) $lat))));
            $query->where('min_lat', '<=', $lat + $dLat)->where('max_lat', '>=', $lat - $dLat)
                ->where('min_lng', '<=', $lng + $dLng)->where('max_lng', '>=', $lng - $dLng);
        }

        return $query->orderBy('departs_at')->limit(self::MAX_CANDIDATES)->get();
    }

    /**
     * @param Collection<int, CarpoolListing> $listings
     * @return list<array<string, mixed>>
     */
    private function matches(User $rider, Collection $listings, array $q, int $seats, float $maxM): array
    {
        if ($listings->isEmpty()) {
            return [];
        }
        $mine = CarpoolRequest::query()->where('rider_id', $rider->id)->whereIn('listing_id', $listings->pluck('id'))
            ->whereIn('status', CarpoolRequest::ACTIVE)->get()->keyBy('listing_id');

        $out = [];
        foreach ($listings as $l) {
            if ($this->alreadyOver($l)) {
                continue;
            }
            $geo = RouteGeometry::of($l->route_polyline ?? []);
            $m = $geo->match((float) $q['from_lat'], (float) $q['from_lng'], (float) $q['to_lat'], (float) $q['to_lng'], $maxM, CarpoolRequestService::minRideM());
            if (! $m) {
                continue;
            }
            $out[] = $this->result($l, $geo, $m, $seats, $mine->get($l->id));
        }
        usort($out, function ($a, $b) {
            $open = fn ($r) => ($r['can_request'] || $r['my_request']) ? 0 : 1;
            $walk = fn ($r) => intdiv($r['pickup']['walk_m'] + $r['drop']['walk_m'], self::WALK_STEP_M);

            return [$open($a), $walk($a), $a['departs_at']] <=> [$open($b), $walk($b), $b['departs_at']];
        });

        return $out;
    }

    /**
     * @param array{pickup: array<string, float>, drop: array<string, float>} $m
     * @return array<string, mixed>
     */
    public function result(CarpoolListing $l, RouteGeometry $geo, array $m, int $seats, ?CarpoolRequest $mine): array
    {
        $free = $l->seatsFree();
        $blocked = match (true) {
            $free <= 0 => 'full',
            $free < $seats => 'seats',
            ! $l->accepting_requests => 'off',
            default => null,
        };

        return [
            'id' => $l->id,
            'status' => $l->status,
            'departs_at' => $l->departs_at->toIso8601String(),
            'day' => CarpoolClock::daysFromToday($l->departs_at),
            'start' => ['name' => $l->start_name],
            'end' => ['name' => $l->end_name],
            'price_per_seat' => $l->price_per_seat,
            'is_free' => $l->is_free,
            'seats_total' => $l->seats_total,
            'seats_free' => $free,
            'driver' => $this->present->driver($l),
            'car' => $this->present->car($l->vehicle),
            'pickup' => $this->point($l, $geo, $m['pickup']),
            'drop' => $this->point($l, $geo, $m['drop']),
            'can_request' => $blocked === null && ! $mine,
            'blocked' => $blocked,
            'my_request' => $mine ? ['id' => $mine->id, 'status' => $mine->status] : null,
        ];
    }

    /** @param array<string, float> $p */
    private function point(CarpoolListing $l, RouteGeometry $geo, array $p): array
    {
        return [
            'lat' => round($p['lat'], 7),
            'lng' => round($p['lng'], 7),
            'along_m' => (int) round($p['along_m']),
            'walk_m' => (int) round($p['distance_m']),
            'at' => $this->present->etaAt($l, $geo, $p['along_m'])->toIso8601String(),
        ];
    }

    /**
     * Customer 3b: when the chosen day has nothing, the nearest days (up to
     * the horizon) that do, with how many carpools and the first time.
     *
     * @return list<array<string, mixed>>
     */
    private function otherDays(User $rider, array $q, int $seats, float $maxM, string $today, string $last): array
    {
        $listings = $this->candidates($rider, $q, CarpoolClock::startOfDay($today), CarpoolClock::endOfDay($last), $maxM)
            ->filter(fn (CarpoolListing $l) => CarpoolClock::dateOf($l->departs_at) !== $q['date']);
        $days = [];
        foreach ($listings as $l) {
            if ($this->alreadyOver($l) || ! $l->accepting_requests || $l->seatsFree() < $seats) {
                continue;
            }
            $geo = RouteGeometry::of($l->route_polyline ?? []);
            if (! $geo->match((float) $q['from_lat'], (float) $q['from_lng'], (float) $q['to_lat'], (float) $q['to_lng'], $maxM, CarpoolRequestService::minRideM())) {
                continue;
            }
            $date = CarpoolClock::dateOf($l->departs_at);
            $days[$date] ??= ['date' => $date, 'day' => CarpoolClock::daysFromToday($l->departs_at), 'count' => 0, 'first_at' => $l->departs_at->toIso8601String()];
            $days[$date]['count']++;
        }
        $chosen = CarbonImmutable::parse($q['date'], CarpoolClock::timezone());
        $list = array_values($days);
        usort($list, fn ($a, $b) => [abs($chosen->diffInDays(CarbonImmutable::parse($a['date'], CarpoolClock::timezone()), false)), $a['date']]
            <=> [abs($chosen->diffInDays(CarbonImmutable::parse($b['date'], CarpoolClock::timezone()), false)), $b['date']]);

        return array_slice($list, 0, 2);
    }

    /** A carpool not started whose whole planned trip is already in the past. */
    private function alreadyOver(CarpoolListing $l): bool
    {
        return $l->status === CarpoolListing::STATUS_PUBLISHED
            && $l->departs_at->copy()->addSeconds($l->duration_s)->lt(now());
    }
}
