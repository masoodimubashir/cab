import { Injectable } from '@angular/core';
import Pusher from 'pusher-js';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

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

export type TripCustomerLocationPayload = {
  type: 'customer_location_updated';
  location: {
    trip_id: number;
    customer_id: number;
    lat: number;
    lng: number;
    accuracy_m?: number | null;
    recorded_at?: string;
  };
};

export type ShuttleManifestPayload = {
  type: 'shuttle_manifest_updated';
  trip_id: number;
  journey_id: number;
};

export type FixedRouteCatalogUpdatedPayload = {
  type: 'fixed_route_catalog_updated';
  city_id: number;
  route_id: number | null;
  reason: string;
};

export type DriverVerificationUpdatedPayload = {
  type: 'driver_verification_updated';
  driver_id: number | null;
  reason: 'approval_status' | 'document_status' | string;
  document_id?: number | null;
  status?: string | null;
};

export type AppNotificationPayload = {
  type: 'app_notification_created';
  notification: {
    id: number;
    type: string;
    title: string;
    body?: string | null;
    data?: Record<string, unknown> | null;
    icon?: string | null;
    read_at?: string | null;
    created_at?: string | null;
  };
};

export type FixedSeatHoldRequestedPayload = {
  hold_id: number;
  departure_id: number;
  driver_id: number;
  customer_id: number;
  customer_name?: string | null;
  board_stop?: string | null;
  drop_stop?: string | null;
  seat_labels: string[];
  seats: number;
  amount: number;
  expires_at: string | null;
};

@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private pusher: Pusher | null = null;

  constructor(private auth: AuthService) {}

  private ensure(): Pusher | null {
    if (!environment.reverbAppKey) return null;
    if (this.pusher) return this.pusher;

    const authBase = environment.apiUrl.replace(/\/api\/?$/, '');
    const authEndpoint = `${authBase}/broadcasting/auth`;
    const authService = this.auth;

    this.pusher = new Pusher(environment.reverbAppKey, {
      wsHost: environment.reverbHost,
      wsPort: environment.reverbPort,
      wssPort: environment.reverbPort,
      forceTLS: environment.reverbScheme === 'https',
      enabledTransports: ['ws', 'wss'],
      cluster: '',
      disableStats: true,
      authorizer: (channel: any) => ({
        authorize: (socketId: string, callback: (err: Error | null, data: any) => void) => {
          const token = authService.getToken();
          fetch(authEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ socket_id: socketId, channel_name: channel.name }),
          })
            .then(async (res) => {
              if (!res.ok) throw new Error(`auth ${res.status}`);
              return res.json();
            })
            .then((data) => callback(null, data))
            .catch((err) => callback(err, null));
        },
      }),
    } as any);
    return this.pusher;
  }

  subscribeDriverVerification(
    userId: number,
    onUpdated: (p: DriverVerificationUpdatedPayload) => void,
  ): () => void {
    const pusher = this.ensure();
    if (!pusher) return () => {};

    const channelName = `private-App.Models.User.${userId}`;
    const channel = pusher.subscribe(channelName);
    const handler = (data: DriverVerificationUpdatedPayload) => onUpdated(data);

    channel.bind('DriverVerificationUpdated', handler);

    return () => {
      channel.unbind('DriverVerificationUpdated', handler);
      pusher.unsubscribe(channelName);
    };
  }

  subscribeAppNotifications(
    userId: number,
    onCreated: (p: AppNotificationPayload) => void,
  ): () => void {
    const pusher = this.ensure();
    if (!pusher) return () => {};

    const channelName = `private-App.Models.User.${userId}`;
    const channel = pusher.subscribe(channelName);
    const handler = (data: AppNotificationPayload) => onCreated(data);

    channel.bind('AppNotificationCreated', handler);

    return () => {
      channel.unbind('AppNotificationCreated', handler);
      pusher.unsubscribe(channelName);
    };
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

    const channelName = `private-trip.${tripId}.negotiation`;
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
   * Subscribe to trip status updates (driver sees customer-side cancels in real time)
   * AND, optionally, the customer's live GPS pings — used by the driver-side map
   * to render a moving customer marker as the rider approaches the pickup pin.
   */
  subscribeTripStatus(
    tripId: number,
    onStatus: (p: TripStatusPayload) => void,
    onCustomerLocation?: (p: TripCustomerLocationPayload) => void,
    onShuttleManifest?: (p: ShuttleManifestPayload) => void
  ): () => void {
    const pusher = this.ensure();
    if (!pusher) return () => {};

    const channelName = `private-trip.${tripId}.tracking`;
    const channel = pusher.subscribe(channelName);

    const statusHandler = (data: TripStatusPayload) => onStatus(data);
    const custLocHandler = (data: TripCustomerLocationPayload) => onCustomerLocation?.(data);
    const manifestHandler = (data: ShuttleManifestPayload) => onShuttleManifest?.(data);

    channel.bind('TripStatusUpdated', statusHandler);
    if (onCustomerLocation) channel.bind('TripCustomerLocationUpdated', custLocHandler);
    if (onShuttleManifest) channel.bind('ShuttleManifestUpdated', manifestHandler);

    return () => {
      channel.unbind('TripStatusUpdated', statusHandler);
      if (onCustomerLocation) channel.unbind('TripCustomerLocationUpdated', custLocHandler);
      if (onShuttleManifest) channel.unbind('ShuttleManifestUpdated', manifestHandler);
      pusher.unsubscribe(channelName);
    };
  }
  subscribeFixedCatalog(
    onUpdated: (p: FixedRouteCatalogUpdatedPayload) => void,
  ): () => void {
    const pusher = this.ensure();
    if (!pusher) return () => {};

    const channelName = 'fixed.catalog';
    const channel = pusher.subscribe(channelName);
    const handler = (data: FixedRouteCatalogUpdatedPayload) => onUpdated(data);

    channel.bind('FixedRouteCatalogUpdated', handler);

    return () => {
      channel.unbind('FixedRouteCatalogUpdated', handler);
      pusher.unsubscribe(channelName);
    };
  }

  subscribeFixedCity(
    cityId: number,
    onUpdated: (p: FixedRouteCatalogUpdatedPayload) => void,
  ): () => void {
    const pusher = this.ensure();
    if (!pusher) return () => {};

    const channelName = 'fixed.city.' + cityId;
    const channel = pusher.subscribe(channelName);
    const handler = (data: FixedRouteCatalogUpdatedPayload) => onUpdated(data);

    channel.bind('FixedRouteCatalogUpdated', handler);

    return () => {
      channel.unbind('FixedRouteCatalogUpdated', handler);
      pusher.unsubscribe(channelName);
    };
  }

  subscribeFixedDriverHoldRequests(
    driverId: number,
    onRequested: (p: FixedSeatHoldRequestedPayload) => void,
  ): () => void {
    const pusher = this.ensure();
    if (!pusher) return () => {};

    const channelName = `private-driver.${driverId}`;
    const channel = pusher.subscribe(channelName);
    const handler = (data: FixedSeatHoldRequestedPayload) => onRequested(data);

    channel.bind('FixedSeatHoldRequested', handler);

    return () => {
      channel.unbind('FixedSeatHoldRequested', handler);
      pusher.unsubscribe(channelName);
    };
  }

  subscribeDepartureHoldRequests(
    departureId: number,
    onRequested: (p: FixedSeatHoldRequestedPayload) => void,
  ): () => void {
    const pusher = this.ensure();
    if (!pusher) return () => {};

    const channelName = `private-departure.${departureId}`;
    const channel = pusher.subscribe(channelName);
    const handler = (data: FixedSeatHoldRequestedPayload) => onRequested(data);

    channel.bind('FixedSeatHoldRequested', handler);

    return () => {
      channel.unbind('FixedSeatHoldRequested', handler);
      pusher.unsubscribe(channelName);
    };
  }
}

