<?php

namespace App\Http\Controllers\Admin;

use App\Models\Driver;
use App\Models\DriverDocument;
use App\Models\Trip;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\WalletService;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class AdminDriversController
{
    public function __construct(
        private readonly WalletService $walletService,
    ) {
    }

    /**
     * Lists drivers for the admin panel.
     *
     * Filters (all optional):
     *   - state:        active (default) | deactivated
     *   - vehicle_type: exact match against drivers.vehicle_type
     *   - q:            substring match against driver id, user.name, user.phone,
     *                   user.email, drivers.vehicle_reg_no
     *   - per_page:     pagination size (default 50)
     */
    public function index(Request $request)
    {
        $drivers = $this->buildIndexQuery($request)->paginate(
            (int) ($request->query('per_page') ?? 50)
        );

        $drivers->getCollection()->transform(function (Driver $d) {
            return $this->shapeRow($d);
        });

        return response()->json(['data' => $drivers]);
    }

    /**
     * Streams the same filtered set as a CSV download.
     */
    public function exportCsv(Request $request): StreamedResponse
    {
        $query = $this->buildIndexQuery($request);
        $state = strtolower((string) $request->query('state', 'active'));
        $filename = 'drivers-' . $state . '-' . now()->format('Ymd-His') . '.csv';

        $columns = [
            'driver_id', 'name', 'phone', 'email', 'vehicle_type', 'vehicle_reg_no',
            'approval_status', 'is_online', 'registered_on', 'last_login',
            'rides_7d', 'rides_30d', 'total_rides', 'last_ride_on',
            'deactivated_at', 'deactivated_reason',
        ];

        return response()->streamDownload(function () use ($query, $columns) {
            $out = fopen('php://output', 'w');
            fputcsv($out, $columns);

            $query->cursor()->each(function (Driver $d) use ($out) {
                $row = $this->shapeRow($d);
                fputcsv($out, [
                    $row['id'],
                    $row['user']['name'] ?? '',
                    $row['user']['phone'] ?? '',
                    $row['user']['email'] ?? '',
                    $row['vehicle_type'] ?? '',
                    $row['vehicle_reg_no'] ?? '',
                    $row['approval_status'],
                    $row['is_online'] ? 'yes' : 'no',
                    $row['registered_on'],
                    $row['last_login'] ?? '',
                    $row['rides_7d'],
                    $row['rides_30d'],
                    $row['total_rides'],
                    $row['last_ride_on'] ?? '',
                    $row['deactivated_at'] ?? '',
                    $row['deactivated_reason'] ?? '',
                ]);
            });

            fclose($out);
        }, $filename, [
            'Content-Type' => 'text/csv',
        ]);
    }

    public function setApproval(Request $request, Driver $driver)
    {
        $data = $request->validate([
            'approval_status' => ['required', 'in:approved,rejected'],
            'rejection_reason' => ['nullable', 'string', 'max:1000'],
        ]);

        if ($data['approval_status'] === 'approved') {
            // The check used to hard-code the legacy DL/RC/INSURANCE/ID enum.
            // The dynamic catalog (documents.required = 'mandatory_register')
            // is the source of truth now. For each mandatory catalog entry
            // the driver must have at least one driver_documents row with
            // status='approved'. Catalog entries marked 'optional' don't gate
            // approval.
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

            // Legacy DL/RC/INSURANCE/ID rows: only block when one of them is
            // explicitly present-but-not-approved. We don't *require* them
            // anymore — fresh drivers come through the new flow only.
            $legacyPending = DriverDocument::query()
                ->where('driver_id', $driver->id)
                ->whereNotNull('document_type')
                ->where('status', '!=', 'approved')
                ->pluck('document_type')
                ->all();
            $missing = array_merge($missing, $legacyPending);

            if (!empty($missing)) {
                return response()->json([
                    'message' => 'All required documents must be approved before approving the driver.',
                    'missing' => array_values(array_unique($missing)),
                ], 422);
            }

            $driver->approval_status = 'approved';
            $driver->approved_at = now();
            $driver->rejected_at = null;
        } else {
            $driver->approval_status = 'rejected';
            $driver->rejected_at = now();
            $driver->approved_at = null;
            $driver->is_online = false;
        }

        $driver->save();

        return response()->json(['driver' => $driver->fresh()]);
    }

    public function setDocumentStatus(Request $request, DriverDocument $document)
    {
        $data = $request->validate([
            'status' => ['required', 'in:approved,rejected'],
            'rejection_reason' => ['nullable', 'string', 'max:1000'],
        ]);

        // Force the operator to give a reason on rejection so the driver gets
        // actionable feedback in the mobile app.
        if ($data['status'] === 'rejected' && empty(trim((string) ($data['rejection_reason'] ?? '')))) {
            return response()->json([
                'message' => 'A rejection reason is required when rejecting a document.',
            ], 422);
        }

        // Block document approval until the operator has set the driver's
        // vehicle registration number. Approving a document for a vehicle that
        // has no plate on file leaves the driver in an inconsistent state
        // (the dispatch flow keys off vehicle_reg_no).
        if ($data['status'] === 'approved') {
            $driver = $document->driver;
            if (!$driver || empty(trim((string) ($driver->vehicle_reg_no ?? '')))) {
                return response()->json([
                    'message' => 'Please register vehicle number first.',
                ], 422);
            }
        }

        $document->status = $data['status'];
        $document->rejection_reason = $data['status'] === 'rejected'
            ? trim($data['rejection_reason'])
            : null;
        $document->save();

        return response()->json(['document' => $document->fresh()]);
    }

    /**
     * Full driver profile used by the Approval Details page. Bundles the
     * driver row, the user, ride_type / vehicle_type labels, and every
     * uploaded document with its catalog name + label values.
     */
    public function fullProfile(Driver $driver)
    {
        $driver->load(['user', 'rideType', 'vehicleTypeRef']);

        $docs = DriverDocument::query()
            ->where('driver_id', $driver->id)
            ->with(['document.labels', 'vehicleType'])
            ->orderByDesc('id')
            ->get()
            ->map(fn (DriverDocument $d) => [
                'id' => $d->id,
                'document_id' => $d->document_id,
                'document_name' => $d->document?->name,
                'document_type' => $d->document_type, // legacy enum
                'vehicle_type_id' => $d->vehicle_type_id,
                'vehicle_type_name' => $d->vehicleType?->name,
                'file_path' => $d->file_path,
                'file_url' => route('admin.drivers.documents.file', [
                    'driver' => $driver->id,
                    'document' => $d->id,
                ]),
                'label_values' => $d->label_values,
                'labels_meta' => $d->document?->labels->map(fn ($l) => [
                    'label' => $l->label,
                    'label_type' => $l->label_type,
                    'mandatory' => (bool) $l->mandatory,
                ])->all() ?? [],
                'status' => $d->status,
                'rejection_reason' => $d->rejection_reason,
                'uploaded_at' => optional($d->created_at)->toIso8601String(),
            ]);

        return response()->json([
            'driver' => [
                'id' => $driver->id,
                'user_id' => $driver->user_id,
                'name' => $driver->user?->name,
                'phone' => $driver->user?->phone,
                'email' => $driver->user?->email,
                'avatar_path' => $driver->user?->avatar_path,
                'avatar_url' => $this->avatarUrl($driver->user?->avatar_path),
                'ride_type_id' => $driver->ride_type_id,
                'ride_type_name' => $driver->rideType?->name,
                'vehicle_type_id' => $driver->vehicle_type_id,
                'vehicle_type_name' => $driver->vehicleTypeRef?->name,
                'vehicle_reg_no' => $driver->vehicle_reg_no,
                'vehicle_brand' => $driver->vehicle_brand,
                'vehicle_model' => $driver->vehicle_model,
                'vehicle_color' => $driver->vehicle_color,
                'approval_status' => $driver->approval_status,
                'deactivated_at' => optional($driver->deactivated_at)->toIso8601String(),
                'is_online' => $driver->isOnlineFresh(),
                'created_at' => optional($driver->created_at)->toIso8601String(),
            ],
            'documents' => $docs,
        ]);
    }

    /**
     * Driver dashboard profile for the admin detail page. Mirrors the customer
     * `show()` shape but with driver-specific fields (vehicle, rating, online,
     * approval). Wallet, referrals and rides all hang off the driver's user
     * account (trips.driver_id points to users.id).
     */
    public function profile(Driver $driver)
    {
        $driver->load([
            'user.referrer:id,name,referral_code',
            'rideType:id,name',
            'vehicleTypeRef:id,name',
            'city:id,name',
        ]);

        $user = $driver->user;

        $totalRides = Trip::query()
            ->where('driver_id', $driver->user_id)
            ->where('status', 'COMPLETED')
            ->count();

        return response()->json([
            'driver' => [
                'id' => $driver->id,
                'user_id' => $driver->user_id,
                'name' => $user?->name,
                'phone' => $user?->phone,
                'email' => $user?->email,
                'avatar_path' => $user?->avatar_path,
                'avatar_url' => $this->avatarUrl($user?->avatar_path),
                'dob' => $user?->dob,
                'address' => $user?->address,
                'date_registered' => optional($driver->created_at)->toIso8601String(),
                'last_login_at' => optional($user?->last_login_at)->toIso8601String(),
                'app_version' => $user?->app_version,
                'os_version' => $user?->os_version,
                'device_type' => $user?->device_type,
                'ride_type_name' => $driver->rideType?->name,
                'vehicle_type_name' => $driver->vehicleTypeRef?->name,
                'vehicle_type' => $driver->vehicle_type,
                'vehicle_brand' => $driver->vehicle_brand,
                'vehicle_model' => $driver->vehicle_model,
                'vehicle_color' => $driver->vehicle_color,
                'vehicle_reg_no' => $driver->vehicle_reg_no,
                'city_name' => $driver->city?->name,
                'approval_status' => $driver->approval_status,
                'is_online' => $driver->isOnlineFresh(),
                'is_active' => $driver->deactivated_at === null,
                'deactivated_at' => optional($driver->deactivated_at)->toIso8601String(),
                'deactivated_reason' => $driver->deactivated_reason,
                'rating_avg' => $driver->rating_avg,
                'rating_count' => $driver->rating_count,
                'referral_code' => $user?->referral_code,
                'referrer' => $user?->referrer ? [
                    'id' => $user->referrer->id,
                    'name' => $user->referrer->name,
                    'referral_code' => $user->referrer->referral_code,
                ] : null,
                'wallet_balance' => $user ? $this->walletService->balance($user) : 0,
                'total_rides' => $totalRides,
                'current_lat' => $user?->current_lat,
                'current_lng' => $user?->current_lng,
                'current_location_updated_at' => $user?->current_location_updated_at,
            ],
        ]);
    }

    public function rides(Driver $driver)
    {
        $rows = Trip::query()
            ->where('driver_id', $driver->user_id)
            ->where('status', '!=', 'CANCELLED')
            ->with(['customer:id,name', 'rideType:id,name'])
            ->orderByDesc('created_at')
            ->paginate(50);

        return response()->json(['data' => $rows]);
    }

    public function cancelledRides(Driver $driver)
    {
        $rows = Trip::query()
            ->where('driver_id', $driver->user_id)
            ->where('status', 'CANCELLED')
            ->with(['customer:id,name', 'rideType:id,name'])
            ->orderByDesc('created_at')
            ->paginate(50);

        return response()->json(['data' => $rows]);
    }

    public function walletTransactions(Driver $driver)
    {
        $rows = WalletTransaction::query()
            ->where('user_id', $driver->user_id)
            ->with(['createdBy:id,name'])
            ->orderByDesc('created_at')
            ->paginate(50);

        return response()->json(['data' => $rows]);
    }

    public function creditDebit(Request $request, Driver $driver)
    {
        $user = $driver->user;
        if (!$user) {
            return response()->json(['message' => 'Driver has no user account.'], 422);
        }

        $data = $request->validate([
            'type' => ['required', 'in:credit,debit,cashback,driver_added_cash'],
            'amount' => ['required', 'numeric', 'min:0.01', 'max:1000000'],
            'reason' => ['nullable', 'string', 'max:500'],
            'engagement_id' => ['nullable', 'integer', 'exists:trips,id'],
        ]);

        // Admin add/remove respects the operator's wallet min/max caps.
        if ($msg = $this->walletService->capViolation($user, $data['type'], (float) $data['amount'])) {
            return response()->json(['message' => $msg], 422);
        }

        $txn = $this->walletService->recordTransaction(
            user: $user,
            type: $data['type'],
            amount: (float) $data['amount'],
            reason: $data['reason'] ?? null,
            tripId: $data['engagement_id'] ?? null,
            by: $request->user(),
        );

        return response()->json([
            'transaction' => $txn,
            'wallet_balance' => $this->walletService->balance($user),
        ], 201);
    }

    public function referrals(Driver $driver)
    {
        $rows = User::query()
            ->where('referred_by_user_id', $driver->user_id)
            ->select(['id', 'name', 'phone', 'email', 'created_at'])
            ->orderByDesc('created_at')
            ->paginate(50);

        return response()->json(['data' => $rows]);
    }

    /**
     * Stream a document file back to the admin. Files are stored on the
     * non-public disk so a direct URL won't work — this endpoint
     * authenticates the request and pipes the bytes through.
     */
    public function documentFile(Driver $driver, DriverDocument $document)
    {
        if ($document->driver_id !== $driver->id) {
            abort(404);
        }
        if (!$document->file_path || !Storage::disk('local')->exists($document->file_path)) {
            abort(404, 'File not found on disk.');
        }

        $mime = Storage::disk('local')->mimeType($document->file_path) ?: 'application/octet-stream';
        $filename = basename($document->file_path);
        $download = request()->boolean('download');

        return response()->stream(
            function () use ($document) {
                $stream = Storage::disk('local')->readStream($document->file_path);
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
     * Admin uploads a document on behalf of a driver (e.g. when paperwork
     * arrives in person). Same payload shape as the driver-mobile upload —
     * document_id is preferred, vehicle_type_id is optional, label_values
     * accepted as JSON string or array.
     */
    public function uploadDocument(Request $request, Driver $driver)
    {
        $data = $request->validate([
            'document_id' => ['nullable', 'integer', 'exists:documents,id'],
            'vehicle_type_id' => ['nullable', 'integer', 'exists:vehicle_types,id'],
            'document_type' => ['nullable', 'in:DL,RC,INSURANCE,ID'],
            'label_values' => ['nullable'],
            'file' => ['required', 'file', 'max:10240'],
        ]);
        if (empty($data['document_id']) && empty($data['document_type'])) {
            return response()->json([
                'message' => 'document_id or document_type is required.',
            ], 422);
        }

        $labelValues = null;
        if (isset($data['label_values'])) {
            $labelValues = is_string($data['label_values'])
                ? json_decode($data['label_values'], true)
                : $data['label_values'];
            if (!is_array($labelValues)) $labelValues = null;
        }

        $path = $request->file('file')->store('driver-documents', 'local');

        $matcher = !empty($data['document_id'])
            ? [
                'driver_id' => $driver->id,
                'document_id' => $data['document_id'],
                'vehicle_type_id' => $data['vehicle_type_id'] ?? null,
            ]
            : [
                'driver_id' => $driver->id,
                'document_type' => $data['document_type'],
            ];

        $doc = DriverDocument::query()->updateOrCreate(
            $matcher,
            [
                'document_id' => $data['document_id'] ?? null,
                'vehicle_type_id' => $data['vehicle_type_id'] ?? null,
                'document_type' => $data['document_type'] ?? null,
                'file_path' => $path,
                'label_values' => $labelValues,
                'status' => 'uploaded',
                'rejection_reason' => null,
            ]
        );

        return response()->json(['document' => $doc->fresh()]);
    }

    /**
     * Admin edits a driver row directly — e.g. setting vehicle_reg_no that
     * the driver app no longer collects.
     */
    public function updateDriver(Request $request, Driver $driver)
    {
        $data = $request->validate([
            'vehicle_reg_no' => ['nullable', 'string', 'max:50'],
            'vehicle_brand' => ['nullable', 'string', 'max:100'],
            'vehicle_model' => ['nullable', 'string', 'max:100'],
            'vehicle_color' => ['nullable', 'string', 'max:100'],
            'ride_type_id' => ['nullable', 'integer', 'exists:ride_types,id'],
            'vehicle_type_id' => ['nullable', 'integer', 'exists:vehicle_types,id'],
        ]);

        $driver->fill($data);
        $driver->save();

        return response()->json(['driver' => $driver->fresh()]);
    }

    /**
     * Deactivate or reactivate a driver. Deactivation also forces them offline.
     */
    public function setActivation(Request $request, Driver $driver)
    {
        $data = $request->validate([
            'active' => ['required', 'boolean'],
            'reason' => ['nullable', 'string', 'max:1000'],
        ]);

        if ($data['active']) {
            $driver->deactivated_at = null;
            $driver->deactivated_reason = null;
        } else {
            $driver->deactivated_at = now();
            $driver->deactivated_reason = $data['reason'] ?? null;
            $driver->is_online = false;
        }

        $driver->save();

        return response()->json(['driver' => $driver->fresh()]);
    }

    /**
     * Driver leaderboard. Counts COMPLETED trips per driver in the chosen period.
     *
     * ?period=day|week|month   (default: day)
     */
    public function leaderboard(Request $request)
    {
        $period = strtolower((string) $request->query('period', 'day'));
        $since = match ($period) {
            'week' => now()->subDays(7),
            'month' => now()->subDays(30),
            default => now()->startOfDay(),
        };

        $rows = DB::table('trips')
            ->join('drivers', 'drivers.user_id', '=', 'trips.driver_id')
            ->join('users', 'users.id', '=', 'drivers.user_id')
            ->where('trips.status', 'COMPLETED')
            ->where('trips.completed_at', '>=', $since)
            ->select(
                'drivers.id as driver_id',
                'users.name as name',
                'users.phone as phone',
                'users.avatar_path as avatar_path',
                DB::raw('COUNT(trips.id) as rides')
            )
            ->groupBy('drivers.id', 'users.name', 'users.phone', 'users.avatar_path')
            ->orderByDesc('rides')
            ->limit(100)
            ->get();

        $ranked = $rows->values()->map(function ($row, $idx) {
            return [
                'driver_id' => (int) $row->driver_id,
                'name' => $row->name,
                'phone' => $row->phone,
                'avatar_path' => $row->avatar_path,
                'avatar_url' => $this->avatarUrl($row->avatar_path),
                'rides' => (int) $row->rides,
                'rank' => $idx + 1,
            ];
        });

        return response()->json([
            'period' => $period,
            'since' => $since->toIso8601String(),
            'data' => $ranked,
        ]);
    }

    /**
     * Per-driver successful / cancelled / missed counts in a date range.
     *
     * ?from=YYYY-MM-DD&to=YYYY-MM-DD (defaults to today)
     */
    public function performance(Request $request)
    {
        $from = $request->query('from')
            ? Carbon::parse((string) $request->query('from'))->startOfDay()
            : now()->startOfDay();
        $to = $request->query('to')
            ? Carbon::parse((string) $request->query('to'))->endOfDay()
            : now()->endOfDay();

        $rows = DB::table('trips')
            ->join('drivers', 'drivers.user_id', '=', 'trips.driver_id')
            ->join('users', 'users.id', '=', 'drivers.user_id')
            ->whereBetween('trips.created_at', [$from, $to])
            ->select(
                'drivers.id as driver_id',
                'users.name as name',
                'users.phone as phone',
                'users.avatar_path as avatar_path',
                DB::raw("SUM(CASE WHEN trips.status = 'COMPLETED' THEN 1 ELSE 0 END) as successful"),
                DB::raw("SUM(CASE WHEN trips.status = 'CANCELLED' AND trips.no_show_by IS NULL THEN 1 ELSE 0 END) as cancelled"),
                DB::raw("SUM(CASE WHEN trips.status = 'CANCELLED' AND trips.no_show_by IS NOT NULL THEN 1 ELSE 0 END) as missed")
            )
            ->groupBy('drivers.id', 'users.name', 'users.phone', 'users.avatar_path')
            ->orderByDesc('successful')
            ->get()
            ->map(fn ($r) => [
                'driver_id' => (int) $r->driver_id,
                'name' => $r->name,
                'phone' => $r->phone,
                'avatar_path' => $r->avatar_path,
                'avatar_url' => $this->avatarUrl($r->avatar_path),
                'successful' => (int) $r->successful,
                'cancelled' => (int) $r->cancelled,
                'missed' => (int) $r->missed,
                'total' => (int) $r->successful + (int) $r->cancelled + (int) $r->missed,
            ]);

        return response()->json([
            'from' => $from->toDateString(),
            'to' => $to->toDateString(),
            'data' => $rows,
        ]);
    }

    /**
     * @return \Illuminate\Database\Eloquent\Builder<Driver>
     *
     * Filters honored:
     *   - state:        all (default) | active | deactivated
     *   - vehicle_type: exact match
     *   - has_documents: 1 → with docs, 0 → without
     *   - q:            driver id, name, email, phone, vehicle_reg_no
     *   - date_from / date_to: drivers.created_at window (YYYY-MM-DD)
     */
    private function buildIndexQuery(Request $request)
    {
        $state = strtolower((string) $request->query('state', 'all'));

        $query = Driver::query()
            ->with(['user', 'documents']);

        if ($state === 'deactivated') {
            $query->whereNotNull('deactivated_at');
        } elseif ($state === 'active') {
            $query->whereNull('deactivated_at');
        }
        // state=all → no activation filter

        if ($vehicleType = $request->query('vehicle_type')) {
            $query->where('vehicle_type', $vehicleType);
        }

        // ?has_documents=1 → drivers with at least one driver_documents row
        // ?has_documents=0 → drivers with zero uploads
        if ($request->has('has_documents') && $request->query('has_documents') !== '') {
            if ($request->boolean('has_documents')) {
                $query->whereHas('documents');
            } else {
                $query->whereDoesntHave('documents');
            }
        }

        // ?is_online=1 → fresh-online drivers (online flag + ping within stale window)
        // ?is_online=0 → offline OR stale (older than STALE_AFTER_SECONDS)
        if ($request->has('is_online') && $request->query('is_online') !== '') {
            $staleCutoff = now()->subSeconds(Driver::STALE_AFTER_SECONDS);
            if ($request->boolean('is_online')) {
                $query->where('drivers.is_online', true)
                    ->where('drivers.last_online_at', '>=', $staleCutoff);
            } else {
                $query->where(function ($w) use ($staleCutoff) {
                    $w->where('drivers.is_online', false)
                        ->orWhereNull('drivers.last_online_at')
                        ->orWhere('drivers.last_online_at', '<', $staleCutoff);
                });
            }
        }

        // ?approval_status=approved|pending|rejected
        if ($approval = $request->query('approval_status')) {
            $approval = strtolower((string) $approval);
            if (in_array($approval, ['approved', 'pending', 'rejected'], true)) {
                $query->where('drivers.approval_status', $approval);
            }
        }

        // Registered-on (drivers.created_at) date range
        if ($from = $request->query('date_from')) {
            try {
                $query->where('drivers.created_at', '>=', Carbon::parse((string) $from)->startOfDay());
            } catch (\Throwable $e) {
                // ignore malformed dates from the client
            }
        }
        if ($to = $request->query('date_to')) {
            try {
                $query->where('drivers.created_at', '<=', Carbon::parse((string) $to)->endOfDay());
            } catch (\Throwable $e) {
                // ignore malformed dates from the client
            }
        }

        if ($q = trim((string) $request->query('q'))) {
            $needle = $q;
            $digits = preg_replace('/\D+/', '', $q);

            $query->where(function ($w) use ($needle, $digits) {
                if (ctype_digit($needle)) {
                    $w->orWhere('drivers.id', (int) $needle);
                }
                $w->orWhere('drivers.vehicle_reg_no', 'like', "%{$needle}%")
                    ->orWhereHas('user', function ($u) use ($needle, $digits) {
                        $u->where('name', 'like', "%{$needle}%")
                            ->orWhere('email', 'like', "%{$needle}%");
                        if ($digits !== '') {
                            $u->orWhere('phone', 'like', "%{$digits}%");
                        }
                    });
            });
        }

        return $query->orderByDesc('drivers.created_at');
    }

    private function shapeRow(Driver $driver): array
    {
        $userId = $driver->user_id;
        $now = now();

        $rides7d = Trip::query()
            ->where('driver_id', $userId)
            ->where('status', 'COMPLETED')
            ->where('completed_at', '>=', $now->copy()->subDays(7))
            ->count();

        $rides30d = Trip::query()
            ->where('driver_id', $userId)
            ->where('status', 'COMPLETED')
            ->where('completed_at', '>=', $now->copy()->subDays(30))
            ->count();

        $totalRides = Trip::query()
            ->where('driver_id', $userId)
            ->where('status', 'COMPLETED')
            ->count();

        $lastRide = Trip::query()
            ->where('driver_id', $userId)
            ->where('status', 'COMPLETED')
            ->orderByDesc('completed_at')
            ->value('completed_at');

        return [
            'id' => $driver->id,
            'approval_status' => $driver->approval_status,
            'vehicle_type' => $driver->vehicle_type,
            'vehicle_reg_no' => $driver->vehicle_reg_no,
            'is_online' => $driver->isOnlineFresh(),
            'registered_on' => optional($driver->created_at)->toIso8601String(),
            'last_login' => optional($driver->user?->last_login_at)->toIso8601String(),
            'last_ride_on' => $lastRide ? Carbon::parse($lastRide)->toIso8601String() : null,
            'rides_7d' => $rides7d,
            'rides_30d' => $rides30d,
            'total_rides' => $totalRides,
            'deactivated_at' => optional($driver->deactivated_at)->toIso8601String(),
            'deactivated_reason' => $driver->deactivated_reason,
            'user' => $driver->user ? [
                'id' => $driver->user->id,
                'name' => $driver->user->name,
                'phone' => $driver->user->phone,
                'email' => $driver->user->email,
                'avatar_path' => $driver->user->avatar_path,
                'avatar_url' => $this->avatarUrl($driver->user->avatar_path),
            ] : null,
            'documents' => $driver->documents,
        ];
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
