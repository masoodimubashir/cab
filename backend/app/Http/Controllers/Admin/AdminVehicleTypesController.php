<?php

namespace App\Http\Controllers\Admin;

use App\Events\FixedRouteCatalogUpdated;
use App\Models\City;
use App\Models\CityVehicleType;
use App\Models\CityVehicleTypeImage;
use App\Models\OutstationPackage;
use App\Models\PricingRule;
use App\Models\RideType;
use App\Models\Route;
use App\Models\VehicleSeatLayout;
use App\Models\VehicleSeatLayoutCell;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class AdminVehicleTypesController
{
    /**
     * List all vehicle types for a city. The Enabled/Disabled split in the
     * Jugnoo UI is just is_active=true|false; the frontend filters client-side.
     */
    public function index(Request $request, City $city)
    {
        $rows = CityVehicleType::query()
            ->with(['rideType:id,name', 'vehicleType:id,name', 'vehicleSet:id,name'])
            ->where('city_id', $city->id)
            ->orderBy('display_order')
            ->orderBy('id')
            ->get()
            ->map(fn (CityVehicleType $v) => $this->shape($v));

        return response()->json([
            'city_id' => $city->id,
            'data' => $rows,
            'available_ride_types' => RideType::query()
                ->orderBy('sort_order')
                ->get(['id', 'name'])
                ->toArray(),
            'available_vehicle_types' => \App\Models\VehicleType::query()
                ->where('is_active', true)
                ->orderBy('sort_order')
                ->get(['id', 'name'])
                ->toArray(),
        ]);
    }

    public function show(City $city, CityVehicleType $vehicleType)
    {
        $this->guard($city, $vehicleType);
        $vehicleType->load(['rideType:id,name', 'vehicleType:id,name', 'vehicleSet:id,name']);

        return response()->json(['vehicle_type' => $this->shape($vehicleType)]);
    }

    /**
     * Create a vehicle in this city — one row per Vehicle Name + ride type.
     * The (city, ride_type, display_name) tuple is unique at the DB level, so
     * re-posting the same vehicle returns a conflict.
     */
    public function store(Request $request, City $city)
    {
        $data = $request->validate([
            'ride_type_id' => ['nullable', 'integer', 'exists:ride_types,id'],
            'vehicle_type_id' => ['required', 'integer', 'exists:vehicle_types,id'],
            'display_name' => ['required', 'string', 'max:120'],
            'display_order' => ['nullable', 'integer', 'min:0', 'max:9999'],
            'max_people' => ['required', 'integer', 'min:1', 'max:99'],
            'luggage_capacity' => ['required', 'integer', 'min:0', 'max:99'],
            'reverse_bidding_enabled' => ['nullable', 'boolean'],
            'is_active' => ['nullable', 'boolean'],
        ]);

        $rideType = isset($data['ride_type_id']) ? RideType::query()->find((int) $data['ride_type_id']) : null;
        if (!$rideType || !$this->isPrivateRideType($rideType?->name)) {
            $data['reverse_bidding_enabled'] = false;
        }

        $existing = CityVehicleType::query()
            ->where('city_id', $city->id)
            ->when($data['ride_type_id'] ?? null,
                fn ($q, $rideTypeId) => $q->where('ride_type_id', $rideTypeId),
                fn ($q) => $q->whereNull('ride_type_id')
            )
            ->where('display_name', $data['display_name'])
            ->first();
        if ($existing) {
            return response()->json([
                'message' => 'A vehicle with this name already exists for this ride type.',
            ], 409);
        }

        if (! array_key_exists('display_order', $data) || $data['display_order'] === null) {
            $data['display_order'] = $this->nextDisplayOrder($city);
        }

        $row = CityVehicleType::query()->create(array_merge(
            [
                'city_id' => $city->id,
                'is_active' => true,
                'reverse_bidding_enabled' => true,
            ],
            $data,
        ));

        return response()->json([
            'vehicle_type' => $this->shape($row->fresh()->load(['rideType:id,name', 'vehicleType:id,name'])),
            'message' => 'Vehicle created.',
        ], 201);
    }

    /**
     * Full edit — every toggle, every commercial, every dispatcher override.
     * (Per-vehicle imagery lives in the separate image gallery.)
     */
    public function update(Request $request, City $city, CityVehicleType $vehicleType)
    {
        $this->guard($city, $vehicleType);

        $data = $request->validate([
            'ride_type_id' => ['nullable', 'integer', 'exists:ride_types,id'],
            'vehicle_type_id' => ['nullable', 'integer', 'exists:vehicle_types,id'],
            'vehicle_set_id' => ['nullable', 'integer', 'exists:vehicle_sets,id'],

            'display_name' => ['sometimes', 'string', 'max:120'],
            'display_order' => ['nullable', 'integer', 'min:0', 'max:9999'],

            'max_people' => ['nullable', 'integer', 'min:1', 'max:99'],
            'luggage_capacity' => ['nullable', 'integer', 'min:0', 'max:99'],

            'reverse_bidding_enabled' => ['nullable', 'boolean'],

            'override_request_radius_m' => ['nullable', 'integer', 'min:0', 'max:50000'],
            'override_hop_interval_sec' => ['nullable', 'integer', 'min:1', 'max:600'],
            'override_hop_radius_m' => ['nullable', 'integer', 'min:0', 'max:50000'],
            'override_max_hops' => ['nullable', 'integer', 'min:1', 'max:50'],

            'is_active' => ['nullable', 'boolean'],
        ]);

        $targetRideTypeId = array_key_exists('ride_type_id', $data) ? $data['ride_type_id'] : $vehicleType->ride_type_id;
        $targetRideType = $targetRideTypeId === null
            ? null
            : ($targetRideTypeId === $vehicleType->ride_type_id
                ? $vehicleType->rideType
                : RideType::query()->find((int) $targetRideTypeId));
        if (!$this->isPrivateRideType($targetRideType?->name)) {
            $data['reverse_bidding_enabled'] = false;
        }

        // Dispatcher overrides are all-or-nothing: either all four set (per-vehicle
        // ring search) or all blank (city-geofence dispatch). Reject a partial mix.
        $dispatchKeys = ['override_request_radius_m', 'override_hop_interval_sec', 'override_hop_radius_m', 'override_max_hops'];
        $dispatchSet = array_filter(
            $dispatchKeys,
            fn ($k) => array_key_exists($k, $data) && $data[$k] !== null,
        );
        if (count($dispatchSet) !== 0 && count($dispatchSet) !== count($dispatchKeys)) {
            return response()->json([
                'message' => 'Set all four dispatcher fields, or leave all four blank.',
            ], 422);
        }

        // Re-check the (city, ride_type, display_name) uniqueness when either
        // key changes, so a rename / ride-type change returns a friendly 409
        // instead of a raw DB integrity 500.
        $targetName = $data['display_name'] ?? $vehicleType->display_name;
        $clash = CityVehicleType::query()
            ->where('city_id', $city->id)
            ->when($targetRideTypeId,
                fn ($q, $rideTypeId) => $q->where('ride_type_id', $rideTypeId),
                fn ($q) => $q->whereNull('ride_type_id')
            )
            ->where('display_name', $targetName)
            ->where('id', '!=', $vehicleType->id)
            ->exists();
        if ($clash) {
            return response()->json([
                'message' => 'A vehicle with this name already exists for this ride type.',
            ], 409);
        }

        foreach ($data as $field => $value) {
            $vehicleType->{$field} = $value;
        }
        $vehicleType->save();
        $this->syncFixedRoutesForVehicle($city, $vehicleType->fresh(), $data);

        return response()->json([
            'vehicle_type' => $this->shape($vehicleType->fresh()->load(['rideType:id,name', 'vehicleType:id,name', 'vehicleSet:id,name'])),
            'message' => 'Vehicle type updated.',
        ]);
    }

    public function destroy(City $city, CityVehicleType $vehicleType)
    {
        $this->guard($city, $vehicleType);
        $vehicleType->delete();

        return response()->json(['message' => 'Vehicle type deleted.']);
    }

    /**
     * Copy vehicle settings (vehicle name, vehicle type, seat capacity, luggage,
     * dispatcher settings, designed seat layouts, rate cards / pricing rules, and outstation packages)
     * from this source city to one or more target cities.
     */
    public function copyToCity(Request $request, City $city)
    {
        $data = $request->validate([
            'target_city_ids' => ['required', 'array', 'min:1'],
            'target_city_ids.*' => ['required', 'integer', 'exists:cities,id', 'different:city'],
            'vehicle_ids' => ['nullable', 'array'],
            'vehicle_ids.*' => ['integer', 'exists:city_vehicle_types,id'],
            'copy_pricing' => ['nullable', 'boolean'],
            'copy_seat_layouts' => ['nullable', 'boolean'],
            'overwrite_existing' => ['nullable', 'boolean'],
        ]);

        $targetCityIds = array_unique($data['target_city_ids']);
        $copyPricing = $request->boolean('copy_pricing', true);
        $copySeatLayouts = $request->boolean('copy_seat_layouts', true);
        $overwriteExisting = $request->boolean('overwrite_existing', true);

        // Fetch source vehicles
        $sourceQuery = CityVehicleType::query()->where('city_id', $city->id);

        if (!empty($data['vehicle_ids'])) {
            $pickedVehicles = CityVehicleType::query()
                ->where('city_id', $city->id)
                ->whereIn('id', $data['vehicle_ids'])
                ->get();
            $names = $pickedVehicles->pluck('display_name')->unique()->toArray();
            $sourceQuery->whereIn('display_name', $names);
        }

        $sourceVehicles = $sourceQuery->with(['rideType', 'vehicleType', 'images'])->get();

        if ($sourceVehicles->isEmpty()) {
            return response()->json(['message' => 'No vehicles found in source location to copy.'], 422);
        }

        $targetCities = City::query()->whereIn('id', $targetCityIds)->get();
        $copiedCount = 0;
        $copiedLayoutsCount = 0;

        DB::transaction(function () use (
            $city,
            $targetCities,
            $sourceVehicles,
            $copyPricing,
            $copySeatLayouts,
            $overwriteExisting,
            &$copiedCount,
            &$copiedLayoutsCount
        ) {
            foreach ($targetCities as $targetCity) {
                // Keep track of vehicle types processed for seat layouts copy
                $processedVehicleTypeIds = [];

                foreach ($sourceVehicles as $srcVeh) {
                    $existing = CityVehicleType::query()
                        ->where('city_id', $targetCity->id)
                        ->when(
                            $srcVeh->ride_type_id,
                            fn ($q, $rtId) => $q->where('ride_type_id', $rtId),
                            fn ($q) => $q->whereNull('ride_type_id')
                        )
                        ->where('display_name', $srcVeh->display_name)
                        ->first();

                    if ($existing && !$overwriteExisting) {
                        continue;
                    }

                    $attrs = [
                        'vehicle_type_id' => $srcVeh->vehicle_type_id,
                        'display_name' => $srcVeh->display_name,
                        'display_order' => $srcVeh->display_order,
                        'max_people' => $srcVeh->max_people,
                        'luggage_capacity' => $srcVeh->luggage_capacity,
                        'reverse_bidding_enabled' => $srcVeh->reverse_bidding_enabled,
                        'override_request_radius_m' => $srcVeh->override_request_radius_m,
                        'override_hop_interval_sec' => $srcVeh->override_hop_interval_sec,
                        'override_hop_radius_m' => $srcVeh->override_hop_radius_m,
                        'override_max_hops' => $srcVeh->override_max_hops,
                        'is_active' => $srcVeh->is_active,
                    ];

                    if ($existing) {
                        $existing->update($attrs);
                        $targetVeh = $existing;
                    } else {
                        $targetVeh = CityVehicleType::query()->create(array_merge([
                            'city_id' => $targetCity->id,
                            'ride_type_id' => $srcVeh->ride_type_id,
                        ], $attrs));
                    }

                    $copiedCount++;

                    // Copy vehicle imagery
                    foreach ($srcVeh->images as $img) {
                        CityVehicleTypeImage::query()->updateOrCreate(
                            [
                                'city_vehicle_type_id' => $targetVeh->id,
                                'platform' => $img->platform,
                                'key' => $img->key,
                            ],
                            ['image_path' => $img->image_path]
                        );
                    }

                    // Copy Base Pricing / Pricing Rule
                    if ($copyPricing) {
                        $srcPricing = PricingRule::query()->where('city_vehicle_type_id', $srcVeh->id)->first();
                        if ($srcPricing) {
                            $pricingAttrs = $srcPricing->toArray();
                            unset($pricingAttrs['id'], $pricingAttrs['city_id'], $pricingAttrs['city_vehicle_type_id'], $pricingAttrs['created_at'], $pricingAttrs['updated_at']);
                            $pricingAttrs['vehicle_type_id'] = $targetVeh->vehicle_type_id;
                            $pricingAttrs['ride_type_id'] = $targetVeh->ride_type_id;

                            PricingRule::query()->updateOrCreate(
                                [
                                    'city_id' => $targetCity->id,
                                    'city_vehicle_type_id' => $targetVeh->id,
                                ],
                                $pricingAttrs
                            );
                        }

                        // Copy Outstation Packages if any
                        $srcPackages = OutstationPackage::query()->where('city_vehicle_type_id', $srcVeh->id)->get();
                        foreach ($srcPackages as $pkg) {
                            OutstationPackage::query()->updateOrCreate(
                                [
                                    'city_vehicle_type_id' => $targetVeh->id,
                                    'name' => $pkg->name,
                                ],
                                [
                                    'sort_order' => $pkg->sort_order,
                                    'is_active' => $pkg->is_active,
                                    'fare_config' => $pkg->fare_config,
                                ]
                            );
                        }
                    }

                    // Copy Designed Seat Layouts for this vehicle type (once per vehicle type per target city)
                    if ($copySeatLayouts && $srcVeh->vehicle_type_id && !in_array($srcVeh->vehicle_type_id, $processedVehicleTypeIds, true)) {
                        $processedVehicleTypeIds[] = $srcVeh->vehicle_type_id;

                        $srcLayouts = VehicleSeatLayout::query()
                            ->where('city_id', $city->id)
                            ->where('vehicle_type_id', $srcVeh->vehicle_type_id)
                            ->with('cells')
                            ->get();

                        foreach ($srcLayouts as $srcLayout) {
                            $targetLayout = VehicleSeatLayout::query()
                                ->where('city_id', $targetCity->id)
                                ->where('vehicle_type_id', $srcVeh->vehicle_type_id)
                                ->where('name', $srcLayout->name)
                                ->first();

                            $repopulateCells = false;

                            if (!$targetLayout) {
                                $targetLayout = VehicleSeatLayout::query()->create([
                                    'city_id' => $targetCity->id,
                                    'vehicle_type_id' => $srcVeh->vehicle_type_id,
                                    'name' => $srcLayout->name,
                                    'rows' => $srcLayout->rows,
                                    'cols' => $srcLayout->cols,
                                    'is_active' => $srcLayout->is_active,
                                ]);
                                $repopulateCells = true;
                                $copiedLayoutsCount++;
                            } elseif ($overwriteExisting) {
                                $targetLayout->update([
                                    'rows' => $srcLayout->rows,
                                    'cols' => $srcLayout->cols,
                                    'is_active' => $srcLayout->is_active,
                                ]);
                                VehicleSeatLayoutCell::query()->where('vehicle_seat_layout_id', $targetLayout->id)->delete();
                                $repopulateCells = true;
                                $copiedLayoutsCount++;
                            }

                            if ($repopulateCells && $srcLayout->cells) {
                                foreach ($srcLayout->cells as $cell) {
                                    VehicleSeatLayoutCell::query()->create([
                                        'vehicle_seat_layout_id' => $targetLayout->id,
                                        'row' => $cell->row,
                                        'col' => $cell->col,
                                        'label' => $cell->label,
                                        'category' => $cell->category,
                                        'price_delta' => $cell->price_delta,
                                        'kind' => $cell->kind,
                                        'is_active' => $cell->is_active,
                                    ]);
                                }
                            }
                        }
                    }
                }
            }
        });

        $cityNames = $targetCities->pluck('name')->join(', ');
        $summary = "Copied {$copiedCount} vehicle settings";
        if ($copiedLayoutsCount > 0) {
            $summary .= " and {$copiedLayoutsCount} seat layout design(s)";
        }
        $summary .= " to {$cityNames}.";

        return response()->json([
            'message' => $summary,
            'copied_count' => $copiedCount,
            'copied_layouts_count' => $copiedLayoutsCount,
        ]);
    }

    private function guard(City $city, CityVehicleType $vehicleType): void
    {
        if ($vehicleType->city_id !== $city->id) {
            abort(404);
        }
    }

    private function isPrivateRideType(?string $name): bool
    {
        $name = strtolower((string) $name);
        return !str_contains($name, 'fixed') && !str_contains($name, 'shuttle');
    }

    private function nextDisplayOrder(City $city): int
    {
        return ((int) CityVehicleType::query()
            ->where('city_id', $city->id)
            ->max('display_order')) + 1;
    }

    private function syncFixedRoutesForVehicle(City $city, CityVehicleType $vehicleType, array $changed): void
    {
        if (! array_intersect(array_keys($changed), ['max_people', 'luggage_capacity', 'is_active'])) {
            return;
        }

        $routeIds = Route::query()
            ->where('city_id', $city->id)
            ->where('mode', 'fixed')
            ->where('city_vehicle_type_id', $vehicleType->id)
            ->pluck('id');

        if ($routeIds->isEmpty()) {
            return;
        }

        Route::query()
            ->whereIn('id', $routeIds)
            ->update([
                'max_luggage_per_vehicle' => max(0, (int) $vehicleType->luggage_capacity),
            ]);

        $reason = array_intersect(array_keys($changed), ['max_people', 'luggage_capacity'])
            ? 'vehicle_capacity_updated'
            : 'vehicle_visibility_updated';

        foreach ($routeIds as $routeId) {
            $this->broadcastFixedUpdate((int) $city->id, (int) $routeId, $reason);
        }
    }

    private function broadcastFixedUpdate(int $cityId, ?int $routeId, string $reason): void
    {
        try {
            broadcast(new FixedRouteCatalogUpdated($cityId, $routeId, $reason))->toOthers();
        } catch (\Throwable $e) {
            Log::warning('Fixed route catalog broadcast failed after vehicle update', [
                'city_id' => $cityId,
                'route_id' => $routeId,
                'reason' => $reason,
                'error' => $e->getMessage(),
            ]);
        }
    }

    private function shape(CityVehicleType $v): array
    {
        return [
            'id' => $v->id,
            'city_id' => $v->city_id,
            'ride_type_id' => $v->ride_type_id,
            'ride_type_name' => $v->rideType?->name,
            'is_outstation' => (bool) $v->rideType?->isOutstation(),
            'vehicle_type_id' => $v->vehicle_type_id,
            'vehicle_type_name' => $v->vehicleType?->name,
            'vehicle_set_id' => $v->vehicle_set_id,
            'vehicle_set_name' => $v->vehicleSet?->name,
            'display_name' => $v->display_name,
            'display_order' => (int) $v->display_order,
            'max_people' => (int) $v->max_people,
            'luggage_capacity' => (int) $v->luggage_capacity,

            'reverse_bidding_enabled' => (bool) $v->reverse_bidding_enabled,

            'override_request_radius_m' => $v->override_request_radius_m,
            'override_hop_interval_sec' => $v->override_hop_interval_sec,
            'override_hop_radius_m' => $v->override_hop_radius_m,
            'override_max_hops' => $v->override_max_hops,

            'is_active' => (bool) $v->is_active,
            'updated_at' => optional($v->updated_at)->toIso8601String(),
        ];
    }
}
