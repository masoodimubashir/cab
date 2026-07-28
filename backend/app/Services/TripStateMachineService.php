<?php

namespace App\Services;

use App\Models\OperatorSetting;
use App\Models\ShuttleJourney;
use App\Models\Trip;
use App\Models\User;
use App\Events\TripStatusUpdated;
use Illuminate\Support\Facades\DB;

class TripStateMachineService
{
    public function __construct(
        private NotificationService $notificationService,
        private FareEstimationService $fareEstimationService,
        private CommissionSettlementService $commissionSettlementService,
        private MessageTemplateService $messageTemplates,
        private AutoRefundService $autoRefunds,
    ) {
    }


    /**
     * Allowed transitions for trip status.
     *
     * @return array<string, array<string, true>>
     */
    private function allowedTransitions(): array
    {
        return [
            'REQUESTED' => ['NEGOTIATION' => true, 'CANCELLED' => true],
            'NEGOTIATION' => ['CONFIRMED' => true, 'CANCELLED' => true],
            'CONFIRMED' => ['ASSIGNED' => true, 'CANCELLED' => true],
            'ASSIGNED' => [
                'EN_ROUTE_PICKUP' => true,
                'CANCELLED' => true,
            ],
            'EN_ROUTE_PICKUP' => ['ARRIVED_PICKUP' => true, 'CANCELLED' => true],
            'ARRIVED_PICKUP' => ['EN_ROUTE_DROP' => true, 'CANCELLED' => true],
            'EN_ROUTE_DROP' => ['ARRIVED_DROP' => true, 'CANCELLED' => true],
            'ARRIVED_DROP' => ['COMPLETED' => true, 'CANCELLED' => true],
            'COMPLETED' => [],
            'CANCELLED' => [],
        ];
    }

    public function transition(Trip $trip, string $to, array $meta = []): Trip
    {
        $from = $trip->status;
        $allowed = $this->allowedTransitions();

        if (!isset($allowed[$from][$to])) {
            throw new \InvalidArgumentException("Invalid trip transition from {$from} to {$to}.");
        }

        $trip->status = $to;

        switch ($to) {
            case 'NEGOTIATION':
                $trip->negotiation_started_at = now();
                break;
            case 'CONFIRMED':
                $trip->confirmed_at = now();
                if (isset($meta['final_fare'])) {
                    $trip->final_fare = (float) $meta['final_fare'];
                }
                $this->stampDriverFleet($trip);
                break;
            case 'ASSIGNED':
                $trip->assigned_at = now();
                $this->stampDriverFleet($trip);
                break;
            case 'EN_ROUTE_PICKUP':
                $trip->en_route_pickup_at = now();
                break;
            case 'ARRIVED_PICKUP':
                $trip->arrived_pickup_at = now();
                break;
            case 'EN_ROUTE_DROP':
                $trip->en_route_drop_at = now();
                break;
            case 'ARRIVED_DROP':
                $trip->arrived_drop_at = now();
                break;
            case 'COMPLETED':
                // Stamp completion first so recomputeFinal sees the closed window
                // when summing telemetry.
                $trip->completed_at = now();
                $negotiatedFloor = (float) ($trip->final_fare ?? $trip->estimated_fare ?? 0);
                $settle = $this->fareEstimationService->recomputeFinal($trip, $negotiatedFloor);
                $trip->final_fare = $settle['final_fare'];
                $trip->waiting_charge_amount = $settle['waiting_charge_amount'];
                break;
            case 'CANCELLED':
                $trip->cancelled_at = now();
                $trip->cancelled_reason = $meta['cancelled_reason'] ?? $trip->cancelled_reason;
                break;
        }

        $trip->save();
        $this->syncShuttleJourney($trip, $to);

        // On completion, settle the operator's commission (honouring any
        // active subscription) and draw down the driver's subscription usage.
        if ($to === 'COMPLETED') {
            // settle() also runs the Phase 5 booking-payment split for Fixed and
            // Shuttle prepayments riding on this trip.
            $this->commissionSettlementService->settle($trip);
        }

        // On cancellation of a solo ride, run the automatic refund rulebook
        // (§5) when the split engine is live: refund the customer per the rule,
        // claw back the driver's share, keep only the cancel fee. No-op while the
        // engine is disabled, or when nothing was captured yet.
        //
        // Shared journeys are excluded because they decide their own refunds per
        // seat/passenger, on a different rule (driver committed or not). Fixed is
        // recognisable by route_departure_id; Shuttle carries none, so it has to
        // be identified by its journey row — without that check a cancelled
        // shuttle would be refunded twice, once by each rulebook.
        $isShared = $trip->route_departure_id !== null
            || ShuttleJourney::query()->where('trip_id', $trip->id)->exists();

        if ($to === 'CANCELLED' && ! $isShared && $this->autoRefunds->enabled()) {
            $this->autoRefunds->refundForCancellation($trip, $this->cancelledBy($trip, $meta));
        }

        $tripId = $trip->id;
        $customerId = $trip->customer_id;

        // Defer broadcast + FCM until any enclosing transaction commits, so
        // listeners and recipients never observe a status that's about to roll
        // back. afterCommit() fires immediately when no transaction is active.
        DB::afterCommit(function () use ($tripId, $to, $customerId, $meta) {
            broadcast(new TripStatusUpdated(tripId: $tripId, status: $to))->toOthers();

            $customerMessages = [
                'ASSIGNED' => ['Driver assigned', 'Your driver is on the way.'],
                'ARRIVED_PICKUP' => ['Driver has arrived', 'Your driver is at the pickup point.'],
                'EN_ROUTE_DROP' => ['Trip started', 'You are on your way to the destination.'],
                'COMPLETED' => ['Trip completed', 'Thanks for riding. Tap to pay and rate.'],
                'CANCELLED' => ['Trip cancelled', $meta['cancelled_reason'] ?? 'Your trip was cancelled.'],
            ];

            if (isset($customerMessages[$to]) && $customerId) {
                $customer = User::query()->find($customerId);
                if ($customer) {
                    [$title, $body] = $customerMessages[$to];

                    // Operator-customisable bodies (Operator Settings → Templates).
                    // Only the ride-accept (ASSIGNED) and cancellation messages are
                    // editable; everything else keeps its built-in copy.
                    $settings = OperatorSetting::instance();
                    $template = $to === 'ASSIGNED'
                        ? $settings->customer_ride_accept_msg
                        : ($to === 'CANCELLED' ? $settings->ride_cancellation_msg : null);

                    if (filled($template)) {
                        $rendered = $this->messageTemplates->render(
                            $template,
                            $this->templateVars($tripId, $customer, $meta),
                        );
                        if ($rendered !== '') {
                            $body = $rendered;
                        }
                    }

                    $this->notificationService->sendToUser($customer, $title, $body, [
                        'type' => 'trip_status',
                        'trip_id' => $tripId,
                        'status' => $to,
                    ]);
                }
            }
        });

        return $trip->fresh();
    }

    /**
     * Works out who a cancellation is attributed to, for the refund rulebook.
     * An explicit meta['cancelled_by'] always wins; otherwise we read it off the
     * no-show reason ("no_show_by:driver" means the customer didn't board, so
     * it's on the customer; "no_show_by:customer" means the driver never showed,
     * so it's on the driver). Everything else defaults to a customer cancel.
     */
    private function cancelledBy(Trip $trip, array $meta): string
    {
        $explicit = $meta['cancelled_by'] ?? null;
        if (is_string($explicit) && in_array($explicit, [
            AutoRefundService::BY_CUSTOMER,
            AutoRefundService::BY_DRIVER,
            AutoRefundService::BY_OPERATOR,
            AutoRefundService::BY_SYSTEM,
        ], true)) {
            return $explicit;
        }

        $reason = (string) ($meta['cancelled_reason'] ?? $trip->cancelled_reason ?? '');
        if ($reason === 'no_show_by:customer') {
            return AutoRefundService::BY_DRIVER;   // driver never showed → not the customer's fault
        }
        if ($reason === 'no_show_by:driver') {
            return AutoRefundService::BY_CUSTOMER;  // customer didn't board → on them
        }

        return AutoRefundService::BY_CUSTOMER;
    }

    private function syncShuttleJourney(Trip $trip, string $tripStatus): void
    {
        $journeyStatus = match ($tripStatus) {
            'CONFIRMED', 'ASSIGNED' => 'ASSIGNED',
            'EN_ROUTE_PICKUP', 'ARRIVED_PICKUP', 'EN_ROUTE_DROP', 'ARRIVED_DROP' => 'IN_PROGRESS',
            'COMPLETED' => 'COMPLETED',
            'CANCELLED' => 'CANCELLED',
            default => null,
        };

        if ($journeyStatus === null) {
            return;
        }

        $updates = ['status' => $journeyStatus];
        if ($trip->driver_id !== null) {
            $updates['driver_id'] = $trip->driver_id;
        }
        if ($journeyStatus === 'IN_PROGRESS' && $trip->en_route_pickup_at) {
            $updates['started_at'] = $trip->en_route_pickup_at;
        }
        if ($journeyStatus === 'COMPLETED') {
            $updates['completed_at'] = $trip->completed_at ?? now();
        }

        ShuttleJourney::query()
            ->where('trip_id', $trip->id)
            ->update($updates);
    }

    /**
     * Stamp the trip with the assigned driver's fleet (when the driver belongs
     * to one) so fleet-level trip reporting works. The driver is bound to a
     * trip just before it enters CONFIRMED (shared pre-assign) or ASSIGNED
     * (private accept), so both call this. No-op for independent drivers or once
     * the fleet is already set.
     */
    private function stampDriverFleet(Trip $trip): void
    {
        if ($trip->driver_id === null || $trip->fleet_id !== null) {
            return;
        }
        $fleetId = \App\Models\Driver::query()
            ->where('user_id', $trip->driver_id)
            ->value('fleet_id');
        if ($fleetId !== null) {
            $trip->fleet_id = $fleetId;
        }
    }

    /**
     * Token values for the operator's notification templates. Tokens with no
     * data source today (vehicle_no, eta, link) are intentionally absent so the
     * renderer strips them rather than leaking the raw placeholder.
     */
    private function templateVars(int $tripId, User $customer, array $meta): array
    {
        $trip = Trip::query()->with('driver:id,name')->find($tripId);

        return [
            'customer_name' => (string) ($customer->name ?? ''),
            'driver_name' => (string) ($trip?->driver?->name ?? ''),
            'operator_name' => (string) config('app.name', ''),
            'engagement_id' => (string) $tripId,
        ];
    }
}

