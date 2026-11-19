<?php

namespace App\Http\Controllers\Carpool;

use App\Http\Controllers\Controller;
use App\Models\Carpool\CarpoolListing;
use App\Models\Carpool\CarpoolRequest;
use App\Models\Driver;
use App\Services\Carpool\CarpoolClock;
use App\Services\Carpool\CarpoolListingService;
use App\Services\Carpool\CarpoolPresenter;
use App\Services\Carpool\CarpoolRequestService;
use App\Services\Carpool\RouteGeometry;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Driver side of join requests (M4): Inbox, Accept, Decline, Remove, Paid tick, rider profile. */
class DriverRequestController extends Controller
{
    public function __construct(
        private CarpoolListingService $listings,
        private CarpoolRequestService $requests,
        private CarpoolPresenter $present,
    ) {
    }

    /**
     * Inbox (driver 7): one container per live carpool with waiting requests,
     * soonest first. Chats join these containers in M5.
     */
    public function inbox(Request $request): JsonResponse
    {
        $driver = $this->listings->driverFor($request->user());
        $pending = $this->pending($driver);

        $active = $pending->groupBy('listing_id')->map(function ($rows) {
            $l = $rows->first()->listing;
            $geo = RouteGeometry::of($l->route_polyline ?? []);

            return [
                'listing' => $this->listingSummary($l),
                'requests' => $rows->sortBy('id')->map(fn ($r) => $this->present->driverRequest($r, $l, $geo))->values(),
            ];
        })->sortBy(fn ($box) => $box['listing']['departs_at'])->values();

        return response()->json(['active' => $active, 'past' => [], 'count' => $pending->count()]);
    }

    /** The Inbox tab badge: waiting requests plus unread messages. */
    public function count(Request $request): JsonResponse
    {
        $driver = $this->listings->driverFor($request->user());

        return response()->json(['count' => $this->pending($driver)->count() + app(\App\Services\Carpool\CarpoolChatService::class)->unreadCount($request->user())]);
    }

    /** Rider profile (driver 8c): who they are on this carpool. Never the phone number. */
    public function show(Request $request, CarpoolRequest $carpoolRequest): JsonResponse
    {
        $driver = $this->listings->driverFor($request->user());
        $l = $carpoolRequest->listing;
        if ((int) $l->driver_id !== (int) $driver->id) {
            abort(404);
        }
        $rider = $carpoolRequest->rider;

        return response()->json(['data' => $this->present->driverRequest($carpoolRequest, $l) + [
            'profile' => [
                'joined' => $rider?->created_at ? CarpoolClock::local($rider->created_at)->format('Y-m') : null,
                'phone_verified' => (bool) $rider?->phone,
                'photo_added' => (bool) $rider?->avatar_path,
                'carpools_taken' => CarpoolRequest::query()->where('rider_id', $carpoolRequest->rider_id)
                    ->where('status', CarpoolRequest::STATUS_COMPLETED)->count(),
            ],
            'listing' => $this->listingSummary($l),
        ]]);
    }

    public function accept(Request $request, CarpoolRequest $carpoolRequest): JsonResponse
    {
        $r = $this->requests->accept($request->user(), $carpoolRequest);

        return response()->json(['data' => $this->present->driverRequest($r, $r->listing)]);
    }

    public function decline(Request $request, CarpoolRequest $carpoolRequest): JsonResponse
    {
        $r = $this->requests->decline($request->user(), $carpoolRequest);

        return response()->json(['data' => $this->present->driverRequest($r, $r->listing)]);
    }

    public function remove(Request $request, CarpoolRequest $carpoolRequest): JsonResponse
    {
        $r = $this->requests->remove($request->user(), $carpoolRequest);

        return response()->json(['data' => $this->present->driverRequest($r, $r->listing)]);
    }

    public function paid(Request $request, CarpoolRequest $carpoolRequest): JsonResponse
    {
        $data = $request->validate(['paid' => ['required', 'boolean']]);
        $r = $this->requests->markPaid($request->user(), $carpoolRequest, (bool) $data['paid']);

        return response()->json(['data' => $this->present->driverRequest($r, $r->listing)]);
    }

    /** Waiting requests on the driver's live carpools. */
    private function pending(Driver $driver)
    {
        return $this->requests->pendingFor($driver);
    }

    /** @return array<string, mixed> */
    private function listingSummary(CarpoolListing $l): array
    {
        return $this->present->listingSummary($l);
    }
}
