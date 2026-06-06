<?php

namespace App\Http\Controllers;

use App\Events\TripMessageSent;
use App\Models\Trip;
use App\Models\TripMessage;
use Illuminate\Http\Request;

class TripMessagesController extends Controller
{
    public function index(Request $request, Trip $trip)
    {
        $user = $request->user();
        if (!$trip->isParticipant($user->id) && $trip->driver_id !== $user->id && !$user->hasRole('admin')) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $messages = TripMessage::query()
            ->where('trip_id', $trip->id)
            ->where('moderation_status', '!=', 'REMOVED')
            ->orderBy('created_at')
            ->paginate(50);

        return response()->json(['data' => $messages]);
    }

    public function send(Request $request, Trip $trip)
    {
        $data = $request->validate([
            'body' => ['required', 'string', 'max:2000'],
        ]);

        $user = $request->user();
        if (!$trip->isParticipant($user->id) && $trip->driver_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        if (in_array($trip->status, ['CANCELLED', 'COMPLETED'], true)) {
            return response()->json(['message' => 'Trip chat is closed.'], 409);
        }

        $message = TripMessage::query()->create([
            'trip_id' => $trip->id,
            'sender_user_id' => $user->id,
            'message_type' => 'TEXT',
            'body' => $data['body'],
            'moderation_status' => 'VISIBLE',
        ]);

        broadcast(new TripMessageSent(
            tripId: $trip->id,
            message: $message->fresh(),
        ))->toOthers();

        return response()->json(['message' => $message->fresh()], 201);
    }

    public function moderate(Request $request, TripMessage $message)
    {
        $data = $request->validate([
            'moderation_status' => ['required', 'in:VISIBLE,FLAGGED,REMOVED'],
            'moderation_reason' => ['nullable', 'string', 'max:1000'],
        ]);

        $moderator = $request->user();

        $message->moderation_status = $data['moderation_status'];
        $message->moderation_reason = $data['moderation_reason'] ?? null;
        $message->moderated_by_user_id = $moderator->id;
        $message->save();

        return response()->json(['message' => $message->fresh()]);
    }
}

