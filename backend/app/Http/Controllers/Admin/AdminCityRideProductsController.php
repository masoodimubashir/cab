<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Models\CityRideProduct;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class AdminCityRideProductsController
{
    private const KIND_DEFAULTS = [
        'local' => ['name' => 'Local', 'is_active' => true, 'sort_order' => 1],
        'rental' => ['name' => 'Shuttle', 'is_active' => true, 'sort_order' => 2],
        'outstation' => ['name' => 'Outstation', 'is_active' => true, 'sort_order' => 3],
    ];

    /**
     * Return all 3 ride products for a city, auto-seeding any missing kinds.
     */
    public function index(City $city)
    {
        foreach (self::KIND_DEFAULTS as $kind => $defaults) {
            CityRideProduct::query()->firstOrCreate(
                ['city_id' => $city->id, 'kind' => $kind],
                $defaults,
            );
        }

        // Re-query after seeding so DB defaults (e.g. timestamps) and any
        // newly-inserted columns are reflected.
        $products = CityRideProduct::query()
            ->where('city_id', $city->id)
            ->orderBy('sort_order')
            ->get()
            ->map(fn (CityRideProduct $p) => $this->shape($p));

        return response()->json([
            'city_id' => $city->id,
            'data' => $products,
        ]);
    }

    public function update(Request $request, City $city, CityRideProduct $product)
    {
        if ($product->city_id !== $city->id) {
            abort(404);
        }

        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:120'],
            'is_active' => ['nullable', 'boolean'],
            'sort_order' => ['nullable', 'integer', 'min:0', 'max:1000'],
            'image' => ['nullable', 'file', 'image', 'max:4096'],
        ]);

        // Guard: a city must always keep at least ONE active ride product.
        // Otherwise the customer app's booking screen renders no ride options
        // and nobody in that city can book. Block deactivating the last one.
        if (array_key_exists('is_active', $data) && !$request->boolean('is_active') && $product->is_active) {
            $otherActiveExists = CityRideProduct::query()
                ->where('city_id', $city->id)
                ->where('id', '!=', $product->id)
                ->where('is_active', true)
                ->exists();
            if (!$otherActiveExists) {
                return response()->json([
                    'message' => 'At least one ride product must stay active for this city.',
                ], 422);
            }
        }

        if ($request->hasFile('image')) {
            if ($product->image_path && Storage::disk('public')->exists($product->image_path)) {
                Storage::disk('public')->delete($product->image_path);
            }
            $product->image_path = $request->file('image')->store('city_ride_products', 'public');
        }

        foreach (['name', 'is_active', 'sort_order'] as $field) {
            if (array_key_exists($field, $data)) {
                $product->{$field} = $data[$field];
            }
        }

        $product->save();

        return response()->json([
            'product' => $this->shape($product->fresh()),
            'message' => 'Ride product updated.',
        ]);
    }

    private function shape(CityRideProduct $p): array
    {
        return [
            'id' => $p->id,
            'city_id' => $p->city_id,
            'kind' => $p->kind,
            'name' => $p->name,
            'image_path' => $p->image_path,
            'image_url' => $p->image_url,
            'is_active' => (bool) $p->is_active,
            'sort_order' => (int) $p->sort_order,
            'updated_at' => optional($p->updated_at)->toIso8601String(),
        ];
    }
}
