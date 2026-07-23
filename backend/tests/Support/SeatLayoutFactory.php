<?php

namespace Tests\Support;

use Illuminate\Support\Facades\DB;

/**
 * Test helper — every fixed feature test needs a seat layout attached to its
 * route_departure (post-M0, `route_departures.vehicle_seat_layout_id` is
 * NOT NULL). This class centralises the "give me a standard 6-seater" recipe
 * so tests don't repeat 20 lines of cell-insert boilerplate.
 */
class SeatLayoutFactory
{
    /**
     * A 3×3 layout with 6 seats + 1 blocked driver + 1 blocked co-space + 1 aisle.
     *
     *   [blocked][1A][blocked]
     *   [2A]    [2B][2C]
     *   [3A]    [--][3B]
     *
     * Sellable labels: 1A, 2A, 2B, 2C, 3A, 3B.
     */
    public static function standardErtiga6P(int $cityId, int $vehicleTypeId, string $name = 'Ertiga 6P std'): int
    {
        $layoutId = DB::table('vehicle_seat_layouts')->insertGetId([
            'city_id' => $cityId,
            'vehicle_type_id' => $vehicleTypeId,
            'name' => $name,
            'rows' => 3,
            'cols' => 3,
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $cells = [
            ['row' => 1, 'col' => 1, 'kind' => 'blocked', 'label' => null, 'category' => null,     'price_delta' => 0],
            ['row' => 1, 'col' => 2, 'kind' => 'seat',    'label' => '1A', 'category' => 'front',  'price_delta' => 0],
            ['row' => 1, 'col' => 3, 'kind' => 'blocked', 'label' => null, 'category' => null,     'price_delta' => 0],
            ['row' => 2, 'col' => 1, 'kind' => 'seat',    'label' => '2A', 'category' => 'window', 'price_delta' => 0],
            ['row' => 2, 'col' => 2, 'kind' => 'seat',    'label' => '2B', 'category' => 'middle', 'price_delta' => 0],
            ['row' => 2, 'col' => 3, 'kind' => 'seat',    'label' => '2C', 'category' => 'window', 'price_delta' => 0],
            ['row' => 3, 'col' => 1, 'kind' => 'seat',    'label' => '3A', 'category' => 'rear',   'price_delta' => 0],
            ['row' => 3, 'col' => 2, 'kind' => 'aisle',   'label' => null, 'category' => null,     'price_delta' => 0],
            ['row' => 3, 'col' => 3, 'kind' => 'seat',    'label' => '3B', 'category' => 'rear',   'price_delta' => 0],
        ];

        foreach ($cells as $cell) {
            DB::table('vehicle_seat_layout_cells')->insert(array_merge($cell, [
                'vehicle_seat_layout_id' => $layoutId,
                'created_at' => now(),
                'updated_at' => now(),
            ]));
        }

        return $layoutId;
    }
}
