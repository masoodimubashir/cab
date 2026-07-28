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
            'owed' => $this->owedByDriver(),
        ];
    }

    /**
     * "Who is owed money" — held shares rolled up per driver, worst first. The
     * per-payment rows above answer "what happened to this ride"; this answers
     * the question an operator actually acts on, which is which PEOPLE are
     * waiting and why. `blocked_by_kyc` separates the two causes: a driver with
     * no verified payout account needs chasing, whereas a verified driver whose
     * transfer bounced is already being retried by the sweeper.
     *
     * @return array<int,array{driver_id:int,driver_name:?string,driver_phone:?string,amount:float,rides:int,account_status:string,blocked_by_kyc:bool,oldest_at:?string}>
     */
    public function owedByDriver(int $limit = 100): array
    {
        $held = HeldEarning::query()
            ->where('status', HeldEarning::STATUS_HELD)
            ->selectRaw('driver_id, SUM(amount_paise) as paise, COUNT(*) as rides, MIN(created_at) as oldest_at')
            ->groupBy('driver_id')
            ->orderByDesc('paise')
            ->limit($limit)
            ->get();

        if ($held->isEmpty()) {
            return [];
        }

        $drivers = \App\Models\User::query()
            ->whereIn('id', $held->pluck('driver_id'))
            ->get(['id', 'name', 'phone', 'payout_account_status', 'razorpay_linked_account_id'])
            ->keyBy('id');

        return $held->map(function ($row) use ($drivers) {
            $driver = $drivers->get($row->driver_id);
            $verified = $driver?->hasVerifiedPayoutAccount() ?? false;

            return [
                'driver_id' => (int) $row->driver_id,
                'driver_name' => $driver?->name,
                'driver_phone' => $driver?->phone,
                'amount' => round(((int) $row->paise) / 100, 2),
                'rides' => (int) $row->rides,
                'account_status' => (string) ($driver?->payout_account_status ?? \App\Models\User::PAYOUT_NONE),
                'blocked_by_kyc' => ! $verified,
                'oldest_at' => $row->oldest_at ? \Illuminate\Support\Carbon::parse($row->oldest_at)->toIso8601String() : null,
            ];
        })->all();
    }

    /**
     * Ledger view: the append-only money movements, newest first, each carrying
     * its trip's reconciliation so "is this trip balanced?" is answerable at a
     * glance. Optionally scoped to one trip.
     *
     * @return array{rows:array,reconciliation:array}
     */
    public function ledger(?int $tripId = null, int $limit = 500, bool $unbalancedOnly = false): array
    {
        $query = LedgerEntry::query()->orderByDesc('id');
        if ($tripId !== null) {
            $query->where('trip_id', $tripId);
        }

        // "Show me only what doesn't add up" — the single question worth asking
        // of a ledger this size. Scanning recent trips is enough: an imbalance is
        // created at settlement, so it shows up immediately or not at all.
        if ($unbalancedOnly) {
            $recentTripIds = LedgerEntry::query()
                ->whereNotNull('trip_id')
                ->orderByDesc('id')
                ->limit(2000)
                ->pluck('trip_id')
                ->unique();

            $broken = $recentTripIds
                ->filter(fn ($id) => ! $this->ledger->tripBalance((int) $id)['balanced'])
                ->values();

            $query->whereIn('trip_id', $broken);
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

        return [
            'rows' => $rows,
            'reconciliation' => $reconciliation,
            'summary' => $this->ledgerSummary($entries, $reconciliation),
        ];
    }

    /**
     * Headline figures for the slice on screen, plus the one number that matters
     * beyond it: how many of these trips don't balance. Anything other than zero
     * means money was invented or dropped and needs a human.
     *
     * @param  \Illuminate\Support\Collection<int,LedgerEntry>  $entries
     * @return array{captured:float,to_driver:float,held:float,to_operator:float,refunded:float,trips:int,unbalanced:int}
     */
    private function ledgerSummary($entries, array $reconciliation): array
    {
        $sum = fn (string $type) => round(
            $entries->where('type', $type)->sum('amount_paise') / 100,
            2,
        );

        return [
            'captured' => $sum(LedgerEntry::TYPE_CAPTURE),
            'to_driver' => $sum(LedgerEntry::TYPE_TRANSFER),
            'held' => $sum(LedgerEntry::TYPE_HELD),
            'to_operator' => $sum(LedgerEntry::TYPE_RETAINED),
            'refunded' => $sum(LedgerEntry::TYPE_REFUND),
            'trips' => count($reconciliation),
            'unbalanced' => count(array_filter($reconciliation, fn ($r) => ! $r['balanced'])),
        ];
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
