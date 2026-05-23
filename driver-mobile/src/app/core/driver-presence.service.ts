import { Injectable } from '@angular/core';
import { ApiService } from './api.service';
import { GeoFix, GeolocationService } from './geolocation.service';

export type PresenceError =
  | { code: 'permission_denied'; message: string }
  | { code: 'position_unavailable'; message: string }
  | { code: 'timeout'; message: string }
  | { code: 'unknown'; message: string };

export interface PresenceFix {
  lat: number;
  lng: number;
  accuracy: number | null;
  speedKmh: number | null;
  bearing: number | null;
}

/**
 * Streams the driver's location to the backend whenever they're online,
 * outside of an active trip. Trip-time pings still go through
 * BackgroundLocationService (which is trip-scoped).
 *
 * Without this, drivers show as "Inactive" on the dispatch console — the
 * snapshot only marks a driver "Free" when both `is_online=true` AND there's
 * a fresh driver_locations row in the last 5 minutes.
 */
@Injectable({ providedIn: 'root' })
export class DriverPresenceService {
  private watchId: string | null = null;
  private lastSentAt = 0;
  private readonly minIntervalMs = 10000;
  private highAccuracy = true;
  private errorListener: ((err: PresenceError) => void) | null = null;
  private locatedListener: ((fix: PresenceFix) => void) | null = null;

  private lastNotifiedErrorCode: PresenceError['code'] | null = null;
  private consecutiveTimeouts = 0;

  constructor(private api: ApiService, private geo: GeolocationService) {}

  isStreaming(): boolean {
    return this.watchId != null;
  }

  onError(listener: (err: PresenceError) => void): void {
    this.errorListener = listener;
  }

  onLocated(listener: (fix: PresenceFix) => void): void {
    this.locatedListener = listener;
  }

  async start(): Promise<void> {
    if (this.watchId) return;
    this.highAccuracy = true;
    this.consecutiveTimeouts = 0;
    this.lastNotifiedErrorCode = null;

    await this.geo.requestPermissions();

    try {
      const fix = await this.geo.getCurrentPosition({
        enableHighAccuracy: this.highAccuracy,
        maximumAge: 0,
        timeout: 20000,
      });
      this.notifyLocated(fix);
      this.postLocation(fix);
    } catch (err) {
      this.handlePositionError(err, 'initial');
    }

    await this.attachWatcher();
  }

  async stop(): Promise<void> {
    if (!this.watchId) return;
    await this.geo.clearWatch(this.watchId);
    this.watchId = null;
    this.lastSentAt = 0;
    this.lastNotifiedErrorCode = null;
    this.consecutiveTimeouts = 0;
  }

  private async attachWatcher(): Promise<void> {
    this.watchId = await this.geo.watchPosition(
      { enableHighAccuracy: this.highAccuracy, maximumAge: 4000, timeout: 30000 },
      (fix, err) => {
        if (err) {
          this.handlePositionError(err, 'watch');
          return;
        }
        if (fix) {
          this.notifyLocated(fix);
          this.postLocation(fix);
        }
      },
    );
  }

  private notifyLocated(fix: GeoFix): void {
    if (!this.locatedListener) return;
    const speedKmh =
      fix.speed != null && Number.isFinite(fix.speed) ? Math.max(0, fix.speed) * 3.6 : null;
    const bearing =
      fix.bearing != null && Number.isFinite(fix.bearing) ? Math.round(fix.bearing) : null;
    this.locatedListener({
      lat: fix.lat,
      lng: fix.lng,
      accuracy: fix.accuracy,
      speedKmh,
      bearing,
    });
  }

  private handlePositionError(err: unknown, source: 'initial' | 'watch'): void {
    const decoded = this.decodeGeoError(err);
    console.warn(`DriverPresence ${source} error`, decoded.code, decoded.message, err);

    if (decoded.code === 'permission_denied') {
      this.notifyError(decoded);
      void this.stop();
      return;
    }

    if (decoded.code === 'timeout') {
      this.consecutiveTimeouts += 1;
      if (this.consecutiveTimeouts >= 2) {
        this.notifyError(decoded);
      }
    } else {
      this.notifyError(decoded);
    }

    if (this.highAccuracy && (decoded.code === 'position_unavailable' || decoded.code === 'timeout')) {
      this.highAccuracy = false;
      void this.restartWatcher();
    }
  }

  private notifyError(err: PresenceError): void {
    if (this.lastNotifiedErrorCode === err.code) return;
    this.lastNotifiedErrorCode = err.code;
    this.errorListener?.(err);
  }

  private async restartWatcher(): Promise<void> {
    if (this.watchId) {
      await this.geo.clearWatch(this.watchId);
      this.watchId = null;
    }
    await this.attachWatcher();
  }

  private decodeGeoError(err: unknown): PresenceError {
    const code = (err as { code?: number })?.code;
    const message = (err as { message?: string })?.message || 'Unknown geolocation error';
    if (code === 1) return { code: 'permission_denied', message: 'Location permission denied. Enable it in your browser/OS settings to receive rides.' };
    if (code === 2) return { code: 'position_unavailable', message: 'Could not determine your location. Check that location services are enabled.' };
    if (code === 3) return { code: 'timeout', message: 'Still trying to get a GPS fix — move to a spot with a clearer view of the sky.' };
    return { code: 'unknown', message };
  }

  private postLocation(fix: GeoFix): void {
    const now = Date.now();
    if (now - this.lastSentAt < this.minIntervalMs) return;
    this.lastSentAt = now;

    const speedKmh =
      fix.speed != null && Number.isFinite(fix.speed) ? Math.max(0, fix.speed) * 3.6 : null;
    const bearing =
      fix.bearing != null && Number.isFinite(fix.bearing) ? Math.round(fix.bearing) : null;

    this.api
      .post('/drivers/location', {
        lat: fix.lat,
        lng: fix.lng,
        accuracy_m: fix.accuracy,
        speed_kmh: speedKmh,
        bearing_deg: bearing,
      })
      .subscribe({
        next: () => {
          this.consecutiveTimeouts = 0;
          this.lastNotifiedErrorCode = null;
        },
        error: (err: any) => {
          if (err?.status !== 429) {
            console.warn('DriverPresence ping failed', err?.status, err?.error);
          }
        },
      });
  }
}
