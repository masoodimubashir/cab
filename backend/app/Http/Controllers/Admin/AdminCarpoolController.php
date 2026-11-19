<?php

namespace App\Http\Controllers\Admin;

use App\Models\Carpool\CarpoolBannedWord;
use App\Models\Carpool\CarpoolListing;
use App\Models\Carpool\CarpoolReport;
use App\Models\Carpool\CarpoolRequest;
use App\Models\Carpool\CarpoolSetting;
use App\Models\User;
use App\Services\Carpool\CarpoolAdminService;
use App\Services\Carpool\CarpoolClock;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Carpool > Listings, Reports and Settings, plus the ban actions (Carpool.md section 10). */
class AdminCarpoolController
{
    public function __construct(private CarpoolAdminService $admin)
    {
    }

    // ---- Listings ----

    public function listings(Request $request): JsonResponse
    {
        $data = $request->validate([
            'tab' => ['sometimes', 'in:upcoming,today,in_progress,past'],
            'city_id' => ['sometimes', 'nullable', 'integer'],
            'search' => ['sometimes', 'nullable', 'string', 'max:80'],
        ]);
        $tab = $data['tab'] ?? 'upcoming';
        $dayStart = CarpoolClock::startOfDay(CarpoolClock::today());
        $dayEnd = CarpoolClock::endOfDay(CarpoolClock::today());

        $q = CarpoolListing::query()->with(['driver.user:id,name,phone', 'driver.carpoolVehicle', 'city:id,name'])->withCount([
            'requests as requests_count' => fn ($r) => $r->whereIn('status', [...CarpoolRequest::ACTIVE, CarpoolRequest::STATUS_COMPLETED]),
        ]);
        match ($tab) {
            'today' => $q->where('status', CarpoolListing::STATUS_PUBLISHED)->where('departs_at', '>=', $dayStart)->where('departs_at', '<', $dayEnd)->orderBy('departs_at'),
            'in_progress' => $q->where('status', CarpoolListing::STATUS_IN_PROGRESS)->orderBy('departs_at'),
            'past' => $q->whereIn('status', [CarpoolListing::STATUS_COMPLETED, CarpoolListing::STATUS_CANCELLED])->orderByDesc('departs_at'),
            default => $q->where('status', CarpoolListing::STATUS_PUBLISHED)->orderBy('departs_at'),
        };
        if (! empty($data['city_id'])) {
            $q->where('city_id', $data['city_id']);
        }
        if (! empty($data['search'])) {
            $s = trim($data['search']);
            $q->whereHas('driver', fn ($d) => $d->whereHas('user', fn ($u) => $u->where('name', 'like', "%{$s}%")->orWhere('phone', 'like', "%{$s}%"))
                ->orWhereHas('carpoolVehicle', fn ($v) => $v->where('plate', 'like', '%' . strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $s)) . '%')));
        }
        $page = $q->paginate(25);

        return response()->json([
            'data' => $page->getCollection()->map(fn ($l) => $this->listingRow($l))->values(),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()],
            'strip' => [
                'upcoming' => CarpoolListing::query()->where('status', CarpoolListing::STATUS_PUBLISHED)->count(),
                'in_progress' => CarpoolListing::query()->where('status', CarpoolListing::STATUS_IN_PROGRESS)->count(),
                'open_reports' => CarpoolReport::query()->where('status', 'open')->count(),
            ],
        ]);
    }

    public function listing(CarpoolListing $listing): JsonResponse
    {
        $listing->load(['driver.user:id,name,phone', 'driver.carpoolVehicle', 'city:id,name']);
        $requests = CarpoolRequest::query()->with('rider:id,name,phone')->where('listing_id', $listing->id)->orderBy('id')->get()
            ->map(fn ($r) => [
                'id' => $r->id, 'rider' => $r->rider?->name, 'rider_phone' => $r->rider?->phone, 'seats' => $r->seats,
                'pickup' => $r->pickup_name, 'drop' => $r->drop_name, 'status' => $r->status, 'closed_reason' => $r->closed_reason,
            ]); // The rider code is never shown.
        $reports = CarpoolReport::query()->where('listing_id', $listing->id)->orderByDesc('id')->get()
            ->map(fn ($r) => ['id' => $r->id, 'reason' => $r->reason, 'status' => $r->status]);

        return response()->json(['data' => $this->listingRow($listing) + [
            'cancel_note' => $listing->cancel_note,
            'distance_km' => round($listing->distance_m / 1000, 1),
            'requests' => $requests,
            'reports' => $reports,
            'can_cancel' => $listing->status === CarpoolListing::STATUS_PUBLISHED,
        ]]);
    }

    public function cancelListing(Request $request, CarpoolListing $listing): JsonResponse
    {
        $data = $request->validate(['note' => ['nullable', 'string', 'max:500']]);
        $this->admin->cancelListing($listing, $data['note'] ?? null);

        return response()->json(['message' => 'Carpool cancelled.', 'data' => $this->listingRow($listing->fresh(['driver.user', 'driver.carpoolVehicle', 'city']))]);
    }

    private function listingRow(CarpoolListing $l): array
    {
        $status = $l->status === CarpoolListing::STATUS_COMPLETED && $l->completed_by === 'auto' ? 'auto_completed' : $l->status;

        return [
            'id' => $l->id,
            'departs_at' => $l->departs_at->toIso8601String(),
            'route' => $l->start_name . ' to ' . $l->end_name,
            'driver' => $l->driver?->user?->name,
            'driver_phone' => $l->driver?->user?->phone,
            'driver_id' => $l->driver_id,
            'driver_user_id' => $l->driver?->user_id,
            'car' => $l->driver?->carpoolVehicle ? trim($l->driver->carpoolVehicle->make . ' ' . $l->driver->carpoolVehicle->model) : null,
            'plate' => $l->driver?->carpoolVehicle?->plate,
            'city' => $l->city?->name,
            'seats_taken' => $l->seats_taken,
            'seats_total' => $l->seats_total,
            'price_per_seat' => $l->is_free ? null : $l->price_per_seat,
            'is_free' => (bool) $l->is_free,
            'status' => $status,
            'cancel_reason' => $l->cancel_reason,
            'requests_count' => $l->requests_count ?? null,
        ];
    }

    // ---- Reports ----

    public function reports(Request $request): JsonResponse
    {
        $tab = $request->query('tab') === 'closed' ? 'closed' : 'open';
        $page = CarpoolReport::query()->with(['reporter:id,name,phone', 'reported:id,name,phone'])
            ->when($tab === 'open', fn ($q) => $q->where('status', 'open'), fn ($q) => $q->where('status', '!=', 'open'))
            ->orderByDesc('id')->paginate(25);

        return response()->json([
            'data' => $page->getCollection()->map(fn ($r) => $this->reportRow($r))->values(),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()],
        ]);
    }

    public function report(CarpoolReport $report): JsonResponse
    {
        $report->load(['reporter:id,name,phone', 'reported:id,name,phone', 'listing']);
        $earlier = CarpoolReport::query()->where('reported_user_id', $report->reported_user_id)->where('id', '!=', $report->id)->count();

        return response()->json(['data' => $this->reportRow($report) + [
            'details' => $report->details,
            'message_text' => $report->message_text, // the copy taken when the report was sent (A33), banned words hidden
            'original_text' => $report->original_text, // what was typed; null when nothing was hidden or it predates this
            'note' => $report->note,
            'message_removed' => (bool) $report->removed_at,
            'reported_user_id' => $report->reported_user_id,
            'reported_banned' => (bool) $report->reported?->carpool_banned_at,
            'earlier_reports' => $earlier,
            'listing_id' => $report->listing_id,
            'impact' => $report->reported ? $this->admin->banImpact($report->reported) : null,
        ]]);
    }

    public function removeMessage(CarpoolReport $report): JsonResponse
    {
        $this->admin->removeMessage($report);

        return response()->json(['message' => 'Message removed.']);
    }

    public function closeReport(Request $request, CarpoolReport $report): JsonResponse
    {
        $data = $request->validate(['note' => ['nullable', 'string', 'max:1000']]);
        $r = $this->admin->closeReport($report, $data['note'] ?? null);

        return response()->json(['message' => 'Report closed.', 'status' => $r->status]);
    }

    private function reportRow(CarpoolReport $r): array
    {
        return [
            'id' => $r->id,
            'created_at' => $r->created_at->toIso8601String(),
            'type' => $r->message_id || $r->message_text !== null ? 'message' : 'person',
            'reported_by' => $r->reporter?->name,
            'reported_person' => $r->reported?->name,
            'reason' => $r->reason,
            'listing_id' => $r->listing_id,
            'status' => $r->status,
        ];
    }

    // ---- Bans (from Reports, Drivers and Customers) ----

    public function banImpact(User $user): JsonResponse
    {
        return response()->json(['data' => $this->admin->banImpact($user) + ['banned' => (bool) $user->carpool_banned_at]]);
    }

    public function ban(Request $request, User $user): JsonResponse
    {
        $data = $request->validate(['note' => ['required', 'string', 'min:3', 'max:255']]);
        $impact = $this->admin->ban($user, $data['note']);

        return response()->json(['message' => 'Carpool access paused.', 'data' => $impact]);
    }

    public function restore(User $user): JsonResponse
    {
        $this->admin->restore($user);

        return response()->json(['message' => 'Carpool access restored.']);
    }

    // ---- Settings and banned words ----

    public function settings(): JsonResponse
    {
        return response()->json(['data' => $this->settingsPayload()]);
    }

    public function updateSettings(Request $request): JsonResponse
    {
        $data = $request->validate([
            'enabled' => ['sometimes', 'boolean'],
            'search_distance_km' => ['sometimes', 'integer', 'min:1', 'max:10'],
            'auto_complete_hours' => ['sometimes', 'integer', 'min:1', 'max:48'],
            'chat_retention_days' => ['sometimes', 'integer', 'min:1', 'max:30'],
        ]);
        $s = CarpoolSetting::query()->first() ?? CarpoolSetting::current();
        $s = CarpoolSetting::query()->find($s->id);
        foreach (['enabled', 'auto_complete_hours', 'chat_retention_days'] as $k) {
            if (array_key_exists($k, $data)) {
                $s->{$k} = $data[$k];
            }
        }
        if (isset($data['search_distance_km'])) {
            $s->search_distance_m = $data['search_distance_km'] * 1000;
        }
        $s->save();

        return response()->json(['data' => $this->settingsPayload()]);
    }

    private function settingsPayload(): array
    {
        $s = CarpoolSetting::current();

        return [
            'enabled' => (bool) $s->enabled,
            'search_distance_km' => (int) round($s->search_distance_m / 1000),
            'auto_complete_hours' => (int) $s->auto_complete_hours,
            'chat_retention_days' => (int) $s->chat_retention_days,
            'upcoming_carpools' => CarpoolListing::query()->where('status', CarpoolListing::STATUS_PUBLISHED)->count(),
            'kill_switch' => (bool) config('carpool.kill_switch'),
            'banned_words' => CarpoolBannedWord::query()->orderBy('word')->get(['id', 'word', 'active']),
        ];
    }

    public function addWord(Request $request): JsonResponse
    {
        $data = $request->validate(['word' => ['required', 'string', 'min:2', 'max:60']]);
        $word = mb_strtolower(trim($data['word']));
        $w = CarpoolBannedWord::query()->firstOrCreate(['word' => $word], ['active' => true]);

        return response()->json(['data' => $w], $w->wasRecentlyCreated ? 201 : 200);
    }

    public function updateWord(Request $request, CarpoolBannedWord $word): JsonResponse
    {
        $data = $request->validate(['active' => ['required', 'boolean']]);
        $word->active = $data['active'];
        $word->save();

        return response()->json(['data' => $word]);
    }

    public function deleteWord(CarpoolBannedWord $word): JsonResponse
    {
        $word->delete();

        return response()->json(['message' => 'Removed.']);
    }
}
