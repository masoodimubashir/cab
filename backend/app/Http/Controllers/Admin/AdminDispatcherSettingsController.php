<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Models\DispatcherSetting;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class AdminDispatcherSettingsController
{
    private const KINDS = ['local', 'rental', 'outstation'];

    public function index(City $city)
    {
        // Auto-seed missing rows so the admin always sees all 3 kinds.
        foreach (self::KINDS as $kind) {
            DispatcherSetting::query()->firstOrCreate(
                ['city_id' => $city->id, 'kind' => $kind],
            );
        }

        $rows = DispatcherSetting::query()
            ->where('city_id', $city->id)
            ->orderByRaw("FIELD(kind, 'local', 'rental', 'outstation')")
            ->get()
            ->map(fn (DispatcherSetting $s) => $this->shape($s));

        return response()->json([
            'city_id' => $city->id,
            'data' => $rows,
        ]);
    }

    public function update(Request $request, City $city, DispatcherSetting $setting)
    {
        if ($setting->city_id !== $city->id) {
            abort(404);
        }

        $data = $request->validate([
            'automatic_dispatcher_type' => ['nullable', 'boolean'],
            'dispatcher_hop_interval_sec' => ['nullable', 'integer', 'min:1', 'max:600'],
            'dispatcher_hop_radius_m' => ['nullable', 'integer', 'min:0', 'max:50000'],
            'request_radius_m' => ['nullable', 'integer', 'min:0', 'max:50000'],
            'max_hops' => ['nullable', 'integer', 'min:1', 'max:50'],
            'driver_accept_window_sec' => ['nullable', 'integer', 'min:0', 'max:600'],

            'schedule_available' => ['nullable', 'boolean'],
            'schedule_dispatcher_type' => ['nullable', 'boolean'],
            'dispatch_only_assigned_scheduled' => ['nullable', 'boolean'],
            'schedule_dispatch_instantly' => [
                'nullable',
                Rule::in(['DELAYED', 'INSTANT', 'INSTANT_AND_DELAYED']),
            ],
            'scheduler_alarm_min' => ['nullable', 'integer', 'min:0', 'max:1440'],

            'schedule_current_time_diff_min' => ['nullable', 'integer', 'min:0', 'max:1440'],
            'schedule_days_limit' => ['nullable', 'integer', 'min:0', 'max:365'],
            'schedule_days_limit_return' => ['nullable', 'integer', 'min:0', 'max:365'],
            'schedule_rides_limit' => ['nullable', 'integer', 'min:0', 'max:100'],
            'schedule_cancel_window_min' => ['nullable', 'integer', 'min:0', 'max:1440'],
        ]);

        $setting->fill($data);
        $setting->save();

        return response()->json([
            'setting' => $this->shape($setting->fresh()),
            'message' => 'Dispatcher settings updated.',
        ]);
    }

    private function shape(DispatcherSetting $s): array
    {
        return [
            'id' => $s->id,
            'city_id' => $s->city_id,
            'kind' => $s->kind,

            'automatic_dispatcher_type' => (bool) $s->automatic_dispatcher_type,
            'dispatcher_hop_interval_sec' => (int) $s->dispatcher_hop_interval_sec,
            'dispatcher_hop_radius_m' => (int) $s->dispatcher_hop_radius_m,
            'request_radius_m' => (int) $s->request_radius_m,
            'max_hops' => (int) $s->max_hops,
            'driver_accept_window_sec' => (int) $s->driver_accept_window_sec,

            'schedule_available' => (bool) $s->schedule_available,
            'schedule_dispatcher_type' => (bool) $s->schedule_dispatcher_type,
            'dispatch_only_assigned_scheduled' => (bool) $s->dispatch_only_assigned_scheduled,
            'schedule_dispatch_instantly' => $s->schedule_dispatch_instantly,
            'scheduler_alarm_min' => (int) $s->scheduler_alarm_min,

            'schedule_current_time_diff_min' => (int) $s->schedule_current_time_diff_min,
            'schedule_days_limit' => (int) $s->schedule_days_limit,
            'schedule_days_limit_return' => $s->schedule_days_limit_return !== null
                ? (int) $s->schedule_days_limit_return
                : null,
            'schedule_rides_limit' => (int) $s->schedule_rides_limit,
            'schedule_cancel_window_min' => (int) $s->schedule_cancel_window_min,
            'updated_at' => optional($s->updated_at)->toIso8601String(),
        ];
    }
}
