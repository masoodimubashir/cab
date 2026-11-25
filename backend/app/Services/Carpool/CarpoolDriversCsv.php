<?php

namespace App\Services\Carpool;

use App\Models\Carpool\CarpoolListing;
use App\Models\Driver;
use Illuminate\Database\Eloquent\Builder;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * The Drivers CSV when the Carpool type is chosen (W11, Admin-Audit.md G-02): carpool columns (city, car,
 * plate, seats, plan, carpool counts) instead of the commercial ones (vehicle type, ride counts of 0).
 * The commercial CSV is not touched.
 */
class CarpoolDriversCsv
{
    public const COLUMNS = [
        'driver_id', 'name', 'phone', 'email', 'city', 'car', 'plate', 'seats', 'approval_status',
        'plan_active_until', 'carpools_total', 'carpools_completed', 'registered_on', 'deactivated_at', 'deactivated_reason',
    ];

    public function download(Builder $query, string $filename): StreamedResponse
    {
        $query->with(['user', 'city:id,name', 'carpoolVehicle']);
        $plans = app(CarpoolPlanService::class);

        return response()->streamDownload(function () use ($query, $plans) {
            $out = fopen('php://output', 'w');
            fputcsv($out, self::COLUMNS);
            $query->cursor()->each(function (Driver $d) use ($out, $plans) {
                $car = $d->carpoolVehicle;
                $until = $d->user ? $plans->activePlan($d->user)?->expires_at : null;
                $listings = CarpoolListing::query()->where('driver_id', $d->id);
                fputcsv($out, array_map([self::class, 'safe'], [
                    $d->id,
                    $d->user?->name ?? '',
                    $d->user?->phone ?? '',
                    $d->user?->email ?? '',
                    $d->city?->name ?? '',
                    $car ? trim($car->make . ' ' . $car->model . ', ' . $car->colour, ' ,') : '',
                    $car?->plate ?? '',
                    $car?->seats ?? '',
                    $d->approval_status,
                    $until?->toDateString() ?? '',
                    (clone $listings)->count(),
                    (clone $listings)->where('status', CarpoolListing::STATUS_COMPLETED)->count(),
                    $d->created_at?->toDateString() ?? '',
                    $d->deactivated_at?->toDateTimeString() ?? '',
                    $d->deactivated_reason ?? '',
                ]));
            });
            fclose($out);
        }, $filename, ['Content-Type' => 'text/csv']);
    }

    /** A cell that starts with = + - or @ would run as a formula when opened in a spreadsheet. */
    public static function safe(mixed $v): mixed
    {
        return is_string($v) && $v !== '' && in_array($v[0], ['=', '+', '-', '@'], true) ? "'" . $v : $v;
    }
}
