<?php

use App\Models\Trip;
use Illuminate\Support\Facades\Broadcast;

Broadcast::channel('App.Models.User.{id}', function ($user, $id) {
    return (int) $user->id === (int) $id;
});

/*
 * Trip-scoped private channels (negotiation, tracking, chat, sos).
 * Channel name pattern: trip.{tripId}.{kind}
 *
 * Authorisation: only the trip's customer or the assigned driver may subscribe.
 * Returning false (or non-truthy) causes /broadcasting/auth to respond 403.
 */
Broadcast::channel('trip.{tripId}.{kind}', function ($user, int $tripId, string $kind) {
    if (!in_array($kind, ['negotiation', 'tracking', 'chat', 'sos'], true)) {
        return false;
    }

    $trip = Trip::query()->find($tripId);
    if (!$trip) {
        return false;
    }

    return $user->id === $trip->customer_id
        || ($trip->driver_id !== null && $user->id === $trip->driver_id);
});
