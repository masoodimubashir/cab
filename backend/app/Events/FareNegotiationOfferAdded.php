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

    public function broadcastAs(): string
    {
        return 'FareNegotiationOfferAdded';
    }

    public function broadcastWith(): array
    {
        $offer = $this->offer->toArray();

        // Attach the bidding driver's name + vehicle so the customer can tell
        // competing broadcast bids apart — the offer row itself only stores
        // from_user_id. Cheap single lookup; offers are low-frequency.
        if (($this->offer->from_role ?? null) === 'driver' && $this->offer->from_user_id) {
            $user = \App\Models\User::query()
                ->with('driver:id,user_id,vehicle_brand,vehicle_model,vehicle_color,vehicle_reg_no')
                ->find($this->offer->from_user_id);
            if ($user) {
                $offer['driver_name'] = $user->name;
                $offer['driver_avatar'] = $user->avatar_path ?? null;
                $offer['driver_vehicle'] = $user->driver ? [
                    'brand' => $user->driver->vehicle_brand,
                    'model' => $user->driver->vehicle_model,
                    'color' => $user->driver->vehicle_color,
                    'reg_no' => $user->driver->vehicle_reg_no,
                ] : null;
            }
        }

        return [
            'type' => 'offer_added',
            'offer' => $offer,
        ];
    }
}

