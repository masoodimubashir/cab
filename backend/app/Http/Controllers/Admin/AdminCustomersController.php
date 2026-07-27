<?php

namespace App\Http\Controllers\Admin;

use App\Models\Driver;
use App\Models\SeatReservation;
use App\Models\Trip;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\SmsService;
use App\Services\WalletService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\Rule;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Admin Customer Management — paginated list, per-customer dashboard,
 * wallet credit/debit, block/unblock, soft-delete, unsubscribe, send OTP,
 * CSV bulk import, and lookups by driver / ride.
 *
 * Mirrors the Jugnoo "Customers Details" admin module.
 */
class AdminCustomersController
{
    public function __construct(
        private readonly WalletService $walletService,
        private readonly SmsService $smsService,
    ) {
    }

    public function index(Request $request)
    {
        $search       = trim((string) $request->query('search', ''));
        $tab          = $request->query('tab', 'all'); // all | with_docs
        $lastRideFrom = trim((string) $request->query('last_ride_from', ''));
        $lastRideTo   = trim((string) $request->query('last_ride_to', ''));
        $perPage      = max(1, min(200, (int) $request->query('per_page', 25)));

        $query = User::query()
            ->whereHas('roles', fn ($q) => $q->where('role', 'customer'))
            ->select([
                'id', 'name', 'email', 'phone', 'last_login_at',
                'address', 'created_at', 'is_suspended',
                'avatar_path',
            ])
            ->withCount(['tripsAsCustomer as total_rides'])
            ->addSelect([
                'last_ride_at' => Trip::query()
                    ->selectRaw('MAX(created_at)')
                    ->whereColumn('customer_id', 'users.id'),
            ]);

        if ($search !== '') {
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                  ->orWhere('phone', 'like', "%{$search}%")
                  ->orWhere('email', 'like', "%{$search}%")
                  ->orWhere('id', $search);
            });
        }

        // "Customers with Docs" tab — customers who have ever uploaded any document.
        if ($tab === 'with_docs') {
            $query->whereHas('driver.documents');
        }

        // Last-ride date-range filter: matches customers whose most-recent
        // trip's created_at falls within [from, to]. Customers with no trips
        // are excluded (MAX is NULL, fails the comparison).
        $maxTripSql = '(SELECT MAX(created_at) FROM trips WHERE trips.customer_id = users.id)';
        if ($lastRideFrom !== '') {
            $query->whereRaw("{$maxTripSql} >= ?", [$lastRideFrom . ' 00:00:00']);
        }
        if ($lastRideTo !== '') {
            $query->whereRaw("{$maxTripSql} <= ?", [$lastRideTo . ' 23:59:59']);
        }

        $rows = $query->orderByDesc('created_at')->paginate($perPage);

        // Resolve each row's avatar URL so the admin UI doesn't have to know
        // about the storage path layout.
        $rows->getCollection()->transform(function (User $u) {
            $u->setAttribute('avatar_url', $this->avatarUrl($u->avatar_path));
            return $u;
        });

        return response()->json(['data' => $rows]);
    }

    public function show(User $user)
    {
        $this->ensureCustomer($user);

        $user->load(['roles']);

        return response()->json([
            'customer' => [
                'id' => $user->id,
                'name' => $user->name,
                'phone' => $user->phone,
                'email' => $user->email,
                'email_verified_at' => $user->email_verified_at,
                'dob' => $user->dob,
                'address' => $user->address,
                'avatar_path' => $user->avatar_path,
                'avatar_url' => $this->avatarUrl($user->avatar_path),
                'date_registered' => $user->created_at,
                'last_login_at' => $user->last_login_at,
                'app_version' => $user->app_version,
                'os_version' => $user->os_version,
                'device_type' => $user->device_type,
                'is_suspended' => (bool) $user->is_suspended,
                'suspended_reason' => $user->suspended_reason,
                'suspended_at' => $user->suspended_at,
                'duplicate_registration' => (bool) $user->duplicate_registration,
                'push_unsubscribed' => (bool) $user->push_unsubscribed,
                'wallet_balance' => $this->walletService->balance($user),
                'remaining_coupons' => 0, // placeholder until coupon redemption table exists
                'used_subscribed' => false, // placeholder until subscription module exists
                'cancellation_charge_policy' => null, // placeholder until a per-customer cancellation-charge policy exists (previously leaked the driver commission_deduction enum)
                'current_lat' => $user->current_lat,
                'current_lng' => $user->current_lng,
                'current_location_updated_at' => $user->current_location_updated_at,
            ],
        ]);
    }

    public function lookupByDriver(Request $request)
    {
        $data = $request->validate([
            'q' => ['required', 'string', 'max:80'],
            'by' => ['required', 'in:id,phone,vehicle_no'],
        ]);

        $driverQuery = Driver::query()->with('user:id,name,phone,email');
        if ($data['by'] === 'id') {
            $driverQuery->where('id', (int) $data['q']);
        } elseif ($data['by'] === 'phone') {
            $driverQuery->whereHas('user', fn ($q) => $q->where('phone', $data['q']));
        } else {
            $driverQuery->where('vehicle_reg_no', $data['q']);
        }

        $driver = $driverQuery->first();
        if (!$driver) {
            return response()->json(['driver' => null], 404);
        }

        return response()->json([
            'driver' => [
                'id' => $driver->id,
                'user_id' => $driver->user_id,
                'name' => $driver->user?->name,
                'phone' => $driver->user?->phone,
                'email' => $driver->user?->email,
                'vehicle_reg_no' => $driver->vehicle_reg_no,
                'approval_status' => $driver->approval_status,
            ],
        ]);
    }

    public function lookupByRide(Request $request)
    {
        $data = $request->validate([
            'q' => ['required', 'string', 'max:80'],
        ]);

        $trip = Trip::query()->with('customer:id,name,phone,email')->find((int) $data['q']);
        if (!$trip) {
            return response()->json(['ride' => null], 404);
        }

        return response()->json([
            'ride' => [
                'id' => $trip->id,
                'status' => $trip->status,
                'estimated_fare' => $trip->estimated_fare,
                'final_fare' => $trip->final_fare,
                'created_at' => $trip->created_at,
                'customer' => $trip->customer ? [
                    'id' => $trip->customer->id,
                    'name' => $trip->customer->name,
                    'phone' => $trip->customer->phone,
                    'email' => $trip->customer->email,
                ] : null,
            ],
        ]);
    }

    /**
     * PATCH /admin/customers/{user} — update the customer's profile fields.
     * Only touches the identity block (name/phone/email/dob/address); status
     * changes stay on the dedicated block/unblock/unsubscribe endpoints.
     */
    public function update(Request $request, User $user)
    {
        $this->ensureCustomer($user);

        $data = $request->validate([
            'name' => ['sometimes', 'nullable', 'string', 'max:120'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:20', Rule::unique('users', 'phone')->ignore($user->id)],
            'email' => ['sometimes', 'nullable', 'email', 'max:180', Rule::unique('users', 'email')->ignore($user->id)],
            'dob' => ['sometimes', 'nullable', 'date', 'before:today'],
            'address' => ['sometimes', 'nullable', 'string', 'max:500'],
        ]);

        $user->fill($data)->save();

        return response()->json(['customer' => $user->fresh()]);
    }

    public function block(Request $request, User $user)
    {
        $this->ensureCustomer($user);
        $data = $request->validate([
            'reason' => ['required', 'string', 'max:500'],
        ]);

        $user->is_suspended = true;
        $user->suspended_reason = $data['reason'];
        $user->suspended_at = now();
        $user->save();

        return response()->json(['message' => 'Customer blocked.', 'customer' => $user->fresh()]);
    }

    public function unblock(User $user)
    {
        $this->ensureCustomer($user);

        $user->is_suspended = false;
        $user->suspended_reason = null;
        $user->suspended_at = null;
        $user->save();

        return response()->json(['message' => 'Customer unblocked.', 'customer' => $user->fresh()]);
    }

    public function destroy(Request $request, User $user)
    {
        $this->ensureCustomer($user);
        $data = $request->validate([
            'reason' => ['required', 'string', 'max:50'],
        ]);

        // Stash the reason on the suspended_reason column so support can audit later.
        $user->suspended_reason = '[DELETED] ' . $data['reason'];
        $user->suspended_at = now();
        $user->save();
        $user->delete();

        return response()->json(['message' => 'Customer deleted.']);
    }

    public function unsubscribe(Request $request, User $user)
    {
        $this->ensureCustomer($user);
        $data = $request->validate([
            'push' => ['nullable', 'boolean'],
        ]);

        if (array_key_exists('push', $data)) {
            $user->push_unsubscribed = (bool) $data['push'];
        }
        $user->save();

        return response()->json([
            'message' => 'Push preference updated.',
            'customer' => $user->fresh(),
        ]);
    }

    public function sendOtp(User $user, \App\Services\PhoneOtpService $phoneOtpService)
    {
        $this->ensureCustomer($user);

        if (!$user->phone) {
            return response()->json(['message' => 'Customer has no phone on file.'], 422);
        }

        $res = $phoneOtpService->start($user->phone, 'customer');
        if (!($res['sent'] ?? false)) {
            $cooldown = $res['cooldown'] ?? 30;
            return response()->json([
                'message' => "Please wait {$cooldown} seconds before resending OTP.",
            ], 429);
        }

        Log::info('admin.customer.send_otp', [
            'customer_id' => $user->id,
            'phone' => $user->phone,
        ]);

        return response()->json([
            'message' => 'OTP sent successfully.',
            'dev_code' => $res['dev_code'] ?? null,
        ]);
    }

    public function walletTransactions(User $user)
    {
        $this->ensureCustomer($user);

        $rows = WalletTransaction::query()
            ->where('user_id', $user->id)
            ->with(['createdBy:id,name'])
            ->orderByDesc('created_at')
            ->paginate(50);

        return response()->json(['data' => $rows]);
    }

    public function rides(User $user)
    {
        $this->ensureCustomer($user);

        return response()->json($this->customerRidesPayload($user, cancelled: false));
    }

    public function cancelledRides(User $user)
    {
        $this->ensureCustomer($user);

        return response()->json($this->customerRidesPayload($user, cancelled: true));
    }

    /**
     * Rides feed for the customer detail page. A rider's history is two things
     * merged: solo/private trips they booked (trips.customer_id) AND their
     * fixed/shuttle seat bookings (seat_reservations.customer_id) — the latter
     * never live on trips.customer_id, so without this a fixed-only rider's
     * Rides tab would look empty. Each row also carries what they paid and any
     * refund received.
     */
    private function customerRidesPayload(User $user, bool $cancelled): array
    {
        $solo = Trip::query()
            ->where('customer_id', $user->id)
            ->when(
                $cancelled,
                fn ($q) => $q->where('status', 'CANCELLED'),
                fn ($q) => $q->where('status', '!=', 'CANCELLED'),
            )
            ->with(['driver:id,name', 'rideType:id,name', 'route:id,mode,name', 'routeDeparture.route:id,mode,name'])
            ->orderByDesc('created_at')
            ->limit(200)
            ->get()
            ->map(fn (Trip $t) => $this->soloRideRowForCustomer($t));

        $fixed = SeatReservation::query()
            ->where('customer_id', $user->id)
            ->when(
                $cancelled,
                fn ($q) => $q->where('status', 'CANCELLED'),
                fn ($q) => $q->where('status', '!=', 'CANCELLED'),
            )
            ->with(['route:id,mode,name', 'routeDeparture.route:id,mode,name', 'routeDeparture.driver:id,name'])
            ->orderByDesc('created_at')
            ->limit(200)
            ->get()
            ->map(fn (SeatReservation $sr) => $this->fixedRideRowForCustomer($sr));

        $rows = $solo->concat($fixed)
            ->sortByDesc(fn ($r) => $r['created_at'] ?? '')
            ->values();

        return [
            'data' => ['data' => $rows],
            'summary' => $this->customerMoneySummary($user),
        ];
    }

    private function soloRideRowForCustomer(Trip $t): array
    {
        $row = $t->toArray();
        $row['kind'] = 'solo';
        $row['driver_name'] = $t->driver?->name;
        $row['paid_amount'] = round((float) ($t->final_fare ?? $t->estimated_fare ?? 0), 2);
        $row['payment_status'] = $t->payment_method ? 'PAID' : null;
        $row['refund_amount'] = 0;
        $row['refund_due'] = 0;
        $row['refund_status'] = 'NONE';

        return $row;
    }

    private function fixedRideRowForCustomer(SeatReservation $sr): array
    {
        $dep = $sr->routeDeparture;
        $route = $sr->route ?? $dep?->route;
        $refunded = $sr->refund_status === 'REFUNDED';
        $refundDue = $sr->refund_status === 'APPROVED';

        return [
            // No trip.customer_id for these, so the row id is the trip (when the
            // vehicle has been assigned) else the booking id — display only.
            'id' => $sr->trip_id ?? $sr->id,
            'kind' => $route?->mode === 'shuttle' ? 'shuttle' : 'fixed',
            'status' => $sr->status,
            'driver' => $dep?->driver ? ['id' => $dep->driver->id, 'name' => $dep->driver->name] : null,
            'driver_name' => $dep?->driver?->name,
            'pickup_address' => $sr->board_address,
            'pickup_lat' => $sr->board_lat,
            'pickup_lng' => $sr->board_lng,
            'drop_address' => $sr->drop_address,
            'drop_lat' => $sr->drop_lat,
            'drop_lng' => $sr->drop_lng,
            'ride_type' => null,
            'route' => $route ? ['mode' => $route->mode, 'name' => $route->name] : null,
            'route_departure_id' => $sr->route_departure_id,
            'route_departure' => $dep && $dep->route
                ? ['route' => ['mode' => $dep->route->mode, 'name' => $dep->route->name]]
                : null,
            'seats' => $sr->seats,
            'payment_method' => $sr->payment_method,
            'payment_status' => $sr->payment_status,
            'paid_amount' => $sr->payment_status === 'PAID' ? round((float) $sr->fare_amount, 2) : 0,
            'final_fare' => round((float) $sr->fare_amount, 2),
            'estimated_fare' => round((float) $sr->fare_amount, 2),
            'refund_amount' => $refunded ? round((float) ($sr->refund_amount ?? 0), 2) : 0,
            'refund_due' => $refundDue ? round((float) ($sr->refund_amount ?? $sr->fare_amount), 2) : 0,
            'refund_status' => $sr->refund_status ?: 'NONE',
            'created_at' => $sr->created_at?->toISOString(),
            'completed_at' => $sr->dropped_at?->toISOString(),
        ];
    }

    /**
     * Money totals for the customer detail header: everything they've paid and
     * every refund actually returned (REFUNDED), plus refunds still owed
     * (APPROVED = in the manual refund register, not yet paid out).
     */
    private function customerMoneySummary(User $user): array
    {
        $soloPaid = (float) Trip::query()
            ->where('customer_id', $user->id)
            ->where('status', '!=', 'CANCELLED')
            ->sum(DB::raw('COALESCE(final_fare, estimated_fare, 0)'));

        $seatPaid = (float) SeatReservation::query()
            ->where('customer_id', $user->id)
            ->where('payment_status', 'PAID')
            ->sum('fare_amount');

        $refunded = (float) SeatReservation::query()
            ->where('customer_id', $user->id)
            ->where('refund_status', 'REFUNDED')
            ->sum('refund_amount');

        $refundDue = (float) SeatReservation::query()
            ->where('customer_id', $user->id)
            ->where('refund_status', 'APPROVED')
            ->sum('refund_amount');

        $ridesCount = Trip::query()
                ->where('customer_id', $user->id)
                ->where('status', '!=', 'CANCELLED')
                ->count()
            + SeatReservation::query()
                ->where('customer_id', $user->id)
                ->where('status', '!=', 'CANCELLED')
                ->count();

        return [
            'rides_count' => $ridesCount,
            'total_paid' => round($soloPaid + $seatPaid, 2),
            'total_refunded' => round($refunded, 2),
            'refund_due' => round($refundDue, 2),
        ];
    }

    public function importCsv(Request $request)
    {
        $request->validate([
            'file' => ['required', 'file', 'mimes:csv,txt', 'max:2048'],
        ]);

        $path = $request->file('file')->getRealPath();
        $handle = fopen($path, 'r');
        if (!$handle) {
            return response()->json(['message' => 'Could not read uploaded file.'], 422);
        }

        $headers = fgetcsv($handle);
        if (!$headers || !in_array('phone', array_map('strtolower', $headers), true)) {
            fclose($handle);
            return response()->json(['message' => 'CSV must include a "phone" column.'], 422);
        }
        $headers = array_map('strtolower', $headers);
        $phoneIdx = array_search('phone', $headers, true);
        $nameIdx = array_search('name', $headers, true);
        $emailIdx = array_search('email', $headers, true);

        $created = 0;
        $updated = 0;
        $skipped = 0;

        DB::transaction(function () use ($handle, $phoneIdx, $nameIdx, $emailIdx, &$created, &$updated, &$skipped) {
            while (($row = fgetcsv($handle)) !== false) {
                $phone = isset($row[$phoneIdx]) ? trim((string) $row[$phoneIdx]) : '';
                if ($phone === '') {
                    $skipped++;
                    continue;
                }

                $existing = User::query()->where('phone', $phone)->first();
                if ($existing) {
                    // Only update name/email if missing on the existing record.
                    if ($nameIdx !== false && empty($existing->name) && !empty($row[$nameIdx])) {
                        $existing->name = trim((string) $row[$nameIdx]);
                    }
                    if ($emailIdx !== false && empty($existing->email) && !empty($row[$emailIdx])) {
                        $existing->email = trim((string) $row[$emailIdx]);
                    }
                    $existing->save();
                    $existing->addRole('customer');
                    $updated++;
                } else {
                    $user = User::query()->create([
                        'phone' => $phone,
                        'name' => $nameIdx !== false ? trim((string) ($row[$nameIdx] ?? '')) : null,
                        'email' => $emailIdx !== false ? trim((string) ($row[$emailIdx] ?? '')) : null,
                    ]);
                    $user->addRole('customer');
                    $created++;
                }
            }
        });
        fclose($handle);

        return response()->json([
            'message' => "Imported: {$created} created, {$updated} updated, {$skipped} skipped.",
            'created' => $created,
            'updated' => $updated,
            'skipped' => $skipped,
        ]);
    }

    private function ensureCustomer(User $user): void
    {
        if (!$user->hasRole('customer')) {
            abort(404, 'Customer not found.');
        }
    }

    /**
     * Resolve the public URL the admin UI can render for a stored avatar.
     * Using url() (not Storage::url()) so the host+port match the request —
     * Storage::url() reads APP_URL from .env, which in dev often lacks the
     * artisan-serve port and yields a broken link.
     */
    private function avatarUrl(?string $path): ?string
    {
        if (!$path) {
            return null;
        }
        if (str_starts_with($path, 'http')) {
            return $path;
        }
        return url('/storage/' . ltrim($path, '/'));
    }
}
