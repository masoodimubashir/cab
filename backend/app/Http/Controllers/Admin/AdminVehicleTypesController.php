<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Models\CityVehicleType;
use App\Models\RideType;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

class AdminVehicleTypesController
{
    private const KINDS = ['local', 'rental', 'outstation'];
    private const TOLL_MODES = ['no', 'yes', 'yes_locked'];

    /**
     * List all vehicle types for a city. The Enabled/Disabled split in the
     * Jugnoo UI is just is_active=true|false; the frontend filters client-side.
     */
    public function index(Request $request, City $city)
    {
        $rows = CityVehicleType::query()
            ->with(['rideType:id,name', 'vehicleType:id,name'])
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
        $vehicleType->load(['rideType:id,name', 'vehicleType:id,name']);

        return response()->json(['vehicle_type' => $this->shape($vehicleType)]);
    }

    /**
     * Create a vehicle in this city. The operator picks which product kinds
     * to enable (Local / Rental / Outstation, at least one required) and we
     * fan out one row per requested kind — all is_active=true — sharing the
     * same ride_type_id, vehicle_type_id and display_name.
     *
     * Idempotent for the (city, ride_type, vehicle, kind) tuple: re-submitting
     * the same vehicle with a kind that already exists leaves that row alone.
     * That makes it cheap to "add a missing kind later" by re-running this
     * endpoint with just the new kind in the kinds[] array.
     */
    public function store(Request $request, City $city)
    {
        $data = $request->validate([
            'ride_type_id' => ['required', 'integer', 'exists:ride_types,id'],
            'vehicle_type_id' => ['required', 'integer', 'exists:vehicle_types,id'],
            'display_name' => ['required', 'string', 'max:120'],
            'display_order' => ['required', 'integer', 'min:0', 'max:9999'],
            'max_people' => ['required', 'integer', 'min:1', 'max:99'],
            'luggage_capacity' => ['required', 'integer', 'min:0', 'max:99'],
            'destination_mandatory' => ['required', 'boolean'],
            'fare_mandatory' => ['required', 'boolean'],
            'toll_mode' => ['required', Rule::in(self::TOLL_MODES)],
            'commission_percent' => ['required', 'numeric', 'min:0', 'max:100'],

            // At least one product kind must be enabled at creation.
            'kinds' => ['required', 'array', 'min:1'],
            'kinds.*' => [Rule::in(self::KINDS)],
        ]);

        $kindsRequested = array_values(array_unique($data['kinds']));
        unset($data['kinds']);

        // A vehicle is identified by its Vehicle Name within the (city, ride
        // type, vehicle type) — many vehicles can share one ride type. The
        // idempotency check is per (vehicle, kind): re-adding a kind that
        // already exists for THIS vehicle is a no-op; a different Vehicle Name
        // is an independent vehicle.
        $matchVehicle = function ($query) use ($city, $data) {
            $query->where('city_id', $city->id)
                ->where('ride_type_id', $data['ride_type_id'])
                ->where('vehicle_type_id', $data['vehicle_type_id'])
                ->where('display_name', $data['display_name']);
        };

        $existing = CityVehicleType::query()
            ->where($matchVehicle)
            ->pluck('product_kind')
            ->all();

        $created = [];
        foreach ($kindsRequested as $kind) {
            if (in_array($kind, $existing, true)) {
                continue;
            }
            $created[] = CityVehicleType::query()->create(array_merge(
                ['city_id' => $city->id, 'product_kind' => $kind, 'is_active' => true],
                $data,
            ));
        }

        $allRows = CityVehicleType::query()
            ->with('rideType:id,name')
            ->where($matchVehicle)
            ->orderBy('product_kind')
            ->get()
            ->map(fn (CityVehicleType $v) => $this->shape($v));

        return response()->json([
            'data' => $allRows,
            'created_count' => count($created),
            'message' => count($created) === 0
                ? 'Vehicle already exists for all three kinds.'
                : 'Vehicle created. Enable the kinds you want from the details page.',
        ], 201);
    }

    /**
     * Full edit — every toggle, every commercial, every dispatcher override,
     * and Android/iOS image uploads. Multipart accepted for the image fields.
     */
    public function update(Request $request, City $city, CityVehicleType $vehicleType)
    {
        $this->guard($city, $vehicleType);

        // The Vehicle Name + class identify the vehicle and are shared by all
        // its product-kind rows — captured here so a rename can be propagated
        // to the siblings after the save.
        $origRideTypeId = $vehicleType->ride_type_id;
        $origDisplayName = $vehicleType->display_name;

        $data = $request->validate([
            'ride_type_id' => ['sometimes', 'integer', 'exists:ride_types,id'],
            'vehicle_type_id' => ['nullable', 'integer', 'exists:vehicle_types,id'],
            'product_kind' => ['sometimes', Rule::in(self::KINDS)],

            'display_name' => ['sometimes', 'string', 'max:120'],
            'display_order' => ['nullable', 'integer', 'min:0', 'max:9999'],

            'max_people' => ['nullable', 'integer', 'min:1', 'max:99'],
            'luggage_capacity' => ['nullable', 'integer', 'min:0', 'max:99'],

            'destination_mandatory' => ['nullable', 'boolean'],
            'fare_mandatory' => ['nullable', 'boolean'],
            'reverse_bidding_enabled' => ['nullable', 'boolean'],
            'waiting_charges_applicable' => ['nullable', 'boolean'],
            'customer_notes_enabled' => ['nullable', 'boolean'],
            'multiple_destinations_enabled' => ['nullable', 'boolean'],
            'show_low_wallet_alert' => ['nullable', 'boolean'],
            'toll_mode' => ['nullable', Rule::in(self::TOLL_MODES)],

            'commission_percent' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'fixed_commission' => ['nullable', 'numeric', 'min:0', 'max:99999.99'],
            'convenience_charge' => ['nullable', 'numeric', 'min:0', 'max:99999.99'],
            'convenience_customer_waiver' => ['nullable', 'numeric', 'min:0', 'max:99999.99'],
            'convenience_driver_cut' => ['nullable', 'numeric', 'min:0', 'max:99999.99'],
            'min_driver_balance' => ['nullable', 'numeric', 'min:0', 'max:99999.99'],

            'override_request_radius_m' => ['nullable', 'integer', 'min:0', 'max:50000'],
            'override_hop_interval_sec' => ['nullable', 'integer', 'min:1', 'max:600'],
            'override_hop_radius_m' => ['nullable', 'integer', 'min:0', 'max:50000'],
            'override_max_hops' => ['nullable', 'integer', 'min:1', 'max:50'],

            'is_active' => ['nullable', 'boolean'],

            'android_image' => ['nullable', 'file', 'image', 'max:4096'],
            'ios_image' => ['nullable', 'file', 'image', 'max:4096'],
        ]);

        // Image swaps — delete old file before writing the new one.
        if ($request->hasFile('android_image')) {
            if ($vehicleType->android_image_path && Storage::disk('public')->exists($vehicleType->android_image_path)) {
                Storage::disk('public')->delete($vehicleType->android_image_path);
            }
            $vehicleType->android_image_path = $request->file('android_image')->store('vehicle_types/android', 'public');
        }
        if ($request->hasFile('ios_image')) {
            if ($vehicleType->ios_image_path && Storage::disk('public')->exists($vehicleType->ios_image_path)) {
                Storage::disk('public')->delete($vehicleType->ios_image_path);
            }
            $vehicleType->ios_image_path = $request->file('ios_image')->store('vehicle_types/ios', 'public');
        }

        foreach ($data as $field => $value) {
            if (in_array($field, ['android_image', 'ios_image'], true)) {
                continue;
            }
            $vehicleType->{$field} = $value;
        }
        $vehicleType->save();

        // Keep the vehicle's other product-kind rows in sync on identity
        // changes, so a rename doesn't split one vehicle into two cards.
        if ($vehicleType->display_name !== $origDisplayName || $request->has('vehicle_type_id')) {
            CityVehicleType::query()
                ->where('city_id', $city->id)
                ->where('ride_type_id', $origRideTypeId)
                ->where('display_name', $origDisplayName)
                ->where('id', '!=', $vehicleType->id)
                ->update([
                    'display_name' => $vehicleType->display_name,
                    'vehicle_type_id' => $vehicleType->vehicle_type_id,
                ]);
        }

        return response()->json([
            'vehicle_type' => $this->shape($vehicleType->fresh()->load(['rideType:id,name', 'vehicleType:id,name'])),
            'message' => 'Vehicle type updated.',
        ]);
    }

    public function destroy(City $city, CityVehicleType $vehicleType)
    {
        $this->guard($city, $vehicleType);

        foreach (['android_image_path', 'ios_image_path'] as $col) {
            if ($vehicleType->{$col} && Storage::disk('public')->exists($vehicleType->{$col})) {
                Storage::disk('public')->delete($vehicleType->{$col});
            }
        }
        $vehicleType->delete();

        return response()->json(['message' => 'Vehicle type deleted.']);
    }

    private function guard(City $city, CityVehicleType $vehicleType): void
    {
        if ($vehicleType->city_id !== $city->id) {
            abort(404);
        }
    }

    private function shape(CityVehicleType $v): array
    {
        return [
            'id' => $v->id,
            'city_id' => $v->city_id,
            'ride_type_id' => $v->ride_type_id,
            'ride_type_name' => $v->rideType?->name,
            'vehicle_type_id' => $v->vehicle_type_id,
            'vehicle_type_name' => $v->vehicleType?->name,
            'product_kind' => $v->product_kind,
            'display_name' => $v->display_name,
            'display_order' => (int) $v->display_order,
            'android_image_path' => $v->android_image_path,
            'android_image_url' => $v->android_image_url,
            'ios_image_path' => $v->ios_image_path,
            'ios_image_url' => $v->ios_image_url,
            'max_people' => (int) $v->max_people,
            'luggage_capacity' => (int) $v->luggage_capacity,

            'destination_mandatory' => (bool) $v->destination_mandatory,
            'fare_mandatory' => (bool) $v->fare_mandatory,
            'reverse_bidding_enabled' => (bool) $v->reverse_bidding_enabled,
            'waiting_charges_applicable' => (bool) $v->waiting_charges_applicable,
            'customer_notes_enabled' => (bool) $v->customer_notes_enabled,
            'multiple_destinations_enabled' => (bool) $v->multiple_destinations_enabled,
            'show_low_wallet_alert' => (bool) $v->show_low_wallet_alert,
            'toll_mode' => $v->toll_mode,

            'commission_percent' => (float) $v->commission_percent,
            'fixed_commission' => (float) $v->fixed_commission,
            'convenience_charge' => (float) $v->convenience_charge,
            'convenience_customer_waiver' => (float) $v->convenience_customer_waiver,
            'convenience_driver_cut' => (float) $v->convenience_driver_cut,
            'min_driver_balance' => (float) $v->min_driver_balance,

            'override_request_radius_m' => $v->override_request_radius_m,
            'override_hop_interval_sec' => $v->override_hop_interval_sec,
            'override_hop_radius_m' => $v->override_hop_radius_m,
            'override_max_hops' => $v->override_max_hops,

            'is_active' => (bool) $v->is_active,
            'updated_at' => optional($v->updated_at)->toIso8601String(),
        ];
    }
}
