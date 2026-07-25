<?php

namespace App\Services;

use App\Models\HeldEarning;
use App\Models\LedgerEntry;
use App\Models\Payment;

/**
 * Phase 4 — read-only monitors that replace the old manual payout/refund
 * worklists. Under the auto-split engine the operator no longer *does* payouts
 * or refunds by hand; they watch them happen. This service answers:
 *
 *   • Payouts monitor — every driver share and whether Route paid it, is still
 *     settling, failed, or is held for an unverified driver.
 *   • Ledger — every rupee movement with a per-trip reconciliation check.
 *
 * Amounts are surfaced in rupees for display; the ledger keeps paise.
 */
class PayoutMonitorService
{
    public function __construct(private readonly LedgerService $ledger) {}

    /**
     * The driver-payout status monitor: summary counters plus the most recent
     * rows. $status filters server-side: paid | pending | failed | held | all.
     *
     * @return array{summary:array,rows:array}
     */
    public function payouts(string $status = 'all', int $limit = 300): array
    {
        $payments = Payment::query()
            ->whereNotNull('split_at')
            ->where(function ($q) {
                $q->where('driver_amount', '>', 0)->orWhereNotNull('driver_transfer_id');
            })
            ->with(['trip:id,driver_id,final_fare', 'trip.driver:id,name,phone'])
            ->orderByDesc('split_at')
            ->limit(1000)
            ->get();

        $rows = $payments->map(fn (Payment $p) => $this->payoutRow($p))->all();

        // Held earnings that aren't tied to a still-visible payment row are the
        // real "held" money to chase — surface them from their own table so the
        // total is authoritative even after a payment is refunded/reversed.
        $summary = $this->payoutSummary();

        if ($status !== 'all') {
            $rows = array_values(array_filter($rows, fn ($r) => $r['state'] === $status));
        }

        return [
            'summary' => $summary,
            'rows' => array_slice($rows, 0, $limit),
        ];
    }

    /**
     * Ledger view: the append-only money movements, newest first, each carrying
     * its trip's reconciliation so "is this trip balanced?" is answerable at a
     * glance. Optionally scoped to one trip.
     *
     * @return array{rows:array,reconciliation:array}
     */
    public function ledger(?int $tripId = null, int $limit = 500): array
    {
        $query = LedgerEntry::query()->orderByDesc('id');
        if ($tripId !== null) {
            $query->where('trip_id', $tripId);
        }

        $entries = $query->limit($limit)->get();

        $rows = $entries->map(fn (LedgerEntry $e) => [
            'id' => $e->id,
            'trip_id' => $e->trip_id,
            'payment_id' => $e->payment_id,
            'type' => $e->type,
            'party' => $e->party,
            'direction' => $e->direction,
            'amount' => round(((int) $e->amount_paise) / 100, 2),
            'razorpay_ref' => $e->razorpay_ref,
            'created_at' => optional($e->created_at)->toIso8601String(),
        ])->all();

        // Reconcile each trip that appears in this slice.
        $reconciliation = collect($entries)
            ->pluck('trip_id')
            ->filter()
            ->unique()
            ->mapWithKeys(function ($id) {
                $b = $this->ledger->tripBalance((int) $id);

                return [(int) $id => [
                    'captured' => round($b['captured'] / 100, 2),
                    'driver_net' => round($b['driver_net'] / 100, 2),
                    'operator_net' => round($b['operator_net'] / 100, 2),
                    'refunded' => round($b['refunded'] / 100, 2),
                    'balanced' => $b['balanced'],
                    'imbalance_paise' => $b['imbalance'],
                ]];
            })
            ->all();

        return ['rows' => $rows, 'reconciliation' => $reconciliation];
    }

    /* ------------------------------------------------------------------ */

    private function payoutRow(Payment $p): array
    {
        $driver = $p->trip?->driver;
        $state = $this->payoutState($p);

        return [
            'payment_id' => $p->id,
            'trip_id' => $p->trip_id,
            'driver_id' => $driver?->id,
            'driver_name' => $driver?->name,
            'driver_phone' => $driver?->phone,
            'driver_amount' => round((float) ($p->driver_amount ?? 0), 2),
            'commission_amount' => round((float) ($p->commission_amount ?? 0), 2),
            'state' => $state,
            'transfer_status' => $p->transfer_status,
            'transfer_id' => $p->driver_transfer_id,
            'reversal_id' => $p->reversal_id,
            'split_at' => optional($p->split_at)->toIso8601String(),
        ];
    }

    /**
     * Maps a payment's transfer_status to a monitor bucket. Held covers both an
     * unverified-driver hold and a post-capture transfer failure that parked the
     * share.
     */
    private function payoutState(Payment $p): string
    {
        return match ($p->transfer_status) {
            Payment::TRANSFER_PROCESSED, Payment::TRANSFER_CREATED => 'paid',
            Payment::TRANSFER_FAILED => 'failed',
            Payment::TRANSFER_HELD => 'held',
            Payment::TRANSFER_REVERSED => 'reversed',
            default => 'none',
        };
    }

    /**
     * @return array{paid_count:int,paid_amount:float,failed_count:int,held_count:int,held_amount:float,reversed_count:int}
     */
    private function payoutSummary(): array
    {
        $paidStatuses = [Payment::TRANSFER_PROCESSED, Payment::TRANSFER_CREATED];

        $paidCount = Payment::query()->whereNotNull('split_at')->whereIn('transfer_status', $paidStatuses)->count();
        $paidAmount = (float) Payment::query()->whereNotNull('split_at')->whereIn('transfer_status', $paidStatuses)->sum('driver_amount');
        $failedCount = Payment::query()->where('transfer_status', Payment::TRANSFER_FAILED)->count();
        $reversedCount = Payment::query()->where('transfer_status', Payment::TRANSFER_REVERSED)->count();

        // Authoritative held total comes from the held_earnings table.
        $heldCount = HeldEarning::query()->where('status', HeldEarning::STATUS_HELD)->count();
        $heldPaise = (int) HeldEarning::query()->where('status', HeldEarning::STATUS_HELD)->sum('amount_paise');

        return [
            'paid_count' => $paidCount,
            'paid_amount' => round($paidAmount, 2),
            'failed_count' => $failedCount,
            'held_count' => $heldCount,
            'held_amount' => round($heldPaise / 100, 2),
            'reversed_count' => $reversedCount,
        ];
    }
}
