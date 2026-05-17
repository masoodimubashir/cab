<?php

namespace App\Http\Controllers;

use App\Models\OperatorSetting;
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
}
