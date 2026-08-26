import { Injectable } from '@angular/core';
import { Geolocation, PermissionStatus } from '@capacitor/geolocation';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';

export type LatLng = { lat: number; lng: number };

export interface GeoFix extends LatLng {
  accuracy: number | null;
  speed: number | null;
  bearing: number | null;
  timestamp: number;
}

export type WatchCallback = (fix: GeoFix | null, err: unknown) => void;

interface WatchOptions {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
}

/**
 * Single chokepoint for geolocation across the customer app.
 * Passes straight through to @capacitor/geolocation with browser fallback.
 */
@Injectable({ providedIn: 'root' })
export class GeolocationService {
  private lastLocationPingAt = 0;

  constructor(
    private api: ApiService,
    private auth: AuthService,
  ) {}

  private syncUserLocation(lat: number, lng: number): void {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const now = Date.now();
    if (now - this.lastLocationPingAt < 3000) return;
    if (!this.auth.getToken()) return;
    this.lastLocationPingAt = now;
    this.api.post('/me/location', { lat, lng }).subscribe({
      error: () => {},
    });
  }

  async requestPermissions(): Promise<PermissionStatus | null> {
    try {
      return await Geolocation.requestPermissions();
    } catch {
      return null;
    }
  }

  /** Convenience used widely by the customer-book and trip-active screens. */
  async getCurrentPosition(): Promise<LatLng | null> {
    try {
      const perm = await Geolocation.checkPermissions();
      if (perm.location !== 'granted') {
        const req = await Geolocation.requestPermissions();
        if (req.location !== 'granted') return this.browserFallback();
      }
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 8000,
      });
      const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      this.syncUserLocation(coords.lat, coords.lng);
      return coords;
    } catch {
      return this.browserFallback();
    }
  }

  /** Long-form fix (used by trip-active so it can render a heading-aware marker). */
  async getCurrentFix(): Promise<GeoFix | null> {
    try {
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 8000,
      });
      const fix: GeoFix = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? null,
        speed: pos.coords.speed ?? null,
        bearing: pos.coords.heading ?? null,
        timestamp: pos.timestamp,
      };
      this.syncUserLocation(fix.lat, fix.lng);
      return fix;
    } catch {
      return null;
    }
  }

  async watchPosition(options: WatchOptions, callback: WatchCallback): Promise<string> {
    return Geolocation.watchPosition(
      {
        enableHighAccuracy: options.enableHighAccuracy ?? true,
        timeout: options.timeout ?? 30000,
        maximumAge: options.maximumAge ?? 4000,
      },
      (pos, err) => {
        if (err) {
          callback(null, err);
          return;
        }
        if (pos) {
          const fix: GeoFix = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? null,
            speed: pos.coords.speed ?? null,
            bearing: pos.coords.heading ?? null,
            timestamp: pos.timestamp,
          };
          this.syncUserLocation(fix.lat, fix.lng);
          callback(fix, null);
        }
      },
    );
  }

  async clearWatch(id: string): Promise<void> {
    try {
      await Geolocation.clearWatch({ id });
    } catch {
      /* ignore */
    }
  }

  private browserFallback(): Promise<LatLng | null> {
    return new Promise((resolve) => {
      if (!('geolocation' in navigator)) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 }
      );
    });
  }
}
