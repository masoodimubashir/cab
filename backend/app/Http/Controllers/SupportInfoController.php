<?php

namespace App\Http\Controllers;

use App\Models\CitySetting;
use App\Models\Driver;
use Illuminate\Http\Request;

/**
 * Read-only access to the official support contacts that the admin configures
 * per city (police number, driver/customer support numbers, support email).
 *
 * The customer and driver mobile apps both call this on their "Support" tab.
 * Customers display customer_support_no; drivers display driver_support_no.
 *
 * City resolution order:
 *   1. explicit ?city_id=N
 *   2. the authenticated user's driver.city_id (if they have a driver profile)
 *   3. the first city_settings row (so the app always shows *something*)
 */
class SupportInfoController extends Controller
{
    public function show(Request $request)
    {
        $cityId = $request->query('city_id') ? (int) $request->query('city_id') : null;

        if (! $cityId) {
            $driver = Driver::query()->where('user_id', $request->user()->id)->first();
            $cityId = $driver?->city_id;
        }

        $settings = $cityId
            ? CitySetting::query()->where('city_id', $cityId)->first()
            : null;

        if (! $settings) {
            $settings = CitySetting::query()->orderBy('id')->first();
        }

        return response()->json([
            'city_id' => $settings?->city_id,
            'emergency_no' => $settings?->emergency_no,
            'emergency_police_no' => $settings?->emergency_police_no,
            'driver_support_no' => $settings?->driver_support_no,
            'customer_support_no' => $settings?->customer_support_no,
            'support_email' => $settings?->support_email,
        ]);
    }
}
