<?php

namespace App\Http\Controllers;

use App\Models\Driver;
use App\Models\Rating;
use App\Models\Trip;
use Illuminate\Http\Request;

class RatingsController extends Controller
{
    public function store(Request $request, Trip $trip)
    {
        $data = $request->validate([
            'score' => ['required', 'integer', 'min:1', 'max:5'],
            'comment' => ['nullable', 'string', 'max:2000'],
        ]);

        $user = $request->user();
        if ($trip->customer_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        if ($trip->status !== 'COMPLETED') {
            return response()->json(['message' => 'Trip must be completed before rating.'], 409);
        }

        if (Rating::query()->where('trip_id', $trip->id)->exists()) {
            return response()->json(['message' => 'Rating already submitted for this trip.'], 409);
        }

        if (!$trip->driver_id) {
            return response()->json(['message' => 'Driver not assigned.'], 422);
        }

        $rating = Rating::query()->create([
            'trip_id' => $trip->id,
            'customer_id' => $trip->customer_id,
            'driver_id' => $trip->driver_id,
            'score' => (int) $data['score'],
            'comment' => $data['comment'] ?? null,
        ]);

        // Update driver aggregate rating.
        $avg = Rating::query()->where('driver_id', $trip->driver_id)->avg('score');
        $count = Rating::query()->where('driver_id', $trip->driver_id)->count();

        Driver::query()->where('user_id', $trip->driver_id)->update([
            'rating_avg' => $avg ? (float) $avg : 0.0,
            'rating_count' => (int) $count,
        ]);

        return response()->json(['rating' => $rating->fresh()]);
    }

    public function historyCustomer(Request $request)
    {
        $user = $request->user();
        $trips = Trip::query()
            ->where('customer_id', $user->id)
            ->orderByDesc('completed_at')
            ->paginate(20);

        return response()->json(['data' => $trips]);
    }

    public function historyDriver(Request $request)
    {
        $user = $request->user();
        $trips = Trip::query()
            ->where('driver_id', $user->id)
            ->orderByDesc('completed_at')
            ->paginate(20);

        return response()->json(['data' => $trips]);
    }
}

