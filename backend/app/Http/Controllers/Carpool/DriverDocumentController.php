<?php

namespace App\Http\Controllers\Carpool;

use App\Http\Controllers\Controller;
use App\Models\Document;
use App\Services\Carpool\CarpoolDocuments;
use App\Services\Carpool\CarpoolListingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** S11 (choice A1): the driver sees their dated documents and sends a renewed copy for review. */
class DriverDocumentController extends Controller
{
    public function __construct(private CarpoolListingService $listings, private CarpoolDocuments $documents)
    {
    }

    public function index(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->documents->summary($this->listings->driverFor($request->user()))]);
    }

    public function renew(Request $request, Document $document): JsonResponse
    {
        $data = $request->validate([
            'file' => ['required', 'image', 'max:' . (int) config('carpool.photo_max_kb', 4096)],
            'expiry_date' => ['required', 'date_format:Y-m-d'],
        ]);
        $renewal = $this->documents->submitRenewal($this->listings->driverFor($request->user()), $document, $request->file('file'), $data['expiry_date']);

        return response()->json(['message' => 'Sent. Dream Cabs will check it soon.', 'data' => [
            'id' => $renewal->id, 'status' => $renewal->status, 'expiry_date' => $renewal->expiry_date->toDateString(),
        ]], 201);
    }
}
