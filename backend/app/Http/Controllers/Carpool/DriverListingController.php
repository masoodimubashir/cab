<?php

namespace App\Http\Controllers\Carpool;

use App\Http\Controllers\Controller;
use App\Models\Carpool\CarpoolListing;
use App\Models\Carpool\CarpoolRequest;
use App\Services\Carpool\CarpoolClock;
use App\Services\Carpool\CarpoolListingService;
use App\Services\Carpool\CarpoolPresenter;
use App\Services\Carpool\CarpoolRequestService;
use App\Services\Carpool\RouteGeometry;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Driver carpools (M3): Home, the Carpools tab, publish, edit, delay, cancel.
 * M4 adds the waiting requests on Home and the riders on the carpool page.
 */
class DriverListingController extends Controller
{
    public function __construct(
        private CarpoolListingService $listings,
        private CarpoolRequestService $requests,
        private CarpoolPresenter $present,
    ) {
    }

    /**
     * Home: the next carpool, the requests switch, recent trips for Publish,
     * and "Waiting for you": the request on the soonest carpool in full, then
     * how many more there are (driver mockup 2).
     */
    public function home(Request $request): JsonResponse
    {
        $driver = $this->listings->driverFor($request->user());
        $next = $this->listings->nextFor($driver);
        $pending = $this->requests->pendingFor($driver);
        $first = $pending->first();
        $rest = $pending->slice(1);

        return response()->json([
            'next' => $next ? $this->shape($next) : null,
            'requests_on' => $this->listings->requestsOn($driver),
            'has_live' => CarpoolListing::query()->where('driver_id', $driver->id)
                ->where('status', CarpoolListing::STATUS_PUBLISHED)->exists(),
            'recent' => $this->listings->recentFor($driver)->map(fn ($l) => [
                'start' => $this->place($l, 'start'),
                'end' => $this->place($l, 'end'),
                'departs_at' => $l->departs_at->toIso8601String(),
            ])->values(),
            'waiting' => $pending->count(),
            'first_request' => $first
                ? $this->present->driverRequest($first, $first->listing) + ['listing' => $this->present->listingSummary($first->listing)]
                : null,
            'more' => [
                'count' => $rest->count(),
                'routes' => $rest->map(fn ($r) => "{$r->listing->start_name} to {$r->listing->end_name}")->unique()->values(),
            ],
        ]);
    }

    public function index(Request $request): JsonResponse
    {
        $filter = $request->validate(['filter' => ['nullable', 'in:upcoming,today,past']])['filter'] ?? 'upcoming';
        $driver = $this->listings->driverFor($request->user());

        return response()->json(['data' => $this->listings->listFor($driver, $filter)->map(fn ($l) => $this->shape($l))->values()]);
    }

    public function show(Request $request, CarpoolListing $listing): JsonResponse
    {
        $this->listings->owned($request->user(), $listing);

        return response()->json(['data' => $this->shape($listing, true)]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate($this->rules(true));
        $listing = $this->listings->publish($request->user(), $data);

        return response()->json(['data' => $this->shape($listing, true)], 201);
    }

    public function update(Request $request, CarpoolListing $listing): JsonResponse
    {
        $this->listings->owned($request->user(), $listing);
        $data = $request->validate($this->rules(false));

        return response()->json(['data' => $this->shape($this->listings->update($request->user(), $listing, $data), true)]);
    }

    public function delay(Request $request, CarpoolListing $listing): JsonResponse
    {
        return response()->json(['data' => $this->shape($this->listings->delay($request->user(), $listing), true)]);
    }

    public function cancel(Request $request, CarpoolListing $listing): JsonResponse
    {
        $data = $request->validate(['note' => ['nullable', 'string', 'max:255']]);

        return response()->json(['data' => $this->shape($this->listings->cancel($request->user(), $listing, $data['note'] ?? null), true)]);
    }

    public function requests(Request $request): JsonResponse
    {
        $data = $request->validate(['on' => ['required', 'boolean']]);

        return response()->json(['requests_on' => $this->listings->setRequests($request->user(), (bool) $data['on'])]);
    }

    /** @return array<string, mixed> */
    private function rules(bool $publish): array
    {
        $req = $publish ? 'required' : 'sometimes';
        $seatsMax = (int) config('carpool.seats_max', 6);
        $priceMax = (int) config('carpool.price_max', 5000);
        $rules = [
            'departs_at' => [$req, 'date'],
            'seats' => [$req, 'integer', 'min:1', "max:{$seatsMax}"],
            'is_free' => [$req, 'boolean'],
            'price_per_seat' => $publish
                ? ['required_if:is_free,false,0', 'nullable', 'integer', 'min:1', "max:{$priceMax}"]
                : ['sometimes', 'nullable', 'integer', 'min:1', "max:{$priceMax}"],
            'accepting_requests' => ['sometimes', 'boolean'],
            'route' => [$publish ? 'required' : 'sometimes', 'array'],
            'route.polyline' => ['required_with:route', 'array', 'min:2', 'max:5000'],
            'route.polyline.*' => ['array', 'size:2'],
            'route.polyline.*.0' => ['numeric', 'between:-90,90'],
            'route.polyline.*.1' => ['numeric', 'between:-180,180'],
            'route.distance_m' => ['required_with:route', 'integer', 'min:1'],
            'route.duration_s' => ['required_with:route', 'integer', 'min:1'],
            'route.summary' => ['nullable', 'string', 'max:120'],
        ];
        if ($publish) {
            foreach (['start', 'end'] as $p) {
                $rules[$p] = ['required', 'array'];
                $rules["{$p}.lat"] = ['required', 'numeric', 'between:-90,90'];
                $rules["{$p}.lng"] = ['required', 'numeric', 'between:-180,180'];
                $rules["{$p}.name"] = ['required', 'string', 'max:120'];
                $rules["{$p}.address"] = ['required', 'string', 'max:255'];
            }
        }

        return $rules;
    }

    /** @return array<string, mixed> */
    private function shape(CarpoolListing $l, bool $full = false): array
    {
        $out = [
            'id' => $l->id,
            'status' => $l->status,
            'start' => $this->place($l, 'start'),
            'end' => $this->place($l, 'end'),
            'route_summary' => $l->route_summary,
            'distance_m' => $l->distance_m,
            'duration_s' => $l->duration_s,
            'departs_at' => $l->departs_at->toIso8601String(),
            'departs_day' => CarpoolClock::daysFromToday($l->departs_at),
            'seats_total' => $l->seats_total,
            'seats_taken' => $l->seats_taken,
            'price_per_seat' => $l->price_per_seat,
            'is_free' => $l->is_free,
            'accepting_requests' => $l->accepting_requests,
            'cancel_reason' => $l->cancel_reason,
            'cancel_note' => $l->cancel_note,
            'can_edit' => $l->isEditable(),
        ];
        if ($full) {
            $out['route_polyline'] = $l->route_polyline;
            // Riders, in pickup order (driver mockup 8), and how many are still waiting.
            $geo = RouteGeometry::of($l->route_polyline ?? []);
            $out['riders'] = $l->requests()->where('status', CarpoolRequest::STATUS_ACCEPTED)->with('rider')
                ->orderBy('pickup_m')->get()->map(fn ($r) => $this->present->driverRequest($r, $l, $geo))->values();
            $out['pending_count'] = $l->requests()->where('status', CarpoolRequest::STATUS_PENDING)->count();
        }

        return $out;
    }

    /** @return array<string, mixed> */
    private function place(CarpoolListing $l, string $p): array
    {
        return [
            'lat' => $l->{"{$p}_lat"},
            'lng' => $l->{"{$p}_lng"},
            'name' => $l->{"{$p}_name"},
            'address' => $l->{"{$p}_address"},
        ];
    }
}
