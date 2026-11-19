<?php

namespace App\Http\Controllers\Carpool;

use App\Http\Controllers\Controller;
use App\Models\Carpool\CarpoolConversation;
use App\Models\Carpool\CarpoolPickupProposal;
use App\Services\Carpool\CarpoolChatService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Chat for riders and drivers (M5): Messages / Inbox, a thread, send, pickup requests, reports. */
class ChatController extends Controller
{
    public function __construct(private CarpoolChatService $chat)
    {
    }

    public function inbox(Request $request): JsonResponse
    {
        return response()->json($this->chat->inbox($request->user()));
    }

    public function unread(Request $request): JsonResponse
    {
        return response()->json(['count' => $this->chat->unreadCount($request->user())]);
    }

    public function show(Request $request, CarpoolConversation $conversation): JsonResponse
    {
        $after = (int) $request->query('after', 0);

        return response()->json($this->chat->thread($request->user(), $conversation, $after));
    }

    public function send(Request $request, CarpoolConversation $conversation): JsonResponse
    {
        $data = $request->validate(['body' => ['required', 'string']]);
        $m = $this->chat->send($request->user(), $conversation, $data['body']);

        return response()->json(['data' => $this->chat->message($m, $request->user())], 201);
    }

    public function read(Request $request, CarpoolConversation $conversation): JsonResponse
    {
        $this->chat->markRead($request->user(), $conversation);

        return response()->json(['ok' => true]);
    }

    public function proposePickup(Request $request, CarpoolConversation $conversation): JsonResponse
    {
        $data = $request->validate([
            'lat' => ['required', 'numeric', 'between:-90,90'], 'lng' => ['required', 'numeric', 'between:-180,180'],
            'name' => ['required', 'string', 'max:120'], 'address' => ['nullable', 'string', 'max:255'],
            // The driver names which rider's pickup it is when answering in the group chat.
            'request_id' => ['nullable', 'integer'],
        ]);
        $m = $this->chat->proposePickup($request->user(), $conversation, $data);

        return response()->json(['data' => $this->chat->message($m, $request->user())], 201);
    }

    public function acceptPickup(Request $request, CarpoolPickupProposal $proposal): JsonResponse
    {
        $this->chat->answerPickup($request->user(), $proposal, true);

        return response()->json(['ok' => true]);
    }

    public function declinePickup(Request $request, CarpoolPickupProposal $proposal): JsonResponse
    {
        $this->chat->answerPickup($request->user(), $proposal, false);

        return response()->json(['ok' => true]);
    }

    public function report(Request $request): JsonResponse
    {
        $data = $request->validate([
            'message_id' => ['nullable', 'integer'], 'user_id' => ['nullable', 'integer'], 'listing_id' => ['nullable', 'integer'],
            'reason' => ['required', 'string', 'in:' . implode(',', CarpoolChatService::REASONS)],
            'details' => ['nullable', 'string', 'max:1000'],
        ]);
        $this->chat->report($request->user(), $data);

        return response()->json(['ok' => true], 201);
    }
}
