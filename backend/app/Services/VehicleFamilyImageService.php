<?php

namespace App\Services;

use App\Models\CityVehicleFamilyImage;
use Illuminate\Support\Collection;

class VehicleFamilyImageService
{
    /**
     * Resolves images for a vehicle family in a given city.
     *
     * @param int|null $cityId
     * @param string|null $displayName
     * @param string|null $requestedPlatform ('android' | 'ios' | 'web')
     * @param string|null $defaultImageUrl
     * @param string|null $defaultMarkerUrl
     * @param Collection|null $preloadedImages
     * @return array{
     *     images: array{
     *         android: array{booking_card: ?string, map_marker: ?string, selected_map_marker: ?string, driver_map_marker: ?string},
     *         ios: array{booking_card: ?string, map_marker: ?string, selected_map_marker: ?string, driver_map_marker: ?string}
     *     },
     *     image_url: ?string,
     *     map_marker_url: ?string
     * }
     */
    public function resolveForVehicle(
        ?int $cityId,
        ?string $displayName,
        ?string $requestedPlatform = null,
        ?string $defaultImageUrl = null,
        ?string $defaultMarkerUrl = null,
        ?Collection $preloadedImages = null
    ): array {
        $images = [
            'android' => [
                'booking_card' => null,
                'map_marker' => null,
                'selected_map_marker' => null,
                'driver_map_marker' => null,
            ],
            'ios' => [
                'booking_card' => null,
                'map_marker' => null,
                'selected_map_marker' => null,
                'driver_map_marker' => null,
            ],
        ];

        if ($cityId && $displayName) {
            $records = $preloadedImages
                ? $preloadedImages->filter(fn ($img) => empty($img->city_id) || (int) $img->city_id === (int) $cityId)
                : CityVehicleFamilyImage::query()
                    ->where('city_id', $cityId)
                    ->where('display_name', trim($displayName))
                    ->get();

            foreach ($records as $img) {
                $platform = strtolower((string) $img->platform);
                $key = strtolower(trim((string) $img->key));
                if (isset($images[$platform]) && array_key_exists($key, $images[$platform])) {
                    $images[$platform][$key] = $img->image_url;
                }
            }
        }

        $platform = strtolower(trim((string) $requestedPlatform));
        $primary = ($platform === 'ios') ? 'ios' : 'android';
        $secondary = ($primary === 'ios') ? 'android' : 'ios';

        // Fallback policy: requested platform -> other platform -> default
        $resolvedImageUrl = $images[$primary]['booking_card']
            ?? $images[$secondary]['booking_card']
            ?? $defaultImageUrl;

        $resolvedMarkerUrl = $images[$primary]['map_marker']
            ?? $images[$secondary]['map_marker']
            ?? $defaultMarkerUrl;

        return [
            'images' => $images,
            'image_url' => $resolvedImageUrl,
            'map_marker_url' => $resolvedMarkerUrl,
        ];
    }

    /**
     * Preload all family images for a city grouped by lower-cased display_name.
     *
     * @return Collection<string, Collection<int, CityVehicleFamilyImage>>
     */
    public function loadMapForCity(int $cityId): Collection
    {
        return CityVehicleFamilyImage::query()
            ->where('city_id', $cityId)
            ->get()
            ->groupBy(fn ($img) => strtolower(trim((string) $img->display_name)));
    }

    /**
     * Preload family images, optionally filtered by city,
     * grouped by lower-cased display_name.
     * All platforms are preloaded so that cross-platform fallback (e.g. iOS borrowing Android upload) works.
     *
     * @return Collection<string, Collection<int, CityVehicleFamilyImage>>
     */
    public function preloadForPlatform(?string $platform = null, ?int $cityId = null): Collection
    {
        $query = CityVehicleFamilyImage::query();
        if ($cityId) {
            $query->where('city_id', $cityId);
        }
        return $query->get()->groupBy(fn ($img) => strtolower(trim((string) $img->display_name)));
    }
}
