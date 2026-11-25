<?php

namespace App\Http\Controllers\Admin;

use App\Models\Carpool\CarpoolListing;
use App\Models\Carpool\CarpoolRating;
use App\Models\Carpool\CarpoolReport;
use App\Models\Carpool\CarpoolRequest;
use App\Models\Driver;
use App\Models\User;
use App\Services\Carpool\CarpoolAdminLog;
use App\Services\Carpool\CarpoolAdminScope;
use App\Services\Carpool\CarpoolPlanService;
use App\Services\Carpool\CarpoolPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * Carpool > People (Admin-Audit.md E-01, E-04, E-05): find a rider or driver by name, phone or
 * carpool number, and see everything carpool knows about them in one place. Read only; the
 * actions (pause access, edit car) are their own endpoints and are logged.
 */
class AdminCarpoolPeopleController
{
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'search' => ['sometimes', 'nullable', 'string', 'max:80'],
            'kind' => ['sometimes', 'nullable', 'in:all,drivers,riders,banned'],
        ]);
        $s = trim((string) ($data['search'] ?? ''));
        $kind = $data['kind'] ?? 'all';

        $q = User::query()->whereNull('manager_role_id');
        CarpoolAdminScope::people($q);

        // Only people carpool has seen: carpool drivers, people who asked to join, or people with a carpool ban.
        $q->where(fn ($w) => $w->whereHas('driver', fn ($d) => $d->where('driver_type', Driver::TYPE_CARPOOL))
            ->orWhereIn('id', DB::table('carpool_requests')->select('rider_id'))
            ->orWhereNotNull('carpool_banned_at'));

        match ($kind) {
            'drivers' => $q->whereHas('driver', fn ($d) => $d->where('driver_type', Driver::TYPE_CARPOOL)),
            'riders' => $q->whereIn('id', DB::table('carpool_requests')->select('rider_id')),
            'banned' => $q->whereNotNull('carpool_banned_at'),
            default => null,
        };

        if ($s !== '') {
            if (preg_match('/^#(\d{1,9})$/', $s, $m)) {
                $l = CarpoolListing::query()->with('driver')->find((int) $m[1]);
                $ids = $l ? CarpoolRequest::query()->where('listing_id', $l->id)->pluck('rider_id')->push($l->driver?->user_id)->filter()->all() : [];
                $q->whereIn('id', $ids ?: [0]);
            } else {
                $digits = preg_replace('/\D/', '', $s);
                $q->where(function ($w) use ($s, $digits) {
                    $w->where('name', 'like', "%{$s}%");
                    if (strlen($digits) >= 3) {
                        $w->orWhere('phone', 'like', "%{$digits}%");
                    }
                    if (ctype_digit($s) && strlen($s) < 8) {
                        $w->orWhere('id', (int) $s);
                    }
                    $plate = strtoupper((string) preg_replace('/[^A-Za-z0-9]/', '', $s));
                    if (strlen($plate) >= 4) {
                        $w->orWhereHas('driver.carpoolVehicle', fn ($v) => $v->where('plate', 'like', "%{$plate}%"));
                    }
                });
            }
        }

        $page = $q->with(['driver.city:id,name', 'driver.carpoolVehicle'])->orderByDesc('id')->paginate(25);
        $ids = $page->getCollection()->pluck('id');
        $trips = CarpoolRequest::query()->whereIn('rider_id', $ids)->where('status', CarpoolRequest::STATUS_COMPLETED)
            ->groupBy('rider_id')->selectRaw('rider_id, count(*) n')->pluck('n', 'rider_id');
        $reports = CarpoolReport::query()->whereIn('reported_user_id', $ids)->groupBy('reported_user_id')
            ->selectRaw('reported_user_id, count(*) n')->pluck('n', 'reported_user_id');

        return response()->json([
            'data' => $page->getCollection()->map(function (User $u) use ($trips, $reports) {
                $d = $u->driver && $u->driver->isCarpool() ? $u->driver : null;

                return [
                    'id' => $u->id,
                    'name' => $u->name,
                    'phone' => $u->phone,
                    'is_driver' => (bool) $d,
                    'driver_id' => $d?->id,
                    'approval' => $d?->approval_status,
                    'city' => $d?->city?->name,
                    'plate' => $d?->carpoolVehicle?->plate,
                    'rides_as_rider' => (int) ($trips[$u->id] ?? 0),
                    'reports_against' => (int) ($reports[$u->id] ?? 0),
                    'banned' => (bool) $u->carpool_banned_at,
                ];
            })->values(),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()],
        ]);
    }

    public function show(User $user): JsonResponse
    {
        abort_if($user->manager_role_id !== null, 404);
        CarpoolAdminScope::assertPerson($user);
        $user->loadMissing(['driver.city:id,name', 'driver.carpoolVehicle']);
        $driver = $user->driver && $user->driver->isCarpool() ? $user->driver : null;
        $present = app(CarpoolPresenter::class);

        $asRider = CarpoolRequest::query()->with(['listing.driver.user:id,name'])->where('rider_id', $user->id)
            ->orderByDesc('id')->limit(50)->get()->map(fn (CarpoolRequest $r) => [
                'request_id' => $r->id,
                'listing_id' => $r->listing_id,
                'route' => $r->listing ? $r->listing->start_name . ' to ' . $r->listing->end_name : null,
                'departs_at' => $r->listing?->departs_at?->toIso8601String(),
                'driver' => $r->listing?->driver?->user?->name,
                'seats' => $r->seats,
                'price_per_seat' => $r->is_free ? null : (int) $r->price_per_seat,
                'paid_marked' => (bool) $r->paid_marked,
                'status' => $r->status,
                'closed_reason' => $r->closed_reason,
            ]);

        $asDriver = $driver
            ? CarpoolListing::query()->where('driver_id', $driver->id)->orderByDesc('departs_at')->limit(50)->get()->map(fn (CarpoolListing $l) => [
                'listing_id' => $l->id,
                'route' => $l->start_name . ' to ' . $l->end_name,
                'departs_at' => $l->departs_at->toIso8601String(),
                'seats_taken' => $l->seats_taken,
                'seats_total' => $l->seats_total,
                'status' => $l->status === CarpoolListing::STATUS_COMPLETED && $l->completed_by === 'auto' ? 'auto_completed'
                    : ($l->status === CarpoolListing::STATUS_COMPLETED && $l->completed_by === 'admin' ? 'ended_by_admin' : $l->status),
                'cancel_reason' => $l->cancel_reason,
            ])
            : collect();

        $reportRow = fn (CarpoolReport $r) => [
            'id' => $r->id, 'created_at' => $r->created_at?->toIso8601String(), 'reason' => $r->reason, 'status' => $r->status,
            'listing_id' => $r->listing_id, 'other' => $r->relationLoaded('reporter') ? $r->reporter?->name : $r->reported?->name,
        ];
        $against = CarpoolReport::query()->with('reporter:id,name')->where('reported_user_id', $user->id)->orderByDesc('id')->limit(30)->get()->map($reportRow);
        $by = CarpoolReport::query()->with('reported:id,name')->where('reporter_id', $user->id)->orderByDesc('id')->limit(30)->get()->map($reportRow);

        $plan = null;
        if ($driver) {
            $plans = app(CarpoolPlanService::class);
            $active = $plans->activePlan($user);
            $queued = $plans->queuedPlan($user);
            $plan = [
                'active_until' => $active?->expires_at?->toIso8601String(),
                'waiting' => (bool) $queued,
                'waiting_starts' => $queued?->starts_at?->toIso8601String(),
            ];
        }
        $rating = $driver ? $present->ratingOf($user->id) : null;
        $car = $driver?->carpoolVehicle;

        return response()->json(['data' => [
            'id' => $user->id,
            'name' => $user->name,
            'phone' => $user->phone,
            'email' => $user->email && ! str_ends_with((string) $user->email, '@otp.local') ? $user->email : null,
            'joined_at' => $user->created_at?->toIso8601String(),
            'photo_url' => $user->avatar_path ? (str_starts_with($user->avatar_path, 'http') ? $user->avatar_path : Storage::disk('public')->url($user->avatar_path)) : null,
            'is_customer' => $user->hasRole('customer'),
            'banned' => (bool) $user->carpool_banned_at,
            'banned_at' => $user->carpool_banned_at?->toIso8601String(),
            'ban_reason' => $user->carpool_ban_reason,
            'driver' => $driver ? [
                'id' => $driver->id,
                'approval' => $driver->approval_status,
                'deactivated' => (bool) $driver->deactivated_at,
                'city' => $driver->city?->name,
                'city_id' => $driver->city_id,
                'car' => $car ? [
                    'make' => $car->make, 'model' => $car->model, 'colour' => $car->colour, 'plate' => $car->plate, 'seats' => $car->seats,
                    'front_photo_url' => $car->front_photo_path ? Storage::disk('public')->url($car->front_photo_path) : null,
                ] : null,
                'plan' => $plan,
                'rating_avg' => $rating['avg'] ?? null,
                'rating_count' => $rating['count'] ?? 0,
                'comments' => CarpoolRating::query()->where('rated_id', $user->id)->whereNotNull('comment')->orderByDesc('id')->limit(10)
                    ->get(['score', 'comment', 'created_at']),
            ] : null,
            'counts' => [
                'rides_as_rider' => CarpoolRequest::query()->where('rider_id', $user->id)->where('status', CarpoolRequest::STATUS_COMPLETED)->count(),
                'requests' => CarpoolRequest::query()->where('rider_id', $user->id)->count(),
                'no_shows' => CarpoolRequest::query()->where('rider_id', $user->id)->where('status', CarpoolRequest::STATUS_NO_SHOW)->count(),
                'carpools_published' => $driver ? CarpoolListing::query()->where('driver_id', $driver->id)->count() : 0,
                'carpools_completed' => $driver ? CarpoolListing::query()->where('driver_id', $driver->id)->where('status', CarpoolListing::STATUS_COMPLETED)->count() : 0,
                'reports_against' => CarpoolReport::query()->where('reported_user_id', $user->id)->count(),
                'reports_by' => CarpoolReport::query()->where('reporter_id', $user->id)->count(),
            ],
            'as_rider' => $asRider,
            'as_driver' => $asDriver,
            'reports_against' => $against,
            'reports_by' => $by,
            'history' => CarpoolAdminLog::forPerson($user->id),
        ]]);
    }
}
