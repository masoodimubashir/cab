<?php

namespace App\Services;

use App\Models\OperatorSetting;
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

        // On completion, settle the operator's commission (honouring any
        // active subscription) and draw down the driver's subscription usage.
        if ($to === 'COMPLETED') {
            $this->commissionSettlementService->settle($trip);
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

