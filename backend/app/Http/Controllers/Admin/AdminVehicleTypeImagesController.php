<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Models\CityVehicleType;
use App\Models\CityVehicleTypeImage;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

/**
 * Manages the multi-image gallery attached to each city vehicle type.
 * Each image is keyed by (platform, key) — e.g. ('android', 'tab_normal'),
 * ('ios', 'ride_now_highlighted'). Matches the Jugnoo-style "Add Image"
 * dialog with Type + Key + File.
 */
class AdminVehicleTypeImagesController
{
    private const PLATFORMS = ['android', 'ios'];

    public function index(City $city, CityVehicleType $vehicleType)
    {
        $this->guard($city, $vehicleType);

        $rows = $vehicleType->images()
            ->orderBy('platform')
            ->orderBy('key')
            ->get()
            ->map(fn (CityVehicleTypeImage $i) => $this->shape($i));

        return response()->json(['data' => $rows]);
    }

    public function store(Request $request, City $city, CityVehicleType $vehicleType)
    {
        $this->guard($city, $vehicleType);

        $data = $request->validate([
            'platform' => ['required', Rule::in(self::PLATFORMS)],
            'key' => ['required', 'string', 'max:60', 'regex:/^[a-zA-Z0-9_\- ]+$/'],
            'image' => ['required', 'file', 'image', 'max:4096'],
        ]);

        $key = $this->normalizeKey($data['key']);

        // Don't allow two rows with the same (vehicle, platform, key) — replace instead.
        $existing = $vehicleType->images()
            ->where('platform', $data['platform'])
            ->where('key', $key)
            ->first();
        if ($existing) {
            if (Storage::disk('public')->exists($existing->image_path)) {
                Storage::disk('public')->delete($existing->image_path);
            }
            $existing->image_path = $request->file('image')->store(
                "vehicle_types/{$data['platform']}",
                'public',
            );
            $existing->save();
            return response()->json(['image' => $this->shape($existing->fresh()), 'message' => 'Image replaced.']);
        }

        $image = $vehicleType->images()->create([
            'platform' => $data['platform'],
            'key' => $key,
            'image_path' => $request->file('image')->store(
                "vehicle_types/{$data['platform']}",
                'public',
            ),
        ]);

        return response()->json(['image' => $this->shape($image->fresh()), 'message' => 'Image added.'], 201);
    }

    public function update(Request $request, City $city, CityVehicleType $vehicleType, CityVehicleTypeImage $image)
    {
        $this->guard($city, $vehicleType, $image);

        $data = $request->validate([
            'platform' => ['sometimes', Rule::in(self::PLATFORMS)],
            'key' => ['sometimes', 'string', 'max:60', 'regex:/^[a-zA-Z0-9_\- ]+$/'],
            'image' => ['sometimes', 'file', 'image', 'max:4096'],
        ]);

        if (isset($data['platform'])) {
            $image->platform = $data['platform'];
        }
        if (isset($data['key'])) {
            $image->key = $this->normalizeKey($data['key']);
        }
        if ($request->hasFile('image')) {
            if ($image->image_path && Storage::disk('public')->exists($image->image_path)) {
                Storage::disk('public')->delete($image->image_path);
            }
            $image->image_path = $request->file('image')->store(
                "vehicle_types/{$image->platform}",
                'public',
            );
        }
        $image->save();

        return response()->json(['image' => $this->shape($image->fresh()), 'message' => 'Image updated.']);
    }

    public function destroy(City $city, CityVehicleType $vehicleType, CityVehicleTypeImage $image)
    {
        $this->guard($city, $vehicleType, $image);

        if ($image->image_path && Storage::disk('public')->exists($image->image_path)) {
            Storage::disk('public')->delete($image->image_path);
        }
        $image->delete();

        return response()->json(['message' => 'Image deleted.']);
    }

    private function guard(City $city, CityVehicleType $vehicleType, ?CityVehicleTypeImage $image = null): void
    {
        if ($vehicleType->city_id !== $city->id) {
            abort(404);
        }
        if ($image && $image->city_vehicle_type_id !== $vehicleType->id) {
            abort(404);
        }
    }

    private function normalizeKey(string $raw): string
    {
        return strtolower(trim(preg_replace('/\s+/', '_', $raw)));
    }

    private function shape(CityVehicleTypeImage $i): array
    {
        return [
            'id' => $i->id,
            'city_vehicle_type_id' => $i->city_vehicle_type_id,
            'platform' => $i->platform,
            'key' => $i->key,
            'image_path' => $i->image_path,
            'image_url' => $i->image_url,
            'created_at' => optional($i->created_at)->toIso8601String(),
            'updated_at' => optional($i->updated_at)->toIso8601String(),
        ];
    }
}
