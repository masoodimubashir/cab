<?php

namespace App\Services;

use App\Models\CitySetting;
use App\Models\OperatorSetting;
use App\Models\Trip;
use App\Models\User;

/**
 * Single source of truth for "which payment methods may be used".
 *
 * Both the customer payment screen (via the negotiation endpoint) and the pay
 * endpoints resolve through here, so the buttons the rider sees and what the
 * server will accept can never disagree.
 *
 * Layers:
 *   • City ceiling — city_settings.allowed_driver_payment_modes (the operator's
 *     per-city cap; defaults to RAZORPAY when unset).
 *   • Driver layer — Operator Settings → "Update driver payment modes":
 *       ON  → the driver's own accepted_payment_methods narrow the city cap.
 *       OFF → the driver simply follows the city (the operator owns the policy).
 *   • Result = city ∩ driver-effective.
 */
class PaymentModeService
{
    /**
     * Methods a customer may pay this trip with, as lowercase strings
     * ('cash' / 'razorpay').
     *
     * @return array<int, string>
     */
    public function allowedForTrip(Trip $trip): array
    {
        $city = $this->cityModes($trip->city_id);

        if ($this->driverManagesOwnModes()) {
            $driver = $trip->driver_id ? User::query()->find($trip->driver_id) : null;
            $driverModes = $driver && is_array($driver->accepted_payment_methods)
                ? $this->normalize($driver->accepted_payment_methods)
                : ['CASH', 'RAZORPAY']; // a driver who set nothing accepts both
        } else {
            $driverModes = $city; // operator owns it → driver follows the city
        }

        $allowed = array_values(array_intersect($city, $driverModes));

        return array_map('strtolower', $allowed);
    }

    /**
     * A city's allowed modes (UPPERCASE), defaulting to RAZORPAY when unset.
     *
     * @return array<int, string>
     */
    public function cityModes(?int $cityId): array
    {
        $raw = $cityId
            ? CitySetting::query()->where('city_id', $cityId)->value('allowed_driver_payment_modes')
            : null;

        $modes = is_array($raw) ? $this->normalize($raw) : [];

        return $modes ?: ['RAZORPAY'];
    }

    /** Whether the operator lets drivers manage their own accepted methods. */
    public function driverManagesOwnModes(): bool
    {
        return (bool) (OperatorSetting::instance()->update_driver_payment_modes_enabled ?? false);
    }

    /**
     * Upper-case, trim, dedupe and keep only the two supported modes.
     *
     * @param  array<int, mixed>  $modes
     * @return array<int, string>
     */
    private function normalize(array $modes): array
    {
        $upper = array_values(array_unique(array_map(
            fn ($m) => strtoupper(trim((string) $m)),
            $modes,
        )));

        return array_values(array_intersect($upper, ['CASH', 'RAZORPAY']));
    }
}
