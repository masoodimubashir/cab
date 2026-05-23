import { Injectable } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { ApiService } from './api.service';
import { GeolocationService } from './geolocation.service';

type Location = {
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number | null;
  bearing?: number | null;
  time?: number;
};

type WatcherOptions = {
  backgroundMessage?: string;
  backgroundTitle?: string;
  requestPermissions?: boolean;
  stale?: boolean;
  distanceFilter?: number;
};

type BackgroundGeolocationPlugin = {
  addWatcher(
    options: WatcherOptions,
    callback: (location: Location | null, error: any) => void
  ): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
  openSettings(): Promise<void>;
};

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');

@Injectable({ providedIn: 'root' })
export class BackgroundLocationService {
  private watcherId: string | null = null;
  private currentTripId: number | null = null;
  private webIntervalHandle: any = null;
  private lastSentAt = 0;
  private readonly minIntervalMs = 5000;

  constructor(private api: ApiService, private geo: GeolocationService) {}

  isStreaming(): boolean {
    return this.watcherId != null || this.webIntervalHandle != null;
  }

  async start(tripId: number): Promise<void> {
    if (this.isStreaming() && this.currentTripId === tripId) return;
    if (this.isStreaming()) await this.stop();

    this.currentTripId = tripId;

    if (Capacitor.isNativePlatform()) {
      this.watcherId = await BackgroundGeolocation.addWatcher(
        {
          backgroundTitle: 'DreamCabs is sharing your location',
          backgroundMessage: 'Your location is being shared with the rider during this trip.',
          requestPermissions: true,
          stale: false,
          distanceFilter: 5,
        },
        (location, error) => {
          if (error) {
            console.warn('BackgroundLocation error', error);
            return;
          }
          if (!location) return;
          this.postLocation(location);
        }
      );
    } else {
      // Web fallback: foreground-only via GeolocationService (honours dev override).
      const id = await this.geo.watchPosition(
        { enableHighAccuracy: true, maximumAge: 4000, timeout: 8000 },
        (fix, err) => {
          if (err || !fix) return;
          this.postLocation({
            latitude: fix.lat,
            longitude: fix.lng,
            accuracy: fix.accuracy ?? undefined,
            speed: fix.speed,
            bearing: fix.bearing,
            time: fix.timestamp,
          });
        }
      );
      this.webIntervalHandle = id;
    }
  }

  async stop(): Promise<void> {
    if (this.watcherId) {
      try {
        await BackgroundGeolocation.removeWatcher({ id: this.watcherId });
      } catch {
        /* ignore */
      }
      this.watcherId = null;
    }
    if (this.webIntervalHandle) {
      await this.geo.clearWatch(this.webIntervalHandle);
      this.webIntervalHandle = null;
    }
    this.currentTripId = null;
    this.lastSentAt = 0;
  }

  private postLocation(loc: Location): void {
    if (!this.currentTripId) return;
    const now = Date.now();
    if (now - this.lastSentAt < this.minIntervalMs) return;

    // Skip when essentially stationary to avoid hammering the endpoint.
    const speedKmh =
      loc.speed != null && Number.isFinite(loc.speed) ? Math.max(0, loc.speed) * 3.6 : null;

    this.lastSentAt = now;
    this.api
      .post(`/trips/${this.currentTripId}/location`, {
        lat: loc.latitude,
        lng: loc.longitude,
        accuracy_m: loc.accuracy ?? null,
        speed_kmh: speedKmh,
        bearing_deg: loc.bearing ?? null,
      })
      .subscribe({
        error: (err: any) => {
          // 409 means the trip is no longer in an active driver state — customer
          // cancelled, trip completed, or the driver lost it. Stop streaming.
          if (err?.status === 409) {
            void this.stop();
            return;
          }
          // 429 is the server-side dedupe (same trip+driver wrote <3s ago);
          // the last good location is still on file. Push lastSentAt forward
          // so we don't re-fire immediately and keep racing the server.
          if (err?.status === 429) {
            this.lastSentAt = Date.now();
            return;
          }
        },
      });
  }
}
