<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Models\Coupon;
use App\Models\CouponAssignment;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

class AdminCouponsController
{
    public function index(Request $request, City $city)
    {
        $q = Coupon::query()->where('city_id', $city->id);

        if ($request->has('is_active') && $request->query('is_active') !== '') {
            $q->where('is_active', $request->boolean('is_active'));
        }

        if ($search = trim((string) $request->query('q', ''))) {
            $q->where(function ($w) use ($search) {
                $w->where('title', 'like', '%' . $search . '%')
                  ->orWhere('subtitle', 'like', '%' . $search . '%');
            });
        }

        // Vehicle filter — keep rows whose allowed_vehicle_type_ids is empty
        // (means "all") OR contains the requested vehicle id.
        if ($vehicleId = (int) $request->query('city_vehicle_type_id', 0)) {
            $q->where(function ($w) use ($vehicleId) {
                $w->whereNull('allowed_vehicle_type_ids')
                  ->orWhere('allowed_vehicle_type_ids', '[]')
                  ->orWhereJsonContains('allowed_vehicle_type_ids', $vehicleId);
            });
        }

        $perPage = min(100, max(1, (int) $request->query('per_page', 10)));
        $paginator = $q->orderByDesc('id')->paginate($perPage);

        return response()->json([
            'city_id' => $city->id,
            'data' => $paginator->getCollection()->map(fn ($r) => $this->shape($r))->all(),
            'meta' => [
                'current_page' => $paginator->currentPage(),
                'last_page' => $paginator->lastPage(),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
            ],
        ]);
    }

    public function store(Request $request, City $city)
    {
        $data = $this->validatePayload($request, partial: false);
        $data['city_id'] = $city->id;
        $row = Coupon::query()->create($data);

        return response()->json([
            'coupon' => $this->shape($row->fresh()),
            'message' => 'Coupon created.',
        ], 201);
    }

    public function show(City $city, Coupon $coupon)
    {
        $this->guard($city, $coupon);
        return response()->json(['coupon' => $this->shape($coupon)]);
    }

    public function update(Request $request, City $city, Coupon $coupon)
    {
        $this->guard($city, $coupon);
        $data = $this->validatePayload($request, partial: true);
        $coupon->fill($data)->save();

        return response()->json([
            'coupon' => $this->shape($coupon->fresh()),
            'message' => 'Coupon updated.',
        ]);
    }

    public function destroy(City $city, Coupon $coupon)
    {
        $this->guard($city, $coupon);
        $coupon->delete();
        return response()->json(['message' => 'Coupon deleted.']);
    }

    /**
     * Paginated list of users this coupon has been issued to. Drives the
     * "Eye / Details" modal on the coupons admin page.
     */
    public function assignments(Request $request, City $city, Coupon $coupon)
    {
        $this->guard($city, $coupon);

        $q = CouponAssignment::query()
            ->where('coupon_id', $coupon->id)
            ->with(['user:id,name,phone,email']);

        if ($search = trim((string) $request->query('q', ''))) {
            $q->whereHas('user', function ($w) use ($search) {
                $w->where('name', 'like', '%' . $search . '%')
                  ->orWhere('phone', 'like', '%' . $search . '%')
                  ->orWhere('email', 'like', '%' . $search . '%');
            });
        }

        $perPage = min(100, max(1, (int) $request->query('per_page', 10)));
        $paginator = $q->orderByDesc('id')->paginate($perPage);

        return response()->json([
            'data' => $paginator->getCollection()->map(fn (CouponAssignment $a) => [
                'id' => $a->id,
                'user' => $a->user ? [
                    'id' => $a->user->id,
                    'name' => $a->user->name,
                    'phone' => $a->user->phone,
                    'email' => $a->user->email,
                ] : null,
                'reason' => $a->reason,
                'push_message' => $a->push_message,
                'expires_at' => optional($a->expires_at)->toIso8601String(),
                'assigned_at' => optional($a->assigned_at)->toIso8601String(),
                'used_at' => optional($a->used_at)->toIso8601String(),
            ])->all(),
            'meta' => [
                'current_page' => $paginator->currentPage(),
                'last_page' => $paginator->lastPage(),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
            ],
        ]);
    }

    /**
     * Give this coupon to a list of customers. Accepts either:
     *   - mode=customers + user_ids[]   (selected from the admin customer list)
     *   - mode=csv      + csv file      (uploaded with a `user_id` column)
     *
     * Each assignment is unique per (coupon, user); duplicates are silently
     * skipped via updateOrCreate so the operator can re-run the give flow
     * to extend expiry or change push copy without erroring out.
     */
    public function give(Request $request, City $city, Coupon $coupon)
    {
        $this->guard($city, $coupon);

        $data = $request->validate([
            'mode' => ['required', 'string', 'in:customers,csv'],
            'reason' => ['required', 'string', 'max:255'],
            'push_message' => ['nullable', 'string'],
            'expires_at' => ['nullable', 'date'],
            'user_ids' => ['nullable', 'array'],
            'user_ids.*' => ['integer', 'exists:users,id'],
            'csv' => ['nullable', 'file', 'mimes:csv,txt', 'max:5120'],
        ]);

        $userIds = [];
        if ($data['mode'] === 'customers') {
            $userIds = $data['user_ids'] ?? [];
        } else {
            if (! $request->hasFile('csv')) {
                return response()->json(['message' => 'CSV file is required for csv mode.'], 422);
            }
            $userIds = $this->parseUserIdsFromCsv($request->file('csv')->getRealPath());
        }

        if (empty($userIds)) {
            return response()->json(['message' => 'No users to assign the coupon to.'], 422);
        }

        // Filter to only customer-role users that actually exist.
        $validUserIds = User::query()
            ->whereIn('id', $userIds)
            ->whereHas('roles', fn ($w) => $w->where('role', 'customer'))
            ->pluck('id')
            ->all();

        $assignedAt = now();
        $expiresAt = !empty($data['expires_at']) ? Carbon::parse($data['expires_at']) : null;
        $created = 0;
        foreach ($validUserIds as $uid) {
            CouponAssignment::query()->updateOrCreate(
                ['coupon_id' => $coupon->id, 'user_id' => $uid],
                [
                    'reason' => $data['reason'],
                    'push_message' => $data['push_message'] ?? null,
                    'expires_at' => $expiresAt,
                    'assigned_at' => $assignedAt,
                    'assigned_by_admin_id' => $request->user()?->id,
                ],
            );
            $created++;
        }

        return response()->json([
            'assigned_count' => $created,
            'skipped_invalid' => count($userIds) - count($validUserIds),
            'message' => "Coupon issued to {$created} user(s).",
        ]);
    }

    private function parseUserIdsFromCsv(string $path): array
    {
        $ids = [];
        $handle = @fopen($path, 'r');
        if (!$handle) {
            return $ids;
        }
        $headers = null;
        while (($row = fgetcsv($handle)) !== false) {
            // Skip empty rows.
            if ($row === [null] || empty(array_filter($row, fn ($v) => $v !== null && $v !== ''))) {
                continue;
            }
            if ($headers === null) {
                // First non-empty row is the header line.
                $headers = array_map(fn ($h) => strtolower(trim((string) $h)), $row);
                continue;
            }
            $assoc = @array_combine($headers, $row) ?: [];
            $raw = $assoc['user_id'] ?? $row[0] ?? null;
            $id = (int) trim((string) $raw);
            if ($id > 0) {
                $ids[] = $id;
            }
        }
        fclose($handle);
        return array_values(array_unique($ids));
    }

    private function guard(City $city, Coupon $coupon): void
    {
        abort_if($coupon->city_id !== $city->id, 404);
    }

    private function validatePayload(Request $request, bool $partial): array
    {
        $sometimes = $partial ? 'sometimes' : 'required';

        return $request->validate([
            'title' => [$sometimes, 'string', 'max:200'],
            'subtitle' => ['nullable', 'string', 'max:200'],
            'benefit_type' => ['sometimes', 'string', 'in:discount'],
            'description' => ['nullable', 'string'],
            'promo_type' => [$sometimes, 'string', 'in:location_insensitive,location_sensitive'],
            'location_type' => ['nullable', 'string', 'in:pickup,drop'],

            'latitude' => ['nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180'],
            'radius_meters' => ['nullable', 'integer', 'min:0', 'max:1000000'],
            'location_name' => ['nullable', 'string', 'max:255'],

            'per_user_limit' => ['nullable', 'integer', 'min:0'],

            'discount_type' => [$sometimes, 'string', 'in:percentage,flat'],
            'discount_value' => [$sometimes, 'numeric', 'min:0'],
            'discount_maximum' => ['nullable', 'numeric', 'min:0'],

            'allowed_vehicle_type_ids' => ['nullable', 'array'],
            'allowed_vehicle_type_ids.*' => ['integer', 'exists:city_vehicle_types,id'],

            'is_active' => ['sometimes', 'boolean'],
        ]);
    }

    private function shape(Coupon $c): array
    {
        return [
            'id' => $c->id,
            'city_id' => $c->city_id,
            'title' => $c->title,
            'subtitle' => $c->subtitle,
            'benefit_type' => $c->benefit_type,
            'description' => $c->description,
            'promo_type' => $c->promo_type,
            'location_type' => $c->location_type,
            'latitude' => $c->latitude !== null ? (float) $c->latitude : null,
            'longitude' => $c->longitude !== null ? (float) $c->longitude : null,
            'radius_meters' => $c->radius_meters !== null ? (int) $c->radius_meters : null,
            'location_name' => $c->location_name,
            'per_user_limit' => $c->per_user_limit,
            'discount_type' => $c->discount_type,
            'discount_value' => (float) $c->discount_value,
            'discount_maximum' => $c->discount_maximum !== null ? (float) $c->discount_maximum : null,
            'allowed_vehicle_type_ids' => $c->allowed_vehicle_type_ids ?? [],
            'is_active' => (bool) $c->is_active,
            'created_at' => optional($c->created_at)->toIso8601String(),
        ];
    }
}
