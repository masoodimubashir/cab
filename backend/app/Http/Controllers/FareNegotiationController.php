<?php

namespace App\Http\Controllers;

use App\Events\FareNegotiationLocked;
use App\Events\FareNegotiationOfferAdded;
use App\Models\FareNegotiation;
use App\Models\FareNegotiationOffer;
use App\Models\Trip;
use App\Services\TripStateMachineService;
use Illuminate\Http\Request;

class FareNegotiationController extends Controller
{
    public function show(Request $request, Trip $trip)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if ($trip->customer_id !== $user->id && $trip->driver_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $negotiation = FareNegotiation::query()
            ->where('trip_id', $trip->id)
            ->with(['offers' => function ($q) {
                $q->orderBy('created_at', 'asc');
            }])
            ->first();

        return response()->json([
            'trip_id' => $trip->id,
            'negotiation' => $negotiation,
        ]);
    }

    public function customerOffer(Request $request, Trip $trip)
    {
        $data = $request->validate([
            'amount' => ['required', 'numeric', 'min:0'],
        ]);

        $user = $request->user();
        if ($trip->customer_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        if ($trip->status !== 'NEGOTIATION') {
            return response()->json(['message' => 'Trip is not in negotiation state.'], 409);
        }

        $negotiation = FareNegotiation::query()->firstOrCreate(
            ['trip_id' => $trip->id],
            [
                'customer_id' => $trip->customer_id,
                'driver_id' => $trip->driver_id,
                'status' => 'NEGOTIATING',
            ]
        );

        $amount = (float) $data['amount'];

        // Supersede previous pending offers so the client can render the latest state.
        $negotiation->offers()
            ->where('status', 'PENDING')
            ->update(['status' => 'SUPERSEDED']);

        $offer = $negotiation->offers()->create([
            'from_user_id' => $user->id,
            'from_role' => 'customer',
            'amount' => $amount,
            'status' => 'PENDING',
        ]);

        broadcast(new FareNegotiationOfferAdded(
            tripId: $trip->id,
            offer: $offer->fresh(),
        ))->toOthers();

        return response()->json([
            'negotiation' => $negotiation->fresh('offers'),
            'offer' => $offer,
        ]);
    }

    public function driverAction(Request $request, Trip $trip)
    {
        $data = $request->validate([
            'action' => ['required', 'in:ACCEPT,COUNTER'],
            'amount' => ['nullable', 'numeric', 'min:0'],
        ]);

        $user = $request->user();
        // During trip negotiation, the driver is allowed to join the negotiation
        // even if the trip doesn't have a driver_id yet. First negotiation action
        // will “claim” the trip for this driver.
        if ($trip->driver_id === null) {
            $trip->driver_id = $user->id;
            $trip->save();
        } elseif ($trip->driver_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        if ($trip->status !== 'NEGOTIATION') {
            return response()->json(['message' => 'Trip is not in negotiation state.'], 409);
        }

        $negotiation = FareNegotiation::query()->firstOrCreate(
            ['trip_id' => $trip->id],
            [
                'customer_id' => $trip->customer_id,
                'driver_id' => $trip->driver_id,
                'status' => 'NEGOTIATING',
            ]
        );

        $negotiation->driver_id = $trip->driver_id;
        $negotiation->save();

        if ($data['action'] === 'ACCEPT') {
            $customerOffer = $negotiation->offers()
                ->where('from_role', 'customer')
                ->orderBy('created_at', 'desc')
                ->first();

            if (!$customerOffer) {
                return response()->json(['message' => 'No customer offer found to accept.'], 422);
            }

            // Supersede previous pending offers.
            $negotiation->offers()
                ->where('status', 'PENDING')
                ->update(['status' => 'SUPERSEDED']);

            $amount = (float) $customerOffer->amount;
            $offer = $negotiation->offers()->create([
                'from_user_id' => $user->id,
                'from_role' => 'driver',
                'amount' => $amount,
                'status' => 'ACCEPTED',
                'accepted_by_user_id' => $user->id,
                'decision_at' => now(),
            ]);

            $negotiation->final_amount = $amount;
            $negotiation->save();

            broadcast(new FareNegotiationOfferAdded(
                tripId: $trip->id,
                offer: $offer->fresh(),
            ))->toOthers();

            return response()->json([
                'negotiation' => $negotiation->fresh('offers'),
            ]);
        }

        // COUNTER
        if (!isset($data['amount'])) {
            return response()->json(['message' => 'amount is required for COUNTER.'], 422);
        }

        $amount = (float) $data['amount'];

        $negotiation->offers()
            ->where('status', 'PENDING')
            ->update(['status' => 'SUPERSEDED']);

        $offer = $negotiation->offers()->create([
            'from_user_id' => $user->id,
            'from_role' => 'driver',
            'amount' => $amount,
            'status' => 'PENDING',
        ]);

        $negotiation->final_amount = $amount;
        $negotiation->save();

        broadcast(new FareNegotiationOfferAdded(
            tripId: $trip->id,
            offer: $offer->fresh(),
        ))->toOthers();

        return response()->json([
            'negotiation' => $negotiation->fresh('offers'),
            'offer' => $offer,
        ]);
    }

    public function customerConfirm(
        Request $request,
        Trip $trip,
        TripStateMachineService $tripStateMachineService
    ) {
        $data = $request->validate([
            'final_fare' => ['required', 'numeric', 'min:0'],
        ]);

        $user = $request->user();
        if ($trip->customer_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        if ($trip->status !== 'NEGOTIATION') {
            return response()->json(['message' => 'Trip is not in negotiation state.'], 409);
        }

        $negotiation = FareNegotiation::query()
            ->where('trip_id', $trip->id)
            ->first();

        if (!$negotiation || !$negotiation->final_amount) {
            return response()->json(['message' => 'Nothing to confirm yet.'], 409);
        }

        $finalFare = (float) $data['final_fare'];
        if (abs($finalFare - (float) $negotiation->final_amount) > 0.01) {
            return response()->json(['message' => 'final_fare must match the negotiated final amount.'], 422);
        }

        $tripStateMachineService->transition($trip, 'CONFIRMED', [
            'final_fare' => $finalFare,
        ]);

        $negotiation->final_amount = $finalFare;
        $negotiation->status = 'LOCKED';
        $negotiation->locked_at = now();
        $negotiation->save();

        broadcast(new FareNegotiationLocked(
            tripId: $trip->id,
            finalFare: $finalFare,
        ))->toOthers();

        return response()->json(['trip' => $trip->fresh()]);
    }
}

