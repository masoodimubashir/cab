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
    public function __construct(private WalletService $walletService)
    {
    }

    /**
     * Purchase a plan for a driver. Debits the wallet by the plan amount
     * (when > 0) and creates the snapshot subscription. Throws when the
     * wallet balance can't cover the amount.
     */
    public function purchase(User $driver, SubscriptionPlan $plan): DriverSubscription
    {
        $amount = (float) $plan->amount;

        if ($amount > 0 && $this->walletService->balance($driver) < $amount) {
            throw new RuntimeException('Insufficient wallet balance to buy this plan.');
        }

        return DB::transaction(function () use ($driver, $plan, $amount) {
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
     * type (or a vehicle-agnostic plan), or null. Lazily expires any of the
     * driver's subscriptions that are past their limit/date before returning.
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
                $sub->status = DriverSubscription::STATUS_EXPIRED;
                $sub->save();
                continue;
            }
            if ($match === null
                && ($sub->vehicle_type_id === null || $sub->vehicle_type_id === $vehicleTypeId)) {
                $match = $sub;
            }
        }

        return $match;
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

        if ($sub->isExhausted()) {
            $sub->status = DriverSubscription::STATUS_EXPIRED;
        }
        $sub->save();
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
     * Sweep all overdue active subscriptions to expired. Used by the daily
     * scheduled command; correctness doesn't depend on it because activeFor()
     * also expires lazily on read.
     *
     * @return int number of subscriptions expired
     */
    public function expireDue(): int
    {
        $count = 0;
        DriverSubscription::query()
            ->where('status', DriverSubscription::STATUS_ACTIVE)
            ->chunkById(200, function ($subs) use (&$count) {
                foreach ($subs as $sub) {
                    if ($sub->isExhausted()) {
                        $sub->status = DriverSubscription::STATUS_EXPIRED;
                        $sub->save();
                        $count++;
                    }
                }
            });
        return $count;
    }
}
