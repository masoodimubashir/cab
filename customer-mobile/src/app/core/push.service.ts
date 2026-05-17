import { Injectable } from '@angular/core';
import { NavController } from '@ionic/angular';
import { Capacitor } from '@capacitor/core';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { ApiService } from './api.service';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class PushService {
  private currentToken: string | null = null;
  private listenersBound = false;

  constructor(private api: ApiService, private nav: NavController) {}

  async registerForUser(): Promise<void> {
    try {
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
      this.api
        .post('/me/device-tokens', { platform, token })
        .subscribe({ error: () => {} });
    } catch (e) {
      console.warn('PushService.registerForUser failed', e);
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

    FirebaseMessaging.addListener('tokenReceived', (event) => {
      const token = event.token;
      if (!token || token === this.currentToken) return;
      this.currentToken = token;
      this.api
        .post('/me/device-tokens', { platform: Capacitor.getPlatform(), token })
        .subscribe({ error: () => {} });
    });

    FirebaseMessaging.addListener('notificationActionPerformed', (event) => {
      const data = (event.notification?.data || {}) as Record<string, unknown>;
      const tripId = data['trip_id'];
      if (tripId != null) {
        this.nav.navigateForward(`/customer-tabs/trip/${tripId}`);
      }
    });

    FirebaseMessaging.addListener('notificationReceived', () => {
      // Foreground: the app is open. The realtime channel typically already updated UI;
      // we intentionally leave this silent rather than firing duplicate toasts.
    });
  }
}
