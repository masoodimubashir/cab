import { Injectable } from '@angular/core';
import { Geolocation, PermissionStatus } from '@capacitor/geolocation';
import { DevLocationService } from './dev-location.service';

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

const MOCK_EMIT_INTERVAL_MS = 5000;

/**
 * Single chokepoint for geolocation across the customer app. In prod (or when
 * no dev override is set) it passes through to @capacitor/geolocation. In dev
 * with an override set, returns mocked coords from both the one-shot and
 * watch APIs so every page sees the same fake location.
 */
@Injectable({ providedIn: 'root' })
export class GeolocationService {
  private mockWatchers = new Map<string, ReturnType<typeof setInterval>>();
  private mockWatcherSeq = 0;

  constructor(private dev: DevLocationService) {}

  async requestPermissions(): Promise<PermissionStatus | null> {
    if (this.dev.get()) {
      return { location: 'granted', coarseLocation: 'granted' } as PermissionStatus;
    }
    try {
      return await Geolocation.requestPermissions();
    } catch {
      return null;
    }
  }

  /** Convenience used widely by the customer-book and trip-active screens. */
  async getCurrentPosition(): Promise<LatLng | null> {
    const override = this.dev.get();
    if (override) return { lat: override.lat, lng: override.lng };
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
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch {
      return this.browserFallback();
    }
  }

  /** Long-form fix (used by trip-active so it can render a heading-aware marker). */
  async getCurrentFix(): Promise<GeoFix | null> {
    const override = this.dev.get();
    if (override) return this.fixFromOverride(override);
    try {
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 8000,
      });
      return {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? null,
        speed: pos.coords.speed ?? null,
        bearing: pos.coords.heading ?? null,
        timestamp: pos.timestamp,
      };
    } catch {
      return null;
    }
  }

  async watchPosition(options: WatchOptions, callback: WatchCallback): Promise<string> {
    if (this.dev.get()) {
      return this.startMockWatch(callback);
    }
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
          callback(
            {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy ?? null,
              speed: pos.coords.speed ?? null,
              bearing: pos.coords.heading ?? null,
              timestamp: pos.timestamp,
            },
            null,
          );
        }
      },
    );
  }

  async clearWatch(id: string): Promise<void> {
    const mock = this.mockWatchers.get(id);
    if (mock) {
      clearInterval(mock);
      this.mockWatchers.delete(id);
      return;
    }
    try {
      await Geolocation.clearWatch({ id });
    } catch {
      /* ignore */
    }
  }

  private startMockWatch(callback: WatchCallback): string {
    const id = `mock-${++this.mockWatcherSeq}`;
    const emit = () => {
      const override = this.dev.get();
      if (!override) {
        const handle = this.mockWatchers.get(id);
        if (handle) clearInterval(handle);
        this.mockWatchers.delete(id);
        return;
      }
      callback(this.fixFromOverride(override), null);
    };
    emit();
    const handle = setInterval(emit, MOCK_EMIT_INTERVAL_MS);
    this.mockWatchers.set(id, handle);
    return id;
  }

  private fixFromOverride(override: { lat: number; lng: number }): GeoFix {
    return {
      lat: override.lat,
      lng: override.lng,
      accuracy: 5,
      speed: 0,
      bearing: null,
      timestamp: Date.now(),
    };
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
