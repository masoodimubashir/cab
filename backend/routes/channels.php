<?php

use App\Models\Trip;
use Illuminate\Support\Facades\Broadcast;

Broadcast::channel('App.Models.User.{id}', function ($user, $id) {
    return (int) $user->id === (int) $id;
});

/*
 * Trip-scoped private channels (negotiation, tracking, sos).
 * Channel name pattern: trip.{tripId}.{kind}
 *
 * Authorisation: only trip participants or the assigned driver may subscribe.
 * Returning false (or non-truthy) causes /broadcasting/auth to respond 403.
 */
Broadcast::channel('trip.{tripId}.{kind}', function ($user, int $tripId, string $kind) {
    if (!in_array($kind, ['negotiation', 'tracking', 'sos'], true)) {
        return false;
    }

    $trip = Trip::query()->find($tripId);
    if (!$trip) {
        return false;
    }

    return $trip->isParticipant((int) $user->id)
        || ($trip->driver_id !== null && $user->id === $trip->driver_id);
});

/*
 * Admin live operations channel. Only authenticated admin managers with the
 * live_operations permission can subscribe to the global driver-location stream.
 */
Broadcast::channel('dispatch.live', function ($user) {
    return $user->hasRole('admin') && $user->hasPermission('live_operations');
});
