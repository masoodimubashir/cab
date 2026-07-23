<?php

namespace App\Http\Controllers\Admin;

use App\Models\Driver;
use App\Models\FareNegotiation;
use App\Models\Payment;
use App\Models\Trip;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

class AdminDashboardController
{
    public function index(Request $request)
    {
        $activeTrips = Trip::query()
            ->whereNotIn('status', ['COMPLETED', 'CANCELLED'])
            ->count();

        $completedTrips = Trip::query()->where('status', 'COMPLETED')->count();
        $cancelledTrips = Trip::query()->where('status', 'CANCELLED')->count();

        $driversTotal = Driver::query()->count();
        $driversApproved = Driver::query()->where('approval_status', 'approved')->count();
        $driversPending = Driver::query()->where('approval_status', 'pending')->count();
        $driversRejected = Driver::query()->where('approval_status', 'rejected')->count();

        $earnings = Payment::query()
            ->where('status', 'SUCCESS')
            ->sum('amount');

        $negotiations = FareNegotiation::query()->count();

        return response()->json([
            'kpis' => [
                'active_trips' => $activeTrips,
                'completed_trips' => $completedTrips,
                'drivers_total' => $driversTotal,
                'drivers_approved' => $driversApproved,
                'earnings_total' => (float) $earnings,
                'fare_negotiations_total' => $negotiations,
            ],
            'charts' => [
                // Doughnut — trip mix across the whole platform.
                'trips_by_status' => [
                    ['label' => 'Completed', 'value' => $completedTrips],
                    ['label' => 'Ongoing', 'value' => $activeTrips],
                    ['label' => 'Cancelled', 'value' => $cancelledTrips],
                ],
                // Doughnut — driver onboarding funnel.
                'drivers_by_approval' => [
                    ['label' => 'Approved', 'value' => $driversApproved],
                    ['label' => 'Pending', 'value' => $driversPending],
                    ['label' => 'Rejected', 'value' => $driversRejected],
                ],
                // Bar — rides per day for the last 7 days (completed vs cancelled).
                'rides_last_7_days' => $this->ridesLast7Days(),
                // Bar — gross revenue per day for the last 7 days.
                'revenue_last_7_days' => $this->revenueLast7Days(),
                // Horizontal bar — most-booked ride types.
                'top_ride_types' => $this->topRideTypes(),
                // Doughnut — successful payments split by method.
                'payments_by_method' => $this->paymentsByMethod(),
            ],
        ]);
    }

    /**
     * Zero-filled 7-day window of trip counts (total / completed / cancelled).
     *
     * @return array{labels: string[], total: int[], completed: int[], cancelled: int[]}
     */
    private function ridesLast7Days(): array
    {
        $since = now()->startOfDay()->subDays(6);

        $rows = Trip::query()
            ->where('created_at', '>=', $since)
            ->selectRaw('DATE(created_at) as day, COUNT(*) as total,
                SUM(status = "COMPLETED") as completed,
                SUM(status = "CANCELLED") as cancelled')
            ->groupBy('day')
            ->get()
            ->keyBy('day');

        $labels = [];
        $total = [];
        $completed = [];
        $cancelled = [];

        for ($i = 6; $i >= 0; $i--) {
            $date = now()->startOfDay()->subDays($i);
            $key = $date->toDateString();
            $row = $rows->get($key);

            $labels[] = $date->format('D j');
            $total[] = (int) ($row->total ?? 0);
            $completed[] = (int) ($row->completed ?? 0);
            $cancelled[] = (int) ($row->cancelled ?? 0);
        }

        return compact('labels', 'total', 'completed', 'cancelled');
    }

    /**
     * Zero-filled 7-day window of gross revenue (sum of final_fare on completed
     * trips).
     *
     * @return array{labels: string[], values: float[]}
     */
    private function revenueLast7Days(): array
    {
        $since = now()->startOfDay()->subDays(6);

        $rows = Trip::query()
            ->where('status', 'COMPLETED')
            ->where('created_at', '>=', $since)
            ->selectRaw('DATE(created_at) as day, COALESCE(SUM(final_fare), 0) as revenue')
            ->groupBy('day')
            ->get()
            ->keyBy('day');

        $labels = [];
        $values = [];

        for ($i = 6; $i >= 0; $i--) {
            $date = now()->startOfDay()->subDays($i);
            $row = $rows->get($date->toDateString());

            $labels[] = $date->format('D j');
            $values[] = round((float) ($row->revenue ?? 0), 2);
        }

        return compact('labels', 'values');
    }

    /**
     * Top ride types by trip volume.
     *
     * @return array<int, array{label: string, value: int}>
     */
    private function topRideTypes(): array
    {
        return Trip::query()
            ->leftJoin('ride_types', 'ride_types.id', '=', 'trips.ride_type_id')
            ->selectRaw('COALESCE(ride_types.name, "Unspecified") as label, COUNT(*) as value')
            ->groupBy('label')
            ->orderByDesc('value')
            ->limit(6)
            ->get()
            ->map(fn ($r) => ['label' => (string) $r->label, 'value' => (int) $r->value])
            ->all();
    }

    /**
     * Successful payments split by method.
     *
     * @return array<int, array{label: string, value: int}>
     */
    private function paymentsByMethod(): array
    {
        return Payment::query()
            ->where('status', 'SUCCESS')
            ->selectRaw('COALESCE(NULLIF(method, ""), "Other") as label, COUNT(*) as value')
            ->groupBy('label')
            ->orderByDesc('value')
            ->get()
            ->map(fn ($r) => ['label' => ucfirst((string) $r->label), 'value' => (int) $r->value])
            ->all();
    }
}
