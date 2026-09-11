import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { AuthService } from './auth.service';
import { ApiService } from './api.service';
import { GeoFix, GeolocationService } from './geolocation.service';

type Location = {
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number | null;
  bearing?: number | null;
  time?: number;
};

export type FixedLocationState = {
  streaming: boolean;
  degraded: boolean;
  message: string | null;
};


@Injectable({ providedIn: 'root' })
export class FixedCustomerLocationService {
  private generation = 0;
  private webWatchId: string | null = null;
  private lastSentAt = 0;
  private startedAt = 0;
  private readonly minIntervalMs = 3000;
  private readonly maxSessionMs = 6 * 60 * 60 * 1000;
  private readonly stateSubject = new BehaviorSubject<FixedLocationState>({ streaming: false, degraded: false, message: null });
  readonly state$ = this.stateSubject.asObservable();

  constructor(private api: ApiService, private geo: GeolocationService, private auth: AuthService) {
    auth.registerSessionCleanup(() => this.stop());
  }

  isStreaming(): boolean {
    return this.webWatchId !== null;
  }

  async start(): Promise<void> {
    if (this.isStreaming()) return;
    this.startedAt = Date.now();
    this.publishState(false, null);

    await this.startForegroundWatch(null);
  }

  async stop(): Promise<void> {
    ++this.generation;
    if (this.webWatchId) {
      await this.geo.clearWatch(this.webWatchId);
      this.webWatchId = null;
    }
    this.lastSentAt = 0;
    this.startedAt = 0;
    this.publishState(false, null);
  }

  private async startForegroundWatch(message: string | null): Promise<void> {
    const generation = this.generation;
    try {
      await this.geo.requestPermissions();
      const id = await this.geo.watchPosition(
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
        (fix, err) => {
          if (err) {
            this.publishState(true, 'Location tracking is unavailable. Fixed pickup status may be less accurate.');
            return;
          }
          if (fix) this.postFix(fix);
        },
      );
      if (generation !== this.generation || !this.auth.getToken()) {
        await this.geo.clearWatch(id);
        return;
      }
      this.webWatchId = id;
      this.publishState(!!message, message);
    } catch {
      this.publishState(true, 'Location permission is denied. Fixed pickup/no-show checks may be less accurate.');
    }
  }

  private publishState(degraded: boolean, message: string | null): void {
    this.stateSubject.next({ streaming: this.isStreaming(), degraded, message });
  }

  private postFix(fix: GeoFix): void {
    this.postLocation({
      latitude: fix.lat,
      longitude: fix.lng,
      accuracy: fix.accuracy ?? undefined,
      speed: fix.speed,
      bearing: fix.bearing,
      time: fix.timestamp,
    });
  }

  private postLocation(location: Location): void {
    if (!this.auth.getToken() || document.visibilityState === 'hidden') return;
    const now = Date.now();
    if (this.startedAt && now - this.startedAt > this.maxSessionMs) {
      void this.stop();
      return;
    }
    if (now - this.lastSentAt < this.minIntervalMs) return;
    this.lastSentAt = now;

    this.api.post('/me/location', { lat: location.latitude, lng: location.longitude }).subscribe({
      error: (err: any) => {
        if (err?.status === 401 || err?.status === 403) void this.stop();
      },
    });
  }
}
