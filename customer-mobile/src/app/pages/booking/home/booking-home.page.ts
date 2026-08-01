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

import { GeolocationService } from '../../../core/geolocation.service';
import { PlacesService } from '../../../core/places.service';
import { BookingService, resolveCity, scopesOffered, tilesFor, RawScope } from '../booking.service';
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
export class BookingHomePage implements OnInit, OnDestroy {
  @ViewChild('mapEl', { static: true }) mapElRef!: ElementRef<HTMLDivElement>;

  loading = true;
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
    // Load data and map concurrently — neither blocks the other.
    await Promise.all([this.load(), this.initMap()]);
  }

  ngOnDestroy(): void {
    if (this.watchId) {
      void this.geo.clearWatch(this.watchId);
    }
    this.userMarker = null;
    this.map = null;
  }

  // ── Map setup ────────────────────────────────────────────────────────────

  private async initMap(): Promise<void> {
    try {
      await this.places.ensureLoaded();

      const el = this.mapElRef.nativeElement;

      // Default centre: Kashmir — overridden immediately by GPS.
      this.map = new google.maps.Map(el, {
        center: { lat: 34.0, lng: 74.8 },
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

      // Start watching GPS after map is ready.
      await this.startWatch();
    } catch {
      // Maps unavailable (offline / key missing) — page still works.
    }
  }

  private async startWatch(): Promise<void> {
    // Quick first fix — centre the map immediately.
    const fix = await this.geo.getCurrentFix();
    if (fix) {
      this.updateMapPosition(fix.lat, fix.lng, fix.accuracy ?? 40, true);
    }

    // Continuous watch — moves marker as user walks.
    try {
      this.watchId = await this.geo.watchPosition(
        { enableHighAccuracy: true, maximumAge: 2000 },
        (pos, err) => {
          if (err || !pos) return;
          this.updateMapPosition(pos.lat, pos.lng, pos.accuracy ?? 40, false);
        },
      );
    } catch {
      // Location unavailable — stays at first fix / default.
    }
  }

  private async updateMapPosition(
    lat: number, lng: number, accuracy: number, pan: boolean,
  ): Promise<void> {
    if (!this.map) return;
    const latlng = { lat, lng };

    if (!this.userMarker) {
      // Build the pulsing dot using AdvancedMarkerElement + custom HTML.
      const { AdvancedMarkerElement } = await (google.maps as any).importLibrary('marker');

      const dotEl = document.createElement('div');
      dotEl.className = 'bh-map-dot';
      dotEl.innerHTML = '<span class="bh-map-dot__pulse"></span>';

      this.userMarker = new AdvancedMarkerElement({
        map: this.map,
        position: latlng,
        content: dotEl,
        zIndex: 1000,
        title: 'Your location',
      });

      this.accuracyCircle = new google.maps.Circle({
        map: this.map,
        center: latlng,
        radius: accuracy,
        strokeColor: '#12B35B',
        strokeOpacity: 0.35,
        strokeWeight: 1,
        fillColor: '#12B35B',
        fillOpacity: 0.08,
        clickable: false,
      });
    } else {
      this.userMarker.position = latlng;
      this.accuracyCircle.setCenter(latlng);
      this.accuracyCircle.setRadius(accuracy);
    }

    if (pan) {
      this.map.setCenter(latlng);
      this.map.setZoom(15);
    } else {
      this.map.panTo(latlng);
    }
  }

  // ── City / catalogue loading ─────────────────────────────────────────────

  private async load(): Promise<void> {
    this.loading = true;
    this.cdr.markForCheck();

    try {
      const cities = await this.booking.cities().catch(() => [] as City[]);

      let city: City | null = null;
      try {
        const fix = await this.geo.getCurrentPosition();
        if (fix) city = resolveCity(cities, fix.lat, fix.lng);
      } catch {
        // Location denied — fall through.
      }

      this.located = !!city;
      city = city ?? cities[0] ?? null;

      this.city = city;
      this.booking.setCity(city?.id ?? null);

      if (city) {
        this.catalog = await this.booking.catalog(city.id).catch(() => []);
      }

      const offered = scopesOffered(this.catalog);
      this.scopes = offered.length ? offered : ['local'];
      this.scope = this.scopes[0];
      this.rebuildTiles();
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
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
