<?php

namespace App\Http\Controllers\Carpool;

use App\Http\Controllers\Controller;
use App\Models\Carpool\CarpoolListing;
use App\Models\Carpool\CarpoolRequest;
use App\Services\Carpool\CarpoolClock;
use App\Services\Carpool\CarpoolPresenter;
use App\Services\Carpool\CarpoolRequestService;
use App\Services\Carpool\CarpoolRideService;
use App\Services\Carpool\CarpoolSearchService;
use App\Services\Carpool\RouteGeometry;
use App\Models\Carpool\CarpoolSetting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

/** Rider side (M4): search, the carpool page, ask to join, cancel, leave, My trips. */
class RiderController extends Controller
{
    public function __construct(
        private CarpoolSearchService $search,
        private CarpoolRequestService $requests,
        private CarpoolPresenter $present,
        private CarpoolRideService $rides,
    ) {
    }

    public function search(Request $request): JsonResponse
    {
        $seatsMax = (int) config('carpool.seats_max', 6);
        $q = $request->validate($this->pointRules(true) + [
            'date' => ['required', 'date_format:Y-m-d'],
            'seats' => ['required', 'integer', 'min:1', "max:{$seatsMax}"],
        ]);

        return response()->json($this->search->search($request->user(), [
            'from_lat' => (float) $q['from_lat'], 'from_lng' => (float) $q['from_lng'],
            'to_lat' => (float) $q['to_lat'], 'to_lng' => (float) $q['to_lng'],
            'date' => $q['date'], 'seats' => (int) $q['seats'],
        ]));
    }

    /**
     * The carpool page (customer 4, 4b, 8b to 8k). With the search places it
     * also suggests the closest pickup and drop on the route.
     */
    public function show(Request $request, CarpoolListing $listing): JsonResponse
    {
        $q = $request->validate($this->pointRules(false) + ['seats' => ['nullable', 'integer', 'min:1', 'max:' . (int) config('carpool.seats_max', 6)]]);
        $user = $request->user();
        $listing->loadMissing(['driver.user', 'vehicle']);
        $mine = CarpoolRequest::query()->where('listing_id', $listing->id)->where('rider_id', $user->id)
            ->orderByRaw("FIELD(status, 'accepted', 'pending') DESC")->orderByDesc('id')->first();
        $live = in_array($listing->status, CarpoolListing::LIVE, true);
        if (! $live && ! $mine) {
            abort(404);
        }

        $geo = RouteGeometry::of($listing->route_polyline ?? []);
        $suggested = null;
        if (isset($q['from_lat'], $q['from_lng'], $q['to_lat'], $q['to_lng'])) {
            $m = $geo->match((float) $q['from_lat'], (float) $q['from_lng'], (float) $q['to_lat'], (float) $q['to_lng'],
                (float) CarpoolSetting::current()->search_distance_m, CarpoolRequestService::minRideM());
            if ($m) {
                $suggested = $this->search->result($listing, $geo, $m, (int) ($q['seats'] ?? 1), null);
                $suggested = ['pickup' => $suggested['pickup'], 'drop' => $suggested['drop']];
            }
        }

        // 4b: a carpool already on the road. No live location in v1, so the time to the pickup is worked
        // out from the plan, moved by how late the driver really started.
        $onRoad = null;
        if ($listing->status === CarpoolListing::STATUS_IN_PROGRESS && $suggested && $listing->started_at) {
            $shift = max(0, $listing->departs_at->diffInSeconds($listing->started_at, false));
            $at = \Carbon\CarbonImmutable::parse($suggested['pickup']['at'])->addSeconds($shift);
            $onRoad = ['minutes_to_pickup' => (int) ceil(now()->diffInSeconds($at, false) / 60), 'started_at' => $listing->started_at->toIso8601String()];
        }

        $seats = (int) ($q['seats'] ?? 1);
        $free = $listing->seatsFree();
        $own = (int) $listing->driver?->user_id === (int) $user->id;
        $blocked = match (true) {
            ! $live => 'ended',
            $own => 'own',
            $free <= 0 => 'full',
            $free < $seats => 'seats',
            ! $listing->accepting_requests => 'off',
            default => null,
        };
        $active = $mine && $mine->isActive();

        return response()->json(['data' => [
            'id' => $listing->id,
            'status' => $listing->status,
            'departs_at' => $listing->departs_at->toIso8601String(),
            'start_opens_at' => $listing->departs_at->copy()->subMinutes(CarpoolSetting::number('start_early_minutes'))->toIso8601String(),
            'day' => CarpoolClock::daysFromToday($listing->departs_at),
            'start' => $this->present->place($listing, 'start'),
            'end' => $this->present->place($listing, 'end'),
            'route_polyline' => $listing->route_polyline,
            'distance_m' => $listing->distance_m,
            'duration_s' => $listing->duration_s,
            'price_per_seat' => $listing->price_per_seat,
            'is_free' => $listing->is_free,
            'seats_total' => $listing->seats_total,
            'seats_free' => $free,
            'accepting_requests' => $listing->accepting_requests,
            'cancel_reason' => \App\Services\Carpool\CarpoolPresenter::riderCancelReason($listing->cancel_reason),
            'cancel_note' => $listing->cancel_note,
            'started_at' => $listing->started_at?->toIso8601String(),
            'completed_at' => $listing->completed_at?->toIso8601String(),
            'changed' => $listing->changed_kind && $listing->changed_at?->gt(now()->subHours((int) config('carpool.changed_notice_hours', 24))) ? [
                'kind' => $listing->changed_kind,
                'was_at' => $listing->changed_from_at?->toIso8601String(),
            ] : null,
            'driver' => $this->present->driver($listing),
            'car' => $this->present->car($listing->vehicle),
            'suggested' => $suggested,
            'on_road' => $onRoad,
            'can_request' => $blocked === null && ! $active,
            'blocked' => $blocked,
            // A paused rider can open everything but, on Request to join, sees the ban sheet instead (mockup "Carpool ban: rider").
            'banned' => \App\Services\Carpool\CarpoolAccess::blocked($user),
            'my_request' => $mine ? $this->present->riderRequest($mine, $listing, $geo) : null,
            'chat_deleted' => $mine !== null && $listing->chats_deleted_at !== null,
            'group_chat_id' => $mine && in_array($mine->status, CarpoolRequest::SEATED, true) ? $this->present->groupChatId($listing) : null,
        ]]);
    }

    public function join(Request $request, CarpoolListing $listing): JsonResponse
    {
        $seatsMax = (int) config('carpool.seats_max', 6);
        $rules = ['seats' => ['required', 'integer', 'min:1', "max:{$seatsMax}"], 'confirm_overlap' => ['nullable', 'boolean']];
        foreach (['pickup', 'drop'] as $p) {
            $rules[$p] = ['required', 'array'];
            $rules["{$p}.lat"] = ['required', 'numeric', 'between:-90,90'];
            $rules["{$p}.lng"] = ['required', 'numeric', 'between:-180,180'];
            $rules["{$p}.name"] = ['required', 'string', 'max:120'];
            $rules["{$p}.address"] = ['nullable', 'string', 'max:255'];
        }
        $data = $request->validate($rules);
        $listing->loadMissing('driver.user');
        $r = $this->requests->join($request->user(), $listing, $data);

        return response()->json(['data' => $this->present->riderRequest($r, $listing->fresh())], 201);
    }

    public function withdraw(Request $request, CarpoolRequest $carpoolRequest): JsonResponse
    {
        $r = $this->requests->withdraw($request->user(), $carpoolRequest);

        return response()->json(['data' => $this->present->riderRequest($r, $r->listing)]);
    }

    public function leave(Request $request, CarpoolRequest $carpoolRequest): JsonResponse
    {
        $r = $this->requests->leave($request->user(), $carpoolRequest);

        return response()->json(['data' => $this->present->riderRequest($r, $r->listing->fresh())]);
    }

    /** My trips (customer 8, 8l): every request the rider made, newest first. */
    public function trips(Request $request): JsonResponse
    {
        $size = max(1, (int) config('carpool.trips_page_size', 100));
        $page = max(1, $request->integer('page', 1));
        $fetched = CarpoolRequest::query()->where('rider_id', $request->user()->id)
            ->with(['listing.driver.user'])->orderByDesc('id')->offset(($page - 1) * $size)->limit($size + 1)->get();
        $hasMore = $fetched->count() > $size; // one extra row tells us there is a next page (S12)
        $rows = $fetched->take($size)->filter(fn (CarpoolRequest $r) => $r->listing !== null);

        return response()->json(['meta' => ['page' => $page, 'has_more' => $hasMore], 'data' => $rows->map(function (CarpoolRequest $r) {
            $l = $r->listing;
            $driver = $this->present->driver($l);

            return $this->present->riderRequest($r, $l) + [
                'listing' => [
                    'status' => $l->status,
                    'departs_at' => $l->departs_at->toIso8601String(),
                    'day' => CarpoolClock::daysFromToday($l->departs_at),
                    'start' => ['name' => $l->start_name],
                    'end' => ['name' => $l->end_name],
                    'cancel_reason' => \App\Services\Carpool\CarpoolPresenter::riderCancelReason($l->cancel_reason),
                ],
                'driver' => ['name' => $driver['name'], 'first_name' => $driver['first_name']],
            ];
        })->values()]);
    }

    /** Rate the driver after drop-off (customer 8g). Stars required, comment optional. */
    public function rate(Request $request, CarpoolListing $listing): JsonResponse
    {
        $data = $request->validate(['score' => ['required', 'integer', 'between:1,5'], 'comment' => ['nullable', 'string', 'max:500']]);
        $listing->loadMissing('driver.user');
        $this->rides->rateDriver($request->user(), $listing, (int) $data['score'], $data['comment'] ?? null);

        return response()->json(['data' => ['rated' => true]], 201);
    }

    /** The profile photo asked for at the first join request (customer 5a, P12, A20). */
    public function photo(Request $request): JsonResponse
    {
        $request->validate(['photo' => ['required', 'file', 'image', 'max:' . (int) config('carpool.photo_max_kb', 4096)]]);
        $user = $request->user();
        $old = $user->avatar_path;
        $user->avatar_path = $request->file('photo')->store('avatars', 'public');
        $user->save();
        if ($old && ! str_starts_with($old, 'http') && $old !== $user->avatar_path && Storage::disk('public')->exists($old)) {
            Storage::disk('public')->delete($old);
        }

        return response()->json(['avatar_path' => $user->avatar_path, 'avatar_url' => $this->present->rider($user)['photo_url']]);
    }

    /** @return array<string, list<string>> */
    private function pointRules(bool $required): array
    {
        $r = $required ? 'required' : 'nullable';

        return [
            'from_lat' => [$r, 'numeric', 'between:-90,90'],
            'from_lng' => [$r, 'numeric', 'between:-180,180'],
            'to_lat' => [$r, 'numeric', 'between:-90,90'],
            'to_lng' => [$r, 'numeric', 'between:-180,180'],
        ];
    }
}
