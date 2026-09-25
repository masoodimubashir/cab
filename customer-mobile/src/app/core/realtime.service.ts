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

export type DispatchRingDriver = {
  driver_id: number;
  name: string | null;
  vehicle: string | null;
  reg_no: string | null;
  lat: number | null;
  lng: number | null;
  distance_km: number | null;
};

export type DispatchRingExpandedPayload = {
  type: 'dispatch_ring_expanded';
  trip_id: number;
  hop: number;
  max_hops: number;
  radius_m: number;
  hop_interval_sec: number;
  eligible_drivers: number;
  drivers: DispatchRingDriver[];
};

export type TripLocationPayload = {
  type: 'location_updated';
  // The driver location is nested under `location` (matches the backend
  // TripLocationUpdated event, which broadcasts the DriverLocation row).
  location: {
    trip_id: number;
    lat: number;
    lng: number;
    accuracy_m?: number | null;
    speed_kmh?: number | null;
    bearing_deg?: number | null;
    recorded_at?: string;
  };
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

export type FixedRouteCatalogUpdatedPayload = {
  type: 'fixed_route_catalog_updated';
  city_id: number;
  route_id: number | null;
  reason: string;
};

export type AppBannerUpdatedPayload = {
  type: 'app_banner_updated';
  target_app: 'customer' | 'driver' | 'both';
  action: string;
  banner_id?: number | null;
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

export type FixedSeatHoldAcceptedPayload = {
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

export type FixedSeatHoldRejectedPayload = {
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
  reason?: string | null;
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

  subscribeNegotiation(
    tripId: number,
    onOffer: (p: NegotiationOfferPayload) => void,
    onLocked: (p: NegotiationLockedPayload) => void,
    onDispatchRing?: (p: DispatchRingExpandedPayload) => void
  ): () => void {
    const pusher = this.ensure();
    if (!pusher) return () => {};

    const channelName = `private-trip.${tripId}.negotiation`;
    const channel = pusher.subscribe(channelName);

    const offerHandler = (data: NegotiationOfferPayload) => onOffer(data);
    const lockedHandler = (data: NegotiationLockedPayload) => onLocked(data);
    const ringHandler = (data: DispatchRingExpandedPayload) => onDispatchRing?.(data);

    channel.bind('FareNegotiationOfferAdded', offerHandler);
    channel.bind('FareNegotiationLocked', lockedHandler);
    if (onDispatchRing) channel.bind('DispatchRingExpanded', ringHandler);

    // eslint-disable-next-line no-console
    channel.bind('pusher:subscription_succeeded', () => console.log('[realtime] subscribed to ' + channelName));
    // eslint-disable-next-line no-console
    channel.bind('pusher:subscription_error', (err: any) => console.error('[realtime] subscription_error on ' + channelName, err));

    return () => {
      channel.unbind('FareNegotiationOfferAdded', offerHandler);
      channel.unbind('FareNegotiationLocked', lockedHandler);
      if (onDispatchRing) channel.unbind('DispatchRingExpanded', ringHandler);
      pusher.unsubscribe(channelName);
    };
  }

  subscribeTracking(
    tripId: number,
    onLocation: (p: TripLocationPayload) => void,
    onStatus: (p: TripStatusPayload) => void,
    onCustomerLocation?: (p: TripCustomerLocationPayload) => void,
    onStartOtp?: () => void
  ): () => void {
    const pusher = this.ensure();
    if (!pusher) return () => {};

    const channelName = `private-trip.${tripId}.tracking`;
    const channel = pusher.subscribe(channelName);

    const locHandler = (data: TripLocationPayload) => onLocation(data);
    const statusHandler = (data: TripStatusPayload) => onStatus(data);
    const custLocHandler = (data: TripCustomerLocationPayload) => onCustomerLocation?.(data);
    // Signal-only: the driver just requested the start code — fetch it now.
    const startOtpHandler = () => onStartOtp?.();

    channel.bind('TripLocationUpdated', locHandler);
    channel.bind('TripStatusUpdated', statusHandler);
    if (onCustomerLocation) channel.bind('TripCustomerLocationUpdated', custLocHandler);
    // Both signals mean "your code is ready — fetch it now": StartOtpReady for the
    // private start-code, ShuttleBoardingCodeReady for a shuttle pool rider.
    if (onStartOtp) {
      channel.bind('StartOtpReady', startOtpHandler);
      channel.bind('ShuttleBoardingCodeReady', startOtpHandler);
    }

    return () => {
      channel.unbind('TripLocationUpdated', locHandler);
      channel.unbind('TripStatusUpdated', statusHandler);
      if (onCustomerLocation) channel.unbind('TripCustomerLocationUpdated', custLocHandler);
      if (onStartOtp) {
        channel.unbind('StartOtpReady', startOtpHandler);
        channel.unbind('ShuttleBoardingCodeReady', startOtpHandler);
      }
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

  subscribeFixedHold(
    holdId: number,
    onAccepted: (p: FixedSeatHoldAcceptedPayload) => void,
    onRejected: (p: FixedSeatHoldRejectedPayload) => void,
  ): () => void {
    const pusher = this.ensure();
    if (!pusher) return () => {};

    const channelName = `private-fixed-hold.${holdId}`;
    const channel = pusher.subscribe(channelName);
    const acceptHandler = (data: FixedSeatHoldAcceptedPayload) => onAccepted(data);
    const rejectHandler = (data: FixedSeatHoldRejectedPayload) => onRejected(data);

    channel.bind('FixedSeatHoldAccepted', acceptHandler);
    channel.bind('FixedSeatHoldRejected', rejectHandler);

    return () => {
      channel.unbind('FixedSeatHoldAccepted', acceptHandler);
      channel.unbind('FixedSeatHoldRejected', rejectHandler);
      pusher.unsubscribe(channelName);
    };
  }

  subscribeCustomerFixedHoldEvents(
    customerId: number,
    onAccepted: (p: FixedSeatHoldAcceptedPayload) => void,
    onRejected: (p: FixedSeatHoldRejectedPayload) => void,
  ): () => void {
    const pusher = this.ensure();
    if (!pusher) return () => {};

    const channelName = `private-customer.${customerId}`;
    const channel = pusher.subscribe(channelName);
    const acceptHandler = (data: FixedSeatHoldAcceptedPayload) => onAccepted(data);
    const rejectHandler = (data: FixedSeatHoldRejectedPayload) => onRejected(data);

    channel.bind('FixedSeatHoldAccepted', acceptHandler);
    channel.bind('FixedSeatHoldRejected', rejectHandler);

    return () => {
      channel.unbind('FixedSeatHoldAccepted', acceptHandler);
      channel.unbind('FixedSeatHoldRejected', rejectHandler);
      pusher.unsubscribe(channelName);
    };
  }

  subscribeAppBanners(
    onUpdated: (p: AppBannerUpdatedPayload) => void,
  ): () => void {
    const pusher = this.ensure();
    if (!pusher) return () => {};

    const channelName = 'app-banners';
    const channel = pusher.subscribe(channelName);
    const handler = (data: AppBannerUpdatedPayload) => onUpdated(data);

    channel.bind('AppBannerUpdated', handler);

    return () => {
      channel.unbind('AppBannerUpdated', handler);
      pusher.unsubscribe(channelName);
    };
  }
}

