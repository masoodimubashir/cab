<?php

namespace App\Http\Controllers;

use App\Models\Driver;
use App\Models\OperatorSetting;
use App\Services\CashDepositService;
use App\Services\PaymentModeService;
use Illuminate\Http\Request;

/**
 * Public-facing slices of the operator configuration. Mobile apps fetch
 * these once on boot (or first-use) to render UI that reflects the
 * operator's admin settings without exposing the whole settings row.
 *
 * Keep each method narrow: only return the fields needed by the screen
 * that calls it. No secrets.
 */
class OperatorPublicController extends Controller
{
    /**
     * Tipping config used by the customer-mobile post-ride tip prompt.
     *
     * Returns the 3 preset values and whether they should be rendered as
     * rupees or percentages of the ride fare.
     */
    public function tipping(Request $request)
    {
        $s = OperatorSetting::instance();

        return response()->json([
            'values' => [
                (int) $s->customer_tip_value_1,
                (int) $s->customer_tip_value_2,
                (int) $s->customer_tip_value_3,
            ],
            'in_percentage' => (bool) $s->tip_in_percentage,
        ]);
    }

    /**
     * Copy for the driver-app subscription popup (on/off flag + title /
     * description / two button labels) set in Operator Settings → Subscription.
     * When `enabled` is false the driver app must not show the popup. Null copy
     * fields mean "use the app's built-in default".
     */
    public function subscriptionPopup(Request $request)
    {
        $s = OperatorSetting::instance();

        return response()->json([
            'enabled' => (bool) $s->subscription_popup_enabled,
            'title' => $s->subscription_popup_title,
            'desc' => $s->subscription_popup_desc,
            'button1' => $s->subscription_popup_button1,
            'button2' => $s->subscription_popup_button2,
        ]);
    }

    /**
     * Whether drivers may edit their own accepted payment methods (Operator
     * Settings → Driver). When false, the driver app locks the toggles and the
     * update endpoint rejects changes.
     */
    public function driverPaymentModes(Request $request, PaymentModeService $paymentModeService)
    {
        $canUpdate = (bool) OperatorSetting::instance()->update_driver_payment_modes_enabled;

        // When the operator owns payment policy (can_update = false), the driver
        // follows their city's allowed modes. Surface those (lowercased) so the
        // app can show the correct toggles, locked.
        $effectiveModes = null;
        if (!$canUpdate) {
            $driver = Driver::query()->where('user_id', $request->user()->id)->first();
            $effectiveModes = array_map('strtolower', $paymentModeService->cityModes($driver?->city_id));
        }

        return response()->json([
            'can_update' => $canUpdate,
            'effective_modes' => $effectiveModes,
        ]);
    }

    /**
     * Which payment methods the customer app should offer, straight from the
     * operator's Payments switches (Operator Settings → Payments). The shared
     * payment modal renders only the enabled ones. `cash_deposit_percent` is
     * the upfront share paid online when Cash is chosen (the rest is cash to
     * the driver at trip end).
     */
    public function paymentMethods(Request $request, CashDepositService $cashDeposits)
    {
        $s = OperatorSetting::instance();

        return response()->json([
            'online' => (bool) $s->payment_online_enabled,
            'gpay' => (bool) $s->payment_gpay_enabled,
            'cash' => (bool) $s->payment_cash_enabled,
            'cash_deposit_percent' => round($cashDeposits->depositPercent(), 2),
        ]);
    }
}
