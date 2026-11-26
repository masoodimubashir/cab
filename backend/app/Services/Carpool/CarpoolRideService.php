<?php

namespace App\Services\Carpool;

use App\Models\Carpool\CarpoolListing;
use App\Models\Carpool\CarpoolRating;
use App\Models\Carpool\CarpoolRequest;
use App\Models\Carpool\CarpoolSetting;
use App\Models\DriverSubscription;
use App\Models\SubscriptionPlan;
use App\Models\User;
use App\Services\NotificationCenter;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;

/**
 * The ride itself (M6, Carpool.md "Ride status", P8, P11): Start ride, the
 * code check at each pickup, picked up, dropped, no-show, Complete ride, the
 * two scheduled clean-ups and the rider's rating of the driver.
 *
 * The rider code is mandatory (decided 2026-11-13): a rider can't be marked
 * picked up until their own code was checked on this carpool.
 */
class CarpoolRideService
{
    public function __construct(
        private CarpoolListingService $listings,
        private CarpoolRequestService $requests,
        private CarpoolPresenter $present,
        private NotificationCenter $notes,
    ) {
    }

    /** Driver taps Start ride: the carpool is on the road (customer 8e). Needs no rider codes. */
    public function start(User $user, CarpoolListing $listing): CarpoolListing
    {
        $this->listings->owned($user, $listing);
        $early = CarpoolSetting::number('start_early_minutes');
        $l = DB::transaction(function () use ($listing, $early) {
            $l = CarpoolListing::query()->lockForUpdate()->findOrFail($listing->id);
            if ($l->status !== CarpoolListing::STATUS_PUBLISHED) {
                $this->fail($l->status === CarpoolListing::STATUS_IN_PROGRESS ? 'This ride has already started.' : 'This carpool has ended.');
            }
            if (now()->lt($l->departs_at->copy()->subMinutes($early))) {
                $this->fail("You can start the ride {$early} minutes before it leaves.");
            }
            $busy = CarpoolListing::query()->where('driver_id', $l->driver_id)
                ->where('status', CarpoolListing::STATUS_IN_PROGRESS)->exists();
            if ($busy) {
                $this->fail('Finish the ride that is on the road first.');
            }
            $l->status = CarpoolListing::STATUS_IN_PROGRESS;
            $l->started_at = now();
            $l->save();

            return $l;
        });

        $driver = $this->present->firstName($this->present->name($l->driver?->user, 'The driver'));
        foreach ($this->accepted($l) as $r) {
            $this->notify($r->rider_id, 'carpool_started', "{$driver} has started the ride",
                $this->route($l) . '. Keep your code ready for pickup.', $l, $r);
        }

        return $l;
    }

    /**
     * Check a rider's code at their own pickup (driver 11, 11b). A wrong code
     * counts a try; after the allowed tries checking locks for a while, to stop
     * guessing a 4-digit code (proposed in the mockup).
     *
     * @return array{ok: bool, tries_left: int, locked_until: ?string}
     */
    public function checkCode(User $user, CarpoolRequest $request, string $code): array
    {
        $this->ownedByDriver($user, $request);
        $max = (int) config('carpool.code_max_attempts', 3);
        $lockMin = (int) config('carpool.code_lock_minutes', 5);

        return DB::transaction(function () use ($request, $code, $max, $lockMin) {
            $r = CarpoolRequest::query()->lockForUpdate()->findOrFail($request->id);
            $this->assertWaiting($r);
            if ($r->code_verified_at) {
                return ['ok' => true, 'tries_left' => $max, 'locked_until' => null];
            }
            if ($r->code_locked_until && $r->code_locked_until->isFuture()) {
                $msg = 'Too many wrong codes. Try again at ' . CarpoolClock::local($r->code_locked_until)->format('g:i A') . '.';
                // Same 422 shape as before, plus the lock end, so the app never has to guess how long the lock is.
                throw new \Illuminate\Http\Exceptions\HttpResponseException(response()->json([
                    'message' => $msg,
                    'errors' => ['code' => [$msg]],
                    'locked_until' => $r->code_locked_until->toIso8601String(),
                ], 422));
            }
            if (hash_equals((string) $r->code, $code)) {
                $r->code_verified_at = now();
                $r->code_attempts = 0;
                $r->code_locked_until = null;
                $r->save();

                return ['ok' => true, 'tries_left' => $max, 'locked_until' => null];
            }
            // A lock that has run out starts a fresh set of tries.
            $before = $r->code_locked_until ? 0 : $r->code_attempts;
            $r->code_attempts = $before + 1;
            $left = max(0, $max - $r->code_attempts);
            $r->code_locked_until = $left === 0 ? now()->addMinutes($lockMin) : null;
            $r->save();

            return ['ok' => false, 'tries_left' => $left, 'locked_until' => $r->code_locked_until?->toIso8601String()];
        });
    }

    /** "Mark as picked up": only after the code matched (driver 11). */
    public function pickUp(User $user, CarpoolRequest $request): CarpoolRequest
    {
        $this->ownedByDriver($user, $request);
        $r = DB::transaction(function () use ($request) {
            $r = CarpoolRequest::query()->lockForUpdate()->findOrFail($request->id);
            $this->assertWaiting($r);
            if (! $r->code_verified_at) {
                $this->fail("Check the rider's code first. Without it they can't be marked as picked up.", 'code');
            }
            $r->picked_up_at = now();
            $r->save();

            return $r;
        });
        $l = $r->listing;
        $this->notify($r->rider_id, 'carpool_picked_up', "You're picked up", "Enjoy the ride to {$l->end_name}.", $l, $r);

        return $r;
    }

    /** "Mark as dropped" (driver 12). The seat stays counted until the ride ends. */
    public function drop(User $user, CarpoolRequest $request): CarpoolRequest
    {
        $this->ownedByDriver($user, $request);
        $r = DB::transaction(function () use ($request) {
            $l = CarpoolListing::query()->lockForUpdate()->findOrFail($request->listing_id);
            $r = CarpoolRequest::query()->lockForUpdate()->findOrFail($request->id);
            if ($l->status !== CarpoolListing::STATUS_IN_PROGRESS) {
                $this->fail('The ride is not on the road.');
            }
            if ($r->status !== CarpoolRequest::STATUS_ACCEPTED || ! $r->picked_up_at) {
                $this->fail('This rider is not in the car.');
            }
            $r->status = CarpoolRequest::STATUS_COMPLETED;
            $r->dropped_at = now();
            $r->ended_at = now();
            $r->save();

            return $r;
        });
        $l = $r->listing;
        $driver = $this->present->firstName($this->present->name($l->driver?->user, 'your driver'));
        $this->notify($r->rider_id, 'carpool_dropped', "You've arrived", "How was your ride with {$driver}? Tap to rate.", $l, $r);

        return $r;
    }

    /** "Mark as no-show" (driver 13): the rider is told and taken off this ride. No penalty (A13). */
    public function noShow(User $user, CarpoolRequest $request): CarpoolRequest
    {
        $this->ownedByDriver($user, $request);
        $r = DB::transaction(function () use ($request) {
            $l = CarpoolListing::query()->lockForUpdate()->findOrFail($request->listing_id);
            $r = CarpoolRequest::query()->lockForUpdate()->findOrFail($request->id);
            $this->assertWaiting($r);
            // L1.4: while the location is shared, No-show opens only after the wait at the pickup.
            app(CarpoolTracking::class)->assertNoShowOpen($r);
            $r->status = CarpoolRequest::STATUS_NO_SHOW;
            $r->no_show_at = now();
            $r->ended_at = now();
            $r->save();
            $this->requests->recount($l);

            return $r;
        });
        $this->chatOp('endDirect', $r);
        $this->chatOp('leaveGroup', $r);
        $l = $r->listing;
        $driver = $this->present->firstName($this->present->name($l->driver?->user, 'The driver'));
        $this->notify($r->rider_id, 'carpool_no_show', "{$driver} marked you as a no-show",
            $this->route($l) . '. The driver reached your pickup and left.', $l, $r);

        return $r;
    }

    /** "Complete ride" unlocks once every rider is dropped or marked no-show (driver 9, 13b). */
    public function complete(User $user, CarpoolListing $listing): CarpoolListing
    {
        $this->listings->owned($user, $listing);
        $l = DB::transaction(function () use ($listing) {
            $l = CarpoolListing::query()->lockForUpdate()->findOrFail($listing->id);
            if ($l->status !== CarpoolListing::STATUS_IN_PROGRESS) {
                $this->fail('This ride is not on the road.');
            }
            if ($this->accepted($l)->count() > 0) {
                $this->fail('Every rider must be dropped or marked as no-show first.');
            }

            return $this->finish($l, 'driver');
        });
        $this->afterFinish($l);

        return $l;
    }

    /**
     * Scheduled: rides started more than the setting's hours ago and never
     * completed finish by themselves (A11). Riders still waiting count as
     * no-shows, riders in the car as dropped.
     */
    public function autoComplete(): int
    {
        $hours = max(1, (int) CarpoolSetting::current()->auto_complete_hours);
        $due = CarpoolListing::query()->where('status', CarpoolListing::STATUS_IN_PROGRESS)
            ->where('started_at', '<=', now()->subHours($hours))->pluck('id');
        $n = 0;
        foreach ($due as $id) {
            if ($this->endNow((int) $id, 'auto')) {
                $n++;
            }
        }

        return $n;
    }

    /**
     * Ends a carpool that is on the road, now (auto-complete, or an admin's "End this ride").
     * Riders already in the car count as dropped; riders the driver never picked up are closed as
     * "not confirmed" (status no_show, closed_reason not_confirmed), so they are not confused with a
     * no-show the driver tapped himself (Admin-Audit.md B-05). Returns the listing, or null if it was
     * not on the road any more.
     */
    public function endNow(int $listingId, string $by): ?CarpoolListing
    {
        $closed = collect();
        $l = DB::transaction(function () use ($listingId, $by, &$closed) {
            $l = CarpoolListing::query()->lockForUpdate()->find($listingId);
            if (! $l || $l->status !== CarpoolListing::STATUS_IN_PROGRESS) {
                return null;
            }
            foreach ($this->accepted($l) as $r) {
                if ($r->picked_up_at) {
                    $r->status = CarpoolRequest::STATUS_COMPLETED;
                    $r->dropped_at = now();
                } else {
                    $r->status = CarpoolRequest::STATUS_NO_SHOW;
                    $r->no_show_at = now();
                    $r->closed_reason = CarpoolRequest::CLOSED_NOT_CONFIRMED;
                }
                $r->ended_at = now();
                $r->save();
                $closed->push($r);
            }

            return $this->finish($l, $by);
        });
        if (! $l) {
            return null;
        }
        $this->afterFinish($l);
        $driver = $this->present->firstName($this->present->name($l->driver?->user, 'your driver'));
        foreach ($closed as $r) {
            if ($r->status === CarpoolRequest::STATUS_COMPLETED) {
                $this->notify($r->rider_id, 'carpool_dropped', 'Your ride has ended', "How was your ride with {$driver}? Tap to rate.", $l, $r);
            } else {
                $this->notify($r->rider_id, 'carpool_no_show', 'Your carpool has ended',
                    $this->route($l) . ". The driver didn't confirm your pickup.", $l, $r);
            }
        }

        return $l;
    }

    /**
     * Scheduled: a carpool not started by the end of its departure day is cancelled (A10). The admin can
     * give one more day (missed_departure_days = 1): then it is cancelled at the end of the next day.
     */
    public function cancelMissed(): int
    {
        $days = CarpoolSetting::missedDepartureDays();
        // Anything departing before the start of (today minus the extra days) has run out of time.
        $before = CarpoolClock::startOfDay(CarbonImmutable::parse(CarpoolClock::today())->subDays($days)->toDateString());
        $due = CarpoolListing::query()->where('status', CarpoolListing::STATUS_PUBLISHED)
            ->where('departs_at', '<', $before)->pluck('id');

        return $this->cancelListings($due, CarpoolListing::CANCEL_MISSED);
    }

    /**
     * Scheduled grace rule (A16): once a driver's last plan has run out,
     * carpools departing later than the end of the day after it are cancelled
     * ("plan ended"). They don't come back when the driver renews. A running
     * or waiting plan means nothing to do.
     */
    /**
     * S11 (D-12, choice B1): once a driver's last valid document day is over, their published carpools departing
     * after that day are cancelled. Carpools up to that day and carpools on the road are left alone.
     */
    public function applyDocuments(): int
    {
        $due = collect();
        foreach (app(CarpoolDocuments::class)->overdueDrivers() as $driverId => $limit) {
            $cutoff = CarpoolClock::endOfDay($limit['valid_until']);
            $ids = CarpoolListing::query()->where('driver_id', $driverId)->where('status', CarpoolListing::STATUS_PUBLISHED)
                ->where('departs_at', '>', $cutoff)->pluck('id');
            foreach ($ids as $id) {
                $due->push($id);
                $this->documentNames[$id] = $limit['name'];
            }
        }

        return $this->cancelListings($due, CarpoolListing::CANCEL_DOCUMENTS);
    }

    /** @var array<int, string> listing id => document name, for the driver's cancel message */
    private array $documentNames = [];

    public function applyGrace(): int
    {
        $due = collect();
        $plans = app(CarpoolPlanService::class);
        $byDriver = CarpoolListing::query()->where('status', CarpoolListing::STATUS_PUBLISHED)
            ->with('driver')->get()->groupBy('driver_id');
        foreach ($byDriver as $rows) {
            $user = $rows->first()->driver?->user;
            if (! $user || $plans->activePlan($user) || $plans->queuedPlan($user)) {
                continue;
            }
            $last = DriverSubscription::query()->where('driver_user_id', $user->id)
                ->where('status', '!=', DriverSubscription::STATUS_CANCELLED)
                ->whereHas('plan', fn ($p) => $p->where('audience', SubscriptionPlan::AUDIENCE_CARPOOL))
                ->max('expires_at');
            if (! $last) {
                continue;
            }
            $lastDay = CarpoolClock::dateOf(CarbonImmutable::parse($last));
            $cutoff = CarpoolClock::endOfDay(CarbonImmutable::parse($lastDay, CarpoolClock::timezone())->addDays(CarpoolSetting::number('plan_grace_days'))->toDateString());
            foreach ($rows as $l) {
                if ($l->departs_at->gt($cutoff)) {
                    $due->push($l->id);
                }
            }
        }

        return $this->cancelListings($due, CarpoolListing::CANCEL_PLAN_ENDED);
    }

    /**
     * A rider's rating of the driver (customer 8g). Once per ride, only by a
     * rider who was dropped off (P11: a no-show can't rate).
     */
    public function rateDriver(User $rider, CarpoolListing $listing, int $score, ?string $comment): CarpoolRating
    {
        $r = CarpoolRequest::query()->where('listing_id', $listing->id)->where('rider_id', $rider->id)
            ->where('status', CarpoolRequest::STATUS_COMPLETED)->whereNotNull('dropped_at')->first();
        if (! $r) {
            $this->fail('You can rate a driver after you were dropped off.', 'score');
        }
        $driverUserId = (int) $listing->driver?->user_id;
        if (CarpoolRating::query()->where('listing_id', $listing->id)->where('rater_id', $rider->id)->where('rated_id', $driverUserId)->exists()) {
            $this->fail("You've already rated this ride.", 'score');
        }
        $rating = new CarpoolRating(['score' => $score, 'comment' => $comment !== null && trim($comment) !== '' ? trim($comment) : null]);
        $rating->listing_id = $listing->id;
        $rating->rater_id = $rider->id;
        $rating->rated_id = $driverUserId;
        $rating->save();

        return $rating;
    }

    // ---- Internals ----

    private function finish(CarpoolListing $l, string $by): CarpoolListing
    {
        $rode = CarpoolRequest::query()->where('listing_id', $l->id)->where('status', CarpoolRequest::STATUS_COMPLETED)->exists();
        $l->status = CarpoolListing::STATUS_COMPLETED;
        $l->completed_at = now();
        $l->completed_by = $by;
        $l->counts_as_ride = $rode; // A15: a carpool with no riders isn't a ride
        $l->accepting_requests = false;
        $l->save();
        CarpoolRequest::query()->where('listing_id', $l->id)->where('status', CarpoolRequest::STATUS_PENDING)
            ->update(['status' => CarpoolRequest::STATUS_CLOSED, 'closed_reason' => CarpoolRequest::CLOSED_ENDED, 'ended_at' => now()]);

        return $l;
    }

    private function afterFinish(CarpoolListing $l): void
    {
        try {
            app(CarpoolChatService::class)->listingCancelled($l, 'This carpool has ended.');
        } catch (\Throwable $e) {
            Log::warning('Carpool chat end line failed', ['listing_id' => $l->id, 'error' => $e->getMessage()]);
        }
    }

    /** @param Collection<int, int> $ids */
    private function cancelListings(Collection $ids, string $reason): int
    {
        $n = 0;
        foreach ($ids as $id) {
            $l = DB::transaction(function () use ($id, $reason) {
                $l = CarpoolListing::query()->lockForUpdate()->find($id);
                if (! $l || $l->status !== CarpoolListing::STATUS_PUBLISHED) {
                    return null;
                }
                $l->status = CarpoolListing::STATUS_CANCELLED;
                $l->cancel_reason = $reason;
                $l->cancelled_at = now();
                $l->accepting_requests = false;
                $l->save();

                return $l;
            });
            if ($l) {
                $this->requests->listingCancelled($l);
                $why = match ($reason) {
                    CarpoolListing::CANCEL_MISSED => " It wasn't started in time.",
                    CarpoolListing::CANCEL_DOCUMENTS => ' Your ' . ($this->documentNames[$l->id] ?? 'document') . ' has expired. Renew it in the app.',
                    default => ' Your plan has ended.',
                };
                $this->notify($l->driver?->user_id, 'carpool_cancelled', 'Your carpool was cancelled',
                    $this->route($l) . ', ' . $this->present->when($l->departs_at) . '.' . $why, $l, null);
                $n++;
            }
        }

        return $n;
    }

    /** @return Collection<int, CarpoolRequest> riders still to be dropped or marked no-show */
    private function accepted(CarpoolListing $l): Collection
    {
        return CarpoolRequest::query()->where('listing_id', $l->id)->where('status', CarpoolRequest::STATUS_ACCEPTED)->get();
    }

    /** A rider still waiting at their pickup, on a ride that is on the road. */
    private function assertWaiting(CarpoolRequest $r): void
    {
        if ($r->listing?->status !== CarpoolListing::STATUS_IN_PROGRESS) {
            $this->fail('Start the ride first.');
        }
        if ($r->status !== CarpoolRequest::STATUS_ACCEPTED || $r->picked_up_at) {
            $this->fail('This rider is no longer waiting.');
        }
    }

    private function ownedByDriver(User $driverUser, CarpoolRequest $r): void
    {
        if ((int) $r->listing?->driver?->user_id !== (int) $driverUser->id) {
            abort(404);
        }
    }

    private function route(CarpoolListing $l): string
    {
        return "{$l->start_name} to {$l->end_name}";
    }

    private function notify(?int $userId, string $type, string $title, string $body, CarpoolListing $l, ?CarpoolRequest $r): void
    {
        try {
            $this->notes->notifyUserId($userId, $type, $title, $body, array_filter([
                'listing_id' => $l->id, 'request_id' => $r?->id,
                'link' => $r ? '/carpool/ride/' . $l->id : '/carpool/listing/' . $l->id,
            ]));
        } catch (\Throwable $e) {
            Log::warning('Carpool notification failed', ['type' => $type, 'listing_id' => $l->id, 'error' => $e->getMessage()]);
        }
    }

    private function chatOp(string $method, CarpoolRequest $r): void
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
