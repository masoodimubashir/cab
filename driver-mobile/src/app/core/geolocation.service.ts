import { Injectable } from '@angular/core';
import { Geolocation, PermissionStatus } from '@capacitor/geolocation';

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

/**
 * Single chokepoint for geolocation across the driver app.
 * Passes straight through to @capacitor/geolocation.
 */
@Injectable({ providedIn: 'root' })
export class GeolocationService {
  async requestPermissions(): Promise<PermissionStatus | null> {
    try {
      return await Geolocation.requestPermissions();
    } catch {
      return null;
    }
  }

  async getCurrentPosition(options?: CurrentPositionOptions): Promise<GeoFix | null> {
    try {
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: options?.enableHighAccuracy ?? true,
        timeout: options?.timeout ?? 15000,
        maximumAge: options?.maximumAge ?? 3000,
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
    try {
      await Geolocation.clearWatch({ id });
    } catch {
      /* ignore */
    }
  }
}
