<?php

namespace App\Jobs;

use App\Models\FareNegotiationOffer;
use App\Models\Trip;
use App\Services\NotificationCenter;
use App\Services\TripStateMachineService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Cache;

class ExpireUnansweredTripJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        public int $tripId,
        public string $genToken = '',
    ) {}

    public function handle(TripStateMachineService $stateMachine, NotificationCenter $notifier): void
    {
        $trip = Trip::query()->find($this->tripId);
        if (!$trip || $trip->status !== 'NEGOTIATION') {
            return; // Already confirmed, cancelled, or progressing
        }

        // Only expire if this generation token matches the active chain
        if ($this->genToken !== '') {
            $currentGen = Cache::get("dispatch_gen:{$this->tripId}");
            if ($currentGen !== null && $currentGen !== $this->genToken) {
                return;
            }
        }

        // Check if any driver has accepted
        $hasAccepted = FareNegotiationOffer::query()
            ->whereHas('fareNegotiation', fn ($q) => $q->where('trip_id', $this->tripId))
            ->where('status', 'ACCEPTED')
            ->exists();

        if ($hasAccepted) {
            return;
        }

        $stateMachine->transition($trip, 'CANCELLED', [
            'cancelled_reason' => 'unanswered_timeout',
        ]);
        app(\App\Services\ShuttleRefundService::class)->markCancelledForTrip($trip, 'unanswered_timeout');

        $notifier->notifyUserId(
            (int) $trip->customer_id,
            'trip_timeout_no_drivers',
            'No drivers available',
            'No drivers responded nearby. Please try again or offer a higher fare.',
            ['trip_id' => $trip->id],
            'alert-circle'
        );
    }
}
