<?php

namespace App\Services\Carpool;

use App\Models\Carpool\CarpoolListing;
use App\Models\Carpool\CarpoolMessage;
use App\Models\Carpool\CarpoolReport;
use App\Models\Carpool\CarpoolRequest;
use App\Models\Carpool\CarpoolVehicle;
use App\Models\Driver;
use App\Models\User;
use App\Services\NotificationCenter;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;

/**
 * What an admin can do to carpools (Carpool.md section 10, M7): cancel a
 * carpool, ban and restore a person, act on a report. Every action here is
 * the one place that ends the state in question, so the apps never need a
 * separate path for "cancelled by Dream Cabs".
 */
class CarpoolAdminService
{
    public function __construct(
        private CarpoolRequestService $requests,
        private CarpoolChatService $chat,
        private NotificationCenter $notes,
    ) {
    }

    /** Cancel one carpool that has not started (A32). Riders and the driver are told "Cancelled by Dream Cabs". */
    public function cancelListing(CarpoolListing $listing, ?string $note): CarpoolListing
    {
        if ($listing->status !== CarpoolListing::STATUS_PUBLISHED) {
            $this->fail($listing->status === CarpoolListing::STATUS_IN_PROGRESS
                ? 'A carpool that is on the road cannot be cancelled here.'
                : 'This carpool has already ended.');
        }
        $this->cancelLocked($listing, $note);
        CarpoolAdminLog::record('cancel_listing', 'listing', $listing->id, [
            'listing_id' => $listing->id, 'subject_user_id' => $listing->driver?->user_id, 'note' => $note,
        ]);

        return $listing->fresh();
    }

    /**
     * Cancels every carpool of this driver that has not started (A30: block,
     * deactivate, delete and ban). Carpools on the road are left alone.
     */
    public function cancelUpcomingOf(Driver $driver, ?string $note = null): int
    {
        $n = 0;
        CarpoolListing::query()->where('driver_id', $driver->id)->where('status', CarpoolListing::STATUS_PUBLISHED)
            ->get()->each(function (CarpoolListing $l) use ($note, &$n) {
                $this->cancelLocked($l, $note);
                $n++;
            });

        return $n;
    }

    private function cancelLocked(CarpoolListing $listing, ?string $note): void
    {
        $done = DB::transaction(function () use ($listing, $note) {
            $l = CarpoolListing::query()->lockForUpdate()->find($listing->id);
            if (! $l || $l->status !== CarpoolListing::STATUS_PUBLISHED) {
                return null;
            }
            $l->status = CarpoolListing::STATUS_CANCELLED;
            $l->cancel_reason = CarpoolListing::CANCEL_ADMIN;
            $l->cancel_note = $note !== null && trim($note) !== '' ? trim($note) : null;
            $l->cancelled_at = now();
            $l->accepting_requests = false;
            $l->save();

            return $l;
        });
        if (! $done) {
            return;
        }
        $this->requests->listingCancelled($done);
        $this->tell($done->driver?->user_id, 'carpool_cancelled', 'Your carpool was cancelled by Dream Cabs',
            $done->start_name . ' to ' . $done->end_name . '.', $done);
    }

    /** What a ban would do, shown first in the confirm dialog. */
    public function banImpact(User $user): array
    {
        $driver = $this->driverOf($user);
        $upcoming = $driver ? CarpoolListing::query()->where('driver_id', $driver->id)->where('status', CarpoolListing::STATUS_PUBLISHED) : null;
        $riders = $upcoming
            ? CarpoolRequest::query()->whereIn('listing_id', (clone $upcoming)->select('id'))->whereIn('status', CarpoolRequest::ACTIVE)->count()
            : 0;
        $mine = CarpoolRequest::query()->where('rider_id', $user->id)->whereHas('listing', fn ($q) => $q->where('status', CarpoolListing::STATUS_PUBLISHED));

        return [
            'is_driver' => (bool) $driver,
            'upcoming_carpools' => $upcoming ? $upcoming->count() : 0,
            'riders_told' => $riders,
            'rider_seats' => (clone $mine)->where('status', CarpoolRequest::STATUS_ACCEPTED)->count(),
            'rider_pending' => (clone $mine)->where('status', CarpoolRequest::STATUS_PENDING)->count(),
        ];
    }

    /**
     * Pause carpool access (A31): upcoming carpools of a driver are cancelled;
     * a rider is removed from the carpools they are in and their waiting
     * requests end. Carpools already on the road are not touched. Normal rides
     * are not affected.
     */
    public function ban(User $user, string $note, bool $cancelUpcoming = true): array
    {
        $impact = $this->banImpact($user);
        DB::transaction(function () use ($user, $note) {
            $user->carpool_banned_at = $user->carpool_banned_at ?? now();
            $user->carpool_ban_reason = mb_substr($note, 0, 255);
            $user->save();
            CarpoolAccess::rememberNumber($user); // so a deleted-and-returned account stays paused (B-02)
        });
        if ($cancelUpcoming) {
            if ($driver = $this->driverOf($user)) {
                $this->cancelUpcomingOf($driver);
            }
            $this->endRiderSide($user);
        }
        // A pause is about the person, so it applies in every city; the log says which cities the admin manages (F29-1).
        CarpoolAdminLog::record('ban', 'user', $user->id, ['subject_user_id' => $user->id, 'note' => $note, 'after' => $impact + ['admin_cities' => CarpoolAdminScope::cities() ?? 'all', 'cancelled_upcoming' => $cancelUpcoming]]);

        return $impact;
    }

    /** Ends what a person has open before their account is anonymised: upcoming carpools as driver, upcoming seats as rider. */
    public function closeOpenCarpoolsOf(User $user): void
    {
        if ($driver = $this->driverOf($user)) {
            $this->cancelUpcomingOf($driver);
        }
        $this->endRiderSide($user);
    }

    /** Clears the ban. It does not bring back cancelled carpools or seats. The old reason stays in the log. */
    public function restore(User $user, ?string $note = null): void
    {
        $numberCleared = CarpoolAccess::forgetNumber($user);
        if (! $user->carpool_banned_at) {
            if ($numberCleared) {
                CarpoolAdminLog::record('restore', 'user', $user->id, ['subject_user_id' => $user->id, 'note' => $note, 'before' => ['phone_on_paused_list' => true]]);
            }

            return; // Nothing else to restore (a double click, or two admins): no change and no false history line.
        }
        $before = ['banned_at' => $user->carpool_banned_at?->toIso8601String(), 'reason' => $user->carpool_ban_reason];
        $user->carpool_banned_at = null;
        $user->carpool_ban_reason = null;
        $user->save();
        CarpoolAdminLog::record('restore', 'user', $user->id, ['subject_user_id' => $user->id, 'note' => $note, 'before' => $before]);
    }

    private function endRiderSide(User $user): void
    {
        CarpoolRequest::query()->where('rider_id', $user->id)->whereIn('status', CarpoolRequest::ACTIVE)
            ->whereHas('listing', fn ($q) => $q->where('status', CarpoolListing::STATUS_PUBLISHED))
            ->get()->each(function (CarpoolRequest $r) {
                $wasAccepted = DB::transaction(function () use ($r) {
                    $l = CarpoolListing::query()->lockForUpdate()->find($r->listing_id);
                    $row = CarpoolRequest::query()->lockForUpdate()->find($r->id);
                    if (! $l || ! $row || ! in_array($row->status, CarpoolRequest::ACTIVE, true) || $l->status !== CarpoolListing::STATUS_PUBLISHED) {
                        return null;
                    }
                    $was = $row->status === CarpoolRequest::STATUS_ACCEPTED;
                    $row->status = $was ? CarpoolRequest::STATUS_REMOVED : CarpoolRequest::STATUS_WITHDRAWN;
                    $row->ended_at = now();
                    $row->save();
                    $this->requests->recount($l);

                    return $was ? 'accepted' : 'pending';
                });
                if (! $wasAccepted) {
                    return;
                }
                foreach (['endDirect', 'leaveGroup'] as $m) {
                    try {
                        $this->chat->{$m}($r->fresh());
                    } catch (\Throwable $e) {
                        Log::warning('Carpool ban chat update failed', ['request_id' => $r->id, 'error' => $e->getMessage()]);
                    }
                }
                $l = $r->listing;
                $this->tell($l->driver?->user_id, $wasAccepted === 'accepted' ? 'carpool_rider_left' : 'carpool_request_withdrawn',
                    $wasAccepted === 'accepted' ? 'A rider left your carpool' : 'A request was cancelled',
                    $l->start_name . ' to ' . $l->end_name . '.', $l, $r);
            });
    }

    // ---- Reports ----

    /** Removes a reported message for good: chat shows "removed by Dream Cabs". Open reports only. */
    public function removeMessage(CarpoolReport $report): CarpoolReport
    {
        if (! $report->message_id && $report->message_text === null) {
            $this->fail('Only message reports have a message to remove.');
        }
        if ($report->status !== 'open') {
            $this->fail('This report is already closed.');
        }
        if ($report->removed_at) {
            return $report;
        }
        $msg = $report->message_id ? CarpoolMessage::query()->find($report->message_id) : null;
        if (! $msg) {
            // The chat was already deleted by the retention rule: nothing left to remove (Admin-Audit.md B-06).
            $this->fail('This message is no longer in the chat (old chats are deleted automatically). Nothing to remove.');
        }
        $msg->moderation_status = 'removed';
        $msg->moderation_reason = 'admin';
        $msg->save();
        $report->removed_at = now();
        $report->save();
        CarpoolAdminLog::record('remove_message', 'report', $report->id, [
            'subject_user_id' => $report->reported_user_id, 'listing_id' => $report->listing_id,
        ]);

        return $report;
    }

    /**
     * What closing records when the admin doesn't choose: Actioned when this report's message was
     * removed, or the person was banned after this report came in; otherwise Dismissed. A ban from
     * before the report doesn't count (Admin-Audit.md B-06).
     */
    public function suggestedOutcome(CarpoolReport $report): string
    {
        $bannedAt = User::query()->whereKey($report->reported_user_id)->value('carpool_banned_at');
        $bannedSince = $bannedAt && \Illuminate\Support\Carbon::parse($bannedAt)->greaterThanOrEqualTo($report->created_at);

        return ($report->removed_at || $bannedSince) ? 'actioned' : 'dismissed';
    }

    /** Closes a report as Actioned or Dismissed (the admin's choice, or the suggestion above). */
    public function closeReport(CarpoolReport $report, ?string $note, ?string $outcome = null): CarpoolReport
    {
        if ($report->status !== 'open') {
            $this->fail('This report is already closed.');
        }
        $report->status = in_array($outcome, ['actioned', 'dismissed'], true) ? $outcome : $this->suggestedOutcome($report);
        $report->note = $note !== null && trim($note) !== '' ? trim($note) : null;
        $report->save();
        CarpoolAdminLog::record('close_report', 'report', $report->id, [
            'subject_user_id' => $report->reported_user_id, 'listing_id' => $report->listing_id,
            'note' => $report->note, 'after' => ['outcome' => $report->status],
        ]);

        return $report;
    }

    // ---- Fixing stuck states (Admin-Audit.md E-03) ----

    /** Ends a carpool that is on the road now, like auto-complete does. */
    public function endRide(CarpoolListing $listing, string $note): CarpoolListing
    {
        if ($listing->status !== CarpoolListing::STATUS_IN_PROGRESS) {
            $this->fail('Only a carpool on the road can be ended.');
        }
        $done = app(CarpoolRideService::class)->endNow($listing->id, 'admin');
        if (! $done) {
            $this->fail('This carpool is not on the road any more.');
        }
        CarpoolAdminLog::record('end_ride', 'listing', $listing->id, [
            'listing_id' => $listing->id, 'subject_user_id' => $listing->driver?->user_id, 'note' => $note,
        ]);

        return $done->fresh();
    }

    /** Takes a rider off a carpool that hasn't finished: a seat they hold (not yet in the car) or a waiting request. */
    public function removeRider(CarpoolRequest $request, string $note): CarpoolRequest
    {
        $before = $request->status;
        $r = DB::transaction(function () use ($request) {
            $l = CarpoolListing::query()->lockForUpdate()->findOrFail($request->listing_id);
            $r = CarpoolRequest::query()->lockForUpdate()->findOrFail($request->id);
            if (! in_array($l->status, CarpoolListing::LIVE, true)) {
                $this->fail('This carpool has ended.');
            }
            if (! in_array($r->status, CarpoolRequest::ACTIVE, true)) {
                $this->fail('This rider is no longer on the carpool.');
            }
            if ($r->picked_up_at) {
                $this->fail('This rider is already in the car.');
            }
            $r->status = $r->status === CarpoolRequest::STATUS_ACCEPTED ? CarpoolRequest::STATUS_REMOVED : CarpoolRequest::STATUS_DECLINED;
            $r->closed_reason = CarpoolRequest::CLOSED_ADMIN;
            $r->ended_at = now();
            $r->save();
            $this->requests->recount($l);

            return $r;
        });
        if ($before === CarpoolRequest::STATUS_ACCEPTED) {
            foreach (['endDirect', 'leaveGroup'] as $m) {
                try {
                    $this->chat->{$m}($r->fresh());
                } catch (\Throwable $e) {
                    Log::warning('Carpool admin remove: chat update failed', ['request_id' => $r->id, 'error' => $e->getMessage()]);
                }
            }
        }
        $l = $r->listing;
        $this->tell($r->rider_id, 'carpool_rider_removed', 'You were removed from a carpool',
            $l->start_name . ' to ' . $l->end_name . '. Dream Cabs removed you. You can find another carpool for this trip.', $l, $r);
        $this->tell($l->driver?->user_id, 'carpool_rider_left', 'A rider was removed from your carpool',
            $l->start_name . ' to ' . $l->end_name . '. Removed by Dream Cabs.', $l, $r);
        CarpoolAdminLog::record('remove_rider', 'request', $r->id, [
            'listing_id' => $l->id, 'subject_user_id' => $r->rider_id, 'note' => $note,
            'before' => ['status' => $before], 'after' => ['status' => $r->status],
        ]);

        return $r;
    }

    /** After a carpool has finished: set a rider's outcome to Completed or No-show. */
    public function correctOutcome(CarpoolRequest $request, string $outcome, string $note): CarpoolRequest
    {
        if (! in_array($outcome, [CarpoolRequest::STATUS_COMPLETED, CarpoolRequest::STATUS_NO_SHOW], true)) {
            $this->fail('Choose Completed or No-show.');
        }
        $before = null;
        $r = DB::transaction(function () use ($request, $outcome, &$before) {
            $r = CarpoolRequest::query()->lockForUpdate()->findOrFail($request->id);
            $l = CarpoolListing::query()->lockForUpdate()->findOrFail($r->listing_id);
            if ($l->status !== CarpoolListing::STATUS_COMPLETED) {
                $this->fail('Outcomes can be corrected only after the carpool has finished.');
            }
            if (! in_array($r->status, [CarpoolRequest::STATUS_COMPLETED, CarpoolRequest::STATUS_NO_SHOW], true)) {
                $this->fail('Only riders who were on the carpool have an outcome.');
            }
            $before = ['status' => $r->status, 'closed_reason' => $r->closed_reason];
            if ($r->status === $outcome) {
                return $r;
            }
            $r->status = $outcome;
            $r->closed_reason = CarpoolRequest::CLOSED_ADMIN;
            if ($outcome === CarpoolRequest::STATUS_COMPLETED) {
                $r->picked_up_at = $r->picked_up_at ?? $l->started_at ?? now();
                $r->dropped_at = $r->dropped_at ?? $l->completed_at ?? now();
                $r->no_show_at = null;
            } else {
                $r->no_show_at = $r->no_show_at ?? $l->completed_at ?? now();
                $r->dropped_at = null;
            }
            $r->save();
            // A carpool counts as a ride only while at least one rider actually rode (A15), both ways round.
            $rode = CarpoolRequest::query()->where('listing_id', $l->id)->where('status', CarpoolRequest::STATUS_COMPLETED)->exists();
            if ($l->counts_as_ride !== $rode) {
                $l->counts_as_ride = $rode;
                $l->save();
            }

            return $r;
        });
        CarpoolAdminLog::record('correct_outcome', 'request', $r->id, [
            'listing_id' => $r->listing_id, 'subject_user_id' => $r->rider_id, 'note' => $note,
            'before' => $before, 'after' => ['status' => $r->status],
        ]);

        return $r;
    }

    /**
     * Admin edit of a carpool driver's car (Admin-Audit.md C-04). Same plate rule as sign-up (one plate,
     * one driver, both types); seats can't go below seats already taken on a carpool that hasn't finished;
     * the driver-row copy is kept in step; upcoming carpools show the new car and their riders are told
     * when the plate changes.
     *
     * @param array{make: string, model: string, colour: string, plate: string, seats: int} $data
     */
    public function editCar(Driver $driver, array $data, string $note): CarpoolVehicle
    {
        if (! $driver->isCarpool()) {
            $this->fail('Only carpool drivers have a carpool car.');
        }
        $plate = strtoupper((string) preg_replace('/[^A-Za-z0-9]/', '', $data['plate']));
        if (strlen($plate) < 4) {
            $this->fail('Enter a valid number plate.');
        }
        app(CarpoolDriverRegistration::class)->assertPlateFree($plate, $driver);
        $taken = (int) CarpoolListing::query()->where('driver_id', $driver->id)->whereIn('status', CarpoolListing::LIVE)->max('seats_taken');
        if ((int) $data['seats'] < $taken) {
            $this->fail("A carpool that hasn't finished already has {$taken} seats taken. Seats can't be lower than that.");
        }

        $car = $driver->carpoolVehicle ?? new CarpoolVehicle();
        $before = $car->exists ? $car->only(['make', 'model', 'colour', 'plate', 'seats']) : null;
        $plateChanged = $car->exists && $car->plate !== $plate;
        $label = trim(trim($data['make']) . ' ' . trim($data['model']) . ', ' . trim($data['colour']), ' ,');
        DB::transaction(function () use ($driver, $car, $data, $plate, $label) {
            $car->driver_id = $driver->id;
            $car->fill(['make' => trim($data['make']), 'model' => trim($data['model']), 'colour' => trim($data['colour']), 'plate' => $plate, 'seats' => (int) $data['seats']]);
            $car->save();
            $driver->vehicle_reg_no = $plate;
            $driver->vehicle_brand = trim($data['make']);
            $driver->vehicle_color = trim($data['colour']);
            $driver->save();
            CarpoolListing::query()->where('driver_id', $driver->id)->where('status', CarpoolListing::STATUS_PUBLISHED)
                ->update(['car_plate' => $plate, 'car_label' => $label]);
        });
        if ($plateChanged) {
            CarpoolRequest::query()->where('status', CarpoolRequest::STATUS_ACCEPTED)
                ->whereHas('listing', fn ($q) => $q->where('driver_id', $driver->id)->where('status', CarpoolListing::STATUS_PUBLISHED))
                ->with('listing')->get()->each(function (CarpoolRequest $r) use ($plate) {
                    $this->tell($r->rider_id, 'carpool_changed', "Your driver's car number changed",
                        $r->listing->start_name . ' to ' . $r->listing->end_name . '. The new number plate is ' . $plate . '.', $r->listing, $r);
                });
        }
        CarpoolAdminLog::record('car_edit', 'driver', $driver->id, [
            'subject_user_id' => $driver->user_id, 'note' => $note,
            'before' => $before, 'after' => $car->only(['make', 'model', 'colour', 'plate', 'seats']),
        ]);

        return $car->fresh();
    }

    private function driverOf(User $user): ?Driver
    {
        return Driver::query()->where('user_id', $user->id)->carpool()->first();
    }

    private function tell(?int $userId, string $type, string $title, string $body, CarpoolListing $l, ?CarpoolRequest $r = null): void
    {
        try {
            $this->notes->notifyUserId($userId, $type, $title, $body, [
                'listing_id' => $l->id, 'request_id' => $r?->id, 'link' => '/carpool/listing/' . $l->id,
            ]);
        } catch (\Throwable $e) {
            Log::warning('Carpool admin notification failed', ['type' => $type, 'listing_id' => $l->id, 'error' => $e->getMessage()]);
        }
    }

    private function fail(string $message): never
    {
        throw ValidationException::withMessages(['carpool' => $message]);
    }
}
