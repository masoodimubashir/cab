<?php

namespace App\Services;

use App\Models\HeldEarning;
use App\Models\LedgerEntry;
use App\Models\Payment;
use Illuminate\Support\Facades\DB;

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
    public function ledger(?int $tripId = null, int $limit = 500, bool $unbalancedOnly = false, ?string $from = null, ?string $to = null, ?string $search = null): array
    {
        $query = LedgerEntry::query()
            ->with([
                'trip:id,customer_id,driver_id,booked_for_name,booked_for_phone',
                'trip.customer:id,name,phone',
                'trip.driver:id,name,phone',
                'payment:id,trip_id',
                'payment.trip:id,customer_id,driver_id,booked_for_name,booked_for_phone',
                'payment.trip.customer:id,name,phone',
                'payment.trip.driver:id,name,phone',
            ])
            ->orderByDesc('id');
        if ($tripId !== null) {
            $query->where('trip_id', $tripId);
        }

        if (!empty($from) && !empty($to)) {
            try {
                $fromDate = \Illuminate\Support\Carbon::parse($from)->startOfDay();
                $toDate = \Illuminate\Support\Carbon::parse($to)->endOfDay();
                $query->whereBetween('created_at', [$fromDate, $toDate]);
            } catch (\Throwable $e) {
                // Ignore malformed date strings
            }
        } elseif (!empty($from)) {
            try {
                $fromDate = \Illuminate\Support\Carbon::parse($from);
                $query->whereDate('created_at', $fromDate);
            } catch (\Throwable $e) {
                // Ignore malformed date strings
            }
        }

        if (!empty($search)) {
            $term = trim($search);
            $query->where(function ($q) use ($term) {
                $q->where('id', $term)
                  ->orWhere('payment_id', $term)
                  ->orWhere('trip_id', $term)
                  ->orWhere('razorpay_ref', 'LIKE', "%{$term}%")
                  ->orWhereHas('trip.customer', function ($cq) use ($term) {
                      $cq->where('name', 'LIKE', "%{$term}%")->orWhere('phone', 'LIKE', "%{$term}%");
                  })
                  ->orWhereHas('trip.driver', function ($dq) use ($term) {
                      $dq->where('name', 'LIKE', "%{$term}%")->orWhere('phone', 'LIKE', "%{$term}%");
                  });
            });
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

        $rows = $entries->map(function (LedgerEntry $e) {
            $trip = $e->trip ?? $e->payment?->trip;
            return [
                'id' => $e->id,
                'trip_id' => $e->trip_id,
                'payment_id' => $e->payment_id,
                'type' => $e->type,
                'party' => $e->party,
                'direction' => $e->direction,
                'amount' => round(((int) $e->amount_paise) / 100, 2),
                'razorpay_ref' => $e->razorpay_ref,
                'created_at' => optional($e->created_at)->toIso8601String(),
                'customer_name' => $trip?->customer_name ?? $trip?->customer?->name ?? ($e->meta['customer_name'] ?? null),
                'customer_phone' => $trip?->customer_phone ?? $trip?->customer?->phone ?? ($e->meta['customer_phone'] ?? null),
                'driver_name' => $trip?->driver?->name ?? ($e->meta['driver_name'] ?? null),
                'driver_phone' => $trip?->driver?->phone ?? ($e->meta['driver_phone'] ?? null),
            ];
        })->all();

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
                    'gateway_fee' => round($b['gateway_fee'] / 100, 2),
                    'refunded' => round($b['refunded'] / 100, 2),
                    'balanced' => $b['balanced'],
                    'imbalance_paise' => $b['imbalance'],
                ]];
            })
            ->all();

        // Include completed trips and driver transfers from operational tables
        $existingTripIds = $entries->pluck('trip_id')->filter()->unique()->all();
        $existingRefs = $entries->pluck('razorpay_ref')->filter()->map(fn ($r) => trim((string) $r))->all();
        $rowsCollection = collect($rows);

        if (!$unbalancedOnly) {
            $tripsQuery = \App\Models\Trip::query()
                ->where('status', 'COMPLETED')
                ->where('final_fare', '>', 0)
                ->with(['customer:id,name,phone', 'driver:id,name,phone', 'seatReservations'])
                ->orderByDesc('completed_at');

            if ($tripId !== null) {
                $tripsQuery->where('id', $tripId);
            }
            if (!empty($fromDate) && !empty($toDate)) {
                $tripsQuery->whereBetween('completed_at', [$fromDate, $toDate]);
            } elseif (!empty($fromDate)) {
                $tripsQuery->whereDate('completed_at', $fromDate);
            }
            if (!empty($search)) {
                $term = trim($search);
                $tripsQuery->where(function ($tq) use ($term) {
                    $tq->where('id', $term)
                       ->orWhereHas('customer', fn ($cq) => $cq->where('name', 'LIKE', "%{$term}%")->orWhere('phone', 'LIKE', "%{$term}%"))
                       ->orWhereHas('driver', fn ($dq) => $dq->where('name', 'LIKE', "%{$term}%")->orWhere('phone', 'LIKE', "%{$term}%"));
                });
            }

            $allTrips = $tripsQuery->limit(200)->get();
            $payoutCollectionsByTrip = \App\Models\DriverPayoutLedger::query()
                ->where('type', \App\Models\DriverPayoutLedger::TYPE_COLLECTED)
                ->whereIn('trip_id', $allTrips->pluck('id')->all())
                ->get()
                ->groupBy('trip_id');

            foreach ($allTrips as $t) {
                $fare = (float) ($t->final_fare ?? 0);
                $comm = (float) ($t->commission_amount ?? 0);
                $driverShare = round(max(0, $fare - $comm), 2);

                $tripCollections = $payoutCollectionsByTrip->get($t->id);
                $onlineAmt = $tripCollections ? (float) $tripCollections->sum('amount') : 0.0;
                $cashAmt = max(0.0, round($fare - $onlineAmt, 2));

                $isTripInLedger = in_array($t->id, $existingTripIds, true);

                if (!$isTripInLedger) {
                    // 1. Capture row (Fare in from customer)
                    $rowsCollection->push([
                        'id' => 'trip_' . $t->id . '_cap',
                        'trip_id' => $t->id,
                        'payment_id' => null,
                        'type' => 'capture',
                        'party' => 'customer',
                        'direction' => 'in',
                        'amount' => $fare,
                        'razorpay_ref' => $cashAmt > 0 && $onlineAmt > 0 ? 'Hybrid Payment' : ($cashAmt > 0 ? 'Cash' : 'Online'),
                        'created_at' => optional($t->completed_at ?? $t->created_at)->toIso8601String(),
                        'customer_name' => $t->customer?->name,
                        'customer_phone' => $t->customer?->phone,
                        'driver_name' => $t->driver?->name,
                        'driver_phone' => $t->driver?->phone,
                    ]);

                    // 2. Retained commission row
                    if ($comm > 0) {
                        $rowsCollection->push([
                            'id' => 'trip_' . $t->id . '_ret',
                            'trip_id' => $t->id,
                            'payment_id' => null,
                            'type' => 'retained',
                            'party' => 'operator',
                            'direction' => 'in',
                            'amount' => $comm,
                            'razorpay_ref' => 'Platform Commission',
                            'created_at' => optional($t->completed_at ?? $t->created_at)->toIso8601String(),
                            'customer_name' => $t->customer?->name,
                            'customer_phone' => $t->customer?->phone,
                            'driver_name' => $t->driver?->name,
                            'driver_phone' => $t->driver?->phone,
                        ]);
                    }

                    // 3. Driver share row
                    if ($driverShare > 0) {
                        $rowsCollection->push([
                            'id' => 'trip_' . $t->id . '_drv',
                            'trip_id' => $t->id,
                            'payment_id' => null,
                            'type' => $onlineAmt > 0 ? 'held' : 'cash_retained',
                            'party' => 'driver',
                            'direction' => 'out',
                            'amount' => $driverShare,
                            'razorpay_ref' => $onlineAmt > 0 ? 'Pending Payout' : 'Cash in Hand',
                            'created_at' => optional($t->completed_at ?? $t->created_at)->toIso8601String(),
                            'customer_name' => $t->customer?->name,
                            'customer_phone' => $t->customer?->phone,
                            'driver_name' => $t->driver?->name,
                            'driver_phone' => $t->driver?->phone,
                        ]);
                    }

                    $reconciliation[(int) $t->id] = [
                        'captured' => $fare,
                        'driver_net' => $driverShare,
                        'operator_net' => $comm,
                        'gateway_fee' => 0.0,
                        'refunded' => 0.0,
                        'balanced' => true,
                        'imbalance_paise' => 0,
                    ];
                }
            }

            // Include completed transfers recorded in driver_payout_ledger (deduplicated against ledger_entries)
            $payoutTransfersQuery = \App\Models\DriverPayoutLedger::query()
                ->where('type', \App\Models\DriverPayoutLedger::TYPE_TRANSFER)
                ->with(['driver:id,name,phone'])
                ->orderByDesc('created_at');

            if (!empty($fromDate) && !empty($toDate)) {
                $payoutTransfersQuery->whereBetween('created_at', [$fromDate, $toDate]);
            }
            if (!empty($search)) {
                $term = trim($search);
                $payoutTransfersQuery->where(function ($pq) use ($term) {
                    $pq->where('reference', 'LIKE', "%{$term}%")
                       ->orWhere('notes', 'LIKE', "%{$term}%")
                       ->orWhereHas('driver', fn ($dq) => $dq->where('name', 'LIKE', "%{$term}%")->orWhere('phone', 'LIKE', "%{$term}%"));
                });
            }

            $unrecordedTransfers = $payoutTransfersQuery->limit(100)->get();
            foreach ($unrecordedTransfers as $trf) {
                $ref = trim((string) $trf->reference);
                if ($ref !== '' && in_array($ref, $existingRefs, true)) {
                    continue; // Already included via ledger_entries
                }

                $driver = $trf->driver ?? $trf->driverUser;
                $rowsCollection->push([
                    'id' => 'payout_trf_' . $trf->id,
                    'trip_id' => $trf->trip_id,
                    'payment_id' => null,
                    'type' => 'transfer',
                    'party' => 'driver',
                    'direction' => 'out',
                    'amount' => (float) $trf->amount,
                    'razorpay_ref' => ($trf->method ? strtoupper($trf->method) . ': ' : '') . ($trf->reference ?: 'Settlement Transfer'),
                    'created_at' => optional($trf->created_at)->toIso8601String(),
                    'customer_name' => null,
                    'customer_phone' => null,
                    'driver_name' => $driver?->name,
                    'driver_phone' => $driver?->phone,
                ]);
            }

            if ($tripId === null) {
                // Include driver wallet top-ups / recharges
                $topupsQuery = \App\Models\WalletTopup::query()
                    ->where('status', 'SUCCESS')
                    ->with(['user.driver'])
                    ->orderByDesc('paid_at');

                if (!empty($fromDate) && !empty($toDate)) {
                    $topupsQuery->whereBetween(DB::raw('COALESCE(paid_at, created_at)'), [$fromDate, $toDate]);
                } elseif (!empty($fromDate)) {
                    $topupsQuery->whereDate(DB::raw('COALESCE(paid_at, created_at)'), $fromDate);
                }
                if (!empty($search)) {
                    $term = trim($search);
                    $topupsQuery->where(function ($tq) use ($term) {
                        $tq->where('razorpay_payment_id', 'LIKE', "%{$term}%")
                           ->orWhere('razorpay_order_id', 'LIKE', "%{$term}%")
                           ->orWhereHas('user', fn ($uq) => $uq->where('name', 'LIKE', "%{$term}%")->orWhere('phone', 'LIKE', "%{$term}%"));
                    });
                }

                $unrecordedTopups = $topupsQuery->limit(100)->get();
                foreach ($unrecordedTopups as $topup) {
                    $ref = trim((string) ($topup->razorpay_payment_id ?? ''));
                    if ($ref !== '' && in_array($ref, $existingRefs, true)) {
                        continue;
                    }

                    $user = $topup->user;
                    $rowsCollection->push([
                        'id' => 'topup_' . $topup->id,
                        'trip_id' => null,
                        'payment_id' => null,
                        'type' => 'topup',
                        'party' => 'driver',
                        'direction' => 'in',
                        'amount' => (float) $topup->amount,
                        'razorpay_ref' => $topup->razorpay_payment_id ?: 'Wallet Recharge',
                        'created_at' => optional($topup->paid_at ?? $topup->created_at)->toIso8601String(),
                        'customer_name' => null,
                        'customer_phone' => null,
                        'driver_name' => $user?->name,
                        'driver_phone' => $user?->phone,
                    ]);
                }

                // Include driver subscriptions (both wallet deductions and direct online purchases)
                $subsQuery = \App\Models\DriverSubscription::query()
                    ->where('status', \App\Models\DriverSubscription::STATUS_ACTIVE)
                    ->where('is_queued', false)
                    ->with(['driver', 'plan:id,title'])
                    ->orderByDesc('created_at');

                if (!empty($fromDate) && !empty($toDate)) {
                    $subsQuery->whereBetween('created_at', [$fromDate, $toDate]);
                } elseif (!empty($fromDate)) {
                    $subsQuery->whereDate('created_at', $fromDate);
                }
                if (!empty($search)) {
                    $term = trim($search);
                    $subsQuery->where(function ($sq) use ($term) {
                        $sq->where('payment_reference', 'LIKE', "%{$term}%")
                           ->orWhereHas('plan', fn ($pq) => $pq->where('title', 'LIKE', "%{$term}%"))
                           ->orWhereHas('driver', fn ($uq) => $uq->where('name', 'LIKE', "%{$term}%")->orWhere('phone', 'LIKE', "%{$term}%"));
                    });
                }

                $unrecordedSubs = $subsQuery->limit(100)->get();
                foreach ($unrecordedSubs as $sub) {
                    $user = $sub->driver;
                    $isWallet = ($sub->payment_method ?? 'wallet') === 'wallet';
                    $planTitle = $sub->plan?->title ?? 'Driver Plan';

                    $rowsCollection->push([
                        'id' => 'sub_' . $sub->id,
                        'trip_id' => null,
                        'payment_id' => null,
                        'type' => 'subscription',
                        'party' => 'operator',
                        'direction' => 'in',
                        'amount' => (float) $sub->amount_paid,
                        'razorpay_ref' => ($isWallet ? 'Wallet: ' : 'UPI: ') . ($sub->payment_reference ?: '#SUB-' . str_pad($sub->id, 4, '0', STR_PAD_LEFT)),
                        'created_at' => optional($sub->created_at)->toIso8601String(),
                        'customer_name' => null,
                        'customer_phone' => null,
                        'driver_name' => $user?->name,
                        'driver_phone' => $user?->phone,
                    ]);
                }
            }
        }

        $allRows = $rowsCollection->sortByDesc('created_at')->values()->all();

        return [
            'rows' => $allRows,
            'reconciliation' => $reconciliation,
            'summary' => $this->ledgerSummary($rowsCollection, $reconciliation),
        ];
    }

    /**
     * Headline figures for the slice on screen.
     *
     * @param  \Illuminate\Support\Collection  $rowsCollection
     * @param  array  $reconciliation
     * @return array{captured:float,to_driver:float,held:float,to_operator:float,gateway_fee:float,refunded:float,trips:int,unbalanced:int}
     */
    private function ledgerSummary($rowsCollection, array $reconciliation): array
    {
        $sum = fn (string $type) => round(
            (float) $rowsCollection->where('type', $type)->sum('amount'),
            2,
        );

        return [
            'captured' => $sum('capture'),
            'to_driver' => $sum('transfer'),
            'held' => $sum('held'),
            'to_operator' => $sum('retained'),
            'gateway_fee' => $sum('gateway_fee'),
            'refunded' => $sum('refund') + $sum('reversal'),
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
