<?php

namespace App\Http\Controllers;

use App\Services\RefundRegisterService;
use Illuminate\Http\Request;

/**
 * B5 — the customer-refund register, exposed to all three apps:
 *  - admin:    the full register + "Mark refunded" (money moves OUTSIDE the
 *              app by GPay/bank/Razorpay dashboard; this only records it)
 *  - customer: "my refunds" — what's owed to me, how it arrives, and proof
 *  - driver:   informational — refunds on their trips, paid by the company
 */
class RefundsController extends Controller
{
    public function __construct(private readonly RefundRegisterService $register) {}

    public function adminIndex(Request $request)
    {
        $data = $request->validate([
            'status' => ['nullable', 'in:due,refunded,all'],
        ]);

        // Once the auto-refund engine is live this register stops being a
        // worklist: refunds go back to the card automatically. Anything still
        // sitting here unpaid is therefore an EXCEPTION — a Razorpay refund that
        // failed, or a legacy row from before the migration — so the screen says
        // so instead of implying every row is routine manual work.
        // Refunds are automatic: under Model B the app refunds the card directly
        // (AutoRefundService::refundBookingModelB), so this register is an EXCEPTIONS
        // list (a Razorpay refund that failed, or a legacy row), not a routine
        // worklist. Always true now that Route is gone and Model B is the only model.
        return response()->json(
            $this->register->adminList($data['status'] ?? 'all')
            + ['auto_refunds' => true],
        );
    }

    public function adminMarkRefunded(Request $request, string $module, int $id)
    {
        $data = $request->validate([
            'method' => ['required', 'in:' . implode(',', RefundRegisterService::METHODS)],
            'reference' => ['required', 'string', 'max:191'],
            'note' => ['required', 'string', 'max:1000'],
        ], [
            'reference.required' => 'Add the payment reference (UPI txn id / bank ref / rfnd_…).',
            'note.required' => 'Add a note — the customer can see this.',
        ]);

        // ReservationException self-renders with its HTTP status on failure.
        $row = $this->register->markRefunded(
            $module,
            $id,
            $request->user(),
            $data['method'],
            $data['reference'] ?? null,
            $data['note'] ?? null,
        );

        return response()->json([
            'row' => $row,
            'message' => 'Refund recorded — the customer has been notified.',
        ]);
    }

    public function customerIndex(Request $request)
    {
        return response()->json(['data' => $this->register->customerList($request->user())]);
    }

    public function driverIndex(Request $request)
    {
        return response()->json(['data' => $this->register->driverList($request->user())]);
    }
}
