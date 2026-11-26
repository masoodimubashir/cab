<?php

namespace App\Http\Controllers\Admin;

use App\Models\Carpool\CarpoolBannedWord;
use App\Models\Carpool\CarpoolListing;
use App\Models\Carpool\CarpoolReport;
use App\Models\Carpool\CarpoolRequest;
use App\Models\Carpool\CarpoolSetting;
use App\Models\Driver;
use App\Models\User;
use App\Services\Carpool\CarpoolAdminLog;
use App\Services\Carpool\CarpoolAdminScope;
use App\Services\Carpool\CarpoolAdminService;
use App\Services\Carpool\CarpoolChatService;
use App\Services\Carpool\CarpoolClock;
use App\Services\Carpool\CarpoolJobStatus;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Carpool > Listings, Reports and Settings, plus the ban actions (Carpool.md section 10).
 * Every list and action respects the manager's cities (Admin-Audit.md D-01) and every action
 * writes a line to the carpool admin log (B-03).
 */
class AdminCarpoolController
{
    public function __construct(private CarpoolAdminService $admin)
    {
    }

    // ---- Listings ----

    public function listings(Request $request): JsonResponse
    {
        $data = $request->validate([
            'tab' => ['sometimes', 'in:upcoming,not_started,today,in_progress,past'],
            'city_id' => ['sometimes', 'nullable', 'integer'],
            'search' => ['sometimes', 'nullable', 'string', 'max:80'],
            'date_from' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'date_to' => ['sometimes', 'nullable', 'date_format:Y-m-d', 'after_or_equal:date_from'],
        ]);
        $tab = $data['tab'] ?? 'upcoming';
        $dayStart = CarpoolClock::startOfDay(CarpoolClock::today());
        $dayEnd = CarpoolClock::endOfDay(CarpoolClock::today());

        // The base the strip counts use too, so they follow the city filter and the manager's cities.
        $base = fn () => CarpoolAdminScope::listings(CarpoolListing::query())
            ->when(! empty($data['city_id']), fn ($q) => $q->where('city_id', $data['city_id']));

        $q = $base()->with(['driver.user:id,name,phone', 'driver.carpoolVehicle', 'city:id,name'])->withCount([
            'requests as requests_count' => fn ($r) => $r->whereIn('status', [...CarpoolRequest::ACTIVE, CarpoolRequest::STATUS_COMPLETED]),
        ]);
        match ($tab) {
            'today' => $q->where('status', CarpoolListing::STATUS_PUBLISHED)->where('departs_at', '>=', $dayStart)->where('departs_at', '<', $dayEnd)->orderBy('departs_at'),
            'in_progress' => $q->where('status', CarpoolListing::STATUS_IN_PROGRESS)->orderBy('departs_at'),
            'past' => $q->whereIn('status', [CarpoolListing::STATUS_COMPLETED, CarpoolListing::STATUS_CANCELLED])->orderByDesc('departs_at'),
            // Published but the departure time has passed: the hourly job cancels these at the end of the day.
            'not_started' => $q->where('status', CarpoolListing::STATUS_PUBLISHED)->where('departs_at', '<', now())->orderBy('departs_at'),
            default => $q->where('status', CarpoolListing::STATUS_PUBLISHED)->where('departs_at', '>=', now())->orderBy('departs_at'),
        };
        if (! empty($data['date_from'])) {
            $q->where('departs_at', '>=', CarpoolClock::startOfDay($data['date_from']));
        }
        if (! empty($data['date_to'])) {
            $q->where('departs_at', '<', CarpoolClock::endOfDay($data['date_to']));
        }
        if (! empty($data['search'])) {
            $this->applySearch($q, trim($data['search']));
        }
        $page = $q->paginate(25);

        return response()->json([
            'data' => $page->getCollection()->map(fn ($l) => $this->listingRow($l))->values(),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()],
            'strip' => [
                'upcoming' => $base()->where('status', CarpoolListing::STATUS_PUBLISHED)->where('departs_at', '>=', now())->count(),
                'past_departure' => $base()->where('status', CarpoolListing::STATUS_PUBLISHED)->where('departs_at', '<', now())->count(),
                'in_progress' => $base()->where('status', CarpoolListing::STATUS_IN_PROGRESS)->count(),
                'open_reports' => CarpoolAdminScope::reports(CarpoolReport::query())->where('status', 'open')->count(),
            ],
        ]);
    }

    /** Driver name, phone or plate; a rider's name or phone; or a carpool number (#28). */
    private function applySearch(Builder $q, string $s): void
    {
        if (preg_match('/^#?(\d{1,9})$/', $s, $m) && strlen($m[1]) < 6) {
            $q->whereKey((int) $m[1]);

            return;
        }
        $plate = strtoupper((string) preg_replace('/[^A-Za-z0-9]/', '', $s));
        $q->where(function ($w) use ($s, $plate) {
            $w->whereHas('driver.user', fn ($u) => $u->where('name', 'like', "%{$s}%")->orWhere('phone', 'like', "%{$s}%"))
                ->orWhereHas('requests.rider', fn ($u) => $u->where('name', 'like', "%{$s}%")->orWhere('phone', 'like', "%{$s}%"));
            if (strlen($plate) >= 3) {
                $w->orWhere('car_plate', 'like', "%{$plate}%")
                    ->orWhereHas('driver.carpoolVehicle', fn ($v) => $v->where('plate', 'like', "%{$plate}%"));
            }
        });
    }

    public function listing(CarpoolListing $listing): JsonResponse
    {
        CarpoolAdminScope::assertListing($listing);
        $listing->load(['driver.user:id,name,phone', 'driver.carpoolVehicle', 'city:id,name']);
        $requests = CarpoolRequest::query()->with('rider:id,name,phone')->where('listing_id', $listing->id)->orderBy('id')->get()
            ->map(fn (CarpoolRequest $r) => [
                'id' => $r->id, 'rider_id' => $r->rider_id, 'rider' => $r->rider?->name, 'rider_phone' => $r->rider?->phone,
                'seats' => $r->seats, 'pickup' => $r->pickup_name, 'drop' => $r->drop_name,
                'status' => $r->status, 'closed_reason' => $r->closed_reason,
                'price_per_seat' => $r->is_free ? null : (int) $r->price_per_seat, 'is_free' => (bool) $r->is_free,
                'paid_marked' => (bool) $r->paid_marked,
                'asked_at' => $r->created_at?->toIso8601String(), 'answered_at' => $r->answered_at?->toIso8601String(),
                'picked_up_at' => $r->picked_up_at?->toIso8601String(), 'dropped_at' => $r->dropped_at?->toIso8601String(),
                'no_show_at' => $r->no_show_at?->toIso8601String(), 'ended_at' => $r->ended_at?->toIso8601String(),
                // Not offered on a carpool that was never started and whose departure has passed: the job cancels it (F29-4).
                'can_remove' => in_array($listing->status, CarpoolListing::LIVE, true) && in_array($r->status, CarpoolRequest::ACTIVE, true) && ! $r->picked_up_at
                    && ! ($listing->status === CarpoolListing::STATUS_PUBLISHED && $listing->departs_at->lt(now())),
                'can_correct' => $listing->status === CarpoolListing::STATUS_COMPLETED && in_array($r->status, [CarpoolRequest::STATUS_COMPLETED, CarpoolRequest::STATUS_NO_SHOW], true),
            ]); // The rider code is never shown.
        $reports = CarpoolReport::query()->where('listing_id', $listing->id)->orderByDesc('id')->get()
            ->map(fn ($r) => ['id' => $r->id, 'reason' => $r->reason, 'reason_label' => $this->reasonLabel($r->reason), 'status' => $r->status, 'created_at' => $r->created_at?->toIso8601String()]);

        return response()->json(['data' => $this->listingRow($listing) + [
            'cancel_note' => $listing->cancel_note,
            'distance_km' => round($listing->distance_m / 1000, 1),
            'requests' => $requests,
            'reports' => $reports,
            'timeline' => $this->timeline($listing),
            'history' => CarpoolAdminLog::forListing($listing->id),
            'can_cancel' => $listing->status === CarpoolListing::STATUS_PUBLISHED,
            'can_end' => $listing->status === CarpoolListing::STATUS_IN_PROGRESS,
        ]]);
    }

    /** What happened to a carpool and when, oldest first. */
    private function timeline(CarpoolListing $l): array
    {
        $out = [['at' => $l->created_at?->toIso8601String(), 'label' => 'Published']];
        if ($l->changed_at) {
            $out[] = ['at' => $l->changed_at->toIso8601String(), 'label' => 'Changed by the driver (' . ($l->changed_kind ?: 'details') . ')'];
        }
        if ($l->started_at) {
            $out[] = ['at' => $l->started_at->toIso8601String(), 'label' => 'Ride started'];
        }
        if ($l->completed_at) {
            $out[] = ['at' => $l->completed_at->toIso8601String(), 'label' => match ($l->completed_by) {
                'auto' => 'Finished automatically', 'admin' => 'Ended by Dream Cabs', default => 'Finished by the driver',
            }];
        }
        if ($l->cancelled_at) {
            $out[] = ['at' => $l->cancelled_at->toIso8601String(), 'label' => 'Cancelled (' . ($this->cancelLabel($l->cancel_reason)) . ')'];
        }
        if ($l->chats_deleted_at) {
            $out[] = ['at' => $l->chats_deleted_at->toIso8601String(), 'label' => 'Chats deleted (retention)'];
        }

        $out = array_values(array_filter($out, fn ($e) => $e['at']));
        // Oldest first, as promised. A stable sort keeps same-second events in the order above.
        usort($out, fn ($a, $b) => strtotime($a['at']) <=> strtotime($b['at']));

        return $out;
    }

    private function cancelLabel(?string $reason): string
    {
        return match ($reason) {
            CarpoolListing::CANCEL_DRIVER => 'by the driver',
            CarpoolListing::CANCEL_PLAN_ENDED => 'plan ended',
            CarpoolListing::CANCEL_MISSED => 'missed departure',
            CarpoolListing::CANCEL_ADMIN => 'by Dream Cabs',
            CarpoolListing::CANCEL_DOCUMENTS => 'document expired',
            default => 'by the driver',
        };
    }

    public function cancelListing(Request $request, CarpoolListing $listing): JsonResponse
    {
        CarpoolAdminScope::assertListing($listing);
        $data = $request->validate(['note' => ['nullable', 'string', 'max:500']]);
        $this->admin->cancelListing($listing, $data['note'] ?? null);

        return response()->json(['message' => 'Carpool cancelled.', 'data' => $this->listingRow($listing->fresh(['driver.user', 'driver.carpoolVehicle', 'city']))]);
    }

    public function endRide(Request $request, CarpoolListing $listing): JsonResponse
    {
        CarpoolAdminScope::assertListing($listing);
        $data = $request->validate(['note' => ['required', 'string', 'min:3', 'max:500']]);
        $this->admin->endRide($listing, $data['note']);

        return response()->json(['message' => 'Ride ended.']);
    }

    public function removeRider(Request $request, CarpoolRequest $carpoolRequest): JsonResponse
    {
        CarpoolAdminScope::assertListing($carpoolRequest->listing);
        $data = $request->validate(['note' => ['required', 'string', 'min:3', 'max:500']]);
        $this->admin->removeRider($carpoolRequest, $data['note']);

        return response()->json(['message' => 'Rider removed.']);
    }

    public function correctOutcome(Request $request, CarpoolRequest $carpoolRequest): JsonResponse
    {
        CarpoolAdminScope::assertListing($carpoolRequest->listing);
        $data = $request->validate([
            'outcome' => ['required', 'in:completed,no_show'],
            'note' => ['required', 'string', 'min:3', 'max:500'],
        ]);
        $r = $this->admin->correctOutcome($carpoolRequest, $data['outcome'], $data['note']);

        return response()->json(['message' => 'Outcome saved.', 'status' => $r->status]);
    }

    private function listingRow(CarpoolListing $l): array
    {
        $status = $l->status === CarpoolListing::STATUS_COMPLETED
            ? match ($l->completed_by) { 'auto' => 'auto_completed', 'admin' => 'ended_by_admin', default => 'completed' }
            : $l->status;
        $car = $l->driver?->carpoolVehicle;

        return [
            'id' => $l->id,
            'departs_at' => $l->departs_at->toIso8601String(),
            'route' => $l->start_name . ' to ' . $l->end_name,
            'driver' => $l->driver?->user?->name,
            'driver_phone' => $l->driver?->user?->phone,
            'driver_id' => $l->driver_id,
            'driver_user_id' => $l->driver?->user_id,
            // The car as it was when the carpool was published (falls back to today's car for older carpools).
            'car' => $l->car_label ?: ($car ? trim($car->make . ' ' . $car->model) : null),
            'plate' => $l->car_plate ?: $car?->plate,
            'car_now' => $car ? trim($car->make . ' ' . $car->model . ', ' . $car->colour, ' ,') : null,
            'plate_now' => $car?->plate,
            'city' => $l->city?->name,
            'city_id' => $l->city_id,
            'seats_taken' => $l->seats_taken,
            'seats_total' => $l->seats_total,
            'price_per_seat' => $l->is_free ? null : $l->price_per_seat,
            'is_free' => (bool) $l->is_free,
            'status' => $status,
            'cancel_reason' => $l->cancel_reason,
            'is_past_departure' => $l->status === CarpoolListing::STATUS_PUBLISHED && $l->departs_at->lt(now()),
            'requests_count' => $l->requests_count ?? null,
        ];
    }

    // ---- Reports ----

    public function reports(Request $request): JsonResponse
    {
        $data = $request->validate([
            'tab' => ['sometimes', 'in:open,closed'],
            'city_id' => ['sometimes', 'nullable', 'integer'],
            'reason' => ['sometimes', 'nullable', 'in:' . implode(',', \App\Models\Carpool\CarpoolReportReason::allKeys())],
            'search' => ['sometimes', 'nullable', 'string', 'max:80'],
            'date_from' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'date_to' => ['sometimes', 'nullable', 'date_format:Y-m-d', 'after_or_equal:date_from'],
        ]);
        $tab = ($data['tab'] ?? 'open') === 'closed' ? 'closed' : 'open';
        $q = CarpoolAdminScope::reports(CarpoolReport::query())->with(['reporter:id,name,phone', 'reported:id,name,phone', 'listing:id,city_id'])
            ->when($tab === 'open', fn ($q) => $q->where('status', 'open'), fn ($q) => $q->where('status', '!=', 'open'));
        if (! empty($data['city_id'])) {
            $city = (int) $data['city_id'];
            $q->where(fn ($w) => $w->whereHas('listing', fn ($l) => $l->where('city_id', $city))
                ->orWhere(fn ($n) => $n->whereNull('listing_id')->whereHas('reported.driver', fn ($d) => $d->where('city_id', $city))));
        }
        if (! empty($data['reason'])) {
            $q->where('reason', $data['reason']);
        }
        if (! empty($data['search'])) {
            $s = trim($data['search']);
            if (preg_match('/^#?(\d{1,5})$/', $s, $m)) {
                $q->where(fn ($w) => $w->whereKey((int) $m[1])->orWhere('listing_id', (int) $m[1]));
            } else {
                $q->where(fn ($w) => $w->whereHas('reporter', fn ($u) => $u->where('name', 'like', "%{$s}%")->orWhere('phone', 'like', "%{$s}%"))
                    ->orWhereHas('reported', fn ($u) => $u->where('name', 'like', "%{$s}%")->orWhere('phone', 'like', "%{$s}%")));
            }
        }
        if (! empty($data['date_from'])) {
            $q->where('created_at', '>=', CarpoolClock::startOfDay($data['date_from']));
        }
        if (! empty($data['date_to'])) {
            $q->where('created_at', '<', CarpoolClock::endOfDay($data['date_to']));
        }
        $page = $q->orderByDesc('id')->paginate(25);

        return response()->json([
            'data' => $page->getCollection()->map(fn ($r) => $this->reportRow($r))->values(),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()],
            'reasons' => \App\Models\Carpool\CarpoolReportReason::allKeys(),
            'reason_labels' => \App\Models\Carpool\CarpoolReportReason::labels(),
        ]);
    }

    public function report(CarpoolReport $report): JsonResponse
    {
        CarpoolAdminScope::assertReport($report);
        $report->load(['reporter:id,name,phone', 'reported:id,name,phone', 'listing']);
        $earlier = CarpoolReport::query()->where('reported_user_id', $report->reported_user_id)->where('id', '!=', $report->id)
            ->orderByDesc('id')->limit(20)->get()
            ->map(fn ($r) => ['id' => $r->id, 'created_at' => $r->created_at?->toIso8601String(), 'reason' => $r->reason, 'reason_label' => $this->reasonLabel($r->reason), 'status' => $r->status, 'listing_id' => $r->listing_id]);
        $l = $report->listing;

        return response()->json(['data' => $this->reportRow($report) + [
            'details' => $report->details,
            'message_text' => $report->message_text, // the copy taken when the report was sent (A33), banned words hidden
            'original_text' => $report->original_text, // what was typed; null when nothing was hidden or it predates this
            'note' => $report->note,
            'message_removed' => (bool) $report->removed_at,
            // False when the chat was already deleted by the retention rule: there is nothing left to remove.
            'message_in_chat' => $report->message_id !== null && \App\Models\Carpool\CarpoolMessage::query()->whereKey($report->message_id)->exists(),
            'reporter_user_id' => $report->reporter_id,
            'reported_user_id' => $report->reported_user_id,
            'reported_banned' => (bool) $report->reported?->carpool_banned_at,
            'reported_ban_reason' => $report->reported?->carpool_ban_reason,
            'earlier_reports' => $earlier->count(),
            'earlier' => $earlier,
            'listing' => $l ? ['id' => $l->id, 'route' => $l->start_name . ' to ' . $l->end_name, 'departs_at' => $l->departs_at?->toIso8601String()] : null,
            'impact' => $report->reported ? $this->admin->banImpact($report->reported) : null,
            'suggested_outcome' => $report->status === 'open' ? $this->admin->suggestedOutcome($report) : null,
            'history' => CarpoolAdminLog::forTarget('report', $report->id),
        ]]);
    }

    public function removeMessage(CarpoolReport $report): JsonResponse
    {
        CarpoolAdminScope::assertReport($report);
        $this->admin->removeMessage($report);

        return response()->json(['message' => 'Message removed.']);
    }

    public function closeReport(Request $request, CarpoolReport $report): JsonResponse
    {
        CarpoolAdminScope::assertReport($report);
        $data = $request->validate([
            'note' => ['nullable', 'string', 'max:1000'],
            'outcome' => ['sometimes', 'nullable', 'in:actioned,dismissed'],
        ]);
        $r = $this->admin->closeReport($report, $data['note'] ?? null, $data['outcome'] ?? null);

        return response()->json(['message' => 'Report closed.', 'status' => $r->status]);
    }

    private function reportRow(CarpoolReport $r): array
    {
        return [
            'id' => $r->id,
            'created_at' => $r->created_at->toIso8601String(),
            'type' => $r->message_id || $r->message_text !== null ? 'message' : 'person',
            'reported_by' => $r->reporter?->name,
            'reported_by_phone' => $r->reporter?->phone,
            'reporter_user_id' => $r->reporter_id,
            'reported_person' => $r->reported?->name,
            'reported_person_phone' => $r->reported?->phone,
            'reported_user_id' => $r->reported_user_id,
            'reason' => $r->reason,
            'reason_label' => $this->reasonLabel($r->reason),
            'listing_id' => $r->listing_id,
            'status' => $r->status,
        ];
    }

    private ?array $reasonLabels = null;

    /** The admin's current label for a report reason (also for reasons that have been turned off). */
    private function reasonLabel(?string $key): string
    {
        $this->reasonLabels ??= \App\Models\Carpool\CarpoolReportReason::labels();

        return \App\Models\Carpool\CarpoolReportReason::labelFor($key, $this->reasonLabels);
    }

    // ---- Bans (from Reports, Drivers, Customers and People) ----

    public function banImpact(User $user): JsonResponse
    {
        CarpoolAdminScope::assertPerson($user);

        return response()->json(['data' => $this->admin->banImpact($user) + [
            'banned' => (bool) $user->carpool_banned_at,
            'history' => CarpoolAdminLog::forPerson($user->id)->whereIn('action', ['ban', 'restore'])->values(),
        ]]);
    }

    public function ban(Request $request, User $user): JsonResponse
    {
        CarpoolAdminScope::assertPerson($user);
        $data = $request->validate(['note' => ['required', 'string', 'min:3', 'max:255'], 'cancel_upcoming' => ['sometimes', 'boolean']]);
        // S10 (D-11): the admin chooses whether upcoming carpools and seats end with the pause (default: yes, as before).
        $impact = $this->admin->ban($user, $data['note'], (bool) ($data['cancel_upcoming'] ?? true));

        return response()->json(['message' => 'Carpool access paused.', 'data' => $impact]);
    }

    public function restore(Request $request, User $user): JsonResponse
    {
        CarpoolAdminScope::assertPerson($user);
        $data = $request->validate(['note' => ['nullable', 'string', 'max:255']]);
        $this->admin->restore($user, $data['note'] ?? null);

        return response()->json(['message' => 'Carpool access restored.']);
    }

    // ---- Car (Admin-Audit.md C-04) ----

    public function editCar(Request $request, Driver $driver): JsonResponse
    {
        CarpoolAdminScope::assertCity($driver->city_id);
        $data = $request->validate([
            'make' => ['required', 'string', 'max:60'],
            'model' => ['required', 'string', 'max:60'],
            'colour' => ['required', 'string', 'max:40'],
            'plate' => ['required', 'string', 'max:20'],
            'seats' => ['required', 'integer', 'between:1,8'],
            'note' => ['required', 'string', 'min:3', 'max:500'],
        ]);
        $car = $this->admin->editCar($driver->loadMissing('carpoolVehicle'), $data, $data['note']);

        return response()->json(['message' => 'Car saved.', 'data' => $car->only(['make', 'model', 'colour', 'plate', 'seats'])]);
    }

    // ---- Settings and banned words ----

    public function settings(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->settingsPayload($request)]);
    }

    /**
     * Saves the settings an admin changed. Only the fields sent are touched, each is checked against
     * CarpoolSetting::LIMITS, and `version` (from the last GET) must still match: if another admin saved
     * in between, nothing is written and the answer is 409 with the current settings (hardening S5, D-04).
     */
    public function updateSettings(Request $request): JsonResponse
    {
        $limits = CarpoolSetting::LIMITS;
        $rules = ['enabled' => ['sometimes', 'boolean'], 'version' => ['required', 'string', 'max:64']];
        foreach ($limits as $key => $l) {
            $rules[$key] = $l['nullable']
                ? ['sometimes', 'nullable', 'integer', "between:{$l['min']},{$l['max']}"]
                : ['sometimes', 'integer', "between:{$l['min']},{$l['max']}"];
        }
        $data = $request->validate($rules);

        $diff = DB::transaction(function () use ($data, $limits) {
            CarpoolSetting::current(); // makes sure the row exists
            $s = CarpoolSetting::query()->lockForUpdate()->first();
            if (! hash_equals($s->version(), (string) $data['version'])) {
                return null;
            }
            $before = $s->getAttributes();
            if (array_key_exists('enabled', $data)) {
                $s->enabled = $data['enabled'];
            }
            foreach (array_keys($limits) as $key) {
                if (! array_key_exists($key, $data)) {
                    continue;
                }
                if ($key === 'search_distance_km') {
                    $s->search_distance_m = $data[$key] * 1000;
                } else {
                    $s->{$key} = $data[$key];
                }
            }
            $changed = array_keys($s->getDirty());
            $s->save(); // saves nothing, and keeps updated_at, when no value actually changed

            return ['before' => array_intersect_key($before, array_flip($changed)), 'after' => array_intersect_key($s->getAttributes(), array_flip($changed))];
        });

        if ($diff === null) {
            return response()->json([
                'message' => 'Settings were changed by someone else. Reload the page to see the current values.',
                'data' => $this->settingsPayload($request),
            ], 409);
        }
        unset($diff['before']['updated_at'], $diff['after']['updated_at']);
        if ($diff['after']) {
            CarpoolAdminLog::record('settings', 'settings', null, $diff);
        }

        return response()->json(['data' => $this->settingsPayload($request)]);
    }

    private function settingsPayload(Request $request): array
    {
        $s = CarpoolSetting::current();

        return [
            'version' => $s->version(),
            'enabled' => (bool) $s->enabled,
            'search_distance_km' => (int) round($s->search_distance_m / 1000),
            'auto_complete_hours' => (int) $s->auto_complete_hours,
            'chat_retention_days' => (int) $s->chat_retention_days,
            'publish_horizon_days' => CarpoolSetting::number('publish_horizon_days'),
            'start_early_minutes' => CarpoolSetting::number('start_early_minutes'),
            'pending_expire_minutes' => CarpoolSetting::number('pending_expire_minutes'),
            'plan_grace_days' => CarpoolSetting::number('plan_grace_days'),
            'missed_departure_days' => CarpoolSetting::missedDepartureDays(),
            'plan_warning_days' => CarpoolSetting::number('plan_warning_days'),
            'plan_push_hours' => CarpoolSetting::number('plan_push_hours'),
            'document_warning_days' => CarpoolSetting::number('document_warning_days'),
            'report_retention_days' => CarpoolSetting::number('report_retention_days'),
            'limits' => CarpoolSetting::LIMITS,
            'upcoming_carpools' => CarpoolListing::query()->where('status', CarpoolListing::STATUS_PUBLISHED)->count(),
            'carpools_on_the_road' => CarpoolListing::query()->where('status', CarpoolListing::STATUS_IN_PROGRESS)->count(),
            'waiting_requests' => CarpoolRequest::query()->where('status', CarpoolRequest::STATUS_PENDING)->count(),
            'kill_switch' => (bool) config('carpool.kill_switch'),
            'banned_words' => CarpoolBannedWord::query()->orderBy('word')->get(['id', 'word', 'active']),
            'banned_words_max' => CarpoolBannedWord::MAX_WORDS,
            'report_reasons' => $this->reasonsPayload(),
            'can_edit' => (bool) $request->user()?->hasPermission('carpool_settings'),
            'jobs' => CarpoolJobStatus::all(),
            'history' => \App\Models\Carpool\CarpoolAdminAction::query()->whereIn('target_type', ['settings', 'word', 'reason'])
                ->orderByDesc('id')->limit(20)->get()->map->toEntry()->values(),
        ];
    }

    /** @return list<array<string, mixed>> every reason, with how many reports used it */
    private function reasonsPayload(): array
    {
        $used = CarpoolReport::query()->selectRaw('reason, count(*) n')->groupBy('reason')->pluck('n', 'reason');

        return \App\Models\Carpool\CarpoolReportReason::query()->orderBy('sort')->orderBy('id')->get()->map(fn ($r) => [
            'id' => $r->id, 'key' => $r->key, 'label' => $r->label, 'applies_to' => $r->applies_to,
            'active' => (bool) $r->active, 'reports' => (int) ($used[$r->key] ?? 0),
        ])->all();
    }

    public function addReason(Request $request): JsonResponse
    {
        $data = $request->validate([
            'label' => ['required', 'string', 'min:3', 'max:60'],
            'applies_to' => ['required', 'in:' . implode(',', \App\Models\Carpool\CarpoolReportReason::APPLIES)],
        ]);
        $label = trim($data['label']);
        $reason = \App\Models\Carpool\CarpoolReportReason::query()->create([
            'key' => \App\Models\Carpool\CarpoolReportReason::newKey($label), 'label' => $label, 'applies_to' => $data['applies_to'],
            'active' => true, 'sort' => (int) \App\Models\Carpool\CarpoolReportReason::query()->max('sort') + 1,
        ]);
        CarpoolAdminLog::record('reason_add', 'reason', $reason->id, ['after' => ['label' => $label, 'applies_to' => $reason->applies_to]]);

        return response()->json(['data' => $this->reasonRow($reason)], 201);
    }

    public function updateReason(Request $request, \App\Models\Carpool\CarpoolReportReason $reason): JsonResponse
    {
        $data = $request->validate([
            'label' => ['sometimes', 'string', 'min:3', 'max:60'],
            'applies_to' => ['sometimes', 'in:' . implode(',', \App\Models\Carpool\CarpoolReportReason::APPLIES)],
            'active' => ['sometimes', 'boolean'],
        ]);
        $before = $reason->only(['label', 'applies_to', 'active']);
        DB::transaction(function () use ($reason, $data) {
            $reason->fill(array_filter(['label' => isset($data['label']) ? trim($data['label']) : null, 'applies_to' => $data['applies_to'] ?? null], fn ($v) => $v !== null));
            if (array_key_exists('active', $data)) {
                $reason->active = (bool) $data['active'];
            }
            $reason->save();
            if (! \App\Models\Carpool\CarpoolReportReason::leavesBothKindsCovered()) {
                abort(422, 'Keep at least one reason on for reports about a person and one for reports about a message.');
            }
        });
        CarpoolAdminLog::record('reason_edit', 'reason', $reason->id, ['before' => $before, 'after' => $reason->only(['label', 'applies_to', 'active'])]);

        return response()->json(['data' => $this->reasonRow($reason->fresh())]);
    }

    private function reasonRow(\App\Models\Carpool\CarpoolReportReason $r): array
    {
        return ['id' => $r->id, 'key' => $r->key, 'label' => $r->label, 'applies_to' => $r->applies_to, 'active' => (bool) $r->active,
            'reports' => CarpoolReport::query()->where('reason', $r->key)->count()];
    }

    public function addWord(Request $request): JsonResponse
    {
        $data = $request->validate(['word' => ['required', 'string', 'min:' . CarpoolBannedWord::MIN_LENGTH, 'max:' . CarpoolBannedWord::MAX_LENGTH]]);
        $word = mb_strtolower(trim($data['word']));
        $w = CarpoolBannedWord::query()->where('word', $word)->first();
        if (! $w) {
            if (CarpoolBannedWord::query()->count() >= CarpoolBannedWord::MAX_WORDS) {
                return response()->json(['message' => 'The list is full (' . CarpoolBannedWord::MAX_WORDS . ' words). Remove a word first.'], 422);
            }
            $w = CarpoolBannedWord::query()->create(['word' => $word, 'active' => true]);
            CarpoolAdminLog::record('words_add', 'word', $w->id, ['after' => ['words' => [$word]]]);
        }

        return response()->json(['data' => $w], $w->wasRecentlyCreated ? 201 : 200);
    }

    /**
     * Adds many words from one pasted text. Words are split on commas, semicolons and new lines, trimmed,
     * lower-cased and de-duplicated. Words already on the list, words that are too short or too long, and
     * words that would pass the list limit are skipped, and the answer says how many of each.
     */
    public function addWords(Request $request): JsonResponse
    {
        $data = $request->validate(['words' => ['required', 'string', 'max:10000']]);

        $candidates = [];
        $skipped = [];
        foreach (preg_split('/[\r\n,;]+/u', $data['words']) ?: [] as $part) {
            $w = mb_strtolower(trim((string) preg_replace('/\s+/u', ' ', $part)));
            if ($w === '' || isset($candidates[$w]) || isset($skipped[$w])) {
                continue;
            }
            $len = mb_strlen($w);
            if ($len < CarpoolBannedWord::MIN_LENGTH || $len > CarpoolBannedWord::MAX_LENGTH) {
                $skipped[$w] = true;
            } else {
                $candidates[$w] = true;
            }
        }

        $total = CarpoolBannedWord::query()->count();
        $added = [];
        $already = 0;
        $overLimit = 0;
        foreach (array_keys($candidates) as $w) {
            if (CarpoolBannedWord::query()->where('word', $w)->exists()) {
                $already++;
            } elseif ($total >= CarpoolBannedWord::MAX_WORDS) {
                $overLimit++;
            } else {
                $added[] = CarpoolBannedWord::query()->create(['word' => $w, 'active' => true]);
                $total++;
            }
        }
        if ($added) {
            CarpoolAdminLog::record('words_add', 'word', null, ['after' => ['words' => array_map(fn ($w) => $w->word, $added)]]);
        }

        return response()->json(['data' => [
            'added' => $added,
            'already_there' => $already,
            'skipped' => array_slice(array_keys($skipped), 0, 20),
            'skipped_count' => count($skipped),
            'over_limit' => $overLimit,
            'total' => $total,
            'max' => CarpoolBannedWord::MAX_WORDS,
        ]]);
    }

    public function updateWord(Request $request, CarpoolBannedWord $word): JsonResponse
    {
        $data = $request->validate(['active' => ['required', 'boolean']]);
        $word->active = $data['active'];
        $word->save();
        CarpoolAdminLog::record('word_toggle', 'word', $word->id, ['after' => ['word' => $word->word, 'active' => (bool) $word->active]]);

        return response()->json(['data' => $word]);
    }

    public function deleteWord(CarpoolBannedWord $word): JsonResponse
    {
        CarpoolAdminLog::record('word_delete', 'word', $word->id, ['before' => ['word' => $word->word]]);
        $word->delete();

        return response()->json(['message' => 'Removed.']);
    }
}
