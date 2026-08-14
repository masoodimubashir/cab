<?php

namespace App\Http\Controllers;

use App\Events\DispatchDriverLocationUpdated;
use App\Models\CitySetting;
use App\Models\CityVehicleType;
use App\Models\Driver;
use App\Models\Fleet;
use App\Models\DriverDocument;
use App\Models\DriverLocation;
use App\Models\OperatorSetting;
use App\Models\Trip;
use App\Services\DriverServiceModeService;
use App\Services\WalletService;
use App\Services\FixedStopAutomationService;
use App\Services\ShuttleStopAutomationService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

class DriversController extends Controller
{
    public function register(Request $request)
    {
        $user = $request->user();
        $existing = Driver::query()->where('user_id', $user->id)->first();

        $data = $request->validate([
            // The 3-step wizard sends ride_type_id (Step 1) + vehicle_type_id
            // (Step 2). Free-text vehicle_type is kept for backwards compat
            // with older registrations and as a human-readable fallback.
            'ride_type_id' => ['nullable', 'integer', 'exists:ride_types,id'],
            'vehicle_type_id' => ['nullable', 'integer', 'exists:vehicle_types,id'],
            'city_vehicle_type_id' => ['nullable', 'integer', 'exists:city_vehicle_types,id'],
            'vehicle_type' => ['nullable', 'string', 'max:100'],
            'vehicle_model' => ['nullable', 'regex:/^\d{4}$/'],
            'vehicle_color' => ['nullable', 'string', 'max:100'],
            'vehicle_reg_no' => [
                'nullable',
                'string',
                'max:50',
                Rule::unique('drivers', 'vehicle_reg_no')->ignore($existing?->id),
            ],
            // Onboarding wizard now also captures the city + fleet. Both are
            // nullable (fleet = "none" allowed; city set later by admin if missing).
            'city_id' => ['nullable', 'integer', 'exists:cities,id'],
            'fleet_id' => ['nullable', 'integer', 'exists:fleets,id'],
            'service_scope' => ['nullable', 'string', 'in:local,outstation'],
            'service_mode' => ['nullable', 'string', 'in:private,fixed,shuttle'],
            'name' => ['nullable', 'string', 'max:120'],
            'email' => ['nullable', 'email', 'max:190', Rule::unique('users', 'email')->ignore($user->id)],
            'dob' => ['nullable', 'date', 'before:today'],
            'address' => ['nullable', 'string', 'max:255'],
            'app_version' => ['nullable', 'string', 'max:32'],
            'os_version' => ['nullable', 'string', 'max:32'],
            'device_type' => ['nullable', 'string', 'max:64'],
            'photo' => ['nullable', 'image', 'max:4096'],
        ]);

        if (!$existing || $existing->approval_status !== 'approved') {
            foreach ([
                'city_id' => 'Please pick your city.',
                'service_scope' => 'Choose the service area before continuing.',
                'service_mode' => 'Choose the service type before continuing.',
                'vehicle_type_id' => 'Please pick your vehicle type.',
                'city_vehicle_type_id' => 'Please pick the city vehicle.',
                'vehicle_model' => 'Please select the model year.',
                'vehicle_color' => 'Please enter the vehicle color.',
                'vehicle_reg_no' => 'Please enter the registration number.',
            ] as $field => $message) {
                if (empty($data[$field])) {
                    return response()->json(['message' => $message], 422);
                }
            }

            $hasFleetChoices = Fleet::query()
                ->where('is_active', true)
                ->where(function ($q) use ($data, $existing) {
                    $cityId = $data['city_id'] ?? $existing?->city_id;
                    $q->whereNull('city_id');
                    if ($cityId) $q->orWhere('city_id', (int) $cityId);
                })
                ->exists();
            if ($hasFleetChoices && empty($data['fleet_id'])) {
                return response()->json(['message' => 'Please pick your fleet.'], 422);
            }

            $profileChecks = [
                'name' => [$data['name'] ?? $user->name, 'Please complete your profile name.'],
                'email' => [$data['email'] ?? $user->email, 'Please complete your profile email.'],
                'dob' => [$data['dob'] ?? $user->dob, 'Please complete your date of birth.'],
                'address' => [$data['address'] ?? $user->address, 'Please complete your address.'],
            ];
            foreach ($profileChecks as [$value, $message]) {
                if (empty($value) || $value === 'User' || str_ends_with((string) $value, '@otp.local')) {
                    return response()->json(['message' => $message], 422);
                }
            }
        }

        if (! empty($data['city_vehicle_type_id'])) {
            $cityVehicle = CityVehicleType::query()->find((int) $data['city_vehicle_type_id']);
            if (! $cityVehicle
                || ! $cityVehicle->is_active
                || (int) $cityVehicle->city_id !== (int) ($data['city_id'] ?? $existing?->city_id)
                || (int) $cityVehicle->vehicle_type_id !== (int) ($data['vehicle_type_id'] ?? $existing?->vehicle_type_id)) {
                return response()->json([
                    'message' => 'Selected city vehicle does not match your city and vehicle type.',
                ], 422);
            }
        }

        if (!$existing || $existing->approval_status !== 'approved') {
            $profilePayload = [];
            foreach (['name', 'email', 'dob', 'address', 'app_version', 'os_version', 'device_type'] as $field) {
                if (array_key_exists($field, $data) && $data[$field] !== null && $data[$field] !== '') {
                    $profilePayload[$field] = $data[$field];
                }
            }
            if ($request->hasFile('photo')) {
                if ($user->avatar_path && Storage::disk('public')->exists($user->avatar_path)) {
                    Storage::disk('public')->delete($user->avatar_path);
                }
                $profilePayload['avatar_path'] = $request->file('photo')->store('avatars', 'public');
            }
            if ($profilePayload) {
                $user->fill($profilePayload);
                $user->save();
            }
        }

        // Locked fields once the driver is approved. Trying to change ride,
        // vehicle, or permanent service post-approval is a 422 — the operator
        // owns those decisions from that point on.
        if ($existing && $existing->approval_status === 'approved') {
            $tryingToChangeRide = array_key_exists('ride_type_id', $data)
                && $data['ride_type_id'] !== null
                && (int) $data['ride_type_id'] !== (int) $existing->ride_type_id;
            $tryingToChangeVehicle = array_key_exists('vehicle_type_id', $data)
                && $data['vehicle_type_id'] !== null
                && (int) $data['vehicle_type_id'] !== (int) $existing->vehicle_type_id;
            $tryingToChangeCityVehicle = array_key_exists('city_vehicle_type_id', $data)
                && $data['city_vehicle_type_id'] !== null
                && (int) $data['city_vehicle_type_id'] !== (int) $existing->city_vehicle_type_id;
            $tryingToChangeServiceScope = array_key_exists('service_scope', $data)
                && $data['service_scope'] !== null
                && $data['service_scope'] !== $existing->service_scope;
            $tryingToChangeServiceMode = array_key_exists('service_mode', $data)
                && $data['service_mode'] !== null
                && $data['service_mode'] !== $existing->service_mode;
            if ($tryingToChangeRide || $tryingToChangeVehicle || $tryingToChangeCityVehicle || $tryingToChangeServiceScope || $tryingToChangeServiceMode) {
                return response()->json([
                    'message' => 'Ride type, vehicle type, and driver service are locked after approval. Contact the operator.',
                ], 422);
            }
        }

        // If ride_type_id/vehicle_type_id are sent without a free-text
        // vehicle_type, derive a sensible label so older parts of the app that
        // read vehicle_type still get something.
        $vehicleTypeLabel = $data['vehicle_type'] ?? null;
        if (!$vehicleTypeLabel && !empty($data['vehicle_type_id'])) {
            $vt = \App\Models\VehicleType::query()->find($data['vehicle_type_id']);
            $vehicleTypeLabel = $vt?->name;
        }

        // Build the update set carefully: don't reset approval_status on a
        // re-registration, and freeze ride/vehicle type once approved.
        $payload = [
            'vehicle_type' => $vehicleTypeLabel ?? ($existing->vehicle_type ?? null),
            'vehicle_model' => $data['vehicle_model'] ?? ($existing->vehicle_model ?? null),
            'vehicle_color' => $data['vehicle_color'] ?? ($existing->vehicle_color ?? null),
            'vehicle_reg_no' => $data['vehicle_reg_no'] ?? ($existing->vehicle_reg_no ?? null),
            'city_id' => array_key_exists('city_id', $data) ? $data['city_id'] : ($existing->city_id ?? null),
            'city_vehicle_type_id' => array_key_exists('city_vehicle_type_id', $data) ? $data['city_vehicle_type_id'] : ($existing->city_vehicle_type_id ?? null),
            'fleet_id' => array_key_exists('fleet_id', $data) ? $data['fleet_id'] : ($existing->fleet_id ?? null),
        ];
        if (!$existing) {
            $payload['approval_status'] = 'pending';
            $payload['ride_type_id'] = $data['ride_type_id'] ?? null;
            $payload['vehicle_type_id'] = $data['vehicle_type_id'] ?? null;
            $payload['service_scope'] = $data['service_scope'] ?? null;
            $payload['service_mode'] = $data['service_mode'] ?? null;
        } else {
            $payload['approval_status'] = $existing->approval_status; // preserve
            if ($existing->approval_status !== 'approved') {
                // Pre-approval: driver can still flip their choices.
                $payload['ride_type_id'] = array_key_exists('ride_type_id', $data)
                    ? $data['ride_type_id']
                    : $existing->ride_type_id;
                $payload['vehicle_type_id'] = array_key_exists('vehicle_type_id', $data)
                    ? $data['vehicle_type_id']
                    : $existing->vehicle_type_id;
                $payload['city_vehicle_type_id'] = array_key_exists('city_vehicle_type_id', $data)
                    ? $data['city_vehicle_type_id']
                    : $existing->city_vehicle_type_id;
                $payload['service_scope'] = array_key_exists('service_scope', $data)
                    ? $data['service_scope']
                    : $existing->service_scope;
                $payload['service_mode'] = array_key_exists('service_mode', $data)
                    ? $data['service_mode']
                    : $existing->service_mode;
            } else {
                // Approved: ride/vehicle frozen regardless of payload.
                $payload['ride_type_id'] = $existing->ride_type_id;
                $payload['vehicle_type_id'] = $existing->vehicle_type_id;
                $payload['city_vehicle_type_id'] = $existing->city_vehicle_type_id;
                $payload['service_scope'] = $existing->service_scope;
                $payload['service_mode'] = $existing->service_mode;
            }
        }

        $driver = Driver::query()->updateOrCreate(
            ['user_id' => $user->id],
            $payload,
        );

        $user->addRole('driver');

        $fresh = $user->fresh();

        return response()->json([
            'driver' => $driver->fresh(),
            'user' => [
                'id' => $fresh->id,
                'name' => $fresh->name,
                'phone' => $fresh->phone,
                'email' => $fresh->email,
                'roles' => $fresh->roleNames(),
            ],
        ]);
    }

    /**
     * Current user's driver profile (if any), for mobile dashboard / status.
     */
    public function me(Request $request)
    {
        $user = $request->user();
        $driver = Driver::query()->where('user_id', $user->id)->first();

        $documents = [];
        if ($driver) {
            $documents = DriverDocument::query()
                ->where('driver_id', $driver->id)
                ->with('document:id,name')
                ->get()
                ->map(fn (DriverDocument $d) => [
                    'id' => $d->id,
                    'document_id' => $d->document_id,
                    'document_name' => $d->document?->name,
                    'document_type' => $d->document_type,
                    'image_index' => $d->image_index,
                    'vehicle_type_id' => $d->vehicle_type_id,
                    'status' => $d->status,
                    'rejection_reason' => $d->rejection_reason,
                    'file_url' => route('driver.me.documents.file', ['document' => $d->id]),
                    'label_values' => $d->label_values,
                    'uploaded_at' => optional($d->created_at)->toIso8601String(),
                ])
                ->all();
        }

        $avatarUrl = $user->avatar_path
            ? (str_starts_with($user->avatar_path, 'http')
                ? $user->avatar_path
                : url('/storage/'.ltrim($user->avatar_path, '/')))
            : null;

        // City-level wallet warning config.
        $citySettings = $driver?->city_id
            ? CitySetting::query()->firstOrCreate(['city_id' => $driver->city_id])
            : null;

        return response()->json([
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'phone' => $user->phone,
                'email' => $user->email,
                'roles' => $user->roleNames(),
                'avatar_path' => $user->avatar_path,
                'avatar_url' => $avatarUrl,
            ],
            'driver' => $driver,
            'documents' => $documents,
            'city_vehicle_type_config' => [
                'show_low_wallet_alert' => (bool) ($citySettings?->show_low_wallet_alert ?? true),
            ],
        ]);
    }

    /**
     * Stream the driver's own uploaded document. Same content-disposition
     * semantics as the admin equivalent — pass ?download=1 to force a
     * download instead of inline view.
     */
    public function meDocumentFile(Request $request, DriverDocument $document)
    {
        $user = $request->user();
        $driver = Driver::query()->where('user_id', $user->id)->first();
        if (!$driver || $document->driver_id !== $driver->id) {
            abort(404);
        }
        if (!$document->file_path || !\Illuminate\Support\Facades\Storage::disk('local')->exists($document->file_path)) {
            abort(404, 'File not found.');
        }

        $mime = \Illuminate\Support\Facades\Storage::disk('local')->mimeType($document->file_path) ?: 'application/octet-stream';
        $filename = basename($document->file_path);
        $download = $request->boolean('download');

        return response()->stream(
            function () use ($document) {
                $stream = \Illuminate\Support\Facades\Storage::disk('local')->readStream($document->file_path);
                if ($stream) {
                    fpassthru($stream);
                    if (is_resource($stream)) fclose($stream);
                }
            },
            200,
            [
                'Content-Type' => $mime,
                'Content-Disposition' => ($download ? 'attachment' : 'inline') . '; filename="' . $filename . '"',
            ],
        );
    }

    /**
     * Earnings summary used by the driver mobile Earnings tab.
     *
     * Returns:
     *  - total_earnings   lifetime SUM(final_fare) across the driver's completed trips
     *  - wallet_balance   placeholder until driver payouts are wired up
     *  - period           the bucket window: 'week' (last 7 days) or 'month' (last 30 days)
     *  - buckets          [{ date: YYYY-MM-DD, amount: number, weekday: short }, ...]
     *                     one entry per day in the requested window, in chronological order
     *  - weekly           [{ date, amount, weekday }, ...] always the last 7 days
     *                     so the dashboard's "weekly earnings" list stays stable
     */
    public function earnings(Request $request, WalletService $wallet)
    {
        $user = $request->user();
        $period = $request->query('period', 'week');
        if (!in_array($period, ['week', 'month', 'all'], true)) {
            $period = 'week';
        }

        $windowStart = null;
        if ($period === 'week') {
            $windowStart = now()->startOfDay()->subDays(6);
            $days = 7;
        } elseif ($period === 'month') {
            $windowStart = now()->startOfDay()->subDays(29);
            $days = 30;
        } else {
            $days = 30; // default chart window for all-time view
        }

        $rowsQuery = Trip::query()
            ->where('driver_id', $user->id)
            ->where('status', 'COMPLETED')
            ->whereNotNull('completed_at');

        if ($windowStart) {
            $rowsQuery->where('completed_at', '>=', $windowStart);
        }

        $rows = (clone $rowsQuery)
            ->selectRaw('DATE(completed_at) as day, COALESCE(SUM(final_fare), 0) as amount')
            ->groupBy('day')
            ->pluck('amount', 'day');

        // Backfill missing days with zero so the bar chart has even gaps.
        $buckets = [];
        $chartStart = $windowStart ?: now()->startOfDay()->subDays(29);
        for ($i = 0; $i < $days; $i++) {
            $d = $chartStart->copy()->addDays($i);
            $key = $d->toDateString();
            $buckets[] = [
                'date' => $key,
                'amount' => (float) ($rows[$key] ?? 0),
                'weekday' => $d->format('D'),
            ];
        }

        // Always also return last-7-days for the weekly breakdown list.
        $weekly = array_slice($buckets, -7);

        // Per-ride breakdown for the selected window: fare − commission = net.
        // This is what the driver sees as "how much was cut for each ride".
        $ridesQuery = Trip::query()
            ->where('driver_id', $user->id)
            ->where('status', 'COMPLETED')
            ->whereNotNull('completed_at');

        if ($windowStart) {
            $ridesQuery->where('completed_at', '>=', $windowStart);
        }

        $rides = $ridesQuery
            ->orderByDesc('completed_at')
            ->limit(500)
            ->get(['id', 'completed_at', 'final_fare', 'commission_amount', 'route_departure_id'])
            ->map(function (Trip $t) {
                $fare = (float) ($t->final_fare ?? 0);
                $commission = (float) ($t->commission_amount ?? 0);
                return [
                    'id' => $t->id,
                    'date' => optional($t->completed_at)->toIso8601String(),
                    'fare' => round($fare, 2),
                    'commission' => round($commission, 2),
                    'net' => round($fare - $commission, 2),
                    'commission_free' => $commission <= 0 && $fare > 0,
                    'is_shared' => $t->route_departure_id !== null,
                ];
            })
            ->all();

        // ── Period money totals (or lifetime if 'all') ──
        $totalsQuery = Trip::query()
            ->where('driver_id', $user->id)
            ->where('status', 'COMPLETED');

        if ($windowStart) {
            $totalsQuery->where('completed_at', '>=', $windowStart);
        }

        $totalEarnings = (float) (clone $totalsQuery)->sum('final_fare');
        $totalCommission = (float) (clone $totalsQuery)->sum('commission_amount');

        // What the driver has added to their own wallet (successful Razorpay
        // top-ups only) — the piece that makes the wallet differ from earnings.
        $topupTotal = (float) \App\Models\WalletTopup::query()
            ->where('user_id', $user->id)
            ->where('status', \App\Models\WalletTopup::STATUS_SUCCESS)
            ->sum('amount');

        // Wallet balance uses the SAME formula as the wallet screen
        // (credit + cashback + driver_added_cash − debit) so the two never
        // disagree — this was the source of the 100-vs-140 confusion.
        $walletBalance = $wallet->balance($user);

        // Operator wallet caps — shown for transparency. Enforcement itself stays
        // in WalletService (top-up / admin flows); this is display-only.
        $settings = OperatorSetting::instance();

        // Does the driver currently hold an active (non-queued, started) plan?
        // Commission-free rides come from this — logic unchanged, just surfaced.
        $subscriptionActive = \App\Models\DriverSubscription::query()
            ->where('driver_user_id', $user->id)
            ->where('status', \App\Models\DriverSubscription::STATUS_ACTIVE)
            ->where('is_queued', false)
            ->where('starts_at', '<=', now())
            ->exists();

        return response()->json([
            'total_earnings' => round($totalEarnings, 2),
            'total_commission' => round($totalCommission, 2),
            'net_earnings' => round($totalEarnings - $totalCommission, 2),
            'topup_total' => round($topupTotal, 2),
            'wallet_balance' => round($walletBalance, 2),
            'currency' => 'INR',
            'period' => $period,
            'buckets' => $buckets,
            'weekly' => $weekly,
            'rides' => $rides,
            'caps' => [
                'min' => (int) $settings->wallet_cash_min_capping,
                'max' => (int) $settings->wallet_cash_max_capping,
            ],
            'subscription_active' => $subscriptionActive,
            'payout' => $this->payoutSummary($user, $windowStart),
        ]);
    }

    /**
     * Where the driver's money actually IS, under the auto-split engine: their
     * share of each fare is transferred straight to their own bank account, so
     * "earnings" and "money you have" are no longer the same question.
     *
     * Three numbers matter to them:
     *   paid    — reached their account (or is on its way).
     *   held    — earned, but stuck: usually payout KYC isn't verified yet,
     *             sometimes a transfer bounced. Never lost, always retried.
     *   pending — split, but Razorpay hasn't confirmed the transfer landed.
     *
     * `enabled` is false on the legacy model, where the wallet is still the
     * source of truth and the app hides this whole section.
     *
     * @return array{enabled:bool,paid:float,pending:float,held:float,account_status:string,blocked_by_kyc:bool}
     */
    private function payoutSummary(\App\Models\User $user, ?\Carbon\Carbon $windowStart = null): array
    {
        // Route removed: there are no Route payouts/held-earnings to summarise. The
        // wallet is the single source of truth for what the driver is owed, so this
        // section is always disabled and the app shows the wallet instead.
        return [
            'enabled' => false,
            'paid' => 0.0, 'pending' => 0.0, 'held' => 0.0,
            'account_status' => (string) ($user->payout_account_status ?? \App\Models\User::PAYOUT_NONE),
            'blocked_by_kyc' => false,
        ];
    }

    /**
     * Returns the current driver's in-flight trip (or null). Used by the driver
     * mobile app on boot to resume the location stream and route to the
     * trip-active page after a cold start.
     */
    public function activeTrip(Request $request)
    {
        $user = $request->user();

        // Broader than Trip::ACTIVE_DRIVER_STATUSES on purpose: also surface
        // NEGOTIATION trips the customer pre-selected this driver for, and
        // CONFIRMED trips waiting for /driver-accept. Without these, a cold
        // start mid-handoff lands on "no active trip" even though the driver
        // is committed to one.
        $statuses = array_merge(['NEGOTIATION', 'CONFIRMED'], Trip::ACTIVE_DRIVER_STATUSES);

        $trip = Trip::query()
            ->where('driver_id', $user->id)
            ->whereIn('status', $statuses)
            ->orderByDesc('updated_at')
            ->first();

        if (!$trip) {
            return response()->json(['trip' => null]);
        }

        $trip->loadMissing('cityVehicleType:id,display_name,ride_type_id', 'cityVehicleType.rideType:id,name');
        $payload = $trip->toArray();
        $rideTypeName = (string) $trip->cityVehicleType?->rideType?->name;
        $payload['is_shared'] = $trip->route_departure_id !== null;
        $payload['service_mode'] = str_contains(strtolower($rideTypeName), 'shuttle') ? 'shuttle' : 'private';
        $payload['vehicle_name'] = $trip->cityVehicleType?->display_name;
        $payload['ride_type_name'] = $trip->cityVehicleType?->rideType?->name;
        $payload['is_prepaid'] = $payload['service_mode'] === 'shuttle';

        // Whether tolls are on for this trip's city. When off, the driver app
        // hides the end-of-ride toll box (the server ignores a toll anyway).
        $payload['tolls_enabled'] = $trip->tollsEnabled();

        // Rider contact the driver should call to coordinate pickup. For a
        // "booked for a friend" trip that's the friend the booker named; for a
        // normal trip it's the account holder. (is_for_other / booked_for_* are
        // already in the toArray payload.)
        $trip->loadMissing('customer:id,name,phone');
        $payload['customer_name'] = $trip->booked_for_name ?: $trip->customer?->name;
        $payload['customer_phone'] = $trip->booked_for_phone ?: $trip->customer?->phone;

        // Shared (fixed/shuttle) journey → attach the passenger manifest + the
        // ordered route stops so the driver app can render the pickup list.
        if ($trip->route_departure_id !== null) {
            $payload = array_merge($payload, app(\App\Services\SeatReservationService::class)->manifestFor($trip));
        }

        return response()->json(['trip' => $payload]);
    }

    /**
     * Anonymized list of nearby online + approved drivers, used by the customer
     * "searching" map to render driver pins like Uber. Returns only lat/lng +
     * an opaque `id` (the driver user id) so the customer can stably animate
     * a marker between polls. Drivers already on an in-flight trip are excluded.
     *
     * Freshness window: only drivers whose latest location row was recorded in
     * the last 5 minutes are returned — staler drivers are effectively offline.
     */
    public function nearby(Request $request)
    {
        $data = $request->validate([
            'lat' => ['required', 'numeric', 'between:-90,90'],
            'lng' => ['required', 'numeric', 'between:-180,180'],
            'radius_km' => ['nullable', 'numeric', 'min:0.1', 'max:50'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $lat = (float) $data['lat'];
        $lng = (float) $data['lng'];
        $radiusKm = (float) ($data['radius_km'] ?? 8.0);
        $limit = (int) ($data['limit'] ?? 30);

        $busyDriverIds = Trip::query()
            ->whereNotNull('driver_id')
            ->whereIn('status', Trip::DRIVER_BUSY_STATUSES)
            ->pluck('driver_id');

        $eligibleIds = Driver::query()
            ->where('approval_status', 'approved')
            ->where('is_online', true)
            ->whereNotIn('user_id', $busyDriverIds)
            ->pluck('user_id');

        if ($eligibleIds->isEmpty()) {
            return response()->json(['data' => []]);
        }

        $cutoff = now()->subMinutes(5);
        $latestPerDriver = DriverLocation::query()
            ->select('driver_id', DB::raw('MAX(recorded_at) as max_recorded_at'))
            ->whereIn('driver_id', $eligibleIds)
            ->where('recorded_at', '>=', $cutoff)
            ->groupBy('driver_id');

        $rows = DriverLocation::query()
            ->joinSub($latestPerDriver, 'latest', function ($join) {
                $join->on('driver_locations.driver_id', '=', 'latest.driver_id')
                     ->on('driver_locations.recorded_at', '=', 'latest.max_recorded_at');
            })
            ->get(['driver_locations.driver_id', 'driver_locations.lat', 'driver_locations.lng', 'driver_locations.bearing_deg']);

        $nearby = $rows
            ->map(function ($row) use ($lat, $lng) {
                $distance = $this->haversineKm($lat, $lng, (float) $row->lat, (float) $row->lng);
                return [
                    'id' => (int) $row->driver_id,
                    'lat' => (float) $row->lat,
                    'lng' => (float) $row->lng,
                    'bearing_deg' => $row->bearing_deg !== null ? (int) $row->bearing_deg : null,
                    'distance_km' => round($distance, 3),
                ];
            })
            ->filter(fn ($d) => $d['distance_km'] <= $radiusKm)
            ->sortBy('distance_km')
            ->take($limit)
            ->values();

        return response()->json(['data' => $nearby]);
    }

    private function haversineKm(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $earthKm = 6371.0;
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) ** 2
            + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;
        $c = 2 * atan2(sqrt($a), sqrt(1 - $a));
        return $earthKm * $c;
    }

    public function uploadDocument(Request $request)
    {
        // The driver wizard sends document_id (from the dynamic catalog) +
        // image_index so each required image can live in its own slot.
        // Legacy callers may still send the document_type enum — both are accepted.
        $data = $request->validate([
            'document_id' => ['nullable', 'integer', 'exists:documents,id'],
            'vehicle_type_id' => ['nullable', 'integer', 'exists:vehicle_types,id'],
            'image_index' => ['nullable', 'integer', 'min:1', 'max:20'],
            'document_type' => ['nullable', 'in:DL,RC,INSURANCE,ID'],
            'label_values' => ['nullable'],
            'file' => ['required', 'file', 'max:25600'],
        ]);

        if (empty($data['document_id']) && empty($data['document_type'])) {
            return response()->json([
                'message' => 'Either document_id (preferred) or document_type (legacy) must be provided.',
            ], 422);
        }

        $user = $request->user();
        $driver = Driver::query()->where('user_id', $user->id)->first();
        if (!$driver) {
            return response()->json(['message' => 'Driver profile not found.'], 404);
        }

        // Once the driver is approved, no further uploads are accepted —
        // their paperwork is locked. Operator handles changes after this.
        if ($driver->approval_status === 'approved') {
            return response()->json([
                'message' => 'Your registration is approved. Contact the operator to update documents.',
            ], 403);
        }

        $imageIndex = isset($data['image_index']) ? max(1, (int) $data['image_index']) : null;
        $imageIndex = $imageIndex ?? ((int) (DriverDocument::query()
            ->when(!empty($data['document_id']), fn ($q) => $q->where('document_id', (int) $data['document_id']), fn ($q) => $q->where('document_type', $data['document_type']))
            ->when(array_key_exists('vehicle_type_id', $data), fn ($q) => $q->where('vehicle_type_id', $data['vehicle_type_id'] ?? null))
            ->max('image_index') ?: 0) + 1);

        // Look up an existing row with the same identity + image slot.
        // Pending/rejected rows can be replaced by the driver; approved rows
        // stay locked unless an operator changes them.
        $matcher = !empty($data['document_id'])
            ? [
                'driver_id' => $driver->id,
                'document_id' => $data['document_id'],
                'vehicle_type_id' => $data['vehicle_type_id'] ?? null,
                'image_index' => $imageIndex,
            ]
            : [
                'driver_id' => $driver->id,
                'document_type' => $data['document_type'],
                'image_index' => $imageIndex,
            ];

        $existing = DriverDocument::query()->where($matcher)->first();
        if ($existing && $existing->status === 'approved') {
            return response()->json([
                'message' => 'This document image is already approved and cannot be re-uploaded.',
            ], 409);
        }

        // Allow label_values to arrive either as JSON string (multipart) or as
        // a structured array (raw JSON body). Anything else gets ignored.
        $labelValues = null;
        if (isset($data['label_values'])) {
            $labelValues = is_string($data['label_values'])
                ? json_decode($data['label_values'], true)
                : $data['label_values'];
            if (!is_array($labelValues)) {
                $labelValues = null;
            }
        }

        $file = $request->file('file');
        $path = $file->store('driver-documents', 'local');

        // Clean up the previous file on disk before overwriting its row.
        if ($existing && $existing->file_path && Storage::disk('local')->exists($existing->file_path)) {
            Storage::disk('local')->delete($existing->file_path);
        }

        $doc = DriverDocument::query()->updateOrCreate(
            $matcher,
            [
                'document_id' => $data['document_id'] ?? null,
                'vehicle_type_id' => $data['vehicle_type_id'] ?? null,
                'image_index' => $imageIndex,
                'document_type' => $data['document_type'] ?? null,
                'file_path' => $path,
                'label_values' => $labelValues,
                'status' => 'uploaded',
                'rejection_reason' => null,
            ]
        );

        return response()->json(['document' => $doc->fresh()]);
    }

    public function deleteDocument(Request $request, DriverDocument $document)
    {
        $user = $request->user();
        $driver = Driver::query()->where('user_id', $user->id)->first();
        if (!$driver || $document->driver_id !== $driver->id) {
            abort(404);
        }

        if ($driver->approval_status === 'approved' || $document->status === 'approved') {
            return response()->json([
                'message' => 'Approved document images cannot be removed from the app.',
            ], 403);
        }

        if ($document->file_path && Storage::disk('local')->exists($document->file_path)) {
            Storage::disk('local')->delete($document->file_path);
        }

        $document->delete();

        return response()->json(['ok' => true]);
    }

    private function resolveDriverCityVehicleType(Driver $driver): ?CityVehicleType
    {
        if (!$driver->city_id) {
            return null;
        }

        if ($driver->vehicle_type_id) {
            $row = CityVehicleType::query()
                ->where('city_id', $driver->city_id)
                ->where('vehicle_type_id', $driver->vehicle_type_id)
                ->orderBy('id')
                ->first();
            if ($row) {
                return $row;
            }
        }

        if ($driver->ride_type_id) {
            return CityVehicleType::query()
                ->where('city_id', $driver->city_id)
                ->where('ride_type_id', $driver->ride_type_id)
                ->orderBy('id')
                ->first();
        }

        return null;
    }

    public function goOnline(Request $request, WalletService $walletService)
    {
        $user = $request->user();
        $driver = Driver::query()->where('user_id', $user->id)->first();
        if (!$driver) {
            return response()->json(['message' => 'Driver profile not found.'], 404);
        }

        if ($driver->approval_status !== 'approved') {
            return response()->json(['message' => 'Driver is not approved.'], 422);
        }

        // Consult the dynamic catalog instead of the legacy DL/RC/INSURANCE/ID
        // enum. Mandatory rows in the documents catalog must each have an
        // approved driver_documents entry for this driver. Legacy enum rows
        // that exist and aren't approved still block — they don't gate
        // approval otherwise.
        $mandatoryDocIds = \App\Models\Document::query()
            ->where('required', 'mandatory_register')
            ->pluck('id')
            ->all();

        $missing = [];
        if (!empty($mandatoryDocIds)) {
            $approvedByDocId = DriverDocument::query()
                ->where('driver_id', $driver->id)
                ->whereIn('document_id', $mandatoryDocIds)
                ->where('status', 'approved')
                ->pluck('document_id')
                ->unique()
                ->all();

            $missingIds = array_values(array_diff($mandatoryDocIds, $approvedByDocId));
            if (!empty($missingIds)) {
                $missing = \App\Models\Document::query()
                    ->whereIn('id', $missingIds)
                    ->pluck('name')
                    ->all();
            }
        }

        $legacyPending = DriverDocument::query()
            ->where('driver_id', $driver->id)
            ->whereNotNull('document_type')
            ->where('status', '!=', 'approved')
            ->pluck('document_type')
            ->all();
        $missing = array_merge($missing, $legacyPending);

        if (!empty($missing)) {
            return response()->json([
                'message' => 'Not all required documents are approved.',
                'missing' => array_values(array_unique($missing)),
            ], 422);
        }

        // Block going online once the driver owes more than the operator's cash
        // exposure limit, when the driver-debt check is on. The limit is the
        // configured floor (wallet_cash_min_capping, a signed value: 0 = no debt
        // allowed, −500 = up to ₹500 of debt tolerated). This is the Model B cash
        // exposure control — it caps how much unremitted cash a driver can carry.
        $settings = OperatorSetting::instance();
        if ($settings->check_driver_debt) {
            $balance = $walletService->balance($user);
            $floor = (float) $settings->wallet_cash_min_capping;
            if ($balance < $floor) {
                $clearBy = round($floor - $balance, 2);
                return response()->json([
                    'message' => 'You owe ₹' . number_format(abs($balance), 2)
                        . ', over your allowed limit. Settle at least ₹' . number_format($clearBy, 2)
                        . ' before going online.',
                    'error_code' => 'driver_debt',
                    'balance' => $balance,
                    'limit' => $floor,
                ], 422);
            }
        }

        if (!$driver->service_scope || !$driver->service_mode) {
            return response()->json([
                'message' => 'Choose your permanent driver service before going online.',
            ], 422);
        }

        $driver->is_online = true;
        $driver->active_service_scope = $driver->service_scope;
        $driver->active_service_mode = $driver->service_mode;
        $driver->last_online_at = now();
        $driver->save();

        return response()->json(['driver' => $driver->fresh()]);
    }

    public function goOffline(Request $request)
    {
        $user = $request->user();
        $driver = Driver::query()->where('user_id', $user->id)->first();
        if (!$driver) {
            return response()->json(['message' => 'Driver profile not found.'], 404);
        }

        $driver->is_online = false;
        $driver->active_service_scope = null;
        $driver->active_service_mode = null;
        $driver->last_offline_at = now();
        $driver->save();

        return response()->json(['driver' => $driver->fresh()]);
    }

    public function setServiceMode(Request $request, DriverServiceModeService $modes)
    {
        $data = $request->validate([
            'mode' => ['nullable', 'string', 'in:private,fixed,shuttle'],
            'scope' => ['nullable', 'string', 'in:local,outstation'],
        ]);

        $driver = Driver::query()->where('user_id', $request->user()->id)->first();
        if (!$driver) {
            return response()->json(['message' => 'Driver profile not found.'], 404);
        }

        return response()->json([
            'driver' => $modes->setMode($driver, $data['mode'] ?? null, $data['scope'] ?? null),
        ]);
    }

    /**
     * Presence heartbeat from the driver app while online (no trip in flight).
     * Inserts a driver_locations row with trip_id=null so the dispatch snapshot
     * has a fresh ping for "Free" classification. Trip-time pings still go
     * through TripTrackingController@updateLocation.
     */
    public function pingLocation(Request $request, FixedStopAutomationService $fixedStops, ShuttleStopAutomationService $shuttleStops)
    {
        $data = $request->validate([
            'lat' => ['required', 'numeric', 'between:-90,90'],
            'lng' => ['required', 'numeric', 'between:-180,180'],
            'accuracy_m' => ['nullable', 'numeric', 'min:0'],
            'speed_kmh' => ['nullable', 'numeric', 'min:0'],
            'bearing_deg' => ['nullable', 'integer', 'min:0', 'max:360'],
        ]);

        $user = $request->user();
        $driver = Driver::query()->where('user_id', $user->id)->first();
        if (!$driver) {
            return response()->json(['message' => 'Driver profile not found.'], 404);
        }

        // Scope the throttle to *presence* rows (trip_id IS NULL) so the 5s
        // trip-location stream doesn't starve the 10s presence ping. They
        // share the same table but serve different purposes — interleaving
        // them would let one block the other indefinitely.
        $minIntervalSeconds = 5;
        $last = DriverLocation::query()
            ->where('driver_id', $user->id)
            ->whereNull('trip_id')
            ->orderByDesc('recorded_at')
            ->first();

        if ($last && $last->recorded_at) {
            $ageSeconds = now()->getTimestamp() - $last->recorded_at->getTimestamp();
            if ($ageSeconds < $minIntervalSeconds) {
                return response()->json([
                    'message' => 'Throttled',
                    'location' => $last,
                ], 429);
            }
        }

        $location = DriverLocation::query()->create([
            'driver_id' => $user->id,
            'trip_id' => null,
            'lat' => (float) $data['lat'],
            'lng' => (float) $data['lng'],
            'accuracy_m' => $data['accuracy_m'] ?? null,
            'speed_kmh' => $data['speed_kmh'] ?? null,
            'bearing_deg' => $data['bearing_deg'] ?? null,
            'recorded_at' => now(),
        ]);

        // Every ping is a liveness signal: stamp last_online_at so the reaper
        // and admin freshness checks know the driver is still reachable. If the
        // reaper had already flipped is_online=false because of a transient
        // network drop, this ping re-asserts that they're online.
        $driver->forceFill([
            'is_online' => true,
            'last_online_at' => now(),
        ])->save();

        broadcast(new DispatchDriverLocationUpdated(
            location: $location->fresh(),
            driver: $driver->fresh(['user', 'vehicleTypeRef']),
        ))->toOthers();

        $fixedStops->processDriverLocation($user->id, (float) $data['lat'], (float) $data['lng']);
        $shuttleStops->processDriverLocation($user->id, (float) $data['lat'], (float) $data['lng']);

        return response()->json(['location' => $location]);
    }
}

