<?php

namespace App\Http\Controllers;

use App\Models\Driver;
use App\Models\DriverDocument;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class DriversController extends Controller
{
    public function register(Request $request)
    {
        $data = $request->validate([
            'vehicle_type' => ['required', 'string', 'max:100'],
            'vehicle_brand' => ['nullable', 'string', 'max:100'],
            'vehicle_model' => ['nullable', 'string', 'max:100'],
            'vehicle_color' => ['nullable', 'string', 'max:100'],
            'vehicle_reg_no' => ['required', 'string', 'max:50'],
        ]);

        $user = $request->user();

        $driver = Driver::query()->updateOrCreate(
            ['user_id' => $user->id],
            [
                'approval_status' => 'pending',
                'vehicle_type' => $data['vehicle_type'],
                'vehicle_brand' => $data['vehicle_brand'] ?? null,
                'vehicle_model' => $data['vehicle_model'] ?? null,
                'vehicle_color' => $data['vehicle_color'] ?? null,
                'vehicle_reg_no' => $data['vehicle_reg_no'],
            ]
        );

        $user->role = 'driver';
        $user->save();

        return response()->json([
            'driver' => $driver->fresh(),
            'user' => $user->fresh(['id', 'name', 'role', 'phone', 'email']),
        ]);
    }

    /**
     * Current user's driver profile (if any), for mobile dashboard / status.
     */
    public function me(Request $request)
    {
        $user = $request->user();
        $driver = Driver::query()->where('user_id', $user->id)->first();

        return response()->json([
            'user' => $user->only(['id', 'name', 'role', 'phone', 'email']),
            'driver' => $driver,
        ]);
    }

    public function uploadDocument(Request $request)
    {
        $data = $request->validate([
            'document_type' => ['required', 'in:DL,RC,INSURANCE,ID'],
            'file' => ['required'],
            'file' => ['required', 'file', 'max:10240'],
        ]);

        $user = $request->user();
        $driver = Driver::query()->where('user_id', $user->id)->first();
        if (!$driver) {
            return response()->json(['message' => 'Driver profile not found.'], 404);
        }

        $file = $request->file('file');
        // Store in the non-public disk; documents should only be accessible through
        // authenticated/admin workflows (file serving endpoints, if added later).
        $path = $file->store('driver-documents', 'local');

        $doc = DriverDocument::query()->updateOrCreate(
            ['driver_id' => $driver->id, 'document_type' => $data['document_type']],
            [
                'file_path' => $path,
                'status' => 'uploaded',
                'rejection_reason' => null,
            ]
        );

        return response()->json(['document' => $doc->fresh()]);
    }

    public function goOnline(Request $request)
    {
        $user = $request->user();
        $driver = Driver::query()->where('user_id', $user->id)->first();
        if (!$driver) {
            return response()->json(['message' => 'Driver profile not found.'], 404);
        }

        if ($driver->approval_status !== 'approved') {
            return response()->json(['message' => 'Driver is not approved.'], 422);
        }

        $requiredDocs = ['DL', 'RC', 'INSURANCE', 'ID'];
        $missing = [];
        foreach ($requiredDocs as $docType) {
            $doc = DriverDocument::query()
                ->where('driver_id', $driver->id)
                ->where('document_type', $docType)
                ->first();
            if (!$doc || $doc->status !== 'approved') {
                $missing[] = $docType;
            }
        }

        if (!empty($missing)) {
            return response()->json([
                'message' => 'Not all required documents are approved.',
                'missing' => $missing,
            ], 422);
        }

        $driver->is_online = true;
        $driver->last_online_at = now();
        $driver->save();

        return response()->json(['driver' => $driver->fresh()]);
    }

    public function goOffline(Request $request)
    {
        $user = $request->user();
        $driver = Driver::query()->where('user_id', $user->id)->first();
        if (!$driver) {
            return response()->json(['message' => 'Driver profile not found.'], 404);
        }

        $driver->is_online = false;
        $driver->last_offline_at = now();
        $driver->save();

        return response()->json(['driver' => $driver->fresh()]);
    }
}

