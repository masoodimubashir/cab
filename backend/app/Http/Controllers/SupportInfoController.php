<?php

namespace App\Http\Controllers;

use App\Models\CitySetting;
use App\Models\Driver;
use App\Models\Trip;
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
 *   3. the customer's most recent trip's city_id (using customer_id)
 *   4. the first city_settings row with configured support info (or first row)
 */
class SupportInfoController extends Controller
{
    public function show(Request $request)
    {
        $cityId = $request->query('city_id') ? (int) $request->query('city_id') : null;
        $userId = $request->user()?->id;

        if (! $cityId && $userId) {
            $driver = Driver::query()->where('user_id', $userId)->first();
            $cityId = $driver?->city_id;
        }

        if (! $cityId && $userId) {
            $latestTrip = Trip::query()->where('customer_id', $userId)->latest()->first();
            $cityId = $latestTrip?->city_id;
        }

        $settings = $cityId
            ? CitySetting::query()->where('city_id', $cityId)->first()
            : null;

        // If specific city settings don't exist or lack support contacts, search for any configured city_setting
        if (! $settings || (! $settings->customer_support_no && ! $settings->driver_support_no && ! $settings->support_email)) {
            $configured = CitySetting::query()
                ->where(function ($q) {
                    $q->whereNotNull('customer_support_no')->where('customer_support_no', '!=', '')
                      ->orWhereNotNull('driver_support_no')->where('driver_support_no', '!=', '')
                      ->orWhereNotNull('support_email')->where('support_email', '!=', '');
                })
                ->first();

            if ($configured) {
                $settings = $configured;
            }
        }

        if (! $settings) {
            $settings = CitySetting::query()->orderBy('id')->first();
        }

        $custNo = $settings?->customer_support_no ?: $settings?->driver_support_no;
        $driverNo = $settings?->driver_support_no ?: $settings?->customer_support_no;

        return response()->json([
            'city_id' => $settings?->city_id,
            'emergency_no' => $settings?->emergency_no,
            'emergency_police_no' => $settings?->emergency_police_no,
            'driver_support_no' => $driverNo,
            'customer_support_no' => $custNo,
            'support_email' => $settings?->support_email,
        ]);
    }
}
