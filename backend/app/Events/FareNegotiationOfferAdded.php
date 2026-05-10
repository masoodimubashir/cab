<?php

namespace App\Events;

use App\Models\FareNegotiationOffer;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class FareNegotiationOfferAdded implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public int $tripId,
        public FareNegotiationOffer $offer,
    ) {
    }

    public function broadcastOn(): array
    {
        return [new PrivateChannel('trip.' . $this->tripId . '.negotiation')];
    }

    public function broadcastWith(): array
    {
        return [
            'type' => 'offer_added',
            'offer' => $this->offer->toArray(),
        ];
    }
}

