<?php

namespace App\Http\Controllers\Admin;

use App\Models\Driver;
use App\Models\FareNegotiation;
use App\Models\Payment;
use App\Models\Trip;
use Illuminate\Http\Request;

class AdminDashboardController
{
    public function index(Request $request)
    {
        $activeTrips = Trip::query()
            ->whereNotIn('status', ['COMPLETED', 'CANCELLED'])
            ->count();

        $completedTrips = Trip::query()->where('status', 'COMPLETED')->count();

        $driversTotal = Driver::query()->count();
        $driversApproved = Driver::query()->where('approval_status', 'approved')->count();

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
        ]);
    }
}

