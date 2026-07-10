<?php

namespace App\Http\Controllers;

use App\Models\City;
use App\Models\CityRideMode;
use App\Models\CityRideScope;
use App\Models\CityVehicleType;
use App\Models\Document;
use App\Models\DocumentLabel;
use App\Models\Fleet;
use App\Models\RideType;
use App\Models\VehicleType;
use Illuminate\Http\Request;

/**
 * Read-only catalog endpoints used by the driver mobile app during
 * registration. Auth-required (so anonymous probes don't enumerate the
 * catalog), but no admin role — any signed-in user can call these.
 */
class CatalogController extends Controller
{
    private const SCOPE_DEFAULTS = [
        ['local', 'Local', 1],
        ['outstation', 'Outstation', 2],
    ];

    private const MODE_DEFAULTS = [
        ['private', 'Private', true, 1],
        ['fixed', 'Fixed', true, 2],
        ['shuttle', 'Shuttle', true, 3],
    ];

    public function rideTypes(Request $request)
    {
        $rows = RideType::query()
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get(['id', 'name', 'description', 'sort_order']);

        return response()->json(['data' => $rows]);
    }

    public function vehicleTypes(Request $request)
    {
        $rows = VehicleType::query()
            ->where('is_active', true)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get(['id', 'name']);

        return response()->json(['data' => $rows]);
    }

    public function cities(Request $request)
    {
        $rows = City::query()
            ->select(['id', 'name', 'country_code'])
            ->orderBy('name')
            ->get();

        return response()->json(['data' => $rows]);
    }


    public function driverRideProducts(City $city)
    {
        $this->ensureDriverRideCatalogue($city);

        $scopes = CityRideScope::query()
            ->where('city_id', $city->id)
            ->where('is_active', true)
            ->with(['modes' => fn ($q) => $q->where('is_active', true)])
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get()
            ->filter(fn (CityRideScope $scope) => $scope->modes->isNotEmpty())
            ->values()
            ->map(fn (CityRideScope $scope) => [
                'id' => $scope->id,
                'scope' => $scope->scope,
                'name' => $scope->name,
                'sort_order' => (int) $scope->sort_order,
                'modes' => $scope->modes->map(fn (CityRideMode $mode) => [
                    'id' => $mode->id,
                    'scope' => $scope->scope,
                    'mode' => $mode->mode,
                    'name' => $mode->name,
                    'image_url' => $mode->image_url,
                    'sort_order' => (int) $mode->sort_order,
                ])->values(),
            ]);

        return response()->json(['scopes' => $scopes]);
    }


    public function cityVehicles(Request $request, City $city)
    {
        $data = $request->validate([
            'vehicle_type_id' => ['required', 'integer', 'exists:vehicle_types,id'],
        ]);

        $rows = CityVehicleType::query()
            ->where('city_id', $city->id)
            ->where('vehicle_type_id', (int) $data['vehicle_type_id'])
            ->where('is_active', true)
            ->orderBy('display_order')
            ->orderBy('id')
            ->get(['id', 'city_id', 'ride_type_id', 'vehicle_type_id', 'display_name', 'max_people', 'luggage_capacity'])
            ->map(fn (CityVehicleType $row) => [
                'id' => $row->id,
                'city_id' => $row->city_id,
                'ride_type_id' => $row->ride_type_id,
                'vehicle_type_id' => $row->vehicle_type_id,
                'display_name' => $row->display_name,
                'max_people' => (int) $row->max_people,
                'luggage_capacity' => (int) $row->luggage_capacity,
            ]);

        return response()->json(['data' => $rows]);
    }

    public function fleets(Request $request)
    {
        $query = Fleet::query()->where('is_active', true);
        if ($cityId = $request->query('city_id')) {
            $query->where('city_id', (int) $cityId);
        }

        $rows = $query
            ->select(['id', 'name', 'city_id'])
            ->orderBy('name')
            ->get();

        return response()->json(['data' => $rows]);
    }


    private function ensureDriverRideCatalogue(City $city): void
    {
        foreach (self::SCOPE_DEFAULTS as [$scope, $name, $sortOrder]) {
            $scopeRow = CityRideScope::query()->firstOrCreate(
                ['city_id' => $city->id, 'scope' => $scope],
                ['name' => $name, 'is_active' => true, 'sort_order' => $sortOrder],
            );

            foreach (self::MODE_DEFAULTS as [$mode, $modeName, $isActive, $modeSort]) {
                CityRideMode::query()->firstOrCreate(
                    ['city_ride_scope_id' => $scopeRow->id, 'mode' => $mode],
                    ['name' => $modeName, 'is_active' => $isActive, 'sort_order' => $modeSort],
                );
            }
        }
    }

    public function documents(Request $request)
    {
        // Default to the driver-document slice — the driver app shouldn't see
        // car-rental-only catalog rows. Caller can override with ?category=…
        $rows = Document::query()
            ->with('labels')
            ->where('category', 'driver_document')
            ->orderBy('id')
            ->get()
            ->map(fn (Document $d) => [
                'id' => $d->id,
                'name' => $d->name,
                'no_of_images' => (int) $d->no_of_images,
                'category' => $d->category,
                'required' => $d->required,
                'document_type' => $d->document_type,
                'gallery_restricted' => (bool) $d->gallery_restricted,
                'instructions' => $d->instructions,
                'status' => $d->status,
                'labels' => $d->labels->map(fn (DocumentLabel $l) => [
                    'id' => $l->id,
                    'label' => $l->label,
                    'label_type' => $l->label_type,
                    'mandatory' => (bool) $l->mandatory,
                    'sort_order' => (int) $l->sort_order,
                ])->all(),
            ]);

        return response()->json(['data' => $rows]);
    }
}
