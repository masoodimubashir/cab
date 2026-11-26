<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Carpool\CarpoolDocumentRenewal;
use App\Models\Document;
use App\Models\Driver;
use App\Services\Carpool\CarpoolAdminScope;
use App\Services\Carpool\CarpoolDocuments;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * S11 (choice C): an admin corrects a document's expiry date, lets a driver keep going until a day, and approves
 * or rejects a renewed copy. Each needs a reason and is logged; managers act only in their cities (404 otherwise).
 */
class AdminCarpoolDocumentsController extends Controller
{
    public function __construct(private CarpoolDocuments $documents)
    {
    }

    public function setExpiry(Request $request, Driver $driver, Document $document): JsonResponse
    {
        $this->carpoolDriver($driver);
        $data = $request->validate([
            'date' => ['required', 'date_format:Y-m-d'],
            'note' => ['required', 'string', 'min:3', 'max:500'],
            // Upload on behalf: an optional photo of the new copy (same limit as the driver's renewal).
            'file' => ['nullable', 'image', 'max:' . (int) config('carpool.photo_max_kb', 4096)],
        ]);
        $this->documents->setExpiry($driver, $document, $data['date'], $data['note'], $request->file('file'));

        return response()->json(['message' => $request->hasFile('file') ? 'Uploaded. The driver was told.' : 'Expiry date saved.', 'data' => $this->documents->items($driver)]);
    }

    public function allowUntil(Request $request, Driver $driver, Document $document): JsonResponse
    {
        $this->carpoolDriver($driver);
        $data = $request->validate(['date' => ['present', 'nullable', 'date_format:Y-m-d', 'after_or_equal:today'], 'note' => ['required', 'string', 'min:3', 'max:500']]);
        $this->documents->allowUntil($driver, $document, $data['date'], $data['note']);

        return response()->json(['message' => $data['date'] ? 'Allowed until that day.' : 'Back to the document date.', 'data' => $this->documents->items($driver)]);
    }

    public function approve(CarpoolDocumentRenewal $renewal): JsonResponse
    {
        $this->carpoolDriver($renewal->driver);
        $this->documents->approve($renewal);

        return response()->json(['message' => 'Approved. The driver was told.', 'data' => $this->documents->items($renewal->driver)]);
    }

    public function reject(Request $request, CarpoolDocumentRenewal $renewal): JsonResponse
    {
        $this->carpoolDriver($renewal->driver);
        $data = $request->validate(['reason' => ['required', 'string', 'min:3', 'max:255']]);
        $this->documents->reject($renewal, $data['reason']);

        return response()->json(['message' => 'Rejected. The driver was told why.', 'data' => $this->documents->items($renewal->driver)]);
    }

    public function file(CarpoolDocumentRenewal $renewal): StreamedResponse
    {
        $this->carpoolDriver($renewal->driver);
        abort_unless($renewal->status === CarpoolDocumentRenewal::STATUS_PENDING && Storage::disk('local')->exists($renewal->file_path), 404);

        return Storage::disk('local')->response($renewal->file_path);
    }

    private function carpoolDriver(?Driver $driver): void
    {
        abort_unless($driver && $driver->isCarpool(), 404);
        CarpoolAdminScope::assertCity($driver->city_id);
    }
}
