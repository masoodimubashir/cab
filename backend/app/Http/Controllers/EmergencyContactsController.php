<?php

namespace App\Http\Controllers;

use App\Models\EmergencyContact;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Per-user emergency contacts CRUD.
 *
 * Used by the driver and customer mobile apps. Auth-only — operates strictly
 * on the calling user's own contacts; no cross-user access.
 */
class EmergencyContactsController extends Controller
{
    public function index(Request $request)
    {
        $rows = EmergencyContact::query()
            ->where('user_id', $request->user()->id)
            ->orderByDesc('is_primary')
            ->orderBy('name')
            ->get();

        return response()->json(['data' => $rows]);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'phone' => ['required', 'string', 'max:32'],
            'relationship' => ['nullable', 'string', 'max:60'],
            'is_primary' => ['nullable', 'boolean'],
        ]);

        $contact = DB::transaction(function () use ($data, $request) {
            $userId = $request->user()->id;
            if (!empty($data['is_primary'])) {
                // Only one primary contact per user — demote the rest first.
                EmergencyContact::query()
                    ->where('user_id', $userId)
                    ->update(['is_primary' => false]);
            }
            return EmergencyContact::query()->create([
                'user_id' => $userId,
                'name' => $data['name'],
                'phone' => $data['phone'],
                'relationship' => $data['relationship'] ?? null,
                'is_primary' => (bool) ($data['is_primary'] ?? false),
            ]);
        });

        return response()->json(['contact' => $contact], 201);
    }

    public function update(Request $request, EmergencyContact $emergencyContact)
    {
        $this->authorize($request, $emergencyContact);
        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:120'],
            'phone' => ['sometimes', 'string', 'max:32'],
            'relationship' => ['nullable', 'string', 'max:60'],
            'is_primary' => ['sometimes', 'boolean'],
        ]);

        DB::transaction(function () use ($data, $request, $emergencyContact) {
            if (!empty($data['is_primary'])) {
                EmergencyContact::query()
                    ->where('user_id', $request->user()->id)
                    ->where('id', '!=', $emergencyContact->id)
                    ->update(['is_primary' => false]);
            }
            $emergencyContact->fill($data)->save();
        });

        return response()->json(['contact' => $emergencyContact->fresh()]);
    }

    public function destroy(Request $request, EmergencyContact $emergencyContact)
    {
        $this->authorize($request, $emergencyContact);
        $emergencyContact->delete();
        return response()->json(['message' => 'Contact deleted.']);
    }

    private function authorize(Request $request, EmergencyContact $contact): void
    {
        if ($contact->user_id !== $request->user()->id) {
            abort(404);
        }
    }
}
