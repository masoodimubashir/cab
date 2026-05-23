import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { DriverPresenceService, PresenceFix } from '../../core/driver-presence.service';
import { GeolocationService } from '../../core/geolocation.service';
import { MapsLoaderService } from '../../core/maps-loader.service';

declare const google: any;

/**
 * Driver Dashboard
 * ----------------
 * - Full-screen Google Map fills the page.
 * - A sticky "Go Online" / "Go Offline" button sits at the bottom.
 * - Clicking Go Online triggers the OS location permission prompt, fetches the
 *   driver's current position, plots them on the map, and starts the presence
 *   stream (POST /drivers/go-online + a running POST /drivers/location feed).
 */
@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.scss'],
  standalone: false,
})
export class DashboardPage implements AfterViewInit, OnDestroy {
  @ViewChild('mapDiv', { static: false }) mapDiv!: ElementRef<HTMLDivElement>;

  loading = false;
  toggling = false;
  error: string | null = null;
  driver: Record<string, unknown> | null = null;

  private map: any | null = null;
  private selfMarker: any | null = null;
  // Default map centre (Mumbai) until we have a real fix.
  private readonly defaultCentre = { lat: 19.0760, lng: 72.8777 };

  constructor(
    private api: ApiService,
    public auth: AuthService,
    private presence: DriverPresenceService,
    private mapsLoader: MapsLoaderService,
    private geo: GeolocationService,
  ) {
    this.presence.onError((err) => {
      this.error = err.message;
    });
    this.presence.onLocated((fix) => {
      // Every GPS fix from the watcher lands here — push it straight onto the
      // map so the driver sees themselves move in real time. No re-fetching.
      this.applyFixToMap(fix);
      if (this.error && this.error.toLowerCase().includes('gps')) {
        this.error = null;
      }
    });
  }

  ionViewWillEnter(): void {
    this.refresh();
  }

  async ngAfterViewInit(): Promise<void> {
    try {
      await this.mapsLoader.ensureLoaded();
      this.initMap();
    } catch (e) {
      this.error = (e as Error).message;
    }
  }

  ngOnDestroy(): void {
    // Leave the presence watcher alive across page transitions — only stop it
    // explicitly on Go Offline / logout.
  }

  private initMap(): void {
    if (!this.mapDiv?.nativeElement || this.map) return;
    this.map = new google.maps.Map(this.mapDiv.nativeElement, {
      center: this.defaultCentre,
      zoom: 13,
      // mapId is required for AdvancedMarkerElement to render. DEMO_MAP_ID is
      // Google's public test id; replace with a styled mapId from the Cloud
      // Console for production map theming.
      mapId: 'DEMO_MAP_ID',
      disableDefaultUI: true,
      gestureHandling: 'greedy',
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });

    // Ionic's view transitions can render the map container at 0×0 the first
    // tick. Once the page is fully laid out, Google Maps needs an explicit
    // resize trigger or tiles stay blank.
    setTimeout(() => {
      if (this.map) {
        google.maps.event.trigger(this.map, 'resize');
        this.map.setCenter(this.defaultCentre);
      }
    }, 300);
  }

  /**
   * Wait until the map exists. ngAfterViewInit fires later than ionViewWillEnter,
   * so a click on "Go Online" can land before the map is ready.
   */
  private waitForMap(timeoutMs = 5000): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.map) return resolve(true);
      const start = Date.now();
      const tick = () => {
        if (this.map) return resolve(true);
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  refresh(): void {
    this.loading = true;
    this.error = null;
    this.api.get<{ driver: Record<string, unknown> | null; user: { role?: string } }>('/drivers/me').subscribe({
      next: (res) => {
        this.driver = res.driver;
        if (res.user?.role) {
          this.auth.updateUser({ role: res.user.role });
        }
        // App might have been reloaded while online — resume the presence
        // stream so the dispatcher continues to see us as Free, and place
        // ourselves on the map.
        if (this.driver?.['is_online']) {
          if (!this.presence.isStreaming()) {
            void this.presence.start();
          }
          void this.refreshMarkerFromCurrentPosition();
        }
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load driver profile';
        this.driver = null;
      },
      complete: () => {
        this.loading = false;
      },
    });
  }

  /**
   * Go Online flow:
   *  1. Request OS location permission (Capacitor Geolocation).
   *  2. Tell the backend the driver is online (/drivers/go-online).
   *  3. Start the presence stream — getCurrentPosition + watchPosition under the hood.
   *  4. Drop a marker on the map at the current fix and recentre.
   *
   * The first three steps are existing infrastructure; the map marker is new.
   */
  async goOnline(): Promise<void> {
    if (this.toggling) return;
    this.toggling = true;
    this.error = null;

    try {
      // 1. Permission. On native this opens the OS dialog; on web the prompt
      //    is shown by getCurrentPosition shortly after.
      await this.geo.requestPermissions();

      // 2. Backend "I'm online" flip.
      await new Promise<void>((resolve, reject) => {
        this.api.post<{ driver: Record<string, unknown> }>('/drivers/go-online', {}).subscribe({
          next: (res) => { this.driver = res.driver; resolve(); },
          error: (err) => reject(new Error(err?.error?.message || 'Could not go online')),
        });
      });

      // 3. Start streaming location to the dispatcher.
      await this.presence.start();

      // 4. Wait for the map container to exist, then resize + centre on the
      //    current fix. This is the "refresh" the driver expects.
      await this.waitForMap();
      if (this.map) {
        google.maps.event.trigger(this.map, 'resize');
      }
      await this.refreshMarkerFromCurrentPosition();
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.toggling = false;
    }
  }

  async goOffline(): Promise<void> {
    if (this.toggling) return;
    this.toggling = true;
    this.error = null;

    try {
      await new Promise<void>((resolve, reject) => {
        this.api.post<{ driver: Record<string, unknown> }>('/drivers/go-offline', {}).subscribe({
          next: (res) => { this.driver = res.driver; resolve(); },
          error: (err) => reject(new Error(err?.error?.message || 'Could not go offline')),
        });
      });
      await this.presence.stop();
      if (this.selfMarker) {
        this.selfMarker.map = null;
        this.selfMarker = null;
      }
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.toggling = false;
    }
  }

  /**
   * One-shot fetch used by Go Online — we want the marker to appear immediately
   * rather than waiting for the watcher's first tick. Subsequent updates flow
   * through applyFixToMap() driven by presence.onLocated.
   */
  private async refreshMarkerFromCurrentPosition(): Promise<void> {
    if (!this.map) return;
    try {
      const fix = await this.geo.getCurrentPosition({
        enableHighAccuracy: true,
        maximumAge: 4000,
        timeout: 15000,
      });
      this.applyFixToMap({
        lat: fix.lat,
        lng: fix.lng,
        accuracy: fix.accuracy,
        speedKmh: null,
        bearing: null,
      });
    } catch (e) {
      this.error = `Could not read GPS: ${(e as Error)?.message || 'permission denied'}`;
    }
  }

  /**
   * Single source of truth for "put the driver on the map" — used by the
   * initial Go-Online fix and by every continuous watcher tick.
   *
   * Uses AdvancedMarkerElement (the supported replacement for the deprecated
   * google.maps.Marker). The marker content is a small DOM dot we build once
   * and re-use — only the `position` property changes on each tick.
   */
  private applyFixToMap(fix: PresenceFix): void {
    if (!this.map) return;
    const latLng = { lat: fix.lat, lng: fix.lng };
    if (!this.selfMarker) {
      this.selfMarker = new google.maps.marker.AdvancedMarkerElement({
        map: this.map,
        position: latLng,
        title: 'You',
        content: this.buildSelfMarkerContent(),
      });
    } else {
      this.selfMarker.position = latLng;
      // Re-attach if Go-Offline previously detached it from the map.
      if (this.selfMarker.map !== this.map) {
        this.selfMarker.map = this.map;
      }
    }
    this.map.panTo(latLng);
    if (this.map.getZoom() < 14) this.map.setZoom(16);
  }

  private buildSelfMarkerContent(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'driver-self-marker';
    el.style.cssText = [
      'width:18px',
      'height:18px',
      'border-radius:50%',
      'background:#2e7d32',
      'border:3px solid #ffffff',
      'box-shadow:0 1px 4px rgba(0,0,0,0.4)',
    ].join(';');
    return el;
  }

  get isApproved(): boolean {
    return this.driver?.['approval_status'] === 'approved';
  }
  get isOnline(): boolean {
    return !!this.driver?.['is_online'];
  }
}
