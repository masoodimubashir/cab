<?php

namespace App\Services;

use App\Models\OperatorSetting;
use App\Models\Trip;
use App\Models\User;

/**
 * Single source of truth for "which payment methods may be used".
 *
 * Payment methods are a GLOBAL operator policy now (Operator Settings →
 * Payments), no longer a per-city setting. The three switches — Online, GPay
 * and Cash — decide the enforceable payment rails:
 *   • Online OR GPay on → 'razorpay' (both ride the Razorpay rail; the customer
 *     app draws the Online-vs-GPay choice straight from the two switches).
 *   • Cash on → 'cash'.
 *
 * Both the customer payment screen (via the negotiation endpoint) and the pay
 * endpoints resolve through here, so the buttons the rider sees and what the
 * server will accept can never disagree.
 *
 * Layers:
 *   • Operator policy — the three switches above (the ceiling).
 *   • Driver layer — Operator Settings → "Update driver payment modes":
 *       ON  → the driver's own accepted_payment_methods narrow the operator set.
 *       OFF → the driver simply follows the operator policy.
 *   • Result = operator ∩ driver-effective.
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
        $operator = $this->operatorModes();

        if ($this->driverManagesOwnModes()) {
            $driver = $trip->driver_id ? User::query()->find($trip->driver_id) : null;
            $driverModes = $driver && is_array($driver->accepted_payment_methods)
                ? $this->normalize($driver->accepted_payment_methods)
                : ['CASH', 'RAZORPAY']; // a driver who set nothing accepts both
        } else {
            $driverModes = $operator; // operator owns it → driver follows
        }

        $allowed = array_values(array_intersect($operator, $driverModes));
        $allowed = $allowed ?: $operator; // never strand a trip with no method

        return array_map('strtolower', $allowed);
    }

    /**
     * The operator's globally enabled payment rails (UPPERCASE). Online and
     * GPay both map to RAZORPAY; Cash maps to CASH. Falls back to RAZORPAY so a
     * misconfigured row can never leave a trip unpayable.
     *
     * @return array<int, string>
     */
    public function operatorModes(): array
    {
        $s = OperatorSetting::instance();

        $modes = [];
        if ($s->payment_online_enabled || $s->payment_gpay_enabled) {
            $modes[] = 'RAZORPAY';
        }
        if ($s->payment_cash_enabled) {
            $modes[] = 'CASH';
        }

        return $modes ?: ['RAZORPAY'];
    }

    /**
     * @deprecated Payment policy is global now, so the city id is ignored — kept
     * only so existing callers keep resolving. Prefer operatorModes().
     *
     * @return array<int, string>
     */
    public function cityModes(?int $cityId = null): array
    {
        return $this->operatorModes();
    }

    /** Whether the operator lets drivers manage their own accepted methods. */
    public function driverManagesOwnModes(): bool
    {
        return (bool) (OperatorSetting::instance()->update_driver_payment_modes_enabled ?? false);
    }

    /**
     * Upper-case, trim, dedupe and keep only the two supported rails.
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
