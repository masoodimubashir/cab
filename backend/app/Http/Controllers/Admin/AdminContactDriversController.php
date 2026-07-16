<?php

namespace App\Http\Controllers\Admin;

use App\Models\Driver;
use App\Models\Trip;
use App\Models\User;
use App\Services\NotificationService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;

class AdminContactDriversController
{
    public function __construct(
        private NotificationService $notifications,
    ) {
    }

    /**
     * Live preview of drivers matching the chosen audience + filters.
     *
     * ?to=active|free|engaged|live|deactivated|offline|custom_csv
     * ?vehicle_type=…
     * ?driver_ids=1,2,3   (only used when to=custom_csv)
     */
    public function audience(Request $request)
    {
        $rows = $this->buildAudienceQuery($request)
            ->with(['user'])
            ->limit(500)
            ->get()
            ->map(fn (Driver $d) => [
                'driver_id' => $d->id,
                'name' => $d->user?->name,
                'phone' => $d->user?->phone,
                'user_id' => $d->user_id,
                'vehicle_type' => $d->vehicle_type,
                'is_online' => $d->isOnlineFresh(),
            ]);

        return response()->json([
            'data' => $rows,
            'count' => $rows->count(),
        ]);
    }

    /**
     * Parse an uploaded CSV. Required header: driver_id. Other columns are ignored.
     * Returns the matched drivers.
     */
    public function uploadCsv(Request $request)
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
        if (!$headers) {
            fclose($handle);
            return response()->json(['message' => 'Empty CSV.'], 422);
        }

        $idCol = array_search('driver_id', array_map('strtolower', array_map('trim', $headers)), true);
        if ($idCol === false) {
            fclose($handle);
            return response()->json([
                'message' => 'CSV must contain a "driver_id" column.',
            ], 422);
        }

        $ids = [];
        while (($row = fgetcsv($handle)) !== false) {
            $raw = trim((string) ($row[$idCol] ?? ''));
            if ($raw === '') {
                continue;
            }
            if (!ctype_digit($raw)) {
                continue;
            }
            $ids[] = (int) $raw;
        }
        fclose($handle);

        $ids = array_values(array_unique($ids));

        if (empty($ids)) {
            return response()->json([
                'data' => [],
                'count' => 0,
                'driver_ids' => [],
                'message' => 'No valid driver IDs found in CSV.',
            ]);
        }

        $rows = Driver::query()
            ->with(['user'])
            ->whereIn('id', $ids)
            ->get()
            ->map(fn (Driver $d) => [
                'driver_id' => $d->id,
                'name' => $d->user?->name,
                'phone' => $d->user?->phone,
                'user_id' => $d->user_id,
                'vehicle_type' => $d->vehicle_type,
                'is_online' => $d->isOnlineFresh(),
            ]);

        return response()->json([
            'data' => $rows,
            'count' => $rows->count(),
            'driver_ids' => $ids,
        ]);
    }

    /**
     * Send a push message to all drivers matching the audience.
     * (SMS broadcast was removed on purpose — SMS is OTP-only by cost policy.)
     *
     * Body:
     *   message_type: push (kept for API-shape compatibility)
     *   to:           audience key (same as ?to in audience())
     *   vehicle_type: optional
     *   driver_ids:   required when to=custom_csv
     *   title:        optional, defaults to "Message from operations"
     *   message:      required
     */
    public function send(Request $request)
    {
        $data = $request->validate([
            'message_type' => ['required', 'in:push'],
            'to' => ['required', 'string'],
            'vehicle_type' => ['nullable', 'string'],
            'driver_ids' => ['nullable', 'array'],
            'driver_ids.*' => ['integer'],
            'title' => ['nullable', 'string', 'max:120'],
            'message' => ['required', 'string', 'max:1000'],
        ]);

        $title = $data['title'] ?? 'Message from operations';
        $body = $data['message'];

        $drivers = $this->buildAudienceQuery($request)
            ->with(['user'])
            ->get();

        $sentPush = 0;
        $skipped = 0;

        foreach ($drivers as $driver) {
            $user = $driver->user;
            if (!$user) {
                $skipped++;
                continue;
            }

            $this->notifications->sendToUser($user, $title, $body, [
                'type' => 'admin_broadcast',
            ]);
            $sentPush++;
        }

        return response()->json([
            'recipients' => $drivers->count(),
            'sent_push' => $sentPush,
            'skipped' => $skipped,
        ]);
    }

    /**
     * @return Builder<Driver>
     */
    private function buildAudienceQuery(Request $request): Builder
    {
        $to = strtolower((string) $request->input('to', $request->query('to', 'active')));
        $vehicleType = $request->input('vehicle_type', $request->query('vehicle_type'));

        $query = Driver::query();

        switch ($to) {
            case 'active':
                $query->whereNull('deactivated_at');
                break;

            case 'deactivated':
                $query->whereNotNull('deactivated_at');
                break;

            case 'live':
                $query->whereNull('deactivated_at')->onlineFresh();
                break;

            case 'offline':
                // "Offline" must include drivers whose flag is still true but
                // the heartbeat is stale — otherwise ghosts disappear from
                // both buckets between reaper runs.
                $query->whereNull('deactivated_at')
                    ->where(function ($q) {
                        $q->where('is_online', false)
                            ->orWhereNull('last_online_at')
                            ->orWhere('last_online_at', '<', now()->subSeconds(Driver::STALE_AFTER_SECONDS));
                    });
                break;

            case 'engaged':
                $busyUserIds = Trip::query()
                    ->whereNotNull('driver_id')
                    ->whereIn('status', Trip::ACTIVE_DRIVER_STATUSES)
                    ->pluck('driver_id');
                $query->whereNull('deactivated_at')
                    ->whereIn('user_id', $busyUserIds);
                break;

            case 'free':
                $busyUserIds = Trip::query()
                    ->whereNotNull('driver_id')
                    ->whereIn('status', Trip::ACTIVE_DRIVER_STATUSES)
                    ->pluck('driver_id');
                $query->whereNull('deactivated_at')
                    ->onlineFresh()
                    ->where('approval_status', 'approved')
                    ->whereNotIn('user_id', $busyUserIds);
                break;

            case 'custom_csv':
                $ids = $request->input('driver_ids', $request->query('driver_ids', []));
                if (is_string($ids)) {
                    $ids = array_filter(array_map('trim', explode(',', $ids)));
                }
                $ids = array_filter(array_map('intval', (array) $ids));
                if (empty($ids)) {
                    $query->whereRaw('1 = 0');
                } else {
                    $query->whereIn('id', $ids);
                }
                break;

            default:
                $query->whereNull('deactivated_at');
        }

        if ($vehicleType) {
            $query->where('vehicle_type', $vehicleType);
        }

        return $query->orderBy('id');
    }
}
