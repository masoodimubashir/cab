import { Component, ElementRef, NgZone, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NavController } from '@ionic/angular';
import { GeolocationService } from '../../../core/geolocation.service';
import { PlaceSuggestion, PlacesService } from '../../../core/places.service';
import { CarpoolApiService } from '../carpool-api.service';
import { addDays, dayLabel, daysFromToday, indiaDate, seatWord, shortDate, shortName } from './rider-format';
import { loadRiderMaps, placeName } from './rider-map';
import { clampDate, clampSeats, fromParams, getHorizonDays, getSeatsMax, setHorizonDays, setSeatsMax, recentSearches, rememberSearch, RiderPlace, RiderSearch, toParams } from './rider-search';

/**
 * Find a carpool (customer mockup 2). Pickup starts at the rider's location;
 * the two places decide which carpools match and become the suggested pickup
 * and drop. Tapping a place opens the place search over the page.
 */
@Component({
  selector: 'app-carpool-search',
  templateUrl: './carpool-search.page.html',
  styleUrls: ['./carpool-rider.scss'],
  standalone: false,
})
export class CarpoolSearchPage implements OnInit {
  from: RiderPlace | null = null;
  to: RiderPlace | null = null;
  date = indiaDate();
  seats = 1;
  seatsMax = getSeatsMax();
  /** The field shown as current (green outline in the mockup). */
  active: 'from' | 'to' = 'to';
  recent: RiderSearch[] = [];
  distanceKm = 2;

  picking: 'from' | 'to' | null = null;
  query = '';
  suggestions: PlaceSuggestion[] = [];
  searching = false;
  locating = false;
  pickError = '';
  private seq = 0;
  private debounce: ReturnType<typeof setTimeout> | null = null;

  readonly today = indiaDate();
  get lastDay(): string { return addDays(indiaDate(), getHorizonDays()); }
  readonly seatWord = seatWord;

  @ViewChild('pickInput') pickInput?: ElementRef<HTMLInputElement>;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private nav: NavController,
    private places: PlacesService,
    private geo: GeolocationService,
    private carpool: CarpoolApiService,
    private zone: NgZone,
  ) {}

  ngOnInit(): void {
    const p = this.route.snapshot.queryParams;
    const s = fromParams(p);
    if (s) {
      Object.assign(this, { from: s.from, to: s.to, date: s.date, seats: s.seats });
    } else {
      this.date = clampDate(String(p['date'] ?? ''));
      this.seats = clampSeats(Number(p['seats'] ?? 1));
      void this.locateMe(true);
    }
    this.recent = recentSearches();
    this.carpool.config().subscribe((c) => {
      if (c.search_distance_m) this.distanceKm = Math.round(c.search_distance_m / 100) / 10;
      setSeatsMax(c.seats_max);
      setHorizonDays(c.publish_horizon_days);
      this.seatsMax = getSeatsMax();
      this.seats = clampSeats(this.seats);
      this.date = clampDate(this.date);
    });
  }

  get dateTitle(): string { return dayLabel(this.date); }
  get dateSub(): string { return shortDate(this.date); }

  moveDay(n: number): void { this.date = clampDate(addDays(this.date, n)); }
  pickDate(value: string): void { if (value) this.date = clampDate(value); }
  setSeats(n: number): void { this.seats = clampSeats(n); }

  swap(): void {
    [this.from, this.to] = [this.to, this.from];
    if (this.from) this.from = { ...this.from, mine: false };
  }

  useRecent(r: RiderSearch): void {
    this.from = r.from;
    this.to = r.to;
    this.seats = r.seats;
    this.go();
  }

  go(): void {
    if (!this.from || !this.to) return;
    const s: RiderSearch = { from: this.from, to: this.to, date: this.date, seats: this.seats };
    rememberSearch({ ...s, from: { ...s.from, mine: false } });
    void this.router.navigate(['/carpool/results'], { queryParams: toParams(s) });
  }

  back(): void {
    this.nav.navigateBack('/customer-tabs/go');
  }

  /* ── place search over the page ── */

  openPicker(which: 'from' | 'to'): void {
    this.picking = which;
    this.active = which;
    this.query = '';
    this.suggestions = [];
    this.pickError = '';
    setTimeout(() => this.pickInput?.nativeElement.focus(), 60);
  }

  closePicker(): void {
    this.picking = null;
    if (this.debounce) clearTimeout(this.debounce);
  }

  onQuery(value: string): void {
    this.query = value;
    this.pickError = '';
    const mine = ++this.seq;
    if (this.debounce) clearTimeout(this.debounce);
    if (value.trim().length < 2) {
      this.suggestions = [];
      this.searching = false;
      return;
    }
    this.searching = true;
    this.debounce = setTimeout(async () => {
      const near = this.from ?? this.to ?? undefined;
      const found = await this.places.autocompleteSearch(value, near ? { lat: near.lat, lng: near.lng } : undefined);
      this.zone.run(() => {
        if (mine !== this.seq) return;
        this.suggestions = found;
        this.searching = false;
      });
    }, 260);
  }

  async choose(s: PlaceSuggestion): Promise<void> {
    const which = this.picking;
    const detail = await this.places.getPlaceDetail(s.place_id);
    this.zone.run(() => {
      if (!detail || !which) {
        this.pickError = "Couldn't load that place. Try another.";
        return;
      }
      this.set(which, { lat: detail.lat, lng: detail.lng, name: s.main_text || shortName(detail.description), address: detail.description || s.description });
    });
  }

  async useMyLocation(): Promise<void> {
    const which = this.picking ?? 'from';
    const ok = await this.locateMe(false, which);
    if (!ok) this.zone.run(() => (this.pickError = "We couldn't get your location. Search for it instead."));
  }

  private set(which: 'from' | 'to', place: RiderPlace): void {
    if (which === 'from') this.from = place;
    else this.to = place;
    this.active = which === 'from' && !this.to ? 'to' : which;
    this.closePicker();
    // After the pickup, go straight on to the drop, as in Publish.
    if (which === 'from' && !this.to) setTimeout(() => this.openPicker('to'), 80);
  }

  /** Fills a place with the phone's location ("your location"). */
  private async locateMe(quiet: boolean, which: 'from' | 'to' = 'from'): Promise<boolean> {
    this.locating = true;
    try {
      const fix = await this.geo.getCurrentPosition();
      if (!fix) return false;
      await loadRiderMaps(this.places);
      const named = await placeName({ lat: fix.lat, lng: fix.lng });
      this.zone.run(() => {
        const place: RiderPlace = { lat: fix.lat, lng: fix.lng, name: named?.name ?? 'Your location', address: named?.address ?? 'Your location', mine: which === 'from' };
        if (quiet) {
          if (!this.from) this.from = place;
        } else {
          this.set(which, place);
        }
      });
      return true;
    } catch {
      return false;
    } finally {
      this.zone.run(() => (this.locating = false));
    }
  }

  trackRecent = (_: number, r: RiderSearch) => `${r.from.name}|${r.to.name}`;
  trackSuggestion = (_: number, s: PlaceSuggestion) => s.place_id;
  daysAhead(date: string): number { return daysFromToday(date); }
}
