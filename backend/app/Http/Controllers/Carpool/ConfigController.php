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
        if (! CarpoolSwitch::enabled()) {
            return response()->json(['enabled' => false]);
        }

        $settings = CarpoolSetting::current();

        return response()->json([
            'enabled' => true,
            'search_distance_m' => $settings->search_distance_m,
            'publish_horizon_days' => (int) config('carpool.publish_horizon_days'),
            'seats_max' => (int) config('carpool.seats_max'),
            'message_max_chars' => (int) config('carpool.message_max_chars'),
            'timezone' => (string) config('carpool.timezone'),
        ]);
    }
}
