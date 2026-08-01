import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';

import { GeolocationService } from '../../../core/geolocation.service';
import { BookingService, resolveCity, scopesOffered, tilesFor, RawScope } from '../booking.service';
import { City, RideMode, ServiceTile, TripScope } from '../booking.models';

/**
 * Home — the redesigned bottom sheet over the map (screens 7–8).
 *
 * The old home was a two-step page: pick a scope, then a mode, then "Where to?".
 * Here it's one calm sheet floating over the map — a Local/Outstation switch, the
 * three modes as cards, and a single green "Where to?" bar. The ☰ opens the
 * drawer, untouched.
 *
 * The tiles come from the city catalogue, so the operator's switches govern what
 * shows: a mode turned off has no card, and Outstation only appears if it's run.
 */
@Component({
  selector: 'app-booking-home',
  templateUrl: './booking-home.page.html',
  styleUrls: ['./booking-home.page.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BookingHomePage implements OnInit {
  loading = true;

  scope: TripScope = 'local';
  scopes: TripScope[] = ['local'];
  mode: RideMode | null = null;
  tiles: ServiceTile[] = [];

  /** The city whose services are on screen, and whether we located the rider. */
  city: City | null = null;
  located = false;

  private catalog: RawScope[] = [];

  constructor(
    private booking: BookingService,
    private geo: GeolocationService,
    private router: Router,
    private cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  /**
   * Work out which city the rider is in, then load THAT city's catalogue.
   *
   * This is the whole reason "Fixed" went missing: the catalogue is per city,
   * so the wrong city silently hides real services. Sopore has fixed routes,
   * Kupwara doesn't — and taking the first city in the list handed a Sopore
   * rider Kupwara's shorter list.
   */
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
        // Location denied or unavailable — fall through to the fallback below.
      }

      // Without a location we genuinely can't tell. Use the first city so the
      // screen still works, but name it on screen so a wrong guess is visible
      // rather than silently trimming the rider's options.
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

  /** The single action. Carries the chosen scope + mode into the mode flow. */
  whereTo(): void {
    this.booking.setScope(this.scope);
    if (this.mode) this.booking.setMode(this.mode);

    // Each mode has its own flow on the shared shell. Private is built; Fixed
    // and Shuttle come next — until then they fall back to the current flow so
    // nothing dead-ends.
    switch (this.mode) {
      case 'private': void this.router.navigate(['/customer-tabs/go/private']); break;
      case 'fixed': void this.router.navigate(['/customer-tabs/go/fixed']); break;
      case 'shuttle': void this.router.navigate(['/customer-tabs/go/shuttle']); break;
      default: void this.router.navigate(['/customer-tabs/go/private']);
    }
  }

  trackByMode = (_: number, tile: ServiceTile): string => tile.mode;

  private rebuildTiles(): void {
    this.tiles = tilesFor(this.catalog, this.scope);
    // Pre-select the first mode so the sheet is never in a half-chosen state.
    if (this.tiles.length && !this.tiles.some((t) => t.mode === this.mode)) {
      const first = this.tiles[0];
      this.mode = first.mode;
      this.booking.setMode(first.mode, first.rideTypeId);
    }
  }
}
