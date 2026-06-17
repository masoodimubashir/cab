<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Models\CityVehicleType;
use App\Models\OutstationPackage;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * CRUD for outstation packages — the named fare structures (One Way,
 * Round Trip, …) that belong to an outstation vehicle. Packages only apply
 * to vehicles whose product_kind is 'outstation'.
 */
class AdminOutstationPackagesController
{
    /** Fare fields a package's fare_config may carry. Anything else is dropped. */
    private const FARE_KEYS = [
        'base_fare',
        'surge_multiplier', 'commission_percent', 'tax_percent',
        'threshold_distance_1_km', 'fare_per_km_after_threshold_1',
        'threshold_distance_2_km', 'fare_per_km_after_threshold_2',
        'threshold_time_1_min', 'fare_per_min_after_threshold_time_1',
        'threshold_time_2_min', 'fare_per_min_after_threshold_time_2',
    ];

    public function index(City $city, CityVehicleType $vehicleType)
    {
        $this->guard($city, $vehicleType);

        $rows = OutstationPackage::query()
            ->where('city_vehicle_type_id', $vehicleType->id)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get()
            ->map(fn (OutstationPackage $p) => $this->shape($p));

        return response()->json(['data' => $rows]);
    }

    public function store(Request $request, City $city, CityVehicleType $vehicleType)
    {
        $this->guard($city, $vehicleType);

        $data = $this->validatePayload($request);

        $package = OutstationPackage::query()->create([
            'city_vehicle_type_id' => $vehicleType->id,
            'name' => $data['name'],
            'sort_order' => $data['sort_order'] ?? 0,
            'is_active' => $data['is_active'] ?? true,
            'fare_config' => $this->cleanFareConfig($data['fare_config'] ?? []),
        ]);

        return response()->json([
            'package' => $this->shape($package),
            'message' => 'Package created.',
        ], 201);
    }

    public function update(Request $request, City $city, CityVehicleType $vehicleType, OutstationPackage $package)
    {
        $this->guard($city, $vehicleType, $package);

        $data = $this->validatePayload($request);

        $package->fill([
            'name' => $data['name'],
            'sort_order' => $data['sort_order'] ?? $package->sort_order,
            'is_active' => $data['is_active'] ?? $package->is_active,
            'fare_config' => $this->cleanFareConfig($data['fare_config'] ?? []),
        ]);
        $package->save();

        return response()->json([
            'package' => $this->shape($package->fresh()),
            'message' => 'Package updated.',
        ]);
    }

    public function destroy(City $city, CityVehicleType $vehicleType, OutstationPackage $package)
    {
        $this->guard($city, $vehicleType, $package);

        $package->delete();

        return response()->json(['message' => 'Package deleted.']);
    }

    private function validatePayload(Request $request): array
    {
        return $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'sort_order' => ['nullable', 'integer', 'min:0', 'max:9999'],
            'is_active' => ['nullable', 'boolean'],
            'fare_config' => ['nullable', 'array'],
            'fare_config.*' => ['nullable', 'numeric', 'min:0'],
            // A 0 surge would zero the whole fare — require ≥0.1 when set.
            'fare_config.surge_multiplier' => ['nullable', 'numeric', 'min:0.1', 'max:10'],
        ]);
    }

    /** Keeps only the known fare keys, coercing values to float|null. */
    private function cleanFareConfig(array $config): array
    {
        $out = [];
        foreach (self::FARE_KEYS as $key) {
            $out[$key] = isset($config[$key]) && $config[$key] !== '' && $config[$key] !== null
                ? (float) $config[$key]
                : null;
        }
        return $out;
    }

    /**
     * Ensures the vehicle type belongs to the city, is an outstation vehicle,
     * and (when given) the package belongs to that vehicle type.
     */
    private function guard(City $city, CityVehicleType $vehicleType, ?OutstationPackage $package = null): void
    {
        if ($vehicleType->city_id !== $city->id) {
            throw new NotFoundHttpException('Vehicle type not found in this city.');
        }
        if (! $vehicleType->rideType?->isOutstation()) {
            throw new NotFoundHttpException('Packages are only available for outstation vehicles.');
        }
        if ($package && $package->city_vehicle_type_id !== $vehicleType->id) {
            throw new NotFoundHttpException('Package not found for this vehicle.');
        }
    }

    private function shape(OutstationPackage $p): array
    {
        return [
            'id' => $p->id,
            'city_vehicle_type_id' => $p->city_vehicle_type_id,
            'name' => $p->name,
            'sort_order' => (int) $p->sort_order,
            'is_active' => (bool) $p->is_active,
            'fare_config' => $this->cleanFareConfig(is_array($p->fare_config) ? $p->fare_config : []),
            'created_at' => optional($p->created_at)->toIso8601String(),
            'updated_at' => optional($p->updated_at)->toIso8601String(),
        ];
    }
}
