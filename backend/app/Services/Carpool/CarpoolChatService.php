<?php

namespace App\Services\Carpool;

use App\Events\CarpoolMessageSent;
use App\Models\Carpool\CarpoolBannedWord;
use App\Models\Carpool\CarpoolConversation;
use App\Models\Carpool\CarpoolConversationMember;
use App\Models\Carpool\CarpoolListing;
use App\Models\Carpool\CarpoolMessage;
use App\Models\Carpool\CarpoolPickupProposal;
use App\Models\Carpool\CarpoolReport;
use App\Models\Carpool\CarpoolRequest;
use App\Models\Carpool\CarpoolSetting;
use App\Models\User;
use App\Services\NotificationService;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Validation\ValidationException;

/**
 * Carpool chat (M5, P9). One group chat per carpool, created on the first
 * Accept; one direct chat (driver and that rider only) per join request, from
 * the request. Riders can never message each other. Messages go over REST and
 * out live on a private Reverb channel; push only, no inbox entry per message.
 */
class CarpoolChatService
{
    public const REASONS = ['spam', 'harassment', 'unsafe', 'photo', 'other'];

    public function __construct(private CarpoolPresenter $present)
    {
    }

    // ---- Opening and closing conversations (called by CarpoolRequestService) ----

    /** The private chat between the driver and one rider starts at the join request (A3). */
    public function openDirect(CarpoolRequest $r): void
    {
        $l = $r->listing()->with('driver')->first();
        $c = CarpoolConversation::query()->firstOrCreate(
            ['listing_id' => $l->id, 'kind' => CarpoolConversation::DIRECT, 'request_id' => $r->id],
            ['rider_id' => $r->rider_id],
        );
        $this->addMember($c, (int) $l->driver->user_id, 'driver');
        $this->addMember($c, (int) $r->rider_id, 'rider');
    }

    /** The group chat is created on the first Accept; riders are added as they're accepted (A4). */
    public function joinGroup(CarpoolRequest $r): void
    {
        $l = $r->listing()->with('driver')->first();
        $c = CarpoolConversation::query()->firstOrCreate(['listing_id' => $l->id, 'kind' => CarpoolConversation::GROUP]);
        $this->addMember($c, (int) $l->driver->user_id, 'driver');
        $this->addMember($c, (int) $r->rider_id, 'rider');
        $this->system($c, $this->present->firstName($this->present->name($r->rider, 'A rider')) . ' joined the carpool', ['joined_user_id' => (int) $r->rider_id]);
    }

    /** A rider who left or was removed drops out of the group chat. */
    public function leaveGroup(CarpoolRequest $r): void
    {
        $c = CarpoolConversation::query()->where('listing_id', $r->listing_id)->where('kind', CarpoolConversation::GROUP)->first();
        if ($c) {
            CarpoolConversationMember::query()->where('conversation_id', $c->id)->where('user_id', $r->rider_id)
                ->whereNull('left_at')->update(['left_at' => now()]);
        }
    }

    /** A declined, withdrawn, removed or left request's private chat goes read-only; its retention clock starts (B3). */
    public function endDirect(CarpoolRequest $r): void
    {
        CarpoolConversation::query()->where('request_id', $r->id)->whereNull('ended_at')->update(['ended_at' => now()]);
    }

    // ---- Reading ----

    /** @return array{active: array<int, array<string, mixed>>, past: array<int, array<string, mixed>>, unread: int} */
    public function inbox(User $user): array
    {
        $members = CarpoolConversationMember::query()->where('user_id', $user->id)->whereNull('left_at')
            ->with(['conversation.listing.driver.user', 'conversation.request.rider'])->get();

        $rows = $members->map(function (CarpoolConversationMember $m) use ($user) {
            $c = $m->conversation;
            $unread = CarpoolMessage::query()->where('conversation_id', $c->id)->where('id', '>', $m->last_read_message_id)
                ->where('type', '!=', 'system')->where('sender_id', '!=', $user->id)->count();
            $last = CarpoolMessage::query()->where('conversation_id', $c->id)->orderByDesc('id')->first();

            return [
                'conversation' => $this->conversation($c, $user),
                'unread' => $unread,
                'last' => $last ? $this->message($last, $user) : null,
                'writable' => $this->writable($c, $user),
                'sort' => $c->last_message_at?->timestamp ?? $c->created_at->timestamp,
            ];
        });

        $boxes = $rows->groupBy(fn ($r) => $r['conversation']['listing']['id'])->map(function (Collection $items) {
            $first = $items->first()['conversation']['listing'];

            return [
                'listing' => $first,
                'unread' => $items->sum('unread'),
                'conversations' => $items->sortBy([['conversation.kind', 'desc'], ['sort', 'desc']])->values()
                    ->map(fn ($i) => collect($i)->except('sort')->all())->all(),
            ];
        })->values();

        $active = $boxes->filter(fn ($b) => in_array($b['listing']['status'], CarpoolListing::LIVE, true))
            ->sortBy(fn ($b) => $b['listing']['departs_at'])->values();
        $past = $boxes->reject(fn ($b) => in_array($b['listing']['status'], CarpoolListing::LIVE, true))
            ->sortByDesc(fn ($b) => $b['listing']['departs_at'])->values();

        return ['active' => $active->all(), 'past' => $past->all(), 'unread' => (int) $active->sum('unread'), 'retention_days' => $this->retentionDays()];
    }

    /** Unread messages in live carpools, for the badges. One query, so the apps can ask often. */
    public function unreadCount(User $user): int
    {
        return (int) CarpoolMessage::query()
            ->join('carpool_conversation_members as m', 'm.conversation_id', '=', 'carpool_messages.conversation_id')
            ->join('carpool_conversations as c', 'c.id', '=', 'carpool_messages.conversation_id')
            ->join('carpool_listings as l', 'l.id', '=', 'c.listing_id')
            ->where('m.user_id', $user->id)->whereNull('m.left_at')
            ->whereIn('l.status', CarpoolListing::LIVE)
            ->whereColumn('carpool_messages.id', '>', 'm.last_read_message_id')
            ->where('carpool_messages.type', '!=', 'system')
            ->where('carpool_messages.sender_id', '!=', $user->id)
            ->count();
    }

    /** @return array<string, mixed> */
    public function thread(User $user, CarpoolConversation $c, int $afterId = 0): array
    {
        $member = $this->memberOf($user, $c);
        $messages = CarpoolMessage::query()->where('conversation_id', $c->id)->where('id', '>', $afterId)
            ->orderByDesc('id')->limit(100)->get()->reverse()->values();

        return [
            'conversation' => $this->conversation($c, $user),
            'messages' => $messages->map(fn ($m) => $this->message($m, $user))->all(),
            'writable' => $this->writable($c, $user),
            // Where this person had read up to, so the app can draw "N unread messages" (mockup 14).
            'last_read_message_id' => (int) $member->last_read_message_id,
            // The saved route, thinned, for the mini map on pickup cards (mockups 14, 7).
            'route' => $this->thinRoute($c->listing?->route_polyline ?? [], 60),
            'retention_days' => $this->retentionDays(),
            'message_max_chars' => (int) config('carpool.message_max_chars', 1000),
            // Where every pickup card stands now, so cards already on screen update (a poll only brings newer messages).
            'proposal_states' => CarpoolPickupProposal::query()
                ->whereIn('message_id', CarpoolMessage::query()->where('conversation_id', $c->id)->where('type', 'pickup_request')->select('id'))
                ->pluck('status', 'id')->all(),
        ];
    }

    public function markRead(User $user, CarpoolConversation $c): void
    {
        $m = $this->memberOf($user, $c);
        $latest = (int) CarpoolMessage::query()->where('conversation_id', $c->id)->max('id');
        if ($latest > $m->last_read_message_id) {
            $m->last_read_message_id = $latest;
            $m->save();
        }
    }

    // ---- Sending ----

    public function send(User $user, CarpoolConversation $c, string $body): CarpoolMessage
    {
        $this->assertCanWrite($user, $c);
        $body = trim($body);
        if ($body === '') {
            $this->fail('Type a message first.');
        }
        $max = (int) config('carpool.message_max_chars', 1000);
        if (mb_strlen($body) > $max) {
            $this->fail('Messages can be up to ' . number_format($max) . ' characters.');
        }
        $key = 'carpool-chat:' . $user->id;
        if (RateLimiter::tooManyAttempts($key, (int) config('carpool.messages_per_minute', 20))) {
            $this->fail('You are sending messages too fast. Wait a moment.');
        }
        RateLimiter::hit($key, 60);

        [$clean, $flagged] = $this->mask($body);
        $m = $this->store($c, $user->id, 'text', $clean, null, $flagged ? 'masked' : 'ok', $flagged ? 'banned word' : null);
        $this->pushOthers($c, $user, $m);

        return $m;
    }

    /**
     * A pickup request in the private chat (P9, mockups 7 and 14b). The rider
     * asks for a new spot, or the driver answers with another spot instead.
     * Either way the spot must be on the driver's route (A6) and before the
     * rider's drop; the other person accepts or declines. A newer request
     * replaces the one still waiting.
     *
     * @param array{lat: float, lng: float, name: string, address?: string|null} $point
     */
    public function proposePickup(User $user, CarpoolConversation $c, array $point): CarpoolMessage
    {
        $this->assertCanWrite($user, $c);
        $l = $c->listing;
        $byDriver = (int) $l->driver?->user_id === (int) $user->id;
        $r = $this->pickupRequest($c, $user, $byDriver, isset($point['request_id']) ? (int) $point['request_id'] : null);
        if (! $r || ! $r->isActive()) {
            $this->fail('Pickup spots are agreed between the driver and the rider whose pickup it is.');
        }
        if ($l->status !== CarpoolListing::STATUS_PUBLISHED) {
            $this->fail('The ride has started, so the pickup can no longer change.');
        }
        $geo = RouteGeometry::of($l->route_polyline ?? []);
        $hit = $geo->nearest((float) $point['lat'], (float) $point['lng'], (float) config('carpool.pickup_max_distance_m', 300));
        if (! $hit) {
            $this->fail("Pick a spot on the driver's route.", 'pickup');
        }
        if ($hit['along_m'] + CarpoolRequestService::MIN_RIDE_M > $r->drop_m) {
            $this->fail("The pickup must come before the rider's drop.", 'pickup');
        }

        return DB::transaction(function () use ($c, $r, $user, $hit, $point, $byDriver) {
            CarpoolPickupProposal::query()->where('request_id', $r->id)->where('status', 'pending')->update(['status' => 'replaced']);
            $name = mb_substr(trim((string) $point['name']), 0, 120);
            $p = CarpoolPickupProposal::query()->create([
                'request_id' => $r->id, 'lat' => round($hit['lat'], 7), 'lng' => round($hit['lng'], 7), 'name' => $name,
                'address' => isset($point['address']) ? mb_substr(trim((string) $point['address']), 0, 255) : null,
                'along_m' => (int) round($hit['along_m']),
                'proposed_by' => $byDriver ? 'driver' : 'rider',
            ]);
            // In the group chat everyone reads it, so the driver's card names the rider it is for.
            $who = $c->kind === CarpoolConversation::GROUP ? $this->present->firstName($this->present->name($r->rider, 'the rider')) : 'you';
            $body = $byDriver ? "How about picking {$who} up at {$name}?" : "Can you pick me up at {$name}?";
            $m = $this->store($c, $user->id, 'pickup_request', $body, ['proposal_id' => $p->id], 'ok', null);
            $p->message_id = $m->id;
            $p->save();
            $this->pushOthers($c, $user, $m);

            return $m;
        });
    }

    /**
     * Whose pickup a request is about. In the private chat it is that chat's
     * request. In the group chat a rider means their own accepted request, and
     * the driver names the rider's request they are answering.
     */
    private function pickupRequest(CarpoolConversation $c, User $user, bool $byDriver, ?int $requestId): ?CarpoolRequest
    {
        if ($c->kind === CarpoolConversation::DIRECT) {
            $r = $c->request;

            return $r && ($byDriver || (int) $r->rider_id === (int) $user->id) ? $r : null;
        }
        $q = CarpoolRequest::query()->where('listing_id', $c->listing_id)->where('status', CarpoolRequest::STATUS_ACCEPTED);
        if ($byDriver) {
            return $requestId ? (clone $q)->whereKey($requestId)->first() : null;
        }

        return (clone $q)->where('rider_id', $user->id)->first();
    }

    /**
     * The other person answers a pickup request: the driver answers a rider's,
     * the rider answers the driver's counter-spot. Accepting moves the rider's
     * agreed pickup.
     */
    public function answerPickup(User $user, CarpoolPickupProposal $p, bool $accept): CarpoolPickupProposal
    {
        $r = $p->request()->with('listing.driver')->first();
        $driverUserId = (int) $r->listing->driver->user_id;
        $answererId = $p->proposed_by === 'driver' ? (int) $r->rider_id : $driverUserId;
        if ((int) $user->id !== $answererId) {
            abort(404);
        }
        if ($user->carpool_banned_at) {
            $this->fail('Your carpool access is paused.');
        }
        if ($p->status !== 'pending') {
            $this->fail('This pickup request was already answered or replaced.');
        }
        if (! $r->isActive()) {
            $this->fail('This request is no longer active.');
        }
        if ($accept && $r->listing->status !== CarpoolListing::STATUS_PUBLISHED) {
            $this->fail('The ride has started, so the pickup can no longer change.');
        }
        // The answer goes in the chat where the request was made (private or group).
        $c = ($p->message_id ? CarpoolMessage::query()->find($p->message_id)?->conversation : null)
            ?? CarpoolConversation::query()->where('request_id', $r->id)->firstOrFail();

        DB::transaction(function () use ($p, $r, $accept) {
            $p->status = $accept ? 'accepted' : 'declined';
            $p->save();
            if ($accept) {
                $r->pickup_lat = $p->lat;
                $r->pickup_lng = $p->lng;
                $r->pickup_name = $p->name;
                $r->pickup_address = $p->address;
                $r->pickup_m = $p->along_m;
                $r->save();
            }
        });
        $name = $this->present->firstName($this->present->name($user, 'Someone'));
        $line = $accept ? "{$name} accepted the new pickup: {$p->name}" : "{$name} declined the pickup at {$p->name}";
        $this->system($c, $line);
        $proposerId = $p->proposed_by === 'driver' ? $driverUserId : (int) $r->rider_id;
        $proposer = User::query()->find($proposerId);
        if ($proposer) {
            $this->pushOne($proposer, $accept ? 'Pickup changed' : 'Pickup not changed', $line, $c);
        }

        return $p;
    }

    // ---- Reports (A23, A33) ----

    /**
     * @param array{message_id?: int|null, user_id?: int|null, listing_id?: int|null, reason: string, details?: string|null} $data
     */
    public function report(User $reporter, array $data): CarpoolReport
    {
        $messageText = null;
        $messageId = null;
        $listingId = $data['listing_id'] ?? null;
        if (! empty($data['message_id'])) {
            $msg = CarpoolMessage::query()->with('conversation')->findOrFail($data['message_id']);
            $this->memberOf($reporter, $msg->conversation);
            if ($msg->type === 'system' || ! $msg->sender_id) {
                $this->fail("System messages can't be reported.");
            }
            $reportedId = (int) $msg->sender_id;
            $messageId = $msg->id;
            $messageText = $msg->body;
            $listingId = $msg->conversation->listing_id;
        } else {
            $reportedId = (int) ($data['user_id'] ?? 0);
            if (! $reportedId || ! $this->sharesCarpool($reporter->id, $reportedId, $listingId)) {
                $this->fail('You can only report someone you share a carpool with.');
            }
        }
        if ($reportedId === (int) $reporter->id) {
            $this->fail("You can't report yourself.");
        }

        return CarpoolReport::query()->create([
            'reporter_id' => $reporter->id, 'reported_user_id' => $reportedId, 'message_id' => $messageId,
            'message_text' => $messageText, 'listing_id' => $listingId,
            'reason' => $data['reason'], 'details' => isset($data['details']) ? mb_substr((string) $data['details'], 0, 1000) : null,
        ]);
    }

    // ---- Clean-up ----

    /** Marks chats of finished carpools as ended, then deletes those past the retention time. */
    public function prune(): int
    {
        CarpoolConversation::query()->whereNull('ended_at')
            ->whereHas('listing', fn ($q) => $q->whereNotIn('status', CarpoolListing::LIVE))->update(['ended_at' => now()]);
        $days = $this->retentionDays();

        return CarpoolConversation::query()->whereNotNull('ended_at')->where('ended_at', '<', now()->subDays($days))->delete();
    }

    // ---- Internals ----

    public function retentionDays(): int
    {
        return max(1, (int) CarpoolSetting::current()->chat_retention_days);
    }

    /**
     * Evenly thinned copy of the route line.
     *
     * @param array<int, array{0: float, 1: float}> $line
     * @return array<int, array{0: float, 1: float}>
     */
    private function thinRoute(array $line, int $max): array
    {
        $n = count($line);
        if ($n <= $max) {
            return array_values($line);
        }
        $out = [];
        for ($i = 0; $i < $max; $i++) {
            $out[] = $line[(int) round($i * ($n - 1) / ($max - 1))];
        }

        return $out;
    }

    public function writable(CarpoolConversation $c, User $user): bool
    {
        if ($user->carpool_banned_at || $c->ended_at) {
            return false;
        }
        $l = $c->listing;
        if (! $l || ! in_array($l->status, CarpoolListing::LIVE, true)) {
            return false;
        }
        if ($c->kind === CarpoolConversation::DIRECT && ! ($c->request?->isActive())) {
            return false;
        }
        $m = CarpoolConversationMember::query()->where('conversation_id', $c->id)->where('user_id', $user->id)->first();

        return (bool) $m && ! $m->left_at;
    }

    private function assertCanWrite(User $user, CarpoolConversation $c): void
    {
        $this->memberOf($user, $c);
        if ($user->carpool_banned_at) {
            $this->fail('Your carpool access is paused.');
        }
        if (! $this->writable($c, $user)) {
            $this->fail('This chat is read only now.');
        }
    }

    private function memberOf(User $user, CarpoolConversation $c): CarpoolConversationMember
    {
        $m = CarpoolConversationMember::query()->where('conversation_id', $c->id)->where('user_id', $user->id)->first();
        if (! $m) {
            abort(404);
        }

        return $m;
    }

    private function addMember(CarpoolConversation $c, int $userId, string $role): void
    {
        $m = CarpoolConversationMember::query()->firstOrCreate(['conversation_id' => $c->id, 'user_id' => $userId], ['role' => $role]);
        if ($m->left_at) {
            $m->left_at = null;
            $m->save();
        }
    }

    /** @param array<string, mixed>|null $meta */
    private function system(CarpoolConversation $c, string $body, ?array $meta = null): void
    {
        $this->store($c, null, 'system', $body, $meta, 'ok', null);
    }

    /** The carpool was cancelled: every chat of it says why, so the read-only record makes sense (mockup 6c). */
    public function listingCancelled(CarpoolListing $listing, string $line): void
    {
        foreach (CarpoolConversation::query()->where('listing_id', $listing->id)->get() as $c) {
            $this->system($c, $line);
        }
    }

    /** @param array<string, mixed>|null $meta */
    private function store(CarpoolConversation $c, ?int $senderId, string $type, string $body, ?array $meta, string $status, ?string $reason): CarpoolMessage
    {
        $m = CarpoolMessage::query()->create([
            'conversation_id' => $c->id, 'sender_id' => $senderId, 'type' => $type, 'body' => $body, 'meta' => $meta,
            'moderation_status' => $status, 'moderation_reason' => $reason,
        ]);
        $c->last_message_at = now();
        $c->save();
        try {
            broadcast(new CarpoolMessageSent($c->id, $this->message($m, null)));
        } catch (\Throwable $e) {
            Log::warning('Carpool chat broadcast failed', ['conversation_id' => $c->id, 'error' => $e->getMessage()]);
        }

        return $m;
    }

    /** @return array{0: string, 1: bool} */
    private function mask(string $body): array
    {
        $flagged = false;
        $words = CarpoolBannedWord::query()->where('active', true)->pluck('word');
        foreach ($words as $w) {
            $body = preg_replace_callback('/(?<![\p{L}\p{N}])' . preg_quote($w, '/') . '(?![\p{L}\p{N}])/iu', function ($m) use (&$flagged) {
                $flagged = true;

                return str_repeat('•', mb_strlen($m[0]));
            }, $body) ?? $body;
        }

        return [$body, $flagged];
    }

    private function pushOthers(CarpoolConversation $c, User $sender, CarpoolMessage $m): void
    {
        $ids = CarpoolConversationMember::query()->where('conversation_id', $c->id)->whereNull('left_at')
            ->where('user_id', '!=', $sender->id)->pluck('user_id');
        $title = $this->present->firstName($this->present->name($sender, 'Someone'));
        foreach (User::query()->whereIn('id', $ids)->get() as $u) {
            $this->pushOne($u, $title, mb_substr($m->body, 0, 120), $c);
        }
    }

    /** Push only (no inbox entry per message, P10). Never breaks sending. */
    private function pushOne(User $u, string $title, string $body, CarpoolConversation $c): void
    {
        try {
            app(NotificationService::class)->sendToUser($u, $title, $body, [
                'type' => 'carpool_message', 'conversation_id' => $c->id, 'listing_id' => $c->listing_id,
            ]);
        } catch (\Throwable $e) {
            Log::warning('Carpool chat push failed', ['user_id' => $u->id, 'error' => $e->getMessage()]);
        }
    }

    private function sharesCarpool(int $a, int $b, ?int $listingId): bool
    {
        $q = CarpoolConversationMember::query()->where('user_id', $a)->whereIn('conversation_id',
            CarpoolConversationMember::query()->where('user_id', $b)->select('conversation_id'));
        if ($listingId) {
            $q->whereIn('conversation_id', CarpoolConversation::query()->where('listing_id', $listingId)->select('id'));
        }

        return $q->exists();
    }

    /** @return array<string, mixed> */
    public function message(CarpoolMessage $m, ?User $viewer): array
    {
        $removed = $m->moderation_status === 'removed';
        $sender = $m->sender;
        $proposal = null;
        if ($m->type === 'pickup_request' && ! empty($m->meta['proposal_id'])) {
            $p = CarpoolPickupProposal::query()->find($m->meta['proposal_id']);
            $proposal = $p ? [
                'id' => $p->id, 'status' => $p->status, 'name' => $p->name, 'address' => $p->address,
                'lat' => $p->lat, 'lng' => $p->lng, 'proposed_by' => $p->proposed_by,
                'request_id' => $p->request_id,
                'rider_first_name' => $this->present->firstName($this->present->name($p->request?->rider, 'Rider')),
                // The card is for me when I am the rider whose pickup it is (in the group, others just read it).
                'for_me' => $viewer && (int) $p->request?->rider_id === (int) $viewer->id,
            ] : null;
        }

        return [
            'id' => $m->id,
            'conversation_id' => $m->conversation_id,
            'type' => $m->type,
            'body' => $removed ? 'This message was removed by Dream Cabs'
                : (($m->type === 'system' && $viewer && ! empty($m->meta['joined_user_id']) && (int) $m->meta['joined_user_id'] === (int) $viewer->id) ? 'You joined the carpool' : $m->body),
            'removed' => $removed,
            'masked' => $m->moderation_status === 'masked',
            'sender' => $sender ? [
                'id' => $sender->id,
                'first_name' => $this->present->firstName($this->present->name($sender, 'Member')),
                'initials' => $this->present->initials($this->present->name($sender, 'Member')),
                'is_driver' => (int) $m->conversation?->listing?->driver?->user_id === (int) $sender->id,
            ] : null,
            'mine' => $viewer && $m->sender_id && (int) $m->sender_id === (int) $viewer->id,
            'proposal' => $proposal,
            'created_at' => $m->created_at->toIso8601String(),
        ];
    }

    /** @return array<string, mixed> */
    public function conversation(CarpoolConversation $c, User $viewer): array
    {
        $l = $c->listing;
        $mineIsDriver = (int) $l->driver?->user_id === (int) $viewer->id;
        if ($c->kind === CarpoolConversation::GROUP) {
            $title = 'Group chat';
        } elseif ($mineIsDriver) {
            $title = $this->present->firstName($this->present->name($c->request?->rider, 'Rider')) . ', private';
        } else {
            $title = $this->present->firstName($this->present->name($l->driver?->user, 'Driver')) . ', private';
        }

        return [
            'id' => $c->id,
            'kind' => $c->kind,
            'title' => $title,
            'request_id' => $c->request_id,
            'is_driver' => $mineIsDriver,
            'other_initials' => $c->kind === CarpoolConversation::GROUP ? null : $this->present->initials($this->present->name($mineIsDriver ? $c->request?->rider : $l->driver?->user, '?')),
            'other_first_name' => $c->kind === CarpoolConversation::GROUP ? null : $this->present->firstName($this->present->name($mineIsDriver ? $c->request?->rider : $l->driver?->user, 'Member')),
            'other_user_id' => $c->kind === CarpoolConversation::GROUP ? null : ($mineIsDriver ? $c->rider_id : $l->driver?->user_id),
            'driver_first_name' => $this->present->firstName($this->present->name($l->driver?->user, 'Driver')),
            'pickup_name' => $c->request?->pickup_name,
            'listing' => $this->present->listingSummary($l),
            'members' => CarpoolConversationMember::query()->where('conversation_id', $c->id)->whereNull('left_at')->count(),
        ];
    }

    private function fail(string $message, string $field = 'message'): never
    {
        throw ValidationException::withMessages([$field => $message]);
    }
}
