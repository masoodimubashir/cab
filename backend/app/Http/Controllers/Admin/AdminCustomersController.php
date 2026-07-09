<?php

namespace App\Http\Controllers\Admin;

use App\Models\Driver;
use App\Models\Trip;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\SmsService;
use App\Services\WalletService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
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
                'email_unsubscribed' => (bool) $user->email_unsubscribed,
                'sms_unsubscribed' => (bool) $user->sms_unsubscribed,
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
            'email' => ['nullable', 'boolean'],
            'sms' => ['nullable', 'boolean'],
            'push' => ['nullable', 'boolean'],
        ]);

        if (array_key_exists('email', $data)) {
            $user->email_unsubscribed = (bool) $data['email'];
        }
        if (array_key_exists('sms', $data)) {
            $user->sms_unsubscribed = (bool) $data['sms'];
        }
        if (array_key_exists('push', $data)) {
            $user->push_unsubscribed = (bool) $data['push'];
        }
        $user->save();

        return response()->json([
            'message' => 'Unsubscription preferences updated.',
            'customer' => $user->fresh(),
        ]);
    }

    public function sendOtp(User $user)
    {
        $this->ensureCustomer($user);

        if (!$user->phone) {
            return response()->json(['message' => 'Customer has no phone on file.'], 422);
        }

        // Generate a 6-digit code and SMS it. We do NOT verify it here — the
        // actual app login still uses Firebase. This is an admin convenience
        // for support flows ("read me the code you just got").
        $code = (string) random_int(100000, 999999);
        $body = "Your DreamCabs verification code is {$code}. Do not share it.";

        $sent = $this->smsService->send($user->phone, $body);
        if (!$sent) {
            return response()->json(['message' => 'Failed to send OTP.'], 502);
        }

        Log::info('admin.customer.send_otp', [
            'customer_id' => $user->id,
            'phone' => $user->phone,
        ]);

        return response()->json(['message' => 'OTP sent.']);
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

        $rows = Trip::query()
            ->where('customer_id', $user->id)
            ->where('status', '!=', 'CANCELLED')
            ->with(['driver:id,name', 'rideType:id,name', 'route:id,mode,name', 'routeDeparture.route:id,mode,name'])
            ->orderByDesc('created_at')
            ->paginate(50);

        return response()->json(['data' => $rows]);
    }

    public function cancelledRides(User $user)
    {
        $this->ensureCustomer($user);

        $rows = Trip::query()
            ->where('customer_id', $user->id)
            ->where('status', 'CANCELLED')
            ->with(['driver:id,name', 'rideType:id,name', 'route:id,mode,name', 'routeDeparture.route:id,mode,name'])
            ->orderByDesc('created_at')
            ->paginate(50);

        return response()->json(['data' => $rows]);
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
