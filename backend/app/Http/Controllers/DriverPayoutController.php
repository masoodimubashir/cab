<?php

namespace App\Http\Controllers;

use App\Services\PayoutAccountService;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * The driver's own payout account ("driver KYC") — the details Razorpay Route
 * needs to pay them their share automatically. Backs the driver-app
 * "Payout account" page and the skippable KYC step at signup.
 */
class DriverPayoutController extends Controller
{
    public function __construct(private readonly PayoutAccountService $payouts)
    {
    }

    /** Current status + masked details for the signed-in driver. */
    public function show(Request $request)
    {
        return response()->json($this->payouts->status($request->user()));
    }

    /** Submit / update PAN + settlement destination and (re)start verification. */
    public function update(Request $request)
    {
        $data = $request->validate([
            'method' => ['required', Rule::in(['bank', 'upi'])],
            // PAN: 5 letters, 4 digits, 1 letter (case-insensitive input).
            'pan' => ['required', 'string', 'regex:/^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/'],

            // Bank settlement details — required only when method=bank.
            'beneficiary_name' => ['required_if:method,bank', 'nullable', 'string', 'max:120'],
            'account_number' => ['required_if:method,bank', 'nullable', 'string', 'regex:/^[0-9]{6,20}$/'],
            'ifsc' => ['required_if:method,bank', 'nullable', 'string', 'regex:/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/'],

            // UPI VPA — required only when method=upi.
            'upi' => ['required_if:method,upi', 'nullable', 'string', 'regex:/^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/'],
        ]);

        return response()->json($this->payouts->submit($request->user(), $data));
    }
}
