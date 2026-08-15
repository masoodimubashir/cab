<?php

namespace App\Services;

use App\Models\CityVehicleType;
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
     * The atomic entry point for a driver buying a plan. Everything that must be
     * consistent — the one-running-subscription rule, the one-queued-plan rule,
     * the wallet-balance check (for wallet payments), and the debit — happens inside ONE transaction
     * behind a per-driver lock, so two concurrent buys can't double-charge,
     * overspend the wallet, or create two running subscriptions.
     *
     * Payment Methods:
     *   1. 'wallet': Simulates wallet deduction, checks projected balance against minimum wallet limit,
     *      and debits wallet.
     *   2. 'upi' (or direct gateway): Activates plan without wallet deduction or minimum wallet validation.
     *
     * @return array{subscription: DriverSubscription, queued: bool, current: ?DriverSubscription}
     */
    public function buy(User $driver, SubscriptionPlan $plan, ?int $vehicleTypeId, string $paymentMethod = 'wallet', ?string $paymentReference = null): array
    {
        return DB::transaction(function () use ($driver, $plan, $vehicleTypeId, $paymentMethod, $paymentReference) {
            $this->lockDriver($driver);
            $amount = (float) $plan->amount;
            $isWallet = strtolower($paymentMethod) === 'wallet';

            $current = $this->currentActiveRow($driver->id, $vehicleTypeId);
            if ($current) {
                if ($this->queuedFor($driver->id, $vehicleTypeId)) {
                    throw new RuntimeException('You already have a plan queued to start next. Cancel it before queuing another.');
                }
                if ($isWallet) {
                    $this->assertCanAfford($driver, $amount);
                }
                $sub = $this->createQueuedRow($driver, $plan, $amount, true, $paymentMethod, $paymentReference);
                if ($isWallet) {
                    $this->debit($driver, $amount, 'Subscription (queued): ' . $plan->title);
                }

                return ['subscription' => $sub, 'queued' => true, 'current' => $current->fresh()];
            }

            if ($isWallet) {
                $this->assertCanAfford($driver, $amount);
            }
            $sub = $this->createActiveRow($driver, $plan, $amount, true, $paymentMethod, $paymentReference);
            if ($isWallet) {
                $this->debit($driver, $amount, 'Subscription: ' . $plan->title);
            }
            $this->sendSubscriptionInvoiceEmail($driver, $sub, false);

            return ['subscription' => $sub, 'queued' => false, 'current' => null];
        });
    }

    /**
     * Purchase a plan and activate it immediately. Used by the auto-renewal sweep.
     */
    public function purchase(User $driver, SubscriptionPlan $plan, bool $autoRenew = true, string $paymentMethod = 'wallet', ?string $paymentReference = null): DriverSubscription
    {
        return DB::transaction(function () use ($driver, $plan, $autoRenew, $paymentMethod, $paymentReference) {
            $this->lockDriver($driver);
            $amount = (float) $plan->amount;
            $isWallet = strtolower($paymentMethod) === 'wallet';

            if ($isWallet) {
                $this->assertCanAfford($driver, $amount);
            }
            $sub = $this->createActiveRow($driver, $plan, $amount, $autoRenew, $paymentMethod, $paymentReference);
            if ($isWallet) {
                $this->debit($driver, $amount, 'Subscription: ' . $plan->title);
            }

            return $sub;
        });
    }

    /** Create a Razorpay order for direct UPI subscription payment. */
    public function createUpiOrder(User $driver, SubscriptionPlan $plan): array
    {
        $amount = (float) $plan->amount;
        $amountPaise = (int) round($amount * 100);
        $receipt = 'sub_' . $driver->id . '_' . $plan->id . '_' . now()->format('YmdHis');
        $razorpay = app(RazorpayService::class);
        $order = $razorpay->createOrder($amountPaise, $receipt);

        return [
            'order_id' => $order['order_id'],
            'amount_paise' => $order['amount'],
            'amount' => $amount,
            'currency' => $order['currency'],
            'key_id' => env('RAZORPAY_KEY_ID'),
            'plan_id' => $plan->id,
            'plan_title' => $plan->title,
        ];
    }

    /** Verify direct UPI payment and activate subscription without touching wallet. */
    public function verifyUpiPurchase(User $driver, SubscriptionPlan $plan, ?int $vehicleTypeId, string $orderId, string $paymentId, string $signature): array
    {
        $razorpay = app(RazorpayService::class);
        $valid = $razorpay->verifyPaymentSignature($orderId, $paymentId, $signature);
        if (!$valid) {
            throw new RuntimeException('Invalid payment signature for UPI subscription.');
        }

        return $this->buy($driver, $plan, $vehicleTypeId, 'upi', $paymentId);
    }

    /** Serialise everything a driver does to their own wallet / subscriptions. */
    private function lockDriver(User $driver): void
    {
        User::query()->whereKey($driver->id)->lockForUpdate()->first();
    }

    /**
     * Universal Wallet Validation Rule:
     * Projected Balance = Current Wallet Balance - Deduction Amount
     * If Projected Balance < Minimum Wallet Limit -> Reject purchase.
     */
    private function assertCanAfford(User $driver, float $amount): void
    {
        if ($amount > 0) {
            $this->walletService->universalValidation($driver, $amount);
        }
    }

    /** Create a live (running) subscription row. */
    private function createActiveRow(User $driver, SubscriptionPlan $plan, float $amount, bool $autoRenew, string $paymentMethod = 'wallet', ?string $paymentReference = null): DriverSubscription
    {
        $now = now();

        return DriverSubscription::query()->create($this->snapshotAttributes($driver, $plan, $amount, $autoRenew, $paymentMethod, $paymentReference) + [
            'starts_at' => $now,
            'expires_at' => $this->expiryFor($plan->meter_type, (int) ($plan->days_count ?: 1), $now),
            'status' => DriverSubscription::STATUS_ACTIVE,
            'is_queued' => false,
        ]);
    }

    /** Create a prepaid "queued" row. */
    private function createQueuedRow(User $driver, SubscriptionPlan $plan, float $amount, bool $autoRenew, string $paymentMethod = 'wallet', ?string $paymentReference = null): DriverSubscription
    {
        return DriverSubscription::query()->create($this->snapshotAttributes($driver, $plan, $amount, $autoRenew, $paymentMethod, $paymentReference) + [
            'starts_at' => now(),
            'expires_at' => null,
            'status' => DriverSubscription::STATUS_ACTIVE,
            'is_queued' => true,
        ]);
    }

    /**
     * Activate a prepaid queued row when the previous plan ends. Pure status/date
     * flip — the wallet was already charged at queue time, so nothing is debited
     * here. Expiry is recomputed from the activation moment using the snapshot.
     */
    private function activateQueued(DriverSubscription $queued): void
    {
        DB::transaction(function () use ($queued) {
            $sub = DriverSubscription::query()->lockForUpdate()->find($queued->id);
            if (! $sub || ! $sub->is_queued || $sub->status !== DriverSubscription::STATUS_ACTIVE) {
                // Normally a concurrent activation already handled it. If the row
                // vanished entirely, the driver paid but got nothing — flag it.
                if (! $sub) {
                    \Illuminate\Support\Facades\Log::warning('Queued subscription missing at activation', [
                        'subscription_id' => $queued->id,
                        'driver_user_id' => $queued->driver_user_id,
                    ]);
                }
                return;
            }
            $now = now();
            $sub->is_queued = false;
            $sub->starts_at = $now;
            $sub->expires_at = $this->expiryFor($sub->meter_type, (int) ($sub->days_count ?: 1), $now);
            $sub->save();
        });
    }

    /** Shared snapshot of a plan's terms onto a (driver) subscription row. */
    private function snapshotAttributes(User $driver, SubscriptionPlan $plan, float $amount, bool $autoRenew, string $paymentMethod = 'wallet', ?string $paymentReference = null): array
    {
        return [
            'subscription_plan_id' => $plan->id,
            'driver_user_id' => $driver->id,
            'city_id' => $plan->city_id,
            'vehicle_type_id' => $plan->vehicle_type_id,
            'meter_type' => $plan->meter_type,
            'amount_paid' => $amount,
            'commission_percent' => $plan->commission_percent,
            'pricing_model' => $plan->pricing_model ?? SubscriptionPlan::MODEL_SUBSCRIPTION,
            'payment_method' => $paymentMethod,
            'payment_reference' => $paymentReference,
            'rides_allowed' => $plan->meter_type === SubscriptionPlan::METER_RIDES ? $plan->rides_count : null,
            'rides_used' => 0,
            'earnings_cap' => $plan->meter_type === SubscriptionPlan::METER_EARNINGS ? $plan->earnings_threshold : null,
            'earnings_accrued' => 0,
            'days_count' => in_array($plan->meter_type, [SubscriptionPlan::METER_DAYS, SubscriptionPlan::METER_DAILY], true)
                ? ($plan->meter_type === SubscriptionPlan::METER_DAILY ? 1 : (int) ($plan->days_count ?: 1))
                : null,
            'auto_renew' => $autoRenew,
        ];
    }

    /** Expiry for a time-metered plan (null for ride/earnings plans). */
    private function expiryFor(string $meterType, int $daysCount, \Illuminate\Support\Carbon $from): ?\Illuminate\Support\Carbon
    {
        if ($meterType === SubscriptionPlan::METER_DAILY) {
            return $from->copy()->addDay();
        }
        if ($meterType === SubscriptionPlan::METER_DAYS) {
            return $from->copy()->addDays(max(1, $daysCount));
        }
        return null;
    }

    /** Debit the wallet for a plan purchase when the amount is positive. */
    private function debit(User $driver, float $amount, string $reason): void
    {
        if ($amount > 0) {
            $this->walletService->recordTransaction(
                $driver,
                WalletTransaction::TYPE_DEBIT,
                $amount,
                $reason,
                null,
                $driver,
            );
        }
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
            ->where('is_queued', false)
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
            ->where('is_queued', false)
            ->where('starts_at', '<=', now())
            ->where(function ($q) use ($vehicleTypeId) {
                $q->whereNull('vehicle_type_id')->orWhere('vehicle_type_id', $vehicleTypeId);
            })
            ->orderByDesc('created_at')
            ->first();
    }

    /**
     * The driver's prepaid queued plan (bought while another plan is active and
     * waiting to start), or null. Matches the vehicle-type scoping of
     * currentActiveRow() so a queued plan for one vehicle type doesn't block a
     * purchase for another. One queued plan at a time per (driver, vehicle type).
     */
    public function queuedFor(int $driverUserId, ?int $vehicleTypeId = null): ?DriverSubscription
    {
        return DriverSubscription::query()
            ->where('driver_user_id', $driverUserId)
            ->where('status', DriverSubscription::STATUS_ACTIVE)
            ->where('is_queued', true)
            ->where(function ($q) use ($vehicleTypeId) {
                $q->whereNull('vehicle_type_id')->orWhere('vehicle_type_id', $vehicleTypeId);
            })
            ->orderBy('created_at')
            ->first();
    }

    /**
     * Apply a completed trip against the driver's active subscription:
     * accrue earnings, decrement the ride count, and expire when exhausted.
     * No-op when the driver has no matching active subscription.
     */
    public function consume(Trip $trip): void
    {
        $this->consumeTripAllowance($trip, (float) ($trip->final_fare ?? 0));
    }

    public function consumeSharedTrip(Trip $trip, float $fare): void
    {
        $this->consumeTripAllowance($trip, $fare);
    }

    private function consumeTripAllowance(Trip $trip, float $fare): void
    {
        if (! $trip->driver_id) {
            return;
        }

        $vehicleTypeId = $this->vehicleTypeIdForTrip($trip);
        $sub = $this->activeFor((int) $trip->driver_id, $vehicleTypeId);
        if (! $sub) {
            return;
        }

        $sub->earnings_accrued = round((float) $sub->earnings_accrued + max(0.0, $fare), 2);
        $sub->rides_used = $sub->rides_used + 1;
        $sub->save();

        // If this trip used the plan up, leave it status="active" — the hourly
        // sweep expires + auto-renews it (single renewal path; no wallet work
        // on the trip-settlement hot path). activeFor() already stops returning
        // it, so the driver loses the perk immediately.
    }

    public function effectiveCommissionPercentForTrip(Trip $trip, float $default): float
    {
        if (! $trip->driver_id) {
            return $default;
        }

        return $this->effectiveCommissionPercent(
            (int) $trip->driver_id,
            $this->vehicleTypeIdForTrip($trip),
            $default,
        );
    }

    private function vehicleTypeIdForTrip(Trip $trip): ?int
    {
        $vehicleTypeId = $trip->vehicle_type_id
            ?? ($trip->city_vehicle_type_id
                ? CityVehicleType::query()->whereKey($trip->city_vehicle_type_id)->value("vehicle_type_id")
                : null)
            ?? $trip->driver?->driver?->vehicle_type_id;

        return $vehicleTypeId ? (int) $vehicleTypeId : null;
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
            ->where('is_queued', false) // prepaid queued rows aren't "running" yet
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
     * Expire one exhausted subscription and start its successor when there is one.
     * The successor is, in order:
     *   1. a PREPAID queued plan — activated with NO further charge (it was paid
     *      for at queue time), or
     *   2. the same plan, re-bought from the wallet when auto-renew is on and the
     *      plan is still sellable.
     * Cancelled plans with nothing queued simply expire.
     *
     * The old row is claimed + expired in its own locked transaction so that two
     * concurrent callers can't double-process, and so a failed re-buy (wallet
     * short) still leaves the plan expired rather than rolling the expiry back.
     */
    private function renewOrExpire(DriverSubscription $old): void
    {
        $claimed = DB::transaction(function () use ($old) {
            $sub = DriverSubscription::query()->lockForUpdate()->find($old->id);
            if (! $sub
                || $sub->status !== DriverSubscription::STATUS_ACTIVE
                || $sub->is_queued
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

        // Defence-in-depth: never end up with two running plans. If the driver
        // already holds another *live* (non-queued) subscription, just expire.
        $hasOtherActive = DriverSubscription::query()
            ->where('driver_user_id', $driver->id)
            ->where('status', DriverSubscription::STATUS_ACTIVE)
            ->where('is_queued', false)
            ->where('id', '!=', $claimed->id)
            ->exists();
        if ($hasOtherActive) {
            return;
        }

        // 1) A prepaid queued plan wins — activate it now, no charge.
        $queued = $this->queuedFor($driver->id);
        if ($queued) {
            $this->activateQueued($queued);
            $this->notifyQueuedActivated($driver, $queued->fresh());
            return;
        }

        // 2) Else same-plan auto-renew (charged from the wallet).
        // By design, existing active subscribers auto-renew even if the plan was
        // deactivated for new buyers (Grandfathered Loyalty).
        // It strictly checks the minimum wallet limit: if deducting the plan fee
        // causes the projected wallet balance to fall below the minimum limit,
        // renewal is rejected and the plan expires cleanly.
        if (! $claimed->auto_renew || ! $claimed->subscription_plan_id) {
            return; // cancelled — genuine expiry
        }
        $plan = SubscriptionPlan::query()->find($claimed->subscription_plan_id);
        if (! $plan) {
            return; // plan deleted — genuine expiry
        }

        try {
            $new = $this->purchase($driver, $plan, true);
            $this->notifyRenewed($driver, $new);
            $this->sendSubscriptionInvoiceEmail($driver, $new, true);
        } catch (RuntimeException $e) {
            // Wallet couldn't cover the renewal without breaching minimum limit:
            // stays expired and notifies the driver.
            $this->notifyRenewalFailed($driver, $plan);
            $this->sendSubscriptionRenewalFailedEmail($driver, $plan, $e->getMessage());
            return;
        }

        $this->notifyRenewed($driver, $new);
    }

    /**
     * Turn off auto-renew for an active subscription. The plan keeps running
     * until it expires (status stays "active"); it just won't renew. A prepaid
     * queued plan is NOT touched here — the driver already paid for it, so it
     * still activates when this plan ends (cancel it separately for a refund).
     */
    public function cancel(DriverSubscription $sub): DriverSubscription
    {
        $sub->auto_renew = false;
        $sub->cancelled_at = now();
        $sub->save();
        return $sub;
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
            ->where('is_queued', false)
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
                        if ((float) $sub->amount_paid > 0) {
                            $body = "Your {$title} expires on {$when}. It will be auto-renewed for ₹"
                                . number_format((float) $sub->amount_paid, 0)
                                . ' from your wallet.';
                            if ((float) $sub->commission_percent > 0) {
                                $body .= ' ' . $this->fmtPercent($sub->commission_percent) . '% commission applies per ride.';
                            }
                            $body .= ' To change the plan or cancel, do it now.';
                        } else {
                            // Commission-only plan: nothing is taken from the wallet up front.
                            $body = "Your {$title} renews on {$when} at no upfront charge — "
                                . $this->fmtPercent($sub->commission_percent)
                                . '% commission applies per ride. To change the plan or cancel, do it now.';
                        }
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
        $amount = (float) $sub->amount_paid;
        $commission = (float) $sub->commission_percent;

        if ($amount > 0) {
            $body = "{$title} was renewed for ₹" . number_format($amount, 0) . ' from your wallet.';
            if ($commission > 0) {
                $body .= ' ' . $this->fmtPercent($commission) . '% commission applies per ride.';
            }
        } else {
            // Commission-only plan: re-activated with no upfront charge.
            $body = "{$title} was renewed at no upfront charge — "
                . $this->fmtPercent($commission) . '% commission applies per ride.';
        }

        $this->notifications->notify(
            $driver,
            'subscription_renewed',
            'Subscription renewed',
            $body,
            ['subscription_id' => $sub->id],
        );
    }

    /** Percent with trailing zeros trimmed: 15.00 -> "15", 12.50 -> "12.5". */
    private function fmtPercent(float|string|null $pct): string
    {
        $n = (float) $pct;
        return rtrim(rtrim(number_format($n, 2, '.', ''), '0'), '.');
    }

    private function notifyQueuedActivated(User $driver, DriverSubscription $sub): void
    {
        $title = $sub->plan?->title ?? 'Subscription';
        $body = (float) $sub->amount_paid > 0
            ? "Your queued plan {$title} is now active — it was already paid for, so nothing more was charged."
            : "Your queued plan {$title} is now active.";

        $this->notifications->notify(
            $driver,
            'subscription_activated',
            'Queued plan activated',
            $body,
            ['subscription_id' => $sub->id],
        );
    }

    private function notifyRenewalFailed(User $driver, SubscriptionPlan $plan): void
    {
        $this->notifications->notify(
            $driver,
            'subscription_renewal_failed',
            'Subscription renewal failed',
            "We couldn't renew {$plan->title} — your wallet balance was too low to cover the renewal without falling below your minimum limit. "
            . 'Top up your wallet and resubscribe to keep your commission rate.',
            ['plan_id' => $plan->id],
        );
    }

    public function sendSubscriptionInvoiceEmail(User $driver, DriverSubscription $sub, bool $isRenewal = false): void
    {
        $email = trim((string) $driver->email);
        if ($email === "" || str_ends_with($email, "@otp.local")) {
            return;
        }

        $plan = $sub->plan;
        $title = $plan?->title ?? 'Subscription Plan';
        $amount = (float) $sub->amount_paid;
        $commission = (float) $sub->commission_percent;
        $startsAt = optional($sub->starts_at)->format('d M Y, h:i A') ?? 'Immediately';
        $expiresAt = optional($sub->expires_at)->format('d M Y, h:i A')
            ?? ($sub->rides_allowed ? "{$sub->rides_allowed} Rides Allowance" : ($sub->earnings_cap ? "₹" . number_format((float)$sub->earnings_cap, 2) . " Earnings Limit" : "Unlimited"));
        $invoiceNo = 'INV-SUB-' . str_pad((string) $sub->id, 6, '0', STR_PAD_LEFT);
        $method = strtoupper((string) ($sub->payment_method ?: 'WALLET'));
        $subject = ($isRenewal ? '[Renewal Invoice] ' : '[Subscription Invoice] ') . "{$title} - {$invoiceNo}";

        $textBody = "DREAM CABS - SUBSCRIPTION INVOICE\n"
            . "========================================\n"
            . "Invoice No: {$invoiceNo}\n"
            . "Date: " . now()->format('d M Y, h:i A') . "\n"
            . "Driver: {$driver->name} (" . ($driver->phone ?: $email) . ")\n"
            . "Plan: {$title}\n"
            . "Type: " . ($isRenewal ? 'Auto-Renewal' : 'New Subscription') . "\n"
            . "Amount Paid: ₹" . number_format($amount, 2) . "\n"
            . "Payment Method: {$method}\n"
            . "Per-Ride Commission: " . ($commission > 0 ? $this->fmtPercent($commission) . '%' : '0% (Commission Free)') . "\n"
            . "Valid From: {$startsAt}\n"
            . "Valid Until: {$expiresAt}\n"
            . "Auto-Renewal: " . ($sub->auto_renew ? 'Active' : 'Disabled') . "\n"
            . "========================================\n"
            . "Thank you for driving with Dream Cabs!";

        try {
            \Illuminate\Support\Facades\Mail::raw($textBody, function ($message) use ($driver, $email, $subject) {
                $message->to($email, $driver->name ?: null)->subject($subject);
            });
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('Subscription invoice email failed', [
                'user_id' => $driver->id,
                'email' => $email,
                'error' => $e->getMessage(),
            ]);
        }
    }

    public function sendSubscriptionRenewalFailedEmail(User $driver, SubscriptionPlan $plan, string $errorReason = ''): void
    {
        $email = trim((string) $driver->email);
        if ($email === "" || str_ends_with($email, "@otp.local")) {
            return;
        }

        $title = $plan->title ?? 'Subscription Plan';
        $subject = "[Subscription Alert] Renewal Failed for {$title}";

        $textBody = "DREAM CABS - SUBSCRIPTION RENEWAL FAILED\n"
            . "========================================\n"
            . "Driver: {$driver->name}\n"
            . "Plan: {$title}\n"
            . "Amount: ₹" . number_format((float) $plan->amount, 2) . "\n"
            . "Reason: Your wallet balance was too low to cover the renewal without falling below the required minimum limit.\n"
            . "Status: Expired\n"
            . "========================================\n"
            . "Please top up your wallet in the Driver App to purchase or reactivate your subscription.\n\n"
            . "Thank you for driving with Dream Cabs!";

        try {
            \Illuminate\Support\Facades\Mail::raw($textBody, function ($message) use ($driver, $email, $subject) {
                $message->to($email, $driver->name ?: null)->subject($subject);
            });
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('Subscription renewal failed email failed', [
                'user_id' => $driver->id,
                'email' => $email,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
