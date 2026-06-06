<?php

namespace App\Services;

use App\Models\Route;
use App\Models\RouteDeparture;
use App\Models\RouteSchedule;
use Carbon\CarbonImmutable;

/**
 * Turns shuttle timetables (route_schedules) into concrete, dated runs
 * (route_departures). Idempotent: re-running never duplicates a departure
 * (firstOrCreate on route_id+schedule+service_date, backed by a unique index).
 *
 * Only SHUTTLE routes are materialised — Fixed corridors form on demand at
 * dispatch time, they have no timetable.
 *
 * days_of_week is the dynamic_pricing_rules bitmask: Sun=1, Mon=2 … Sat=64,
 * 127 = every day. The weekday bit for a date is 1 << dayOfWeek (Carbon: Sun=0).
 */
class RouteDepartureMaterializer
{
    /**
     * Create the next $days of departures for active shuttle schedules.
     *
     * @param  int|null  $onlyRouteId  limit to a single route (manual generate)
     * @return int  number of departures actually created
     */
    public function materialize(int $days = 14, ?int $onlyRouteId = null): int
    {
        // Generate $days calendar dates starting today (today .. today+days-1).
        // depart_time is interpreted in the app timezone (UTC); there is no
        // per-city timezone column yet — add one before serving a non-UTC region.
        $days = max(1, min($days, 90));
        $today = CarbonImmutable::now()->startOfDay();
        $nowTs = CarbonImmutable::now();

        $routes = Route::query()
            ->where('is_active', true)
            ->where('mode', 'shuttle')
            ->when($onlyRouteId !== null, fn ($q) => $q->where('id', $onlyRouteId))
            ->with([
                'schedules' => fn ($q) => $q->where('is_active', true),
                'cityVehicleType',
            ])
            ->get();

        $created = 0;
        foreach ($routes as $route) {
            foreach ($route->schedules as $schedule) {
                for ($i = 0; $i < $days; $i++) {
                    $date = $today->addDays($i);
                    $weekdayBit = 1 << (int) $date->dayOfWeek;
                    if (((int) $schedule->days_of_week & $weekdayBit) === 0) {
                        continue; // schedule doesn't run on this weekday
                    }

                    $departAt = $date->setTimeFromTimeString((string) $schedule->depart_time);
                    if ($departAt->lessThan($nowTs)) {
                        continue; // never create a departure already in the past
                    }

                    if ($this->reconcileDeparture($route, $schedule, $date->toDateString(), $departAt)) {
                        $created++;
                    }
                }
            }
        }

        return $created;
    }

    /**
     * Create the departure if missing, else reconcile mutable fields (time,
     * capacity, vehicle) on a still-SCHEDULED, un-booked future run so timetable
     * edits take effect. A run that already has bookings or has left is never
     * disturbed. firstOrCreate keeps it race-safe against the unique index.
     *
     * @return bool  true only when a new departure was created
     */
    private function reconcileDeparture(Route $route, RouteSchedule $schedule, string $serviceDate, CarbonImmutable $departAt): bool
    {
        // 0-aware fallback (a stored 0 must not survive as a zero-seat run),
        // clamped to at least 1 so a departure can always carry someone.
        $capacity = max(1, (int) ($schedule->capacity ?: ($route->cityVehicleType?->max_people ?: 4)));
        $cvt = $schedule->city_vehicle_type_id ?? $route->city_vehicle_type_id;

        $departure = RouteDeparture::query()->firstOrCreate(
            [
                'route_id' => $route->id,
                'route_schedule_id' => $schedule->id,
                'service_date' => $serviceDate,
            ],
            [
                'city_vehicle_type_id' => $cvt,
                'depart_at' => $departAt,
                'capacity' => $capacity,
                'seats_taken' => 0,
                'status' => 'SCHEDULED',
            ],
        );

        if ($departure->wasRecentlyCreated) {
            return true;
        }

        if ($departure->status === 'SCHEDULED' && (int) $departure->seats_taken === 0) {
            $departure->fill([
                'depart_at' => $departAt,
                'capacity' => $capacity,
                'city_vehicle_type_id' => $cvt,
            ])->save();
        }

        return false;
    }
}
