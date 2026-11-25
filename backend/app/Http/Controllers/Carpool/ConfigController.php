<?php

namespace App\Http\Controllers\Carpool;

use App\Http\Controllers\Controller;
use App\Models\Carpool\CarpoolSetting;
use App\Services\Carpool\CarpoolSwitch;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/carpool/config. Both apps ask this before showing any carpool entry
 * point, and show nothing when it says off or the call fails.
 */
class ConfigController extends Controller
{
    public function show(): JsonResponse
    {
        // Driver sign-up is open whenever the kill switch is off, so private car
        // owners can be approved before carpool opens to riders (A38).
        $signup = ! CarpoolSwitch::killed();

        if (! CarpoolSwitch::enabled()) {
            return response()->json(['enabled' => false, 'driver_signup' => $signup]);
        }

        $settings = CarpoolSetting::current();

        return response()->json([
            'enabled' => true,
            'driver_signup' => $signup,
            'search_distance_m' => $settings->search_distance_m,
            'publish_horizon_days' => CarpoolSetting::number('publish_horizon_days'),
            'start_early_minutes' => CarpoolSetting::number('start_early_minutes'),
            'pending_expire_minutes' => CarpoolSetting::number('pending_expire_minutes'),
            'plan_grace_days' => CarpoolSetting::number('plan_grace_days'),
            // 0 = an unstarted carpool is cancelled at the end of its departure day, 1 = at the end of the next day.
            'missed_departure_days' => CarpoolSetting::missedDepartureDays(),
            'seats_max' => (int) config('carpool.seats_max'),
            // How far the driver's "delay" button moves the departure (the button label shows it).
            'delay_minutes' => max(1, (int) config('carpool.delay_minutes')),
            'message_max_chars' => (int) config('carpool.message_max_chars'),
            'chat_retention_days' => max(1, (int) $settings->chat_retention_days),
            'timezone' => (string) config('carpool.timezone'),
            // The reasons offered when reporting (admin-editable, S9); apps keep their built-in list if this is missing.
            'report_reasons' => \App\Models\Carpool\CarpoolReportReason::forApps(),
            // Tile name and picture from Operator Settings (the apps fall back to "Carpool" and an icon).
            'tile_name' => \App\Models\OperatorSetting::instance()->carpool_service_name ?: null,
            'tile_image_url' => \App\Models\OperatorSetting::instance()->serviceImageUrl('carpool'),
        ]);
    }
}
