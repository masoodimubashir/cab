<?php

namespace App\Http\Controllers\Admin;

use App\Models\DriverLocation;
use App\Models\Trip;
use Illuminate\Http\Request;

class AdminTripsController
{
    public function index(Request $request)
    {
        $status = $request->query('status');

        $query = Trip::query()
            ->with(['customer', 'driver', 'rideType', 'pricingRule']);

        if ($status) {
            $query->where('status', $status);
        } else {
            $query->whereNotIn('status', ['COMPLETED', 'CANCELLED']);
        }

        $trips = $query->orderByDesc('created_at')->paginate(50);

        return response()->json(['data' => $trips]);
    }

    /**
     * Returns the latest stored driver location for a trip (used by admin ride monitoring).
     */
    public function latestLocation(Trip $trip)
    {
        $latest = DriverLocation::query()
            ->where('trip_id', $trip->id)
            ->orderByDesc('recorded_at')
            ->first();

        return response()->json([
            'trip_id' => $trip->id,
            'latest_location' => $latest,
        ]);
    }
}

