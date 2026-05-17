<?php

namespace App\Http\Controllers;

use App\Models\SavedLocation;
use Illuminate\Http\Request;

/**
 * Per-user saved locations. Each user owns their own rows; cross-user reads
 * and writes are blocked by the auth() check + ownership guard.
 */
class SavedLocationsController extends Controller
{
    public function index(Request $request)
    {
        $rows = SavedLocation::query()
            ->where('user_id', $request->user()->id)
            ->orderBy('label')
            ->get();

        return response()->json(['data' => $rows]);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'label' => ['required', 'string', 'max:80'],
            'address' => ['required', 'string', 'max:500'],
            'lat' => ['required', 'numeric', 'between:-90,90'],
            'lng' => ['required', 'numeric', 'between:-180,180'],
            'icon' => ['nullable', 'string', 'max:40'],
        ]);
        $data['user_id'] = $request->user()->id;

        $location = SavedLocation::query()->create($data);
        return response()->json(['location' => $location], 201);
    }

    public function update(Request $request, SavedLocation $savedLocation)
    {
        $this->ensureOwner($request, $savedLocation);
        $data = $request->validate([
            'label' => ['sometimes', 'string', 'max:80'],
            'address' => ['sometimes', 'string', 'max:500'],
            'lat' => ['sometimes', 'numeric', 'between:-90,90'],
            'lng' => ['sometimes', 'numeric', 'between:-180,180'],
            'icon' => ['nullable', 'string', 'max:40'],
        ]);
        $savedLocation->fill($data)->save();
        return response()->json(['location' => $savedLocation->fresh()]);
    }

    public function destroy(Request $request, SavedLocation $savedLocation)
    {
        $this->ensureOwner($request, $savedLocation);
        $savedLocation->delete();
        return response()->json(['message' => 'Saved location deleted.']);
    }

    private function ensureOwner(Request $request, SavedLocation $location): void
    {
        if ($location->user_id !== $request->user()->id) {
            abort(404);
        }
    }
}
