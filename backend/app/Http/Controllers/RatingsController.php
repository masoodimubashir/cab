<?php

namespace App\Http\Controllers;

use App\Models\Driver;
use App\Models\Rating;
use App\Models\Trip;
use Illuminate\Http\Request;

class RatingsController extends Controller
{
    public function store(Request $request, Trip $trip)
    {
        $data = $request->validate([
            'score' => ['required', 'integer', 'min:1', 'max:5'],
            'comment' => ['nullable', 'string', 'max:2000'],
        ]);

        $user = $request->user();
        if ($trip->customer_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        if ($trip->status !== 'COMPLETED') {
            return response()->json(['message' => 'Trip must be completed before rating.'], 409);
        }

        if (Rating::query()->where('trip_id', $trip->id)->exists()) {
            return response()->json(['message' => 'Rating already submitted for this trip.'], 409);
        }

        if (!$trip->driver_id) {
            return response()->json(['message' => 'Driver not assigned.'], 422);
        }

        $rating = Rating::query()->create([
            'trip_id' => $trip->id,
            'customer_id' => $trip->customer_id,
            'driver_id' => $trip->driver_id,
            'score' => (int) $data['score'],
            'comment' => $data['comment'] ?? null,
        ]);

        // Update driver aggregate rating.
        $avg = Rating::query()->where('driver_id', $trip->driver_id)->avg('score');
        $count = Rating::query()->where('driver_id', $trip->driver_id)->count();

        Driver::query()->where('user_id', $trip->driver_id)->update([
            'rating_avg' => $avg ? (float) $avg : 0.0,
            'rating_count' => (int) $count,
        ]);

        return response()->json(['rating' => $rating->fresh()]);
    }

    /**
     * Detail view for a single customer trip — the trip-details screen.
     * Loads payment + driver + applied_promotion eager so the breakdown,
     * payment status, and Pay-button gating can be rendered in one round-trip.
     */
    public function customerTripDetail(Request $request, Trip $trip)
    {
        $user = $request->user();
        if ($trip->customer_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $trip->load([
            'payment:id,trip_id,method,status,amount,discount_amount,paid_at,coupon_assignment_id',
            'driver:id,name,phone,avatar_path',
            'appliedPromotion:id,title,discount_type,discount_value',
        ]);

        return response()->json(['trip' => $trip]);
    }

    public function historyCustomer(Request $request)
    {
        $user = $request->user();

        $query = Trip::query()->where('customer_id', $user->id);

        $this->applyTripFilters($request, $query);

        $trips = $query
            ->with([
                'payment:id,trip_id,method,status,amount,discount_amount,paid_at',
                'rideType:id,name',
            ])
            ->orderByDesc('completed_at')
            ->orderByDesc('created_at')
            ->paginate(20);

        return response()->json(['data' => $trips]);
    }

    public function historyDriver(Request $request)
    {
        $user = $request->user();

        $query = Trip::query()->where('driver_id', $user->id);

        $this->applyTripFilters($request, $query);

        $trips = $query
            ->with([
                'payment:id,trip_id,method,status,amount,discount_amount,paid_at',
                'rideType:id,name',
            ])
            ->orderByDesc('completed_at')
            ->orderByDesc('created_at')
            ->paginate(20);

        return response()->json(['data' => $trips]);
    }

    /**
     * Shared status + payment + city/date filters for the customer and driver
     * history endpoints. Mutates the query in place.
     */
    private function applyTripFilters(Request $request, $query): void
    {
        // ── status filter ───────────────────────────────────────────
        // completed = ride finished cleanly
        // cancelled = cancelled without a no-show flag (either side bailed early)
        // missed    = cancelled AND no_show_by is set (someone didn't show up)
        $status = $request->query('status', 'all');
        if ($status === 'completed') {
            $query->where('status', 'COMPLETED');
        } elseif ($status === 'cancelled') {
            $query->where('status', 'CANCELLED')->whereNull('no_show_by');
        } elseif ($status === 'missed') {
            $query->where('status', 'CANCELLED')->whereNotNull('no_show_by');
        }

        // ── payment filter ──────────────────────────────────────────
        // paid    = a payments row exists with status SUCCESS
        // unpaid  = no SUCCESS payment row yet (still owed, pending, or failed)
        $payment = $request->query('payment', 'all');
        if ($payment === 'paid') {
            $query->whereHas('payment', function ($q) {
                $q->where('status', 'SUCCESS');
            });
        } elseif ($payment === 'unpaid') {
            $query->where('status', 'COMPLETED')
                ->where(function ($q) {
                    $q->whereDoesntHave('payment')
                      ->orWhereHas('payment', function ($p) {
                          $p->where('status', '!=', 'SUCCESS');
                      });
                });
        }

        // ── ride type filter ────────────────────────────────────────
        // Filters by the real ride_types row the trip was booked under.
        if ($rideTypeId = $request->query('ride_type_id')) {
            $query->where('ride_type_id', (int) $rideTypeId);
        }

        // ── payment method filter ───────────────────────────────────
        // payments.method is the CASH / RAZORPAY enum; only trips with a
        // matching payment row are returned.
        $method = $request->query('payment_method');
        if ($method && $method !== 'all') {
            $method = strtoupper($method);
            $query->whereHas('payment', function ($q) use ($method) {
                $q->where('method', $method);
            });
        }

        // Optional city + date-range filters (untouched when omitted).
        if ($cityId = $request->query('city_id')) {
            $query->where('city_id', (int) $cityId);
        }
        if ($from = $request->query('from')) {
            $query->where('created_at', '>=', $from);
        }
        if ($to = $request->query('to')) {
            $query->where('created_at', '<=', $to);
        }
    }
}

