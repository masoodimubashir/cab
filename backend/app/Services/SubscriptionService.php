<?php

namespace App\Services;

use App\Models\DriverSubscription;
use App\Models\SubscriptionPlan;
use App\Models\Trip;
use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Driver subscription engine.
 *
 * A driver buys a SubscriptionPlan (debiting their wallet) and gets a
 * DriverSubscription that snapshots the plan terms. While active, the driver
 * keeps the plan's (usually 0%) commission instead of the vehicle's default.
 * Each completed trip consumes the plan's allowance (rides / earnings); the
 * subscription expires once exhausted or past its expiry date.
 */
class SubscriptionService
{
    public function __construct(
        private WalletService $walletService,
        private NotificationCenter $notifications,
    ) {
    }

    /**
     * Purchase a plan for a driver. Debits the wallet by the plan amount
     * (when > 0) and creates the snapshot subscription. Throws when the
     * wallet balance can't cover the amount.
     *
     * New subscriptions auto-renew by default; auto-renewal re-buys through
     * this same method so the wallet debit + snapshot are identical.
     */
    public function purchase(User $driver, SubscriptionPlan $plan, bool $autoRenew = true): DriverSubscription
    {
        $amount = (float) $plan->amount;

        if ($amount > 0 && $this->walletService->balance($driver) < $amount) {
            throw new RuntimeException('Insufficient wallet balance to buy this plan.');
        }

        return DB::transaction(function () use ($driver, $plan, $amount, $autoRenew) {
            $now = now();
            $expiresAt = null;
            if (in_array($plan->meter_type, [SubscriptionPlan::METER_DAYS, SubscriptionPlan::METER_DAILY], true)) {
                $days = $plan->meter_type === SubscriptionPlan::METER_DAILY
                    ? 1
                    : (int) ($plan->days_count ?: 1);
                $expiresAt = $now->copy()->addDays($days);
            }

            $sub = DriverSubscription::query()->create([
                'subscription_plan_id' => $plan->id,
                'driver_user_id' => $driver->id,
                'city_id' => $plan->city_id,
                'vehicle_type_id' => $plan->vehicle_type_id,
                'meter_type' => $plan->meter_type,
                'amount_paid' => $amount,
                'commission_percent' => $plan->commission_percent,
                'rides_allowed' => $plan->meter_type === SubscriptionPlan::METER_RIDES ? $plan->rides_count : null,
                'rides_used' => 0,
                'earnings_cap' => $plan->meter_type === SubscriptionPlan::METER_EARNINGS ? $plan->earnings_threshold : null,
                'earnings_accrued' => 0,
                'starts_at' => $now,
                'expires_at' => $expiresAt,
                'status' => DriverSubscription::STATUS_ACTIVE,
                'auto_renew' => $autoRenew,
            ]);

            if ($amount > 0) {
                $this->walletService->recordTransaction(
                    $driver,
                    WalletTransaction::TYPE_DEBIT,
                    $amount,
                    'Subscription: ' . $plan->title,
                    null,
                    $driver,
                );
            }

            return $sub;
        });
    }

    /**
     * The driver's currently-active subscription matching the given vehicle
     * type (or a vehicle-agnostic plan), or null.
     *
     * An exhausted-but-not-yet-swept row is skipped here (so the driver loses
     * the plan's perk the instant it's used up / past its date) but is left
     * status="active" so the hourly sweep can expire AND auto-renew it through
     * the single renewal path. This keeps the trip-settlement hot path free of
     * wallet debits / notifications.
     */
    public function activeFor(int $driverUserId, ?int $vehicleTypeId): ?DriverSubscription
    {
        $candidates = DriverSubscription::query()
            ->where('driver_user_id', $driverUserId)
            ->where('status', DriverSubscription::STATUS_ACTIVE)
            ->where('starts_at', '<=', now())
            ->orderBy('created_at')
            ->get();

        $match = null;
        foreach ($candidates as $sub) {
            if ($sub->isExhausted()) {
                continue; // leave to the sweep (expireDue) to expire + renew
            }
            if ($match === null
                && ($sub->vehicle_type_id === null || $sub->vehicle_type_id === $vehicleTypeId)) {
                $match = $sub;
            }
        }

        return $match;
    }

    /**
     * The row currently occupying the driver's single "active" slot — INCLUDING
     * one that's exhausted but not yet swept. Unlike activeFor() (which hides an
     * exhausted sub so the perk drops immediately), this answers "does the driver
     * already have a subscription?" and is what purchase()/cancel() must use so a
     * buy during the exhausted-but-unswept window queues instead of creating a
     * second active row + double charge.
     */
    public function currentActiveRow(int $driverUserId, ?int $vehicleTypeId): ?DriverSubscription
    {
        return DriverSubscription::query()
            ->where('driver_user_id', $driverUserId)
            ->where('status', DriverSubscription::STATUS_ACTIVE)
            ->where('starts_at', '<=', now())
            ->where(function ($q) use ($vehicleTypeId) {
                $q->whereNull('vehicle_type_id')->orWhere('vehicle_type_id', $vehicleTypeId);
            })
            ->orderByDesc('created_at')
            ->first();
    }

    /**
     * Apply a completed trip against the driver's active subscription:
     * accrue earnings, decrement the ride count, and expire when exhausted.
     * No-op when the driver has no matching active subscription.
     */
    public function consume(Trip $trip): void
    {
        if (! $trip->driver_id) {
            return;
        }

        $vehicleTypeId = $trip->vehicle_type_id
            ?? $trip->driver?->driver?->vehicle_type_id;

        $sub = $this->activeFor((int) $trip->driver_id, $vehicleTypeId ? (int) $vehicleTypeId : null);
        if (! $sub) {
            return;
        }

        $fare = (float) ($trip->final_fare ?? 0);
        $sub->earnings_accrued = round((float) $sub->earnings_accrued + $fare, 2);
        $sub->rides_used = $sub->rides_used + 1;
        $sub->save();

        // If this trip used the plan up, leave it status="active" — the hourly
        // sweep expires + auto-renews it (single renewal path; no wallet work
        // on the trip-settlement hot path). activeFor() already stops returning
        // it, so the driver loses the perk immediately.
    }

    /**
     * Effective commission % for a driver on a given vehicle type: the active
     * subscription's rate when one applies, otherwise the supplied default.
     */
    public function effectiveCommissionPercent(int $driverUserId, ?int $vehicleTypeId, float $default): float
    {
        $sub = $this->activeFor($driverUserId, $vehicleTypeId);
        return $sub ? (float) $sub->commission_percent : $default;
    }

    /**
     * Sweep every exhausted active subscription: expire it and, where it should,
     * auto-renew it (queued plan first, else same-plan renewal). This is the
     * single renewal path — activeFor()/consume() defer all expiry/renewal here.
     *
     * @return int number of subscriptions processed (expired and/or renewed)
     */
    public function expireDue(): int
    {
        $count = 0;
        DriverSubscription::query()
            ->where('status', DriverSubscription::STATUS_ACTIVE)
            ->orderBy('id')
            ->chunkById(200, function ($subs) use (&$count) {
                foreach ($subs as $sub) {
                    if ($sub->isExhausted()) {
                        $this->renewOrExpire($sub);
                        $count++;
                    }
                }
            });
        return $count;
    }

    /**
     * Expire one exhausted subscription and activate its successor when there is
     * one. The successor is the queued plan if set, otherwise the same plan when
     * auto-renew is on and the plan is still sellable. Cancelled plans (auto-renew
     * off, no queue) simply expire.
     *
     * The old row is claimed + expired in its own locked transaction so that two
     * concurrent callers can't double-renew, and so a failed re-buy (wallet short)
     * still leaves the plan expired rather than rolling the expiry back.
     */
    private function renewOrExpire(DriverSubscription $old): void
    {
        $claimed = DB::transaction(function () use ($old) {
            $sub = DriverSubscription::query()->lockForUpdate()->find($old->id);
            if (! $sub
                || $sub->status !== DriverSubscription::STATUS_ACTIVE
                || ! $sub->isExhausted()) {
                return null; // already handled by another path, or not actually due
            }
            $sub->status = DriverSubscription::STATUS_EXPIRED;
            $sub->save();
            return $sub;
        });

        if (! $claimed) {
            return;
        }

        $driver = $claimed->driver;
        if (! $driver) {
            return;
        }

        // Defence-in-depth: never renew into a duplicate. If the driver already
        // holds another active subscription (one-active-per-driver invariant),
        // this one simply expires without a re-buy.
        $hasOtherActive = DriverSubscription::query()
            ->where('driver_user_id', $driver->id)
            ->where('status', DriverSubscription::STATUS_ACTIVE)
            ->where('id', '!=', $claimed->id)
            ->exists();
        if ($hasOtherActive) {
            return;
        }

        // Decide the successor plan: a queued plan wins, else same-plan
        // auto-renew. Either way the plan must still be sellable now.
        $plan = null;
        if ($claimed->next_plan_id) {
            $cand = SubscriptionPlan::query()->find($claimed->next_plan_id);
            if ($cand && $cand->is_active && $cand->isAvailableNow()) {
                $plan = $cand;
            }
        } elseif ($claimed->auto_renew && $claimed->subscription_plan_id) {
            $cand = SubscriptionPlan::query()->find($claimed->subscription_plan_id);
            if ($cand && $cand->is_active && $cand->isAvailableNow()) {
                $plan = $cand;
            }
        }

        if (! $plan) {
            return; // cancelled, or plan no longer available — genuine expiry
        }

        try {
            $new = $this->purchase($driver, $plan, true);
        } catch (RuntimeException $e) {
            // Wallet couldn't cover the renewal: stay expired and tell the driver.
            $this->notifyRenewalFailed($driver, $plan);
            return;
        }

        $this->notifyRenewed($driver, $new);
    }

    /**
     * Turn off auto-renew for an active subscription. The plan keeps running
     * until it expires (status stays "active"); it just won't renew. Any queued
     * next plan is dropped too.
     */
    public function cancel(DriverSubscription $sub): DriverSubscription
    {
        $sub->auto_renew = false;
        $sub->cancelled_at = now();
        $sub->next_plan_id = null;
        $sub->save();
        return $sub;
    }

    /**
     * Queue a plan to start when the given active subscription ends. No wallet
     * debit now — the charge runs through the renewal path at activation.
     */
    public function queueNext(DriverSubscription $current, SubscriptionPlan $plan): DriverSubscription
    {
        $current->next_plan_id = $plan->id;
        $current->save();
        return $current;
    }

    /**
     * Notify drivers whose time-metered subscription expires within the next 24h
     * (once each, via notified_expiry_at). Ride/earnings plans have no expiry
     * date and are correctly excluded.
     *
     * @return int number of drivers notified
     */
    public function notifyExpiringSoon(): int
    {
        $count = 0;
        $now = now();
        $until = $now->copy()->addDay();

        DriverSubscription::query()
            ->where('status', DriverSubscription::STATUS_ACTIVE)
            ->whereNotNull('expires_at')
            ->whereNull('notified_expiry_at')
            ->whereBetween('expires_at', [$now, $until])
            ->with(['driver', 'plan'])
            ->orderBy('id')
            ->chunkById(200, function ($subs) use (&$count, $now) {
                foreach ($subs as $sub) {
                    $driver = $sub->driver;
                    if (! $driver) {
                        continue;
                    }

                    $when = optional($sub->expires_at)->format('d M, g:i A');
                    $title = $sub->plan?->title ?? 'Subscription';

                    if ($sub->auto_renew && ! $sub->cancelled_at) {
                        $body = "Your {$title} expires on {$when}. It will be auto-renewed for ₹"
                            . number_format((float) $sub->amount_paid, 0)
                            . ' from your wallet. To change the plan or cancel, do it now.';
                    } else {
                        $body = "Your {$title} expires on {$when} and will not renew. "
                            . 'Resubscribe to keep your commission rate.';
                    }

                    $this->notifications->notify(
                        $driver,
                        'subscription_expiring_soon',
                        'Subscription expiring soon',
                        $body,
                        [
                            'subscription_id' => $sub->id,
                            'expires_at' => optional($sub->expires_at)->toIso8601String(),
                        ],
                    );

                    $sub->notified_expiry_at = $now;
                    $sub->save();
                    $count++;
                }
            });

        return $count;
    }

    private function notifyRenewed(User $driver, DriverSubscription $sub): void
    {
        $title = $sub->plan?->title ?? 'Subscription';
        $this->notifications->notify(
            $driver,
            'subscription_renewed',
            'Subscription renewed',
            "{$title} was renewed for ₹" . number_format((float) $sub->amount_paid, 0) . ' from your wallet.',
            ['subscription_id' => $sub->id],
        );
    }

    private function notifyRenewalFailed(User $driver, SubscriptionPlan $plan): void
    {
        $this->notifications->notify(
            $driver,
            'subscription_renewal_failed',
            'Subscription renewal failed',
            "We couldn't renew {$plan->title} — your wallet balance was too low, so the plan has ended. "
            . 'Top up your wallet and resubscribe to keep your commission rate.',
            ['plan_id' => $plan->id],
        );
    }
}
