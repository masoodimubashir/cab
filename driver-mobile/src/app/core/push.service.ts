import { Injectable } from '@angular/core';
import { NavController } from '@ionic/angular';
import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { App as CapacitorApp } from '@capacitor/app';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { PushNotifications } from '@capacitor/push-notifications';
import { ApiService } from './api.service';
import { AudioRingtoneService } from './audio-ringtone.service';
import { environment } from '../../environments/environment';

/** Real device name + OS version + app version for the admin detail pages. */
export interface DeviceDetails {
  device_type?: string;
  os_version?: string;
  app_version?: string;
}

/**
 * Reads the real device name (manufacturer + model, e.g. "samsung SM-G991B"),
 * OS version (e.g. "Android 14") and app version via the Capacitor Device/App
 * plugins. Every field is best-effort — failures just leave it unset.
 */
export async function gatherDeviceDetails(): Promise<DeviceDetails> {
  const out: DeviceDetails = {};
  try {
    const d = await Device.getInfo();
    const name = [d.manufacturer, d.model]
      .map((s) => (s || '').trim())
      .filter(Boolean)
      .join(' ')
      .trim();
    if (name) out.device_type = name.slice(0, 64);

    const osName =
      d.operatingSystem === 'ios'
        ? 'iOS'
        : d.operatingSystem
          ? d.operatingSystem.charAt(0).toUpperCase() + d.operatingSystem.slice(1)
          : '';
    const os = [osName, d.osVersion].filter(Boolean).join(' ').trim();
    if (os) out.os_version = os.slice(0, 32);
  } catch {
    /* ignore — leave device fields unset */
  }
  try {
    if (Capacitor.isNativePlatform()) {
      const app = await CapacitorApp.getInfo();
      if (app?.version) out.app_version = String(app.version).slice(0, 32);
    }
  } catch {
    /* ignore */
  }
  return out;
}

@Injectable({ providedIn: 'root' })
export class PushService {
  private currentToken: string | null = null;
  private listenersBound = false;

  constructor(
    private api: ApiService,
    private nav: NavController,
    private ringtone: AudioRingtoneService,
  ) {}

  async registerForUser(): Promise<void> {
    try {
      if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
        try {
          await PushNotifications.createChannel({
            id: 'ride_requests',
            name: 'Ride & Seat Requests',
            description: 'Incoming passenger ride & seat requests',
            importance: 5,
            visibility: 1,
            sound: 'default',
            vibration: true,
            lights: true,
            lightColor: '#10B981',
          });
        } catch (e) {
          console.warn('PushNotifications.createChannel failed', e);
        }
      }

      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
        try {
          await Notification.requestPermission();
        } catch {}
      }

      const perm = await FirebaseMessaging.requestPermissions();
      if (perm.receive !== 'granted') return;

      this.bindListenersOnce();

      const platform = Capacitor.getPlatform();
      const opts =
        platform === 'web' && environment.fcmVapidKey
          ? { vapidKey: environment.fcmVapidKey }
          : undefined;

      const { token } = await FirebaseMessaging.getToken(opts as any);
      if (!token) return;

      this.currentToken = token;
      const device = await gatherDeviceDetails();
      this.api
        .post('/me/device-tokens', { platform, token, ...device })
        .subscribe({ error: () => {} });
    } catch (e) {
      console.warn('PushService.registerForUser failed', e);
    }
  }

  /**
   * Display a local / browser pop-up notification when an incoming request arrives.
   */
  async showLocalNotification(title: string, body: string, data: Record<string, any> = {}): Promise<void> {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        try {
          const n = new Notification(title, {
            body,
            icon: '/assets/icon/icon.png',
            tag: data['hold_id'] ? `hold-${data['hold_id']}` : 'ride-request',
            requireInteraction: true,
          });
          n.onclick = () => {
            window.focus();
            if (data['hold_id'] || data['departure_id']) {
              this.nav.navigateForward(`/tabs/fixed-driver`, {
                queryParams: { departure: data['departure_id'], hold: data['hold_id'] },
              });
            } else if (data['trip_id']) {
              this.nav.navigateForward(`/tabs/rides`, {
                queryParams: { trip: data['trip_id'] },
              });
            }
          };
        } catch (e) {
          console.warn('Web notification display failed', e);
        }
      } else if (Notification.permission === 'default') {
        void Notification.requestPermission();
      }
    }
  }

  /**
   * Reports the device name + OS + app version on login, independent of
   * notification permission (uses /me/device-info, no push token). Best-effort.
   */
  async reportDeviceInfo(): Promise<void> {
    try {
      const device = await gatherDeviceDetails();
      if (device.device_type || device.os_version || device.app_version) {
        this.api.post('/me/device-info', device).subscribe({ error: () => {} });
      }
    } catch {
      /* ignore */
    }
  }

  async unregister(): Promise<void> {
    if (!this.currentToken) return;
    const token = this.currentToken;
    this.currentToken = null;
    try {
      await this.api.delete(`/me/device-tokens/${encodeURIComponent(token)}`).toPromise();
    } catch {
      /* ignore */
    }
    try {
      await FirebaseMessaging.deleteToken();
    } catch {
      /* ignore */
    }
  }

  private bindListenersOnce(): void {
    if (this.listenersBound) return;
    this.listenersBound = true;

    FirebaseMessaging.addListener('tokenReceived', async (event) => {
      const token = event.token;
      if (!token || token === this.currentToken) return;
      this.currentToken = token;
      const device = await gatherDeviceDetails();
      this.api
        .post('/me/device-tokens', { platform: Capacitor.getPlatform(), token, ...device })
        .subscribe({ error: () => {} });
    });

    FirebaseMessaging.addListener('notificationActionPerformed', (event) => {
      const data = (event.notification?.data || {}) as Record<string, unknown>;
      const tripId = data['trip_id'];
      const departureId = data['departure_id'] || data['route_departure_id'];
      const holdId = data['hold_id'];
      const type = data['type'];

      if (type === 'fixed_seat_requested' || holdId != null || departureId != null) {
        this.nav.navigateForward(`/tabs/fixed-driver`, {
          queryParams: { departure: departureId, hold: holdId },
        });
      } else if (tripId != null) {
        this.nav.navigateForward(`/tabs/rides`, {
          queryParams: { trip: tripId },
        });
      }
    });

    FirebaseMessaging.addListener('notificationReceived', (event) => {
      const data = (event.notification?.data || {}) as Record<string, unknown>;
      const type = data['type'];
      const holdId = data['hold_id'];
      const expiresAt = data['expires_at'] as string | undefined;

      if (type === 'fixed_seat_requested' || holdId != null) {
        let remainingSec = 60;
        if (expiresAt) {
          const diff = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
          if (diff <= 0) {
            return; // Already expired, do not ring
          }
          remainingSec = Math.min(diff, 60);
        }
        this.ringtone.startRinging('push-seat-hold-' + (holdId || ''), remainingSec);
      }
    });
  }
}

