<?php

namespace App\Http\Controllers\Admin;

use App\Models\Driver;
use App\Models\DriverDocument;
use Illuminate\Http\Request;

class AdminDriversController
{
    public function index()
    {
        $drivers = Driver::query()
            ->with(['user', 'documents'])
            ->orderBy('created_at', 'desc')
            ->paginate(20);

        return response()->json(['data' => $drivers]);
    }

    public function setApproval(Request $request, Driver $driver)
    {
        $data = $request->validate([
            'approval_status' => ['required', 'in:approved,rejected'],
            'rejection_reason' => ['nullable', 'string', 'max:1000'],
        ]);

        if ($data['approval_status'] === 'approved') {
            // Ensure every required document is approved first.
            $requiredDocs = ['DL', 'RC', 'INSURANCE', 'ID'];
            foreach ($requiredDocs as $docType) {
                $doc = DriverDocument::query()
                    ->where('driver_id', $driver->id)
                    ->where('document_type', $docType)
                    ->first();
                if (!$doc || $doc->status !== 'approved') {
                    return response()->json([
                        'message' => 'All required documents must be approved before approving the driver.',
                        'missing' => array_values(array_filter([$docType])),
                    ], 422);
                }
            }

            $driver->approval_status = 'approved';
            $driver->approved_at = now();
            $driver->rejected_at = null;
        } else {
            $driver->approval_status = 'rejected';
            $driver->rejected_at = now();
            $driver->approved_at = null;
            $driver->is_online = false;
        }

        $driver->save();

        return response()->json(['driver' => $driver->fresh()]);
    }

    public function setDocumentStatus(Request $request, DriverDocument $document)
    {
        $data = $request->validate([
            'status' => ['required', 'in:approved,rejected'],
            'rejection_reason' => ['nullable', 'string', 'max:1000'],
        ]);

        $document->status = $data['status'];
        $document->rejection_reason = $data['rejection_reason'] ?? null;
        $document->save();

        return response()->json(['document' => $document->fresh()]);
    }
}

