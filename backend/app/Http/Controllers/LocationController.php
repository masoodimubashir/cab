<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Last-known location pings from the customer / driver mobile apps.
 *
 * The mobile app should POST here periodically while the app is foregrounded
 * (every 60–120 s is plenty) and on key events such as login, opening the
 * "find a ride" screen, or pulling-to-refresh. We only ever store the LATEST
 * point on the user row — no breadcrumb. (Drivers still write breadcrumbs to
 * `driver_locations` separately; nothing about that flow changes.)
 *
 * Auth: `auth:sanctum`. A user can only write their own row — we read
 * `$request->user()` and never trust an id from the body, so a compromised
 * client cannot move another user's pin.
 */
class LocationController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'lat' => ['required', 'numeric', 'between:-90,90'],
            'lng' => ['required', 'numeric', 'between:-180,180'],
        ]);

        $user = $request->user();
        $user->forceFill([
            'current_lat' => $data['lat'],
            'current_lng' => $data['lng'],
            'current_location_updated_at' => now(),
        ])->save();

        // 204 No Content — the mobile app doesn't need an echo and we keep
        // the payload tiny since this endpoint may be hit many times a minute.
        return response()->json(null, 204);
    }
}
