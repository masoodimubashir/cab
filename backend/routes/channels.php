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

Broadcast::channel('driver.{driverId}', function ($user, int $driverId) {
    return (int) $user->id === (int) $driverId;
});

Broadcast::channel('customer.{customerId}', function ($user, int $customerId) {
    return (int) $user->id === (int) $customerId;
});

Broadcast::channel('departure.{departureId}', function ($user, int $departureId) {
    $dep = \App\Models\RouteDeparture::query()->find($departureId);
    if (!$dep) {
        return false;
    }
    if ((int) $dep->driver_id === (int) $user->id) {
        return true;
    }
    if (method_exists($user, 'hasRole') && $user->hasRole('admin')) {
        return true;
    }
    $hasHold = \App\Models\FixedSeatHold::query()
        ->where('route_departure_id', $departureId)
        ->where('customer_id', $user->id)
        ->whereIn('status', ['PENDING_DRIVER_APPROVAL', 'ACCEPTED', 'HELD'])
        ->where('expires_at', '>', now())
        ->exists();
    if ($hasHold) {
        return true;
    }
    return \App\Models\SeatReservation::query()
        ->where('route_departure_id', $departureId)
        ->where('customer_id', $user->id)
        ->whereNotIn('status', ['CANCELLED'])
        ->exists();
});

Broadcast::channel('fixed-hold.{holdId}', function ($user, int $holdId) {
    $hold = \App\Models\FixedSeatHold::query()->find($holdId);
    if (!$hold) {
        return false;
    }
    return (int) $user->id === (int) $hold->customer_id
        || ((int) $hold->routeDeparture?->driver_id === (int) $user->id);
});
