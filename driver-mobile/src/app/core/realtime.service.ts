import { Injectable } from '@angular/core';
import Pusher from 'pusher-js';
import { environment } from '../../environments/environment';

export type NegotiationOfferPayload = {
  type: 'offer_added';
  offer: {
    id?: number;
    from_role: 'customer' | 'driver';
    amount: number;
    status: string;
    created_at?: string;
    from_user_id?: number;
  };
};

export type NegotiationLockedPayload = {
  type: 'negotiation_locked';
  trip_id: number;
  final_fare: number;
};

export type TripStatusPayload = {
  type: 'status_updated';
  trip_id: number;
  status: string;
};

@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private pusher: Pusher | null = null;

  private ensure(): Pusher | null {
    if (!environment.reverbAppKey) return null;
    if (this.pusher) return this.pusher;

    this.pusher = new Pusher(environment.reverbAppKey, {
      wsHost: environment.reverbHost,
      wsPort: environment.reverbPort,
      wssPort: environment.reverbPort,
      forceTLS: environment.reverbScheme === 'https',
      enabledTransports: ['ws', 'wss'],
      cluster: '',
      disableStats: true,
    } as any);
    return this.pusher;
  }

  /**
   * Subscribe to a trip's negotiation channel — used to see live customer fare offers
   * (and your accepted/locked confirmations).
   */
  subscribeNegotiation(
    tripId: number,
    onOffer: (p: NegotiationOfferPayload) => void,
    onLocked: (p: NegotiationLockedPayload) => void
  ): () => void {
    const pusher = this.ensure();
    if (!pusher) return () => {};

    const channelName = `trip.${tripId}.negotiation`;
    const channel = pusher.subscribe(channelName);

    const offerHandler = (data: NegotiationOfferPayload) => onOffer(data);
    const lockedHandler = (data: NegotiationLockedPayload) => onLocked(data);

    channel.bind('FareNegotiationOfferAdded', offerHandler);
    channel.bind('FareNegotiationLocked', lockedHandler);

    return () => {
      channel.unbind('FareNegotiationOfferAdded', offerHandler);
      channel.unbind('FareNegotiationLocked', lockedHandler);
      pusher.unsubscribe(channelName);
    };
  }

  /**
   * Subscribe to trip status updates (driver sees customer-side cancels in real time).
   */
  subscribeTripStatus(
    tripId: number,
    onStatus: (p: TripStatusPayload) => void
  ): () => void {
    const pusher = this.ensure();
    if (!pusher) return () => {};

    const channelName = `trip.${tripId}.tracking`;
    const channel = pusher.subscribe(channelName);

    const handler = (data: TripStatusPayload) => onStatus(data);
    channel.bind('TripStatusUpdated', handler);

    return () => {
      channel.unbind('TripStatusUpdated', handler);
      pusher.unsubscribe(channelName);
    };
  }
}
