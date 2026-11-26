<?php

namespace App\Http\Controllers\Admin;

use App\Models\Carpool\CarpoolAdminAction;
use App\Models\Carpool\CarpoolListing;
use App\Models\Carpool\CarpoolReport;
use App\Models\Carpool\CarpoolRequest;
use App\Models\Driver;
use App\Models\DriverSubscription;
use App\Models\SubscriptionPlan;
use App\Models\User;
use App\Services\Carpool\CarpoolAdminScope;
use App\Services\Carpool\CarpoolClock;
use App\Services\Carpool\CarpoolJobStatus;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Carpool > Overview (Admin-Audit.md G-01): what happened in a period, by India day, for the manager's
 * cities. Built only from carpool tables, so nothing in Dashboard or Analytics moves. No money figures
 * (payments are on hold, Dev-Plan section 8).
 */
class AdminCarpoolOverviewController
{
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'from' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'nullable', 'date_format:Y-m-d', 'after_or_equal:from'],
            'city_id' => ['sometimes', 'nullable', 'integer'],
        ]);
        $today = CarpoolClock::today();
        $to = $data['to'] ?? $today;
        $from = $data['from'] ?? CarbonImmutable::parse($to)->subDays(29)->toDateString();
        if (CarbonImmutable::parse($from)->diffInDays(CarbonImmutable::parse($to)) > 366) {
            abort(422, 'Choose a period of one year or less.');
        }
        $start = CarpoolClock::startOfDay($from);
        $end = CarpoolClock::endOfDay($to);
        $city = $data['city_id'] ?? null;

        $listings = fn () => CarpoolAdminScope::listings(CarpoolListing::query())->when($city, fn ($q) => $q->where('city_id', $city));
        $departing = $listings()->where('departs_at', '>=', $start)->where('departs_at', '<', $end)
            ->get(['id', 'departs_at', 'status', 'cancel_reason', 'completed_by', 'seats_total', 'seats_taken', 'counts_as_ride']);
        $ids = $departing->pluck('id');
        $requests = CarpoolRequest::query()->whereIn('listing_id', $ids)->get(['id', 'listing_id', 'rider_id', 'seats', 'status', 'closed_reason']);

        $completed = $departing->where('status', CarpoolListing::STATUS_COMPLETED);
        $cancelled = $departing->where('status', CarpoolListing::STATUS_CANCELLED);
        $carried = $requests->where('status', CarpoolRequest::STATUS_COMPLETED);

        // Per India day.
        $days = [];
        for ($d = CarbonImmutable::parse($from); $d->lte(CarbonImmutable::parse($to)); $d = $d->addDay()) {
            $days[$d->toDateString()] = ['day' => $d->toDateString(), 'carpools' => 0, 'completed' => 0, 'cancelled' => 0, 'riders' => 0, 'seats_offered' => 0];
        }
        $dayOf = fn ($at) => CarpoolClock::dateOf(CarbonImmutable::parse($at));
        $riderCount = $carried->groupBy('listing_id')->map->count();
        foreach ($departing as $l) {
            $k = $dayOf($l->departs_at);
            if (! isset($days[$k])) {
                continue;
            }
            $days[$k]['carpools']++;
            if ($l->status === CarpoolListing::STATUS_COMPLETED) {
                $days[$k]['seats_offered'] += (int) $l->seats_total; // only finished carpools could have been filled (F29-2)
                $days[$k]['completed']++;
                $days[$k]['riders'] += (int) ($riderCount[$l->id] ?? 0);
            } elseif ($l->status === CarpoolListing::STATUS_CANCELLED) {
                $days[$k]['cancelled']++;
            }
        }

        $reports = CarpoolAdminScope::reports(CarpoolReport::query());
        $driversQ = Driver::query()->carpool()->when($city, fn ($q) => $q->where('city_id', $city));
        $scope = CarpoolAdminScope::cities();
        if ($scope !== null) {
            $driversQ->whereIn('city_id', $scope);
        }

        return response()->json(['data' => [
            'from' => $from,
            'to' => $to,
            'carpools' => [
                'departing' => $departing->count(),
                'completed' => $completed->count(),
                'with_riders' => $completed->where('counts_as_ride', true)->count(),
                'auto_completed' => $completed->where('completed_by', 'auto')->count(),
                'ended_by_admin' => $completed->where('completed_by', 'admin')->count(),
                'cancelled' => $cancelled->count(),
                'cancelled_by' => [
                    'driver' => $cancelled->where('cancel_reason', CarpoolListing::CANCEL_DRIVER)->count(),
                    'missed_departure' => $cancelled->where('cancel_reason', CarpoolListing::CANCEL_MISSED)->count(),
                    'plan_ended' => $cancelled->where('cancel_reason', CarpoolListing::CANCEL_PLAN_ENDED)->count(),
                    'admin' => $cancelled->where('cancel_reason', CarpoolListing::CANCEL_ADMIN)->count(),
                ],
                'still_open' => $departing->whereIn('status', CarpoolListing::LIVE)->count(),
                'published_in_period' => $listings()->where('created_at', '>=', $start)->where('created_at', '<', $end)->count(),
            ],
            'seats' => [
                'offered' => (int) $completed->sum('seats_total'),
                'filled' => (int) $carried->sum('seats'),
            ],
            'riders' => [
                'requests' => $requests->count(),
                'accepted' => $requests->whereIn('status', [CarpoolRequest::STATUS_ACCEPTED, CarpoolRequest::STATUS_COMPLETED, CarpoolRequest::STATUS_NO_SHOW, CarpoolRequest::STATUS_REMOVED])->count(),
                'carried' => $carried->count(),
                'unique_riders' => $carried->pluck('rider_id')->unique()->count(),
                'no_shows' => $requests->where('status', CarpoolRequest::STATUS_NO_SHOW)->where('closed_reason', '!=', CarpoolRequest::CLOSED_NOT_CONFIRMED)->count(),
                'not_confirmed' => $requests->where('status', CarpoolRequest::STATUS_NO_SHOW)->where('closed_reason', CarpoolRequest::CLOSED_NOT_CONFIRMED)->count(),
            ],
            'safety' => [
                'reports_opened' => (clone $reports)->where('created_at', '>=', $start)->where('created_at', '<', $end)->count(),
                'reports_open_now' => (clone $reports)->where('status', 'open')->count(),
                // A city manager counts only pauses of people in their cities, like every other figure here.
                'bans' => CarpoolAdminAction::query()->where('action', 'ban')->where('created_at', '>=', $start)->where('created_at', '<', $end)
                    ->when($scope !== null, fn ($q) => $q->whereIn('subject_user_id', CarpoolAdminScope::people(User::query())->select('id')))->count(),
                'banned_now' => CarpoolAdminScope::people(User::query())->whereNotNull('carpool_banned_at')->count(),
            ],
            'drivers' => [
                'signed_up' => (clone $driversQ)->where('created_at', '>=', $start)->where('created_at', '<', $end)->count(),
                'waiting_approval' => (clone $driversQ)->where('approval_status', 'pending')->count(),
                'approved' => (clone $driversQ)->where('approval_status', 'approved')->whereNull('deactivated_at')->count(),
                'with_plan_now' => DriverSubscription::query()->where('status', DriverSubscription::STATUS_ACTIVE)->where('starts_at', '<=', now())
                    ->where('expires_at', '>', now())
                    ->whereHas('plan', fn ($p) => $p->where('audience', SubscriptionPlan::AUDIENCE_CARPOOL))
                    ->whereIn('driver_user_id', (clone $driversQ)->select('user_id'))->distinct()->count('driver_user_id'),
            ],
            'days' => array_values($days),
            'jobs_late' => collect(CarpoolJobStatus::all())->where('late', true)->count(),
        ]]);
    }
}
