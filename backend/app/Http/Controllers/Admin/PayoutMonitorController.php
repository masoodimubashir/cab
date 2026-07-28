<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\PayoutMonitorService;
use Illuminate\Http\Request;

/**
 * Phase 4 — the admin's read-only windows onto the auto-split engine: the
 * driver-payout status monitor and the money ledger. Neither moves money; they
 * report what Route already did.
 */
class PayoutMonitorController extends Controller
{
    public function __construct(private readonly PayoutMonitorService $monitor) {}

    /** GET /admin/payouts/monitor — driver transfers: paid / pending / failed / held. */
    public function payouts(Request $request)
    {
        $status = (string) $request->query('status', 'all');
        if (! in_array($status, ['all', 'paid', 'pending', 'failed', 'held', 'reversed'], true)) {
            $status = 'all';
        }

        return response()->json($this->monitor->payouts($status));
    }

    /** GET /admin/ledger — every rupee movement + per-trip reconciliation. */
    public function ledger(Request $request)
    {
        $tripId = $request->query('trip_id');

        return response()->json($this->monitor->ledger(
            $tripId !== null && $tripId !== '' ? (int) $tripId : null,
            (int) $request->query('limit', 500),
            $request->boolean('unbalanced'),
        ));
    }
}
