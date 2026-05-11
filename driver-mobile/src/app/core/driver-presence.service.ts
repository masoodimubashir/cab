import { Injectable } from '@angular/core';
import { Geolocation } from '@capacitor/geolocation';
import { ApiService } from './api.service';

export type PresenceError =
  | { code: 'permission_denied'; message: string }
  | { code: 'position_unavailable'; message: string }
  | { code: 'timeout'; message: string }
  | { code: 'unknown'; message: string };

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
  private locatedListener: (() => void) | null = null;

  // Last error code we surfaced to the UI. We dedupe so the watcher's
  // repeated 20-second timeout doesn't flood the dashboard with the same
  // banner. Reset whenever we successfully send a position.
  private lastNotifiedErrorCode: PresenceError['code'] | null = null;
  // Suppress the very first timeout — the second-try low-accuracy attempt
  // usually succeeds, and "Trying again…" before any retry has happened
  // looks broken. Only escalate after a couple of consecutive timeouts.
  private consecutiveTimeouts = 0;

  constructor(private api: ApiService) {}

  isStreaming(): boolean {
    return this.watchId != null;
  }

  /** Fired whenever the watcher hits an error we couldn't recover from silently. */
  onError(listener: (err: PresenceError) => void): void {
    this.errorListener = listener;
  }

  /** Fired once per successful location ping — use it to clear UI error banners. */
  onLocated(listener: () => void): void {
    this.locatedListener = listener;
  }

  async start(): Promise<void> {
    if (this.watchId) return;
    this.highAccuracy = true;
    this.consecutiveTimeouts = 0;
    this.lastNotifiedErrorCode = null;

    try {
      await Geolocation.requestPermissions();
    } catch {
      // Web doesn't implement requestPermissions — watchPosition surfaces it.
    }

    // Immediate fix so the dispatcher sees a row before watchPosition's first tick.
    try {
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: this.highAccuracy,
        maximumAge: 0,
        timeout: 20000,
      });
      this.postLocation(pos);
    } catch (err) {
      this.handlePositionError(err, 'initial');
    }

    await this.attachWatcher();
  }

  async stop(): Promise<void> {
    if (!this.watchId) return;
    try {
      await Geolocation.clearWatch({ id: this.watchId });
    } catch {
      /* ignore */
    }
    this.watchId = null;
    this.lastSentAt = 0;
    this.lastNotifiedErrorCode = null;
    this.consecutiveTimeouts = 0;
  }

  private async attachWatcher(): Promise<void> {
    this.watchId = await Geolocation.watchPosition(
      { enableHighAccuracy: this.highAccuracy, maximumAge: 4000, timeout: 30000 },
      (pos, err) => {
        if (err) {
          this.handlePositionError(err, 'watch');
          return;
        }
        if (pos) this.postLocation(pos);
      },
    );
  }

  /**
   * Decodes a GeolocationPositionError, logs the actual code/message, surfaces
   * it to the UI, and applies the right recovery strategy:
   *   PERMISSION_DENIED (1)  → stop the watcher; only the user can re-enable.
   *   POSITION_UNAVAILABLE (2) / TIMEOUT (3) → if we were on high-accuracy, drop
   *     to low-accuracy and retry; otherwise keep waiting for the next watch tick.
   *
   * Errors are deduped — the watcher fires the same timeout every 30s and we
   * don't want the UI banner to flicker on every tick.
   */
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
      // Swallow the very first timeout silently — we're probably about to
      // retry at low accuracy and succeed. Only surface after a couple have
      // piled up so the user isn't seeing "Trying again…" right away.
      if (this.consecutiveTimeouts >= 2) {
        this.notifyError(decoded);
      }
    } else {
      this.notifyError(decoded);
    }

    // Desktop browsers without WiFi-positioning frequently fail with
    // POSITION_UNAVAILABLE under enableHighAccuracy. Retry once at low accuracy.
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
      try {
        await Geolocation.clearWatch({ id: this.watchId });
      } catch {
        /* ignore */
      }
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

  private postLocation(pos: {
    coords: {
      latitude: number;
      longitude: number;
      accuracy: number;
      speed: number | null;
      heading: number | null;
    };
  }): void {
    const now = Date.now();
    if (now - this.lastSentAt < this.minIntervalMs) return;
    this.lastSentAt = now;

    const speedKmh =
      pos.coords.speed != null && Number.isFinite(pos.coords.speed)
        ? Math.max(0, pos.coords.speed) * 3.6
        : null;
    const bearing =
      pos.coords.heading != null && Number.isFinite(pos.coords.heading)
        ? Math.round(pos.coords.heading)
        : null;

    this.api
      .post('/drivers/location', {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy_m: pos.coords.accuracy ?? null,
        speed_kmh: speedKmh,
        bearing_deg: bearing,
      })
      .subscribe({
        next: () => {
          // A fix came through — clear any prior error banner and reset the
          // timeout counter so the next slow tick won't re-trigger.
          this.consecutiveTimeouts = 0;
          if (this.lastNotifiedErrorCode) {
            this.lastNotifiedErrorCode = null;
            this.locatedListener?.();
          }
        },
        error: (err: any) => {
          if (err?.status !== 429) {
            console.warn('DriverPresence ping failed', err?.status, err?.error);
          }
        },
      });
  }
}
