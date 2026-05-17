<?php

namespace App\Http\Controllers\Admin;

use App\Models\RideType;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * CRUD for the global ride_types registry — service categories like
 * Airport, Delivery, Pool, Car Rental. Coexists with the legacy read-only
 * endpoint exposed by AdminPricingController::rideTypes (kept intact so
 * existing screens that depend on it don't break).
 */
class AdminRideTypesController
{
    public function index()
    {
        $rows = RideType::query()
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get()
            ->map(fn (RideType $r) => $this->shape($r));

        return response()->json(['data' => $rows]);
    }

    public function show(RideType $rideType)
    {
        return response()->json(['ride_type' => $this->shape($rideType)]);
    }

    public function store(Request $request)
    {
        $data = $this->validatePayload($request, partial: false);
        $row = RideType::query()->create($data);

        return response()->json([
            'ride_type' => $this->shape($row->fresh()),
            'message' => 'Ride type created.',
        ], 201);
    }

    public function update(Request $request, RideType $rideType)
    {
        $data = $this->validatePayload($request, partial: true, currentId: $rideType->id);
        $rideType->fill($data);
        $rideType->save();

        return response()->json([
            'ride_type' => $this->shape($rideType->fresh()),
            'message' => 'Ride type updated.',
        ]);
    }

    public function destroy(RideType $rideType)
    {
        // Don't allow deletion when other rows still reference this. Returning
        // a 409 is friendlier than letting the DB FK error bubble up.
        if ($rideType->pricingRules()->exists() || $rideType->trips()->exists()) {
            return response()->json([
                'message' => 'Ride type is referenced by existing pricing rules or trips.',
            ], 409);
        }
        $rideType->delete();
        return response()->json(['message' => 'Ride type deleted.']);
    }

    private function validatePayload(Request $request, bool $partial, ?int $currentId = null): array
    {
        $sometimes = $partial ? 'sometimes' : 'required';
        $unique = Rule::unique('ride_types', 'name');
        if ($currentId) {
            $unique = $unique->ignore($currentId);
        }

        return $request->validate([
            'name' => [$sometimes, 'string', 'max:160', $unique],
            'description' => ['nullable', 'string', 'max:500'],
            'sort_order' => ['nullable', 'integer', 'min:0', 'max:9999'],
        ]);
    }

    private function shape(RideType $r): array
    {
        return [
            'id' => $r->id,
            'name' => $r->name,
            'description' => $r->description,
            'sort_order' => (int) ($r->sort_order ?? 0),
            'created_at' => optional($r->created_at)->toIso8601String(),
            'updated_at' => optional($r->updated_at)->toIso8601String(),
        ];
    }
}
