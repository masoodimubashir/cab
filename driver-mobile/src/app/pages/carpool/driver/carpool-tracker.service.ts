import { Injectable } from '@angular/core';
import { AlertController } from '@ionic/angular';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { AuthService } from '../../../core/auth.service';
import { locationWatchers } from '../../../core/location-watcher-registry';
import { CarpoolApiService } from '../carpool-api.service';
import { CarpoolListingStatus } from '../carpool.models';

type Fix = { latitude: number; longitude: number; accuracy?: number; speed?: number | null; bearing?: number | null; time?: number };

export interface CarpoolGeoPlugin {
  addWatcher(
    options: { backgroundTitle?: string; backgroundMessage?: string; requestPermissions?: boolean; stale?: boolean; distanceFilter?: number },
    callback: (location: Fix | null, error: any) => void,
  ): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
  openSettings(): Promise<void>;
}

/** The same background location plugin the commercial driver app uses; swapped out in tests. */
export const carpoolGeo = {
  native: (): boolean => Capacitor.isNativePlatform(),
  plugin: registerPlugin<CarpoolGeoPlugin>('BackgroundGeolocation') as CarpoolGeoPlugin,
};

/** idle: nothing to share. sharing: positions are going out. off: refused or turned off (mockup 9c). */
export type CarpoolTrackState = 'idle' | 'starting' | 'sharing' | 'off';

/**
 * L1.2: shares the driver's position from Start ride until the ride ends (mockup 9b). A carpool-only
 * copy of the commercial tracker's approach (same plugin, own watcher in the shared registry), so the
 * commercial `BackgroundLocationService` is not touched. Sends at most every 5 s, and resends the last
 * point every 10 s while the car stands still, so a driver waiting at a pickup still counts as sharing.
 */
@Injectable({ providedIn: 'root' })
export class CarpoolTrackerService {
  static readonly MIN_GAP_MS = 5000;
  static readonly KEEP_FRESH_MS = 10_000;

  state: CarpoolTrackState = 'idle';
  /** Why it is off: the driver said Not now, Android refused, or there is no background location here. */
  offReason: 'declined' | 'denied' | 'unsupported' | null = null;
  private retryNext = false;
  listingId: number | null = null;
  private watcherId: string | null = null;
  private lastFix: Fix | null = null;
  private lastSentAt = 0;
  private freshTimer: ReturnType<typeof setInterval> | null = null;
  private generation = 0;

  constructor(private carpool: CarpoolApiService, private auth: AuthService, private alerts: AlertController) {
    auth.registerSessionCleanup(() => this.stop());
  }

  /** Call with every fresh copy of a carpool the driver looks at: starts or stops sharing to match it. */
  async follow(l: { id: number; status: CarpoolListingStatus | string }): Promise<void> {
    if (l.status === 'in_progress') {
      if (this.listingId === l.id && this.state === 'off' && this.retryNext) {
        this.retryNext = false;
        await this.stop();
      }
      await this.start(l.id);
    }
    else if (this.listingId === l.id) await this.stop();
  }

  async start(id: number): Promise<void> {
    if (this.listingId === id && this.state !== 'idle') return;
    if (this.listingId !== null) await this.stop();
    const generation = ++this.generation;
    this.listingId = id;
    this.state = 'starting';
    if (!(await this.explained()) || generation !== this.generation) {
      if (generation === this.generation) this.off('declined');
      return;
    }
    if (!carpoolGeo.native()) {
      this.off('unsupported'); // the browser preview has no background location
      return;
    }
    try {
      const watcher = await locationWatchers.add(
        'carpool',
        () => carpoolGeo.plugin.addWatcher(
          {
            backgroundTitle: 'Sharing your location with your riders',
            backgroundMessage: 'Your riders see your car until you complete the ride.',
            requestPermissions: true,
            stale: false,
            distanceFilter: 5,
          },
          (loc, err) => this.onFix(generation, loc, err),
        ),
        (wid) => carpoolGeo.plugin.removeWatcher({ id: wid }),
      );
      if (generation !== this.generation) {
        await locationWatchers.remove('carpool', watcher);
        return;
      }
      this.watcherId = watcher;
      this.freshTimer = setInterval(() => this.keepFresh(generation), CarpoolTrackerService.KEEP_FRESH_MS);
    } catch {
      if (generation === this.generation) this.off('denied');
    }
  }

  async stop(): Promise<void> {
    ++this.generation;
    if (this.freshTimer) clearInterval(this.freshTimer);
    this.freshTimer = null;
    const watcher = this.watcherId;
    this.watcherId = null;
    this.listingId = null;
    this.lastFix = null;
    this.lastSentAt = 0;
    this.state = 'idle';
    this.offReason = null;
    if (watcher) await locationWatchers.remove('carpool', watcher);
  }

  /** "Turn on" on the ride page (9c): asks again after Not now, else opens the app's location setting. */
  async turnOn(): Promise<void> {
    const id = this.listingId;
    if (id === null) return;
    if (this.offReason === 'declined') {
      await this.stop();
      await this.start(id);
      return;
    }
    this.retryNext = true;
    await this.openSettings();
  }

  async openSettings(): Promise<void> {
    await carpoolGeo.plugin.openSettings();
  }

  private off(reason: 'declined' | 'denied' | 'unsupported'): void {
    this.state = 'off';
    this.offReason = reason;
  }

  private onFix(generation: number, loc: Fix | null, err: any): void {
    if (generation !== this.generation) return;
    if (err) {
      if (err.code === 'NOT_AUTHORIZED') this.off('denied');
      return;
    }
    if (!loc) return;
    this.state = 'sharing';
    this.offReason = null;
    this.lastFix = loc;
    if (Date.now() - this.lastSentAt < CarpoolTrackerService.MIN_GAP_MS) return;
    this.send(loc, Date.now());
  }

  private keepFresh(generation: number): void {
    if (generation !== this.generation || !this.lastFix) return;
    if (Date.now() - this.lastSentAt < CarpoolTrackerService.KEEP_FRESH_MS) return;
    this.send(this.lastFix, Date.now());
  }

  private send(loc: Fix, at: number): void {
    const id = this.listingId;
    if (id === null || !this.auth.getToken()) return;
    this.lastSentAt = Date.now();
    this.carpool.sendPosition(id, {
      lat: loc.latitude,
      lng: loc.longitude,
      accuracy: loc.accuracy ?? null,
      speed: loc.speed ?? null,
      heading: loc.bearing ?? null,
      at,
    }).subscribe({
      error: (e) => {
        // Not on the road any more (completed, cancelled), not this driver's, or signed out: stop.
        if ([401, 403, 404, 422].includes(e?.status)) void this.stop();
      },
    });
  }

  /** The app says why before Android asks, once per driver (Play's prominent disclosure). */
  private async explained(): Promise<boolean> {
    const key = `dc_cp_location_explained_${this.auth.getUser()?.id ?? 0}`;
    if (localStorage.getItem(key) === '1') return true;
    const alert = await this.alerts.create({
      header: 'Share your location during the ride',
      message: 'From Start ride until you complete the ride, Cabbies shares your location with the riders in this carpool, '
        + 'even when the app is closed. Riders see where your car is and when you reach their pickup. It stops when the ride ends.',
      buttons: [{ text: 'Not now', role: 'cancel' }, { text: 'Continue', role: 'confirm' }],
      backdropDismiss: false,
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'confirm') return false;
    localStorage.setItem(key, '1');
    return true;
  }
}
