<?php

namespace App\Services;

use App\Models\VehicleFamilyImage;
use Illuminate\Support\Collection;

class VehicleFamilyImageService
{
    /**
     * Resolves shared vehicle-family images for every city and platform.
     * City/platform arguments remain for compatibility with existing callers.
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

        if ($displayName) {
            $family = mb_strtolower(trim($displayName));
            $records = $preloadedImages
                ? $preloadedImages->filter(fn ($img) => mb_strtolower(trim($img->display_name)) === $family)
                : VehicleFamilyImage::query()
                    ->where('display_name', $family)
                    ->get();

            foreach ($records as $img) {
                $key = strtolower(trim((string) $img->key));
                if (array_key_exists($key, $images['android'])) {
                    $images['android'][$key] = $img->image_url;
                    $images['ios'][$key] = $img->image_url;
                }
            }
        }

        // Both platform response entries intentionally contain the same shared URLs.
        $resolvedImageUrl = $images['android']['booking_card'] ?? $defaultImageUrl;
        $resolvedMarkerUrl = $images['android']['map_marker'] ?? $defaultMarkerUrl;

        return [
            'images' => $images,
            'image_url' => $resolvedImageUrl,
            'map_marker_url' => $resolvedMarkerUrl,
        ];
    }

    /**
     * Preload shared family images. City is retained for caller compatibility.
     *
     * @return Collection<string, Collection<int, VehicleFamilyImage>>
     */
    public function loadMapForCity(int $cityId): Collection
    {
        return $this->preloadForPlatform();
    }

    /**
     * Preload global family images grouped by canonical display name.
     *
     * @return Collection<string, Collection<int, VehicleFamilyImage>>
     */
    public function preloadForPlatform(?string $platform = null, ?int $cityId = null): Collection
    {
        return VehicleFamilyImage::query()->get()
            ->groupBy(fn ($img) => mb_strtolower(trim((string) $img->display_name)));
    }
}
