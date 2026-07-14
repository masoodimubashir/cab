import { Injectable } from '@angular/core';
import Pusher from 'pusher-js';

export type DispatchDriverLocationPayload = {
  type: 'driver_location_updated';
  driver_id: number;
  trip_id: number | null;
  location: {
    driver_id: number;
    trip_id: number | null;
    lat: number;
    lng: number;
    accuracy_m?: number | null;
    speed_kmh?: number | null;
    bearing_deg?: number | null;
    recorded_at?: string | null;
  };
  driver?: {
    id: number;
    user_id: number;
    name: string | null;
    phone: string | null;
    vehicle_type: string | null;
    vehicle_reg_no: string | null;
    is_online: boolean;
  } | null;
};

export type FixedRouteCatalogUpdatedPayload = {
  type: 'fixed_route_catalog_updated';
  city_id: number;
  route_id: number | null;
  reason: string;
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

type ReverbConfig = {
  appKey: string;
  host: string;
  port: number;
  scheme: 'http' | 'https';
};

@Injectable({ providedIn: 'root' })
export class AdminRealtimeService {
  private pusher: Pusher | null = null;

  subscribeAppNotifications(userId: number, onCreated: (payload: AppNotificationPayload) => void): () => void {
    const pusher = this.ensure();
    if (!pusher) return () => {};

    const channelName = `private-App.Models.User.`;
    const channel = pusher.subscribe(channelName);
    const handler = (data: AppNotificationPayload) => onCreated(data);

    channel.bind('AppNotificationCreated', handler);

    return () => {
      channel.unbind('AppNotificationCreated', handler);
      pusher.unsubscribe(channelName);
    };
  }

  subscribeDispatchLocations(onLocation: (payload: DispatchDriverLocationPayload) => void): () => void {
    const pusher = this.ensure();
    if (!pusher) return () => {};

    const channelName = 'private-dispatch.live';
    const channel = pusher.subscribe(channelName);
    const handler = (data: DispatchDriverLocationPayload) => onLocation(data);

    channel.bind('DispatchDriverLocationUpdated', handler);

    return () => {
      channel.unbind('DispatchDriverLocationUpdated', handler);
      pusher.unsubscribe(channelName);
    };
  }

  subscribeFixedCatalog(onUpdated: (payload: FixedRouteCatalogUpdatedPayload) => void): () => void {
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

  private ensure(): Pusher | null {
    const cfg = this.config();
    if (!cfg.appKey) return null;
    if (this.pusher) return this.pusher;

    this.pusher = new Pusher(cfg.appKey, {
      wsHost: cfg.host,
      wsPort: cfg.port,
      wssPort: cfg.port,
      forceTLS: cfg.scheme === 'https',
      enabledTransports: ['ws', 'wss'],
      cluster: '',
      disableStats: true,
      authorizer: (channel: any) => ({
        authorize: (socketId: string, callback: (err: Error | null, data: any) => void) => {
          fetch(this.authEndpoint(), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              ...this.authHeader(),
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

  private config(): ReverbConfig {
    const apiBase = this.apiBase();
    const url = new URL(apiBase);
    const scheme = (localStorage.getItem('dreamcabs_reverb_scheme') as 'http' | 'https' | null)
      || (url.protocol === 'https:' ? 'https' : 'http');
    const defaultPort = scheme === 'https' ? 443 : 8080;

    return {
      appKey: localStorage.getItem('dreamcabs_reverb_app_key')?.trim() || '4jsb8ggrbvcriyaskojh',
      host: localStorage.getItem('dreamcabs_reverb_host')?.trim() || url.hostname,
      port: Number(localStorage.getItem('dreamcabs_reverb_port') || defaultPort),
      scheme,
    };
  }

  private apiBase(): string {
    return 'http://localhost:8000/api';
  }

  private authEndpoint(): string {
    return `${this.apiBase().replace(/\/api\/?$/i, '')}/broadcasting/auth`;
  }

  private authHeader(): Record<string, string> {
    const token = localStorage.getItem('dreamcabs_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
}
