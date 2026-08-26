import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { ViewDidEnter, ViewDidLeave, ViewWillEnter } from '@ionic/angular';

import { buildPassengerMarkerElement } from '../../../core/car-marker.helper';
import { GeolocationService } from '../../../core/geolocation.service';
import { PlacesService } from '../../../core/places.service';
import {
  BookingService,
  resolveCity,
  nearestCity,
  distanceKm,
  pointInPolygon,
  scopesOffered,
  tilesFor,
  RawScope
} from '../booking.service';
import { City, RideMode, ServiceTile, TripScope } from '../booking.models';

declare const google: any;

/**
 * Home — Google Maps behind the bottom sheet, live GPS tracking.
 *
 * The map initialises full-screen via the native Google Maps JS SDK
 * (same loader PlacesService uses — single shared script tag).
 * `watchPosition` pans an AdvancedMarkerElement smoothly as the user walks.
 */
@Component({
  selector: 'app-booking-home',
  templateUrl: './booking-home.page.html',
  styleUrls: ['./booking-home.page.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BookingHomePage implements OnInit, ViewWillEnter, ViewDidEnter, ViewDidLeave, OnDestroy {
  @ViewChild('mapEl', { static: true }) mapElRef!: ElementRef<HTMLDivElement>;

  loading = true;
  locationFetching = true;
  locationPermissionNeeded = false;
  mapReady = false;

  scope: TripScope = 'local';
  scopes: TripScope[] = ['local'];
  mode: RideMode | null = null;
  tiles: ServiceTile[] = [];

  city: City | null = null;
  located = false;

  private catalog: RawScope[] = [];

  // ── Google Maps internals ────────────────────────────────────────────────
  private map: any = null;
  private userMarker: any = null;   // AdvancedMarkerElement
  private accuracyCircle: any = null;
  private watchId: string | null = null;

  constructor(
    private booking: BookingService,
    private geo: GeolocationService,
    private places: PlacesService,
    private router: Router,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> {
    // Initial load: fetch user GPS location and setup map
    await this.initHome();
  }

  ionViewWillEnter(): void {
    if (!this.located || !this.city) {
      void this.initHome();
    }
  }

  ionViewDidEnter(): void {
    if (this.map && !this.watchId) {
      void this.startWatch();
    }
  }

  ionViewDidLeave(): void {
    if (this.watchId) {
      void this.geo.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  ngOnDestroy(): void {
    if (this.watchId) {
      void this.geo.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.userMarker = null;
    this.map = null;
  }

  private async initHome(): Promise<void> {
    this.locationFetching = true;
    this.locationPermissionNeeded = false;
    this.cdr.markForCheck();

    await Promise.all([this.loadLocationAndCatalog(), this.initMap()]);
  }

  async requestLocation(): Promise<void> {
    this.locationPermissionNeeded = false;
    this.locationFetching = true;
    this.cdr.markForCheck();

    try {
      await this.geo.requestPermissions();
    } catch {
      /* ignore */
    }

    await this.loadLocationAndCatalog();
    if (this.located && this.map) {
      await this.startWatch();
    }
  }

  // ── Map setup ────────────────────────────────────────────────────────────

  private async initMap(): Promise<void> {
    try {
      await this.places.ensureLoaded();

      const el = this.mapElRef.nativeElement;

      this.map = new google.maps.Map(el, {
        center: { lat: 34.2985, lng: 74.4712 }, // Centered on Jammu & Kashmir region
        zoom: 14,
        disableDefaultUI: true,
        mapId: 'DEMO_MAP_ID',         // needed for AdvancedMarkerElement
        gestureHandling: 'greedy',    // single-finger pan on mobile
        clickableIcons: false,
      });

      this.zone.run(() => {
        this.mapReady = true;
        this.cdr.markForCheck();
      });

      // Start watching GPS once map is ready
      await this.startWatch();
    } catch {
      // Maps unavailable (offline / key missing)
      this.locationFetching = false;
      this.cdr.markForCheck();
    }
  }

  currentCoords: { lat: number; lng: number } | null = null;

  recenterMap(): void {
    if (!this.map) return;
    if (this.currentCoords) {
      this.map.panTo(this.currentCoords);
      this.map.setZoom(16);
    } else {
      void this.requestLocation();
    }
  }

  private async startWatch(): Promise<void> {
    // Quick first fix — centre the map immediately.
    try {
      const fix = await this.geo.getCurrentFix();
      if (fix) {
        this.updateMapPosition(fix.lat, fix.lng, fix.accuracy ?? 40, true, fix.bearing);
      }
    } catch {
      /* ignore */
    }

    // Continuous watch — moves marker as user walks.
    try {
      if (this.watchId) {
        await this.geo.clearWatch(this.watchId);
      }
      this.watchId = await this.geo.watchPosition(
        { enableHighAccuracy: true, maximumAge: 2000 },
        (pos, err) => {
          if (err || !pos) return;
          this.updateMapPosition(pos.lat, pos.lng, pos.accuracy ?? 40, false, pos.bearing);
        },
      );
    } catch {
      /* ignore */
    }
  }

  private async updateMapPosition(
    lat: number, lng: number, accuracy: number, pan: boolean, bearing?: number | null,
  ): Promise<void> {
    if (!this.map) return;
    const latlng = { lat, lng };
    this.currentCoords = latlng;

    if (!this.userMarker) {
      const { AdvancedMarkerElement } = await (google.maps as any).importLibrary('marker');

      this.userMarker = new AdvancedMarkerElement({
        map: this.map,
        position: latlng,
        content: buildPassengerMarkerElement({
          kind: 'pickup',
          name: 'You',
          isLive: true,
        }),
        zIndex: 1000,
        title: 'Your location',
      });
    } else {
      this.userMarker.position = latlng;
    }

    if (pan) {
      this.map.setCenter(latlng);
      this.map.setZoom(16);
    } else {
      this.map.panTo(latlng);
    }
  }

  // ── City / catalogue loading ─────────────────────────────────────────────

  private async loadLocationAndCatalog(): Promise<void> {
    this.zone.run(() => {
      this.loading = true;
      this.cdr.markForCheck();
    });

    try {
      const cities = await this.booking.cities().catch(() => [] as City[]);

      // Attempt to retrieve real coordinates from device GPS
      let fix = await this.geo.getCurrentPosition();
      if (!fix) {
        const longFix = await this.geo.getCurrentFix();
        if (longFix) fix = { lat: longFix.lat, lng: longFix.lng };
      }

      if (!fix) {
        // Location is unavailable / GPS off / permission not granted
        this.zone.run(() => {
          this.located = false;
          this.city = null;
          this.locationPermissionNeeded = true;
          this.locationFetching = false;
          this.loading = false;
          this.cdr.markForCheck();
        });
        return;
      }

      // 1. Check if user coordinates match an active Admin City's boundary polygon
      let adminCity = cities.find((c) =>
        Array.isArray(c.boundary_polygon) &&
        c.boundary_polygon.length >= 3 &&
        pointInPolygon(fix.lat, fix.lng, c.boundary_polygon)
      );

      // If no polygon match, check if user is within close proximity (<= 8km) of an Admin City center
      if (!adminCity && cities.length > 0) {
        for (const c of cities) {
          if (c.center_lat != null && c.center_lng != null) {
            const km = distanceKm(fix.lat, fix.lng, Number(c.center_lat), Number(c.center_lng));
            if (km <= 8) {
              adminCity = c;
              break;
            }
          }
        }
      }

      let activeCity: City;

      if (adminCity) {
        // Admin city exists for this location -> Use the Admin city entity
        activeCity = adminCity;
      } else {
        // City does not exist in Admin -> Detect real city / town name from device coordinates
        const detectedName = await this.places.reverseGeocodeCity(fix.lat, fix.lng).catch(() => null);
        const nearest = nearestCity(cities, fix.lat, fix.lng);
        const fallbackId = nearest?.id ?? cities[0]?.id ?? 1;

        activeCity = {
          id: fallbackId,
          name: detectedName || 'Your Location',
          center_lat: fix.lat,
          center_lng: fix.lng,
        };
      }

      const catalogData = activeCity.id
        ? await this.booking.catalog(activeCity.id).catch(() => [])
        : [];

      this.zone.run(() => {
        this.located = true;
        this.city = activeCity;
        this.locationPermissionNeeded = false;
        this.booking.setCity(activeCity.id);
        this.catalog = catalogData;

        const offered = scopesOffered(this.catalog);
        this.scopes = offered.length ? offered : ['local'];
        this.scope = this.scopes[0];
        this.rebuildTiles();
        this.locationFetching = false;
        this.loading = false;
        this.cdr.markForCheck();
      });

      // Pan map to user fix
      if (this.map) {
        this.updateMapPosition(fix.lat, fix.lng, 40, true);
      }
    } catch {
      this.zone.run(() => {
        this.located = false;
        this.city = null;
        this.locationPermissionNeeded = true;
        this.locationFetching = false;
        this.loading = false;
        this.cdr.markForCheck();
      });
    }
  }

  // ── UI helpers ───────────────────────────────────────────────────────────

  get hasScopeSwitch(): boolean {
    return this.scopes.length > 1;
  }

  scopeLabel(scope: TripScope): string {
    return scope === 'outstation' ? 'Outstation' : 'Local';
  }

  pickScope(scope: TripScope): void {
    if (this.scope === scope) return;
    this.scope = scope;
    this.booking.setScope(scope);
    this.mode = null;
    this.rebuildTiles();
    this.cdr.markForCheck();
  }

  pickMode(tile: ServiceTile): void {
    this.mode = tile.mode;
    this.booking.setMode(tile.mode, tile.rideTypeId);
    this.cdr.markForCheck();
  }

  whereTo(): void {
    this.booking.setScope(this.scope);
    if (this.mode) this.booking.setMode(this.mode);

    switch (this.mode) {
      case 'private': void this.router.navigate(['/customer-tabs/go/private']); break;
      case 'fixed':   void this.router.navigate(['/customer-tabs/go/fixed']);   break;
      case 'shuttle': void this.router.navigate(['/customer-tabs/go/shuttle']); break;
      default:        void this.router.navigate(['/customer-tabs/go/private']);
    }
  }

  trackByMode = (_: number, tile: ServiceTile): string => tile.mode;

  private rebuildTiles(): void {
    this.tiles = tilesFor(this.catalog, this.scope);
    if (this.tiles.length && !this.tiles.some((t) => t.mode === this.mode)) {
      const first = this.tiles[0];
      this.mode = first.mode;
      this.booking.setMode(first.mode, first.rideTypeId);
    }
  }
}

