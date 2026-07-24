<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Models\RouteDeparture;
use App\Models\VehicleSeatLayout;
use App\Models\VehicleSeatLayoutCell;
use App\Models\VehicleType;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Admin CRUD for reusable seat layouts. A layout belongs to (city × vehicle-type)
 * and carries N×M cells — some seats, some blocked, some aisle. Every fixed
 * departure points at exactly one layout, and its cells are snapshotted into
 * `departure_seats` when the driver opens the vehicle (see SeatMapService).
 *
 * PATCH replaces the whole cell set (simpler than diffing). DELETE is blocked
 * once any route_departure references the layout — otherwise history breaks.
 */
class AdminVehicleSeatLayoutsController
{
    private const CATEGORIES = ['front', 'window', 'middle', 'rear', 'premium'];
    private const KINDS = ['seat', 'blocked', 'aisle'];

    public function index(City $city)
    {
        $layouts = VehicleSeatLayout::query()
            ->where('city_id', $city->id)
            ->with('cells')
            ->orderBy('name')
            ->get();

        return response()->json([
            'data' => $layouts->map(fn (VehicleSeatLayout $l) => $this->shape($l))->values(),
        ]);
    }

    public function show(City $city, VehicleSeatLayout $vehicleSeatLayout)
    {
        $this->assertCityOwnsLayout($city, $vehicleSeatLayout);
        $vehicleSeatLayout->loadMissing('cells');

        return response()->json(['layout' => $this->shape($vehicleSeatLayout)]);
    }

    public function store(Request $request, City $city)
    {
        $data = $this->validatePayload($request, $city, null);
        $this->assertCells($data['cells'], (int) $data['rows'], (int) $data['cols']);

        $layout = DB::transaction(function () use ($city, $data) {
            $layout = VehicleSeatLayout::query()->create([
                'city_id' => $city->id,
                'vehicle_type_id' => (int) $data['vehicle_type_id'],
                'name' => trim($data['name']),
                'rows' => (int) $data['rows'],
                'cols' => (int) $data['cols'],
                'is_active' => $data['is_active'] ?? true,
            ]);
            $this->insertCells($layout, $data['cells']);
            return $layout;
        });

        return response()->json([
            'layout' => $this->shape($layout->fresh(['cells'])),
            'message' => 'Seat layout created.',
        ], 201);
    }

    public function update(Request $request, City $city, VehicleSeatLayout $vehicleSeatLayout)
    {
        $this->assertCityOwnsLayout($city, $vehicleSeatLayout);
        $data = $this->validatePayload($request, $city, $vehicleSeatLayout);
        $this->assertCells($data['cells'], (int) $data['rows'], (int) $data['cols']);

        DB::transaction(function () use ($vehicleSeatLayout, $data) {
            $vehicleSeatLayout->update([
                'vehicle_type_id' => (int) $data['vehicle_type_id'],
                'name' => trim($data['name']),
                'rows' => (int) $data['rows'],
                'cols' => (int) $data['cols'],
                'is_active' => $data['is_active'] ?? $vehicleSeatLayout->is_active,
            ]);
            // Wipe + reinsert — simpler than diffing, and existing departure_seats
            // are unaffected (they denormalise label/category/price_delta).
            VehicleSeatLayoutCell::query()
                ->where('vehicle_seat_layout_id', $vehicleSeatLayout->id)
                ->delete();
            $this->insertCells($vehicleSeatLayout, $data['cells']);
        });

        return response()->json([
            'layout' => $this->shape($vehicleSeatLayout->fresh(['cells'])),
            'message' => 'Seat layout updated.',
        ]);
    }

    public function destroy(City $city, VehicleSeatLayout $vehicleSeatLayout)
    {
        $this->assertCityOwnsLayout($city, $vehicleSeatLayout);

        $inUse = RouteDeparture::query()
            ->where('vehicle_seat_layout_id', $vehicleSeatLayout->id)
            ->exists();
        if ($inUse) {
            abort(422, 'This layout is in use by one or more departures and cannot be deleted.');
        }

        $vehicleSeatLayout->delete(); // cells cascade
        return response()->json(['message' => 'Seat layout deleted.']);
    }

    private function validatePayload(Request $request, City $city, ?VehicleSeatLayout $layout): array
    {
        return $request->validate([
            'name' => [
                'required', 'string', 'max:120',
                Rule::unique('vehicle_seat_layouts', 'name')
                    ->where(fn ($q) => $q->where('city_id', $city->id)
                        ->where('vehicle_type_id', (int) $request->input('vehicle_type_id', 0)))
                    ->ignore($layout?->id),
            ],
            'vehicle_type_id' => [
                'required', 'integer',
                Rule::exists('vehicle_types', 'id'),
            ],
            'rows' => ['required', 'integer', 'min:1', 'max:20'],
            'cols' => ['required', 'integer', 'min:1', 'max:10'],
            'is_active' => ['nullable', 'boolean'],
            'cells' => ['required', 'array', 'min:1'],
            'cells.*.row' => ['required', 'integer', 'min:1'],
            'cells.*.col' => ['required', 'integer', 'min:1'],
            'cells.*.kind' => ['required', Rule::in(self::KINDS)],
            'cells.*.label' => ['nullable', 'string', 'max:32'],
            'cells.*.category' => ['nullable', Rule::in(self::CATEGORIES)],
            'cells.*.price_delta' => ['nullable', 'numeric', 'min:-99999', 'max:99999'],
        ]);
    }

    /**
     * Enforce the invariants the schema alone can't:
     *   - every (row, col) unique
     *   - every (row, col) inside (rows × cols)
     *   - every seat cell has a non-empty label
     *   - labels unique among seat cells
     *   - at least one seat cell — a layout with zero sellable seats is a mistake
     */
    private function assertCells(array $cells, int $rows, int $cols): void
    {
        $seen = [];
        $labels = [];
        $seatCount = 0;
        foreach ($cells as $i => $cell) {
            $r = (int) $cell['row'];
            $c = (int) $cell['col'];
            if ($r > $rows || $c > $cols) {
                abort(422, "Cell at row {$r}, col {$c} is outside the {$rows}×{$cols} grid.");
            }
            $key = "$r,$c";
            if (isset($seen[$key])) {
                abort(422, "Two cells share position row {$r}, col {$c}.");
            }
            $seen[$key] = true;

            if ($cell['kind'] === 'seat') {
                $label = trim((string) ($cell['label'] ?? ''));
                if ($label === '') {
                    abort(422, "Seat at row {$r}, col {$c} needs a label.");
                }
                if (isset($labels[$label])) {
                    abort(422, "Two seats share label '{$label}'.");
                }
                $labels[$label] = true;
                $seatCount++;
            }
        }

        if ($seatCount < 1) {
            abort(422, 'A layout needs at least one seat cell.');
        }
    }

    private function insertCells(VehicleSeatLayout $layout, array $cells): void
    {
        $now = now();
        $rows = array_map(fn ($cell) => [
            'vehicle_seat_layout_id' => $layout->id,
            'row' => (int) $cell['row'],
            'col' => (int) $cell['col'],
            'kind' => $cell['kind'],
            // Seats keep their label (validated unique). Blocked cells may carry
            // a short label too — e.g. "D" for the driver seat in a top-view map;
            // these never enter the departure snapshot (seatCells filters to
            // kind=seat), so they only ever affect the visual grid. Aisles never
            // carry a label.
            'label' => $cell['kind'] === 'aisle' ? null : (($l = trim((string) ($cell['label'] ?? ''))) === '' ? null : $l),
            'category' => $cell['kind'] === 'seat' ? ($cell['category'] ?? null) : null,
            'price_delta' => (float) ($cell['price_delta'] ?? 0),
            'created_at' => $now,
            'updated_at' => $now,
        ], $cells);

        DB::table('vehicle_seat_layout_cells')->insert($rows);
    }

    private function assertCityOwnsLayout(City $city, VehicleSeatLayout $layout): void
    {
        if ((int) $layout->city_id !== (int) $city->id) {
            abort(404);
        }
    }

    private function shape(VehicleSeatLayout $layout): array
    {
        $cells = $layout->relationLoaded('cells') ? $layout->cells : $layout->cells()->get();
        $seatCells = $cells->where('kind', 'seat');
        $inUse = RouteDeparture::query()
            ->where('vehicle_seat_layout_id', $layout->id)
            ->exists();

        return [
            'id' => (int) $layout->id,
            'city_id' => (int) $layout->city_id,
            'vehicle_type_id' => (int) $layout->vehicle_type_id,
            'name' => $layout->name,
            'rows' => (int) $layout->rows,
            'cols' => (int) $layout->cols,
            'is_active' => (bool) $layout->is_active,
            'seat_count' => $seatCells->count(),
            'in_use' => $inUse,
            'cells' => $cells->map(fn (VehicleSeatLayoutCell $c) => [
                'id' => (int) $c->id,
                'row' => (int) $c->row,
                'col' => (int) $c->col,
                'kind' => $c->kind,
                'label' => $c->label,
                'category' => $c->category,
                'price_delta' => (float) $c->price_delta,
            ])->values(),
        ];
    }
}
