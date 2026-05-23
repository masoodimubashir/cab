import { Injectable } from '@angular/core';
import { Geolocation, PermissionStatus, Position } from '@capacitor/geolocation';
import { DevLocationService } from './dev-location.service';

export interface GeoFix {
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;
  bearing: number | null;
  timestamp: number;
}

export type WatchCallback = (fix: GeoFix | null, err: unknown) => void;

interface CurrentPositionOptions {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
}

interface WatchOptions extends CurrentPositionOptions {}

const MOCK_EMIT_INTERVAL_MS = 5000;

/**
 * Single chokepoint for geolocation across the driver app.
 *
 * - In production builds (or when no dev override is set) it passes straight
 *   through to @capacitor/geolocation, so behaviour on real devices and on
 *   production browsers is unchanged.
 * - In non-production builds with a DevLocationService override set, it
 *   returns the overridden coords from getCurrentPosition() and emits them on
 *   a fixed interval from watchPosition(). Override changes are picked up
 *   live — watchers re-emit the new coords without needing a re-subscribe.
 *
 * Why one wrapper instead of editing each callsite: there are 6+ places that
 * read GPS (presence, background pings, dashboard map, login city detect,
 * intro permission prompt, rides SOS). Routing them all through here keeps
 * the override consistent and lets us add cross-cutting logic (e.g. logging)
 * in one spot.
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
      // Web doesn't implement requestPermissions — the browser prompts lazily
      // on the first getCurrentPosition call instead.
      return null;
    }
  }

  async checkPermissions(): Promise<PermissionStatus | null> {
    if (this.dev.get()) {
      return { location: 'granted', coarseLocation: 'granted' } as PermissionStatus;
    }
    try {
      return await Geolocation.checkPermissions();
    } catch {
      return null;
    }
  }

  async getCurrentPosition(options: CurrentPositionOptions = {}): Promise<GeoFix> {
    const override = this.dev.get();
    if (override) {
      return this.fixFromOverride(override);
    }
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: options.enableHighAccuracy ?? true,
      timeout: options.timeout ?? 15000,
      maximumAge: options.maximumAge ?? 0,
    });
    return this.fixFromPosition(pos);
  }

  /**
   * Subscribe to position updates. Returns an opaque id usable with
   * clearWatch(). The callback fires immediately with the current override
   * (if any), then on each Capacitor tick OR on each mock interval.
   */
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
        if (pos) callback(this.fixFromPosition(pos), null);
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
        // Override was cleared while we were watching — caller will likely
        // restart the watch via their own retry path. Stop emitting from here.
        const handle = this.mockWatchers.get(id);
        if (handle) clearInterval(handle);
        this.mockWatchers.delete(id);
        return;
      }
      callback(this.fixFromOverride(override), null);
    };
    // Fire once immediately so subscribers don't wait MOCK_EMIT_INTERVAL_MS
    // for their first tick — mirrors how real GPS often delivers a cached fix.
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

  private fixFromPosition(pos: Position): GeoFix {
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy ?? null,
      speed: pos.coords.speed ?? null,
      bearing: pos.coords.heading ?? null,
      timestamp: pos.timestamp,
    };
  }
}
