import { Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { NavController } from '@ionic/angular';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../../core/api.service';
import { PlaceSuggestion, PlacesService } from '../../../core/places.service';
import { CarpoolApiService } from '../carpool-api.service';
import { CarpoolDriverHome, CarpoolPlace } from '../carpool.models';
import { RouteOption, createMap, drawRoutes, fetchRouteOptions, loadCarpoolMaps } from './carpool-map';
import { addDays, clockFromHm, dayLabel, daysFromToday, durationLabel, indiaDate, indiaIso, indiaTime, kmLabel, shortDate, whenLabel } from './carpool-format';

type Field = 'from' | 'to';

interface Me {
  driver?: { carpool_vehicle?: { seats: number } | null };
}

/**
 * Publish a carpool (mockup 3 to 6): where, pick a route, when/seats/price,
 * check and publish. No stops: riders along the route ask for a pickup in their
 * request or in chat. The server checks the plan, the route and the limits.
 */
@Component({
  selector: 'app-carpool-publish',
  templateUrl: './carpool-publish.page.html',
  styleUrls: ['./carpool-driver.scss'],
  standalone: false,
})
export class CarpoolPublishPage implements OnDestroy {
  @ViewChild('mapEl') mapEl?: ElementRef<HTMLElement>;
  @ViewChild('toIn') toIn?: ElementRef<HTMLInputElement>;

  step = 1;
  loading = true;
  blocked: 'plan' | 'error' | null = null;
  carSeats = 4;
  horizonDays = 30;
  recent: CarpoolDriverHome['recent'] = [];

  // Step 1
  from: CarpoolPlace | null = null;
  to: CarpoolPlace | null = null;
  active: Field = 'from';
  query: Record<Field, string> = { from: '', to: '' };
  suggestions: PlaceSuggestion[] = [];
  searching = false;
  placeError: string | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private searchSeq = 0;

  // Step 2
  routes: RouteOption[] = [];
  chosen = 0;
  routesLoading = false;
  routesError: string | null = null;
  private routesFor = '';
  private map: any = null;
  private clearDrawn: (() => void) | null = null;

  // Step 3
  date = indiaDate();
  time = '08:30';
  seats = 4;
  price: number | null = 60;
  free = false;

  // Step 4
  accepting = true;
  publishing = false;
  published = false;
  publishError: string | null = null;

  constructor(
    private api: ApiService,
    private carpool: CarpoolApiService,
    private places: PlacesService,
    private nav: NavController,
  ) {}

  ionViewWillEnter(): void {
    if (!this.loading) return;
    forkJoin({
      plan: this.carpool.planState(),
      me: this.api.get<Me>('/drivers/me'),
      home: this.carpool.driverHome(),
      config: this.carpool.config(),
    }).subscribe({
      next: ({ plan, me, home, config }) => {
        this.loading = false;
        if (!plan.can_publish) {
          this.blocked = 'plan';
          return;
        }
        this.carSeats = me.driver?.carpool_vehicle?.seats ?? 4;
        this.seats = this.carSeats;
        this.horizonDays = config.publish_horizon_days ?? 30;
        this.recent = home.recent ?? [];
        this.setDefaultTime();
      },
      error: () => {
        this.loading = false;
        this.blocked = 'error';
      },
    });
    void loadCarpoolMaps(this.places).catch(() => (this.placeError = "Maps couldn't load. Check your connection."));
  }

  ngOnDestroy(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.clearDrawn?.();
  }

  get title(): string {
    return ['Publish a carpool', 'Pick a route', 'When and seats', 'Check and publish'][this.step - 1];
  }

  get routeName(): string {
    return this.from && this.to ? `${this.from.name} to ${this.to.name}` : '';
  }

  /** "via NH 1": only the first word lower case, road names untouched. */
  get viaSmall(): string {
    return this.route?.summary?.replace(/^Via /, 'via ') ?? '';
  }

  get route(): RouteOption | null {
    return this.routes[this.chosen] ?? null;
  }

  // ── navigation ──

  back(): void {
    if (this.published) return;
    if (this.step > 1) {
      this.go(this.step - 1);
      return;
    }
    void this.nav.navigateBack('/carpool/home');
  }

  go(step: number): void {
    this.publishError = null;
    this.step = step;
    if (step === 2) setTimeout(() => this.loadRoutes());
    if (step === 4) setTimeout(() => this.draw(false));
  }

  get canContinue(): boolean {
    switch (this.step) {
      case 1: return !!this.from && !!this.to && !this.samePlace;
      case 2: return !!this.route;
      case 3: return !this.timeError && !this.priceError;
      default: return false;
    }
  }

  next(): void {
    if (this.canContinue) this.go(this.step + 1);
  }

  // ── step 1: where ──

  get samePlace(): boolean {
    return !!this.from && !!this.to && Math.abs(this.from.lat - this.to.lat) < 0.002 && Math.abs(this.from.lng - this.to.lng) < 0.002;
  }

  focus(f: Field): void {
    this.active = f;
    this.suggestions = [];
    this.searching = false;
  }

  onType(f: Field, value: string): void {
    this.active = f;
    this.query[f] = value;
    if (f === 'from') this.from = null;
    else this.to = null;
    this.routesFor = '';
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (value.trim().length < 2) {
      this.suggestions = [];
      this.searching = false;
      return;
    }
    this.searching = true;
    const seq = ++this.searchSeq;
    this.searchTimer = setTimeout(async () => {
      const near = f === 'to' ? this.from : this.to;
      const found = await this.places.autocompleteSearch(value, near ? { lat: near.lat, lng: near.lng } : undefined);
      if (seq !== this.searchSeq) return;
      this.suggestions = found.slice(0, 5);
      this.searching = false;
    }, 300);
  }

  async choose(s: PlaceSuggestion): Promise<void> {
    const f = this.active;
    const detail = await this.places.getPlaceDetail(s.place_id);
    if (!detail) {
      this.placeError = "Couldn't get that place. Try another.";
      return;
    }
    this.placeError = null;
    const place: CarpoolPlace = { lat: detail.lat, lng: detail.lng, name: s.main_text || detail.description, address: detail.description || s.description };
    this.setPlace(f, place);
    this.suggestions = [];
    if (f === 'from' && !this.to) {
      this.active = 'to';
      setTimeout(() => this.toIn?.nativeElement.focus());
    } else {
      (document.activeElement as HTMLElement | null)?.blur();
    }
  }

  useRecent(r: CarpoolDriverHome['recent'][number]): void {
    this.setPlace('from', r.start);
    this.setPlace('to', r.end);
    this.suggestions = [];
  }

  swap(): void {
    const [a, b] = [this.from, this.to];
    this.from = null;
    this.to = null;
    if (b) this.setPlace('from', b);
    else this.query.from = '';
    if (a) this.setPlace('to', a);
    else this.query.to = '';
  }

  recentWhen(iso: string): string {
    return whenLabel(iso);
  }

  private setPlace(f: Field, p: CarpoolPlace): void {
    if (f === 'from') this.from = p;
    else this.to = p;
    this.query[f] = p.name;
    this.routesFor = '';
  }

  // ── step 2: route ──

  async loadRoutes(): Promise<void> {
    if (!this.from || !this.to) return;
    const key = `${this.from.lat},${this.from.lng}|${this.to.lat},${this.to.lng}`;
    if (key === this.routesFor && this.routes.length) {
      this.draw(true);
      return;
    }
    this.routesLoading = true;
    this.routesError = null;
    try {
      await loadCarpoolMaps(this.places);
      this.routes = await fetchRouteOptions(this.from, this.to);
      this.chosen = 0;
      this.routesFor = key;
      this.draw(true);
    } catch {
      this.routes = [];
      this.routesError = "Couldn't find a driving route between these places. Check them, or try again.";
    } finally {
      this.routesLoading = false;
    }
  }

  pickRoute(i: number): void {
    this.chosen = i;
    this.draw(true);
  }

  routeNote(r: RouteOption, i: number): string {
    const fastest = this.routes.every((o) => o.duration_s >= r.duration_s);
    return `${kmLabel(r.distance_m)}${fastest && this.routes.length > 1 ? ', fastest' : ''}`;
  }

  routeTitle(r: RouteOption, i: number): string {
    return r.summary ?? `Route ${i + 1}`;
  }

  dur(s: number): string {
    return durationLabel(s);
  }

  private draw(all: boolean): void {
    const el = this.mapEl?.nativeElement;
    if (!el || !this.routes.length || !(window as any).google?.maps) return;
    if (!this.map) this.map = createMap(el);
    this.clearDrawn?.();
    const lines = all ? this.routes.map((r) => r.path) : [this.routes[this.chosen].path];
    this.clearDrawn = drawRoutes(this.map, lines, all ? this.chosen : 0, all ? (i) => this.pickRoute(i) : undefined);
  }

  // ── step 3: when, seats, price ──

  get today(): string {
    return indiaDate();
  }

  get lastDay(): string {
    return addDays(this.today, this.horizonDays);
  }

  get dateTitle(): string {
    return dayLabel(this.date);
  }

  get dateSub(): string {
    return shortDate(this.date);
  }

  get timeLabel(): string {
    return clockFromHm(this.time);
  }

  moveDay(n: number): void {
    const d = addDays(this.date, n);
    if (daysFromToday(d) < 0 || daysFromToday(d) > this.horizonDays) return;
    this.date = d;
  }

  pickDate(value: string): void {
    if (value && daysFromToday(value) >= 0 && daysFromToday(value) <= this.horizonDays) this.date = value;
  }

  pickTime(value: string): void {
    if (/^\d{2}:\d{2}$/.test(value)) this.time = value;
  }

  get timeError(): string | null {
    if (this.date === this.today && this.time <= indiaTime(new Date())) return 'Pick a time that is still to come.';
    return null;
  }

  get priceError(): string | null {
    if (this.free) return null;
    if (!this.price || this.price < 1) return 'Set a price per seat, or turn on Free ride.';
    return null;
  }

  onPrice(value: string): void {
    const n = parseInt(value.replace(/\D/g, ''), 10);
    this.price = Number.isFinite(n) ? n : null;
  }

  private setDefaultTime(): void {
    // The next quarter hour at least 30 minutes away, India time.
    const soon = new Date(Date.now() + 30 * 60_000);
    const [h, m] = indiaTime(soon).split(':').map(Number);
    let mins = Math.ceil((h * 60 + m) / 15) * 15;
    this.date = indiaDate(soon);
    if (mins >= 24 * 60) {
      mins = 0;
      this.date = addDays(this.date, 1);
    }
    this.time = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }

  // ── step 4: check and publish ──

  get leavingLabel(): string {
    return `${dayLabel(this.date)}, ${clockFromHm(this.time)}`;
  }

  get viaLabel(): string {
    const r = this.route;
    return r ? `${r.summary ? r.summary.replace(/^Via /, '') + ', ' : ''}${kmLabel(r.distance_m)}, ${durationLabel(r.duration_s)}` : '';
  }

  publish(): void {
    const r = this.route;
    if (!this.from || !this.to || !r || this.publishing || this.published) return;
    this.publishing = true;
    this.publishError = null;
    this.carpool
      .publish({
        start: this.from,
        end: this.to,
        route: { polyline: r.polyline, distance_m: r.distance_m, duration_s: r.duration_s, summary: r.summary },
        departs_at: indiaIso(this.date, this.time),
        seats: this.seats,
        is_free: this.free,
        price_per_seat: this.free ? null : this.price,
        accepting_requests: this.accepting,
      })
      .subscribe({
        next: (l) => {
          this.publishing = false;
          this.published = true;
          setTimeout(() => void this.nav.navigateRoot(`/carpool/listing/${l.id}`, { replaceUrl: true }), 1400);
        },
        error: (err) => {
          this.publishing = false;
          const errors = err?.error?.errors ?? {};
          const first = Object.values(errors)[0] as string[] | undefined;
          this.publishError = first?.[0] ?? (err?.status === 0 ? 'No connection. Nothing was published.' : 'Something went wrong. Nothing was published.');
        },
      });
  }

  plans(): void {
    void this.nav.navigateForward('/carpool-signup/plans');
  }
}
