<?php

namespace App\Services\Carpool;

use App\Models\Carpool\CarpoolListing;
use App\Models\Carpool\CarpoolMessage;
use App\Models\Carpool\CarpoolReport;
use App\Models\Carpool\CarpoolRequest;
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
    public function ban(User $user, string $note): array
    {
        $impact = $this->banImpact($user);
        DB::transaction(function () use ($user, $note) {
            $user->carpool_banned_at = $user->carpool_banned_at ?? now();
            $user->carpool_ban_reason = mb_substr($note, 0, 255);
            $user->save();
        });
        if ($driver = $this->driverOf($user)) {
            $this->cancelUpcomingOf($driver);
        }
        $this->endRiderSide($user);

        return $impact;
    }

    /** Clears the ban. It does not bring back cancelled carpools or seats. */
    public function restore(User $user): void
    {
        $user->carpool_banned_at = null;
        $user->carpool_ban_reason = null;
        $user->save();
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

    /** Removes a reported message for good: chat shows "removed by Dream Cabs". */
    public function removeMessage(CarpoolReport $report): CarpoolReport
    {
        $msg = $report->message_id ? CarpoolMessage::query()->find($report->message_id) : null;
        if (! $report->message_id) {
            $this->fail('Only message reports have a message to remove.');
        }
        if ($msg) {
            $msg->moderation_status = 'removed';
            $msg->moderation_reason = 'admin';
            $msg->save();
        }
        $report->removed_at = now();
        $report->save();

        return $report;
    }

    /** Closes a report: Actioned if the message was removed or the person banned, otherwise Dismissed. */
    public function closeReport(CarpoolReport $report, ?string $note): CarpoolReport
    {
        if ($report->status !== 'open') {
            $this->fail('This report is already closed.');
        }
        $banned = (bool) User::query()->whereKey($report->reported_user_id)->whereNotNull('carpool_banned_at')->exists();
        $report->status = ($report->removed_at || $banned) ? 'actioned' : 'dismissed';
        $report->note = $note !== null && trim($note) !== '' ? trim($note) : null;
        $report->save();

        return $report;
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
