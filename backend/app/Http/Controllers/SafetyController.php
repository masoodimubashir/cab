<?php

namespace App\Http\Controllers;

use App\Events\SosTriggered;
use App\Models\SafetyEvent;
use App\Models\Trip;
use App\Models\User;
use App\Models\UserRole;
use App\Services\NotificationService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class SafetyController extends Controller
{
    public function trigger(Request $request, Trip $trip, NotificationService $notificationService)
    {
        $data = $request->validate([
            'lat' => ['nullable', 'numeric', 'between:-90,90'],
            'lng' => ['nullable', 'numeric', 'between:-180,180'],
            'note' => ['nullable', 'string', 'max:1000'],
        ]);

        $user = $request->user();

        if (in_array($trip->status, ['CANCELLED', 'COMPLETED'], true)) {
            return response()->json(['message' => 'Trip is not active.'], 409);
        }

        $isCustomer = $user->hasRole('customer') && $trip->isParticipant($user->id);
        $isDriver = $user->hasRole('driver') && $trip->driver_id === $user->id;

        if (!$isCustomer && !$isDriver) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $event = SafetyEvent::query()->create([
            'trip_id' => $trip->id,
            'type' => 'SOS',
            'initiator_user_id' => $user->id,
            'status' => 'CREATED',
            'lat' => $data['lat'] ?? null,
            'lng' => $data['lng'] ?? null,
            'payload' => [
                'note' => $data['note'] ?? null,
            ],
        ]);

        Log::warning('DreamCabs SOS triggered', [
            'trip_id' => $trip->id,
            'initiator_user_id' => $user->id,
            'lat' => $event->lat,
            'lng' => $event->lng,
        ]);

        broadcast(new SosTriggered(
            tripId: $trip->id,
            event: $event->fresh(),
        ))->toOthers();

        // FCM: alert all admin users.
        $adminIds = UserRole::query()->where('role', 'admin')->pluck('user_id')->all();
        if (!empty($adminIds)) {
            $admins = User::query()->whereIn('id', $adminIds)->get();
            foreach ($admins as $admin) {
                $notificationService->sendToUser(
                    $admin,
                    'SOS triggered',
                    "Trip #{$trip->id} — initiator user #{$user->id}",
                    [
                        'type' => 'sos',
                        'trip_id' => $trip->id,
                        'safety_event_id' => $event->id,
                        'lat' => $event->lat,
                        'lng' => $event->lng,
                    ]
                );
            }
        }

        return response()->json(['safety_event' => $event->fresh()]);
    }

    public function adminIndex(Request $request)
    {
        $events = SafetyEvent::query()
            ->with('initiator')
            ->orderByDesc('created_at')
            ->paginate(20);

        return response()->json(['data' => $events]);
    }
}

