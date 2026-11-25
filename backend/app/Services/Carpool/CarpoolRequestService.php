<?php

namespace App\Services\Carpool;

use App\Models\Carpool\CarpoolListing;
use App\Models\Carpool\CarpoolRequest;
use App\Models\Driver;
use App\Models\User;
use App\Services\NotificationCenter;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;

/**
 * Join requests (M4): ask to join, cancel a request, leave, and the driver's
 * Accept, Decline, Remove and Paid tick. Seats (P7): every change to who is
 * in locks the carpool row and recounts the accepted seats, so two Accepts
 * at the same moment can't overbook the car. Requests that no longer fit
 * close as "filled up"; a freed seat reopens the carpool for new requests.
 */
class CarpoolRequestService
{
    /** A ride shorter than this along the route isn't worth matching: shortest ride in metres (config carpool.min_ride_m, default 300). */
    public static function minRideM(): float
    {
        return (float) config('carpool.min_ride_m', RouteGeometry::FALLBACK_MIN_RIDE_M);
    }

    public function __construct(
        private NotificationCenter $notes,
        private CarpoolPresenter $present,
    ) {
    }

    /**
     * Ask to join (customer mockup 5). Pickup and drop must be on the driver's
     * route (within the pickup distance, A6) with the pickup first.
     *
     * @param array<string, mixed> $data validated input
     */
    public function join(User $rider, CarpoolListing $listing, array $data): CarpoolRequest
    {
        if (! CarpoolSwitch::enabled()) {
            $this->fail('Carpool is not open right now.');
        }
        if ($reason = CarpoolAccess::reason($rider)) {
            $this->fail($reason);
        }
        if (! $rider->avatar_path) {
            $this->fail('Add a profile photo first. Drivers check it at pickup.', 'photo');
        }
        if ((int) $listing->driver?->user_id === (int) $rider->id) {
            $this->fail("You can't join your own carpool.");
        }

        if (empty($data['confirm_overlap']) && ($other = $this->overlapping($rider, $listing))) {
            $this->fail('You already have a carpool at about this time (' . $this->route($other) . ', '
                . $this->present->when($other->departs_at) . '). Ask anyway?', 'overlap');
        }

        $geo = RouteGeometry::of($listing->route_polyline ?? []);
        $max = (float) config('carpool.pickup_max_distance_m', 300);
        $pickup = $geo->nearest((float) $data['pickup']['lat'], (float) $data['pickup']['lng'], $max);
        if (! $pickup) {
            $this->fail("Pick a pickup on the driver's route.", 'pickup');
        }
        $drop = $geo->nearest((float) $data['drop']['lat'], (float) $data['drop']['lng'], $max, $pickup['along_m'] + self::minRideM());
        if (! $drop) {
            $this->fail('Your drop must come after your pickup on this route.', 'drop');
        }

        $request = DB::transaction(function () use ($rider, $listing, $data, $pickup, $drop) {
            $l = CarpoolListing::query()->lockForUpdate()->findOrFail($listing->id);
            if (! in_array($l->status, CarpoolListing::LIVE, true)) {
                $this->fail('This carpool has ended.');
            }
            if (! $l->accepting_requests) {
                $this->fail("The driver isn't taking requests right now.");
            }
            $mine = CarpoolRequest::query()->where('listing_id', $l->id)->where('rider_id', $rider->id)
                ->whereIn('status', CarpoolRequest::ACTIVE)->exists();
            if ($mine) {
                $this->fail("You've already asked to join this carpool.");
            }
            $seats = (int) $data['seats'];
            $free = $l->seats_total - $this->acceptedSeats($l);
            if ($seats > $free) {
                $this->fail($free <= 0 ? 'This carpool is full.' : 'Only ' . $this->seatWord($free) . ' left.', 'seats');
            }

            $r = new CarpoolRequest([
                'seats' => $seats,
                'pickup_lat' => round($pickup['lat'], 7), 'pickup_lng' => round($pickup['lng'], 7),
                'pickup_name' => mb_substr(trim((string) $data['pickup']['name']), 0, 120),
                'pickup_address' => isset($data['pickup']['address']) ? mb_substr(trim((string) $data['pickup']['address']), 0, 255) : null,
                'pickup_m' => (int) round($pickup['along_m']),
                'drop_lat' => round($drop['lat'], 7), 'drop_lng' => round($drop['lng'], 7),
                'drop_name' => mb_substr(trim((string) $data['drop']['name']), 0, 120),
                'drop_address' => isset($data['drop']['address']) ? mb_substr(trim((string) $data['drop']['address']), 0, 255) : null,
                'drop_m' => (int) round($drop['along_m']),
                'price_per_seat' => $l->is_free ? 0 : $l->price_per_seat,
                'is_free' => $l->is_free,
            ]);
            $r->listing_id = $l->id;
            $r->rider_id = $rider->id;
            $r->status = CarpoolRequest::STATUS_PENDING;
            $r->save();

            return $r;
        });

        $this->chat('openDirect', $request);
        $name = $this->present->firstName($this->present->name($rider, 'A rider'));
        $this->notify($listing->driver?->user_id, 'carpool_request_new', "{$name} wants to join",
            $this->seatWord($request->seats) . ' · ' . $this->route($listing) . ', ' . $this->present->when($listing->departs_at),
            $listing, $request, '/carpool/inbox');

        return $request;
    }

    /**
     * A carpool of this rider's own (asked or accepted) that runs at the same time, or null.
     * Only a warning: the rider can ask anyway.
     */
    public function overlapping(User $rider, CarpoolListing $listing): ?CarpoolListing
    {
        $start = $listing->departs_at;
        $end = $listing->departs_at->copy()->addSeconds($listing->duration_s);

        return CarpoolListing::query()
            ->join('carpool_requests', 'carpool_requests.listing_id', '=', 'carpool_listings.id')
            ->where('carpool_requests.rider_id', $rider->id)
            ->whereIn('carpool_requests.status', CarpoolRequest::ACTIVE)
            ->where('carpool_listings.id', '!=', $listing->id)
            ->whereIn('carpool_listings.status', CarpoolListing::LIVE)
            ->where('carpool_listings.departs_at', '<', $end)
            ->whereRaw('DATE_ADD(carpool_listings.departs_at, INTERVAL carpool_listings.duration_s SECOND) > ?', [$start])
            ->select('carpool_listings.*')
            ->first();
    }

    /**
     * Requests stay open while the car is on the road (decided 2026-11-19): the
     * driver knows where they really are. A waiting request closes only once
     * its planned pickup is this many minutes behind the car, so nobody waits
     * at a pickup the car has passed. Runs every few minutes.
     */
    public function expirePassedPickups(): int
    {
        $grace = \App\Models\Carpool\CarpoolSetting::number('pending_expire_minutes');
        $n = 0;
        $waiting = CarpoolRequest::query()->where('status', CarpoolRequest::STATUS_PENDING)
            ->whereHas('listing', fn ($q) => $q->where('status', CarpoolListing::STATUS_IN_PROGRESS))
            ->with('listing.driver.user')->get();
        foreach ($waiting as $r) {
            $l = $r->listing;
            if ($this->present->minutesPastPickup($r, $l) < $grace) {
                continue;
            }
            $closed = DB::transaction(function () use ($r) {
                $row = CarpoolRequest::query()->lockForUpdate()->find($r->id);
                if (! $row || $row->status !== CarpoolRequest::STATUS_PENDING) {
                    return null;
                }
                $row->status = CarpoolRequest::STATUS_CLOSED;
                $row->closed_reason = CarpoolRequest::CLOSED_ENDED;
                $row->ended_at = now();
                $row->save();

                return $row;
            });
            if (! $closed) {
                continue;
            }
            $this->chat('endDirect', $closed);
            $this->notify($closed->rider_id, 'carpool_request_closed', 'The car passed your pickup',
                $this->route($l) . '. ' . $this->driverFirstName($l) . ' did not answer before reaching your pickup. You can find another carpool for this trip.',
                $l, $closed, '/carpool/ride/' . $l->id);
            $n++;
        }

        return $n;
    }

    /** Rider cancels a request the driver hasn't answered (customer 8c). */
    public function withdraw(User $rider, CarpoolRequest $request): CarpoolRequest
    {
        $this->ownedByRider($rider, $request);
        $r = DB::transaction(function () use ($request) {
            $r = CarpoolRequest::query()->lockForUpdate()->findOrFail($request->id);
            if ($r->status !== CarpoolRequest::STATUS_PENDING) {
                $this->fail('This request has already been answered.');
            }
            $r->status = CarpoolRequest::STATUS_WITHDRAWN;
            $r->ended_at = now();
            $r->save();

            return $r;
        });
        $this->chat('endDirect', $r);
        $listing = $r->listing;
        $name = $this->present->firstName($this->present->name($rider, 'A rider'));
        $this->notify($listing->driver?->user_id, 'carpool_request_withdrawn', "{$name} cancelled their request",
            $this->route($listing) . ', ' . $this->present->when($listing->departs_at), $listing, $r, '/carpool/listing/' . $listing->id);

        return $r;
    }

    /** Rider leaves after being accepted, before the ride starts (customer 8h, A7). */
    public function leave(User $rider, CarpoolRequest $request): CarpoolRequest
    {
        $this->ownedByRider($rider, $request);
        $r = DB::transaction(function () use ($request) {
            $l = CarpoolListing::query()->lockForUpdate()->findOrFail($request->listing_id);
            $r = CarpoolRequest::query()->lockForUpdate()->findOrFail($request->id);
            if ($r->status !== CarpoolRequest::STATUS_ACCEPTED) {
                $this->fail("You're not in this carpool.");
            }
            if ($l->status !== CarpoolListing::STATUS_PUBLISHED) {
                $this->fail('The ride has started, so you can no longer leave here.');
            }
            $r->status = CarpoolRequest::STATUS_CANCELLED_BY_RIDER;
            $r->ended_at = now();
            $r->save();
            $this->recount($l);

            return $r;
        });
        $this->chat('endDirect', $r);
        $this->chat('leaveGroup', $r);
        $listing = $r->listing;
        $name = $this->present->firstName($this->present->name($rider, 'A rider'));
        $this->notify($listing->driver?->user_id, 'carpool_rider_left', "{$name} left your carpool",
            ucfirst($this->seatWord($r->seats)) . ($r->seats === 1 ? ' is' : ' are') . ' open again. ' . $this->route($listing) . ', ' . $this->present->when($listing->departs_at),
            $listing, $r, '/carpool/listing/' . $listing->id);

        return $r;
    }

    /**
     * Driver accepts (driver Home 2, Inbox 7). Locks the carpool, recounts the
     * seats already taken and refuses when the request no longer fits, so
     * simultaneous Accepts can't overbook. Gives the rider their 4-digit code.
     */
    public function accept(User $driverUser, CarpoolRequest $request): CarpoolRequest
    {
        $this->ownedByDriver($driverUser, $request);
        [$r, $closed] = DB::transaction(function () use ($request) {
            $l = CarpoolListing::query()->lockForUpdate()->findOrFail($request->listing_id);
            $r = CarpoolRequest::query()->lockForUpdate()->findOrFail($request->id);
            $this->assertPending($r);
            if (! in_array($l->status, CarpoolListing::LIVE, true)) {
                $this->fail('This carpool has ended.');
            }
            $free = $l->seats_total - $this->acceptedSeats($l);
            if ($r->seats > $free) {
                $this->fail($free <= 0 ? 'This carpool is full.' : 'Only ' . $this->seatWord($free) . ' left.');
            }
            $r->status = CarpoolRequest::STATUS_ACCEPTED;
            $r->answered_at = now();
            $r->code = $this->newCode($l);
            $r->save();
            $this->recount($l);

            return [$r, $this->closeUnfitLocked($l)];
        });

        $this->chat('joinGroup', $r);
        $listing = $r->listing;
        $driverName = $this->driverFirstName($listing);
        $this->notify($r->rider_id, 'carpool_request_accepted', "{$driverName} accepted your request",
            $this->route($listing) . ', ' . $this->present->when($listing->departs_at) . '. Your code is on the trip.',
            $listing, $r, '/carpool/ride/' . $listing->id);
        $this->tellFilled($closed, $listing);

        return $r;
    }

    /** Driver declines. No reason is shown to the rider (customer 8k). */
    public function decline(User $driverUser, CarpoolRequest $request): CarpoolRequest
    {
        $this->ownedByDriver($driverUser, $request);
        $r = DB::transaction(function () use ($request) {
            $r = CarpoolRequest::query()->lockForUpdate()->findOrFail($request->id);
            $this->assertPending($r);
            $r->status = CarpoolRequest::STATUS_DECLINED;
            $r->answered_at = now();
            $r->save();

            return $r;
        });
        $this->chat('endDirect', $r);
        $listing = $r->listing;
        $this->notify($r->rider_id, 'carpool_request_declined', $this->driverFirstName($listing) . " couldn't take your request",
            $this->route($listing) . ', ' . $this->present->when($listing->departs_at) . '. You can still find other carpools for this trip.',
            $listing, $r, '/carpool/ride/' . $listing->id);

        return $r;
    }

    /** Driver removes an accepted rider (driver 8d, A8). The seats open again. */
    public function remove(User $driverUser, CarpoolRequest $request): CarpoolRequest
    {
        $this->ownedByDriver($driverUser, $request);
        $r = DB::transaction(function () use ($request) {
            $l = CarpoolListing::query()->lockForUpdate()->findOrFail($request->listing_id);
            $r = CarpoolRequest::query()->lockForUpdate()->findOrFail($request->id);
            if ($r->status !== CarpoolRequest::STATUS_ACCEPTED) {
                $this->fail('This rider is no longer on the carpool.');
            }
            if (! in_array($l->status, CarpoolListing::LIVE, true)) {
                $this->fail('This carpool has ended.');
            }
            if ($r->picked_up_at) {
                $this->fail("This rider is already in the car. Mark them as dropped instead.");
            }
            $r->status = CarpoolRequest::STATUS_REMOVED;
            $r->ended_at = now();
            $r->save();
            $this->recount($l);

            return $r;
        });
        $this->chat('endDirect', $r);
        $this->chat('leaveGroup', $r);
        $listing = $r->listing;
        $this->notify($r->rider_id, 'carpool_rider_removed', $this->driverFirstName($listing) . ' removed you from this carpool',
            $this->route($listing) . ', ' . $this->present->when($listing->departs_at) . '. You can find another carpool for this trip.',
            $listing, $r, '/carpool/ride/' . $listing->id);

        return $r;
    }

    /** The driver's private Paid tick (driver 8b). Riders never see it. */
    public function markPaid(User $driverUser, CarpoolRequest $request, bool $paid): CarpoolRequest
    {
        $this->ownedByDriver($driverUser, $request);
        if ($request->status !== CarpoolRequest::STATUS_ACCEPTED) {
            $this->fail('This rider is no longer on the carpool.');
        }
        $request->paid_marked = $paid;
        $request->save();

        return $request;
    }

    /**
     * Seat count changed outside an Accept (an edit): close waiting requests
     * that can no longer fit and tell those riders.
     */
    public function seatsChanged(CarpoolListing $listing): void
    {
        $closed = DB::transaction(function () use ($listing) {
            $l = CarpoolListing::query()->lockForUpdate()->findOrFail($listing->id);

            return $this->closeUnfitLocked($l);
        });
        $this->tellFilled($closed, $listing);
    }

    /** Riders on a carpool are told when its time or route changes (customer mockup 8i). */
    public function listingChanged(CarpoolListing $listing): void
    {
        $riders = CarpoolRequest::query()->where('listing_id', $listing->id)
            ->whereIn('status', CarpoolRequest::ACTIVE)->get();
        $what = $listing->changed_kind === 'route'
            ? $this->driverFirstName($listing) . ' changed the route'
            : $this->driverFirstName($listing) . ' changed the time to ' . $this->present->when($listing->departs_at);
        foreach ($riders as $r) {
            $this->notify($r->rider_id, 'carpool_changed', $what, $this->route($listing) . '. Open the carpool to see your new pickup time.',
                $listing, $r, '/carpool/ride/' . $listing->id);
        }
    }

    /**
     * The carpool ended without a ride (driver cancel now; plan end, missed
     * departure and admin cancel later). Waiting requests close as "ended" and
     * every rider who asked or is in is told.
     */
    public function listingCancelled(CarpoolListing $listing): void
    {
        $riders = CarpoolRequest::query()->where('listing_id', $listing->id)
            ->whereIn('status', CarpoolRequest::ACTIVE)->get();
        CarpoolRequest::query()->where('listing_id', $listing->id)->where('status', CarpoolRequest::STATUS_PENDING)
            ->update(['status' => CarpoolRequest::STATUS_CLOSED, 'closed_reason' => CarpoolRequest::CLOSED_ENDED, 'ended_at' => now()]);

        $title = match ($listing->cancel_reason) {
            CarpoolListing::CANCEL_PLAN_ENDED => "Carpool cancelled: the driver's plan has ended",
            CarpoolListing::CANCEL_ADMIN => 'Carpool cancelled by Dream Cabs',
            CarpoolListing::CANCEL_MISSED => "Carpool cancelled: it wasn't started",
            default => $this->driverFirstName($listing) . ' cancelled the carpool',
        };
        try {
            app(CarpoolChatService::class)->listingCancelled($listing, 'Cancelled: ' . lcfirst(match ($listing->cancel_reason) {
                CarpoolListing::CANCEL_PLAN_ENDED => "the driver's plan has ended",
                CarpoolListing::CANCEL_ADMIN => 'by Dream Cabs',
                CarpoolListing::CANCEL_MISSED => "it wasn't started",
                default => 'by the driver',
            }));
        } catch (\Throwable $e) {
            Log::warning('Carpool chat cancel line failed', ['listing_id' => $listing->id, 'error' => $e->getMessage()]);
        }
        foreach ($riders as $r) {
            $this->notify($r->rider_id, 'carpool_cancelled', $title,
                $this->route($listing) . ', ' . $this->present->when($listing->departs_at) . '. You can find another carpool for this trip.',
                $listing, $r, '/carpool/ride/' . $listing->id);
        }
    }

    /**
     * Waiting requests on a driver's live carpools, soonest carpool first,
     * oldest request first within it (driver Home and Inbox).
     *
     * @return Collection<int, CarpoolRequest>
     */
    public function pendingFor(Driver $driver): Collection
    {
        return CarpoolRequest::query()->where('carpool_requests.status', CarpoolRequest::STATUS_PENDING)
            ->join('carpool_listings', 'carpool_listings.id', '=', 'carpool_requests.listing_id')
            ->where('carpool_listings.driver_id', $driver->id)
            ->whereIn('carpool_listings.status', CarpoolListing::LIVE)
            ->orderBy('carpool_listings.departs_at')->orderBy('carpool_requests.id')
            ->select('carpool_requests.*')
            ->with(['listing', 'rider'])->get();
    }

    /** seats_taken = the accepted seats, counted from the requests. Call inside a lock. */
    public function recount(CarpoolListing $listing): void
    {
        $listing->seats_taken = $this->acceptedSeats($listing);
        $listing->save();
    }

    private function acceptedSeats(CarpoolListing $l): int
    {
        return (int) CarpoolRequest::query()->where('listing_id', $l->id)
            ->whereIn('status', CarpoolRequest::SEATED)->sum('seats');
    }

    /** @return Collection<int, CarpoolRequest> the requests closed as filled */
    private function closeUnfitLocked(CarpoolListing $l): Collection
    {
        $free = max(0, $l->seats_total - $this->acceptedSeats($l));
        $unfit = CarpoolRequest::query()->where('listing_id', $l->id)
            ->where('status', CarpoolRequest::STATUS_PENDING)->where('seats', '>', $free)->lockForUpdate()->get();
        foreach ($unfit as $r) {
            $r->status = CarpoolRequest::STATUS_CLOSED;
            $r->closed_reason = CarpoolRequest::CLOSED_FILLED;
            $r->ended_at = now();
            $r->save();
        }

        return $unfit;
    }

    /** @param Collection<int, CarpoolRequest> $closed */
    private function tellFilled(Collection $closed, CarpoolListing $listing): void
    {
        foreach ($closed as $r) {
            $this->chat('endDirect', $r);
            $this->notify($r->rider_id, 'carpool_request_closed', 'This carpool filled up',
                $this->route($listing) . ', ' . $this->present->when($listing->departs_at) . '. It filled up before '
                . $this->driverFirstName($listing) . ' answered. You can find another carpool for this trip.',
                $listing, $r, '/carpool/ride/' . $listing->id);
        }
    }

    /** A 4-digit code, different from the other riders' codes on this carpool. */
    private function newCode(CarpoolListing $l): string
    {
        $taken = CarpoolRequest::query()->where('listing_id', $l->id)->where('status', CarpoolRequest::STATUS_ACCEPTED)
            ->whereNotNull('code')->pluck('code')->all();
        do {
            $code = str_pad((string) random_int(0, 9999), 4, '0', STR_PAD_LEFT);
        } while (in_array($code, $taken, true));

        return $code;
    }

    private function assertPending(CarpoolRequest $r): void
    {
        if ($r->status === CarpoolRequest::STATUS_PENDING) {
            return;
        }
        $this->fail(match ($r->status) {
            CarpoolRequest::STATUS_ACCEPTED => 'You already accepted this request.',
            CarpoolRequest::STATUS_DECLINED => 'You already declined this request.',
            CarpoolRequest::STATUS_WITHDRAWN => 'The rider cancelled this request.',
            default => 'This request has closed.',
        });
    }

    private function ownedByRider(User $rider, CarpoolRequest $r): void
    {
        if ((int) $r->rider_id !== (int) $rider->id) {
            abort(404);
        }
    }

    private function ownedByDriver(User $driverUser, CarpoolRequest $r): void
    {
        if ((int) $r->listing?->driver?->user_id !== (int) $driverUser->id) {
            abort(404);
        }
    }

    private function driverFirstName(CarpoolListing $l): string
    {
        return $this->present->firstName($this->present->name($l->driver?->user, 'The driver'));
    }

    private function route(CarpoolListing $l): string
    {
        return "{$l->start_name} to {$l->end_name}";
    }

    private function seatWord(int $n): string
    {
        return $n . ' ' . ($n === 1 ? 'seat' : 'seats');
    }

    /** In-app notification and push (P10). Never breaks the action that caused it. */
    private function notify(?int $userId, string $type, string $title, string $body, CarpoolListing $l, CarpoolRequest $r, string $link): void
    {
        try {
            $this->notes->notifyUserId($userId, $type, $title, $body, [
                'listing_id' => $l->id, 'request_id' => $r->id, 'link' => $link,
            ]);
        } catch (\Throwable $e) {
            Log::warning('Carpool notification failed', ['type' => $type, 'request_id' => $r->id, 'error' => $e->getMessage()]);
        }
    }

    /** Chat bookkeeping never breaks the action that caused it. */
    private function chat(string $method, CarpoolRequest $r): void
    {
        try {
            app(CarpoolChatService::class)->{$method}($r);
        } catch (\Throwable $e) {
            Log::warning('Carpool chat update failed', ['method' => $method, 'request_id' => $r->id, 'error' => $e->getMessage()]);
        }
    }

    private function fail(string $message, string $field = 'request'): never
    {
        throw ValidationException::withMessages([$field => $message]);
    }
}
