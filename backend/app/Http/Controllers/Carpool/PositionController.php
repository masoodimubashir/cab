<?php

namespace App\Http\Controllers\Carpool;

use App\Http\Controllers\Controller;
use App\Models\Carpool\CarpoolListing;
use App\Services\Carpool\CarpoolTracking;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** L1 live location: the driver's phone sends positions; riders on the carpool read the newest one. */
class PositionController extends Controller
{
    public function __construct(private CarpoolTracking $tracking) {}

    /** POST /api/carpool/driver/listings/{listing}/position */
    public function store(Request $request, CarpoolListing $listing): JsonResponse
    {
        $data = $request->validate([
            'lat' => ['required', 'numeric', 'between:-90,90'],
            'lng' => ['required', 'numeric', 'between:-180,180'],
            'accuracy' => ['nullable', 'numeric', 'min:0'],
            'speed' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'heading' => ['nullable', 'numeric', 'min:0', 'max:360'],
            'at' => ['nullable', 'integer'],
        ]);

        return response()->json(['data' => ['stored' => $this->tracking->record($request->user(), $listing, $data)]]);
    }

    /** GET /api/carpool/rides/{listing}/position */
    public function show(Request $request, CarpoolListing $listing): JsonResponse
    {
        return response()->json(['data' => $this->tracking->riderView($request->user(), $listing)]);
    }
}
