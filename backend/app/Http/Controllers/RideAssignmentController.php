<?php

namespace App\Http\Controllers;

use App\Models\Driver;
use App\Models\FareNegotiation;
use App\Models\Trip;
use App\Models\TripAssignment;
use App\Services\TripStateMachineService;
use Illuminate\Http\Request;

class RideAssignmentController extends Controller
{
    public function accept(Request $request, Trip $trip, TripStateMachineService $tripStateMachineService)
    {
        $user = $request->user();

        if ($trip->status !== 'CONFIRMED') {
            return response()->json(['message' => 'Trip is not ready for assignment.'], 409);
        }

        $driverProfile = Driver::query()->where('user_id', $user->id)->first();
        if (!$driverProfile) {
            return response()->json(['message' => 'Driver profile not found.'], 404);
        }

        if ($driverProfile->approval_status !== 'approved' || !$driverProfile->is_online) {
            return response()->json(['message' => 'Driver must be approved and online.'], 422);
        }

        if ($trip->driver_id && $trip->driver_id !== $user->id) {
            return response()->json(['message' => 'Trip already assigned to another driver.'], 409);
        }

        // Ensure we only create one active assignment record per driver.
        TripAssignment::query()->updateOrCreate(
            ['trip_id' => $trip->id, 'driver_id' => $user->id],
            ['status' => 'ACCEPTED', 'assigned_at' => now(), 'decided_at' => now()]
        );

        $trip->driver_id = $user->id;
        $trip->save();

        // Link negotiation thread to the assigned driver.
        $negotiation = FareNegotiation::query()->where('trip_id', $trip->id)->first();
        if ($negotiation) {
            $negotiation->driver_id = $user->id;
            $negotiation->save();
        }

        $tripStateMachineService->transition($trip, 'ASSIGNED');

        return response()->json(['trip' => $trip->fresh()]);
    }

    public function reject(Request $request, Trip $trip)
    {
        $user = $request->user();

        if ($trip->status !== 'CONFIRMED') {
            return response()->json(['message' => 'Trip is not ready for assignment.'], 409);
        }

        $driverProfile = Driver::query()->where('user_id', $user->id)->first();
        if (!$driverProfile) {
            return response()->json(['message' => 'Driver profile not found.'], 404);
        }

        TripAssignment::query()->updateOrCreate(
            ['trip_id' => $trip->id, 'driver_id' => $user->id],
            ['status' => 'REJECTED', 'decided_at' => now()]
        );

        return response()->json(['message' => 'Rejected.']);
    }
}

