<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Models\CityVehicleFamilyImage;
use App\Models\CityVehicleType;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

/**
 * Manages the multi-image gallery attached to a vehicle family.
 * The database key is (city_id, display_name, platform, key), so every
 * ride-type variant that shares the same display_name reuses the same assets.
 */
class AdminVehicleTypeImagesController
{
    private const PLATFORMS = ['android', 'ios'];

    public function index(City $city, CityVehicleType $vehicleType)
    {
        $scope = $this->scope($city, $vehicleType);

        $rows = CityVehicleFamilyImage::query()
            ->where('city_id', $scope['city_id'])
            ->where('display_name', $scope['display_name'])
            ->orderBy('platform')
            ->orderBy('key')
            ->get()
            ->map(fn (CityVehicleFamilyImage $i) => $this->shape($i));

        return response()->json(['data' => $rows]);
    }

    public function store(Request $request, City $city, CityVehicleType $vehicleType)
    {
        $scope = $this->scope($city, $vehicleType);

        $data = $request->validate([
            'platform' => ['required', Rule::in(self::PLATFORMS)],
            'key' => ['required', 'string', 'max:60', 'regex:/^[a-zA-Z0-9_\- ]+$/'],
            'image' => ['required', 'file', 'mimes:jpeg,png,jpg,gif,svg,webp', 'max:4096'],
        ]);

        $key = $this->normalizeKey($data['key']);

        $existing = CityVehicleFamilyImage::query()
            ->where('city_id', $scope['city_id'])
            ->where('display_name', $scope['display_name'])
            ->where('platform', $data['platform'])
            ->where('key', $key)
            ->first();

        $storedPath = $request->file('image')->store(
            "vehicle_families/{$scope['city_id']}/{$data['platform']}",
            'public',
        );

        if (!$storedPath || !Storage::disk('public')->exists($storedPath)) {
            return response()->json(['message' => 'Failed to store image file on server.'], 500);
        }

        if ($existing) {
            $oldPath = $existing->image_path;
            $existing->image_path = $storedPath;
            $existing->save();

            if ($oldPath && $oldPath !== $storedPath && Storage::disk('public')->exists($oldPath)) {
                Storage::disk('public')->delete($oldPath);
            }

            return response()->json(['image' => $this->shape($existing->fresh()), 'message' => 'Image replaced.']);
        }

        $image = CityVehicleFamilyImage::query()->create([
            'city_id' => $scope['city_id'],
            'display_name' => $scope['display_name'],
            'platform' => $data['platform'],
            'key' => $key,
            'image_path' => $storedPath,
        ]);

        return response()->json(['image' => $this->shape($image->fresh()), 'message' => 'Image added.'], 201);
    }

    public function update(Request $request, City $city, CityVehicleType $vehicleType, CityVehicleFamilyImage $image)
    {
        $scope = $this->scope($city, $vehicleType);
        $this->guardFamily($scope, $image);

        $data = $request->validate([
            'platform' => ['sometimes', Rule::in(self::PLATFORMS)],
            'key' => ['sometimes', 'string', 'max:60', 'regex:/^[a-zA-Z0-9_\- ]+$/'],
            'image' => ['sometimes', 'file', 'mimes:jpeg,png,jpg,gif,svg,webp', 'max:4096'],
        ]);

        if (isset($data['platform'])) {
            $image->platform = $data['platform'];
        }
        if (isset($data['key'])) {
            $image->key = $this->normalizeKey($data['key']);
        }
        if ($request->hasFile('image')) {
            $oldPath = $image->image_path;
            $newPath = $request->file('image')->store(
                "vehicle_families/{$scope['city_id']}/{$image->platform}",
                'public',
            );

            if (!$newPath || !Storage::disk('public')->exists($newPath)) {
                return response()->json(['message' => 'Failed to store image file on server.'], 500);
            }

            $image->image_path = $newPath;
            $image->save();

            if ($oldPath && $oldPath !== $newPath && Storage::disk('public')->exists($oldPath)) {
                Storage::disk('public')->delete($oldPath);
            }
        } else {
            $image->save();
        }

        return response()->json(['image' => $this->shape($image->fresh()), 'message' => 'Image updated.']);
    }

    public function destroy(City $city, CityVehicleType $vehicleType, CityVehicleFamilyImage $image)
    {
        $scope = $this->scope($city, $vehicleType);
        $this->guardFamily($scope, $image);

        if ($image->image_path && Storage::disk('public')->exists($image->image_path)) {
            Storage::disk('public')->delete($image->image_path);
        }
        $image->delete();

        return response()->json(['message' => 'Image deleted.']);
    }

    private function scope(City $city, CityVehicleType $vehicleType): array
    {
        if ($vehicleType->city_id !== $city->id) {
            abort(404);
        }

        return [
            'city_id' => $city->id,
            'display_name' => trim($vehicleType->display_name),
        ];
    }

    private function guardFamily(array $scope, CityVehicleFamilyImage $image): void
    {
        if ((int) $image->city_id !== (int) $scope['city_id']) {
            abort(404);
        }
        if (trim((string) $image->display_name) !== $scope['display_name']) {
            abort(404);
        }
    }

    private function normalizeKey(string $raw): string
    {
        return strtolower(trim(preg_replace('/\s+/', '_', $raw)));
    }

    private function shape(CityVehicleFamilyImage $i): array
    {
        return [
            'id' => $i->id,
            'city_id' => $i->city_id,
            'display_name' => $i->display_name,
            'platform' => $i->platform,
            'key' => $i->key,
            'image_path' => $i->image_path,
            'image_url' => $i->image_url,
            'created_at' => optional($i->created_at)->toIso8601String(),
            'updated_at' => optional($i->updated_at)->toIso8601String(),
        ];
    }
}
