import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import * as L from 'leaflet';

import { GeolocationService } from '../../../core/geolocation.service';
import { BookingService, resolveCity, scopesOffered, tilesFor, RawScope } from '../booking.service';
import { City, RideMode, ServiceTile, TripScope } from '../booking.models';

// Fix Leaflet default icon broken path in Angular / webpack
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

/**
 * Home — bottom sheet over a live Leaflet map.
 *
 * The map initialises with the user's GPS position, then uses
 * `watchPosition` to pan + move a marker in real-time as the user
 * walks. Falls back to a default city centre if location is denied.
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

  scope: TripScope = 'local';
  scopes: TripScope[] = ['local'];
  mode: RideMode | null = null;
  tiles: ServiceTile[] = [];

  city: City | null = null;
  located = false;

  private catalog: RawScope[] = [];

  // ── Leaflet internals ────────────────────────────────────────────────────
  private map: L.Map | null = null;
  private userMarker: L.Marker | null = null;
  private accuracyCircle: L.Circle | null = null;
  private watchId: string | null = null;

  constructor(
    private booking: BookingService,
    private geo: GeolocationService,
    private router: Router,
    private cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> {
    this.initMap();
    await this.load();
  }

  ngOnDestroy(): void {
    if (this.watchId) {
      void this.geo.clearWatch(this.watchId);
    }
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }

  // ── Map setup ────────────────────────────────────────────────────────────

  private initMap(): void {
    const el = this.mapElRef.nativeElement;

    this.map = L.map(el, {
      zoomControl: false,
      attributionControl: false,
      dragging: true,
      touchZoom: true,
      scrollWheelZoom: false,
      doubleClickZoom: true,
    }).setView([34.0, 74.8], 13); // default: Kashmir — updated once GPS fires

    // OpenStreetMap tiles — no API key required
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      minZoom: 5,
    }).addTo(this.map);

    // Zoom controls bottom-right to stay out of the menu button area
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    // Attribution bottom-left, tiny
    L.control.attribution({ position: 'bottomleft', prefix: false })
      .addAttribution('© <a href="https://www.openstreetmap.org/copyright" target="_blank">OSM</a>')
      .addTo(this.map);

    // Start live GPS watch
    void this.startWatch();
  }

  private async startWatch(): Promise<void> {
    // First quick fix — move map immediately
    const fix = await this.geo.getCurrentFix();
    if (fix) {
      this.updateMapPosition(fix.lat, fix.lng, fix.accuracy ?? 40, true);
    }

    // Continuous watch — moves marker as user walks
    try {
      this.watchId = await this.geo.watchPosition(
        { enableHighAccuracy: true, maximumAge: 2000 },
        (pos, err) => {
          if (err || !pos) return;
          this.updateMapPosition(pos.lat, pos.lng, pos.accuracy ?? 40, false);
        },
      );
    } catch {
      // Location unavailable — map stays at last known / default
    }
  }

  private updateMapPosition(lat: number, lng: number, accuracy: number, pan: boolean): void {
    if (!this.map) return;
    const latlng = L.latLng(lat, lng);

    if (!this.userMarker) {
      // Create a custom pulsing marker for the user's position
      const icon = L.divIcon({
        className: '',
        html: `
          <div class="bh-map-dot">
            <span class="bh-map-dot__pulse"></span>
          </div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });

      this.userMarker = L.marker(latlng, { icon, zIndexOffset: 1000 }).addTo(this.map);

      this.accuracyCircle = L.circle(latlng, {
        radius: accuracy,
        color: '#12B35B',
        fillColor: '#12B35B',
        fillOpacity: 0.08,
        weight: 1,
        opacity: 0.4,
      }).addTo(this.map);
    } else {
      this.userMarker.setLatLng(latlng);
      this.accuracyCircle?.setLatLng(latlng).setRadius(accuracy);
    }

    if (pan) {
      this.map.setView(latlng, 15, { animate: true });
    } else {
      // Smooth pan without resetting zoom
      this.map.panTo(latlng, { animate: true, duration: 0.8 });
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
        // Location denied or unavailable
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

  /** Recenter the map on user's current position. */
  recenter(): void {
    void this.geo.getCurrentPosition().then((fix) => {
      if (fix && this.map) {
        this.map.setView([fix.lat, fix.lng], 15, { animate: true });
      }
    });
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
