import { Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NavController } from '@ionic/angular';
import { ApiService } from '../../../core/api.service';
import { PlacesService } from '../../../core/places.service';
import { CarpoolApiService } from '../carpool-api.service';
import { CarpoolEditInput, CarpoolJoinRequest, CarpoolListing } from '../carpool.models';
import { RouteOption, createMap, drawRoutes, fetchRouteOptions, loadCarpoolMaps, toPath } from './carpool-map';
import { addDays, cancelReasonLabel, clock, daysFromToday, durationLabel, indiaDate, indiaIso, indiaTime, kmLabel, priceLabel, whenLabel } from './carpool-format';

type Mode = 'view' | 'edit' | 'route';
type Sheet = 'cancel' | 'discard' | 'rider' | 'remove' | 'noshow' | null;

interface Draft {
  date: string;
  time: string;
  seats: number;
  free: boolean;
  price: number | null;
  route: RouteOption | null;
}

interface Me {
  driver?: { carpool_vehicle?: { seats: number } | null };
}

/**
 * The carpool page, driver side (mockup 8, 8f to 8k): the carpool before it
 * starts, the ⋯ menu, edit in place, change route, discard, slide to cancel and
 * the failure bar. M4 adds the riders in pickup order, their options sheet
 * (8b: Paid tick, Profile, Remove) and Remove (8d). M6 adds Start ride and
 * Complete ride in the bottom bar, the in-progress and completed states (9,
 * 13b), the rider options on the road (10, 12), No-show (13) and, on its own
 * page, Check code and pick up (11, 11b).
 */
@Component({
  selector: 'app-carpool-listing',
  templateUrl: './carpool-listing.page.html',
  styleUrls: ['./carpool-driver.scss'],
  standalone: false,
})
export class CarpoolListingPage implements OnDestroy {
  @ViewChild('mapEl') mapEl?: ElementRef<HTMLElement>;
  @ViewChild('swipeEl') swipeEl?: ElementRef<HTMLElement>;

  readonly cancelReasons = ['My plans changed', 'Problem with the car', 'Something else'];

  id = 0;
  listing: CarpoolListing | null = null;
  loading = true;
  loadError = false;
  carSeats = 6;
  horizonDays = 30;
  priceMax = 5000;
  retentionDays = 1;

  mode: Mode = 'view';
  menuOpen = false;
  sheet: Sheet = null;

  draft: Draft | null = null;
  saving = false;
  saveError: string | null = null;
  saved = false;

  routes: RouteOption[] = [];
  routeChoice = 0;
  routesLoading = false;
  routesError: string | null = null;

  delaying = false;
  delayMsg: string | null = null;
  delayError: string | null = null;

  reason: number | null = null;
  cancelling = false;
  cancelError: string | null = null;
  cancelled = false;
  swipeX = 0;
  private swipeMax = 0;
  private swipeStart: number | null = null;

  private map: any = null;
  private clearDrawn: (() => void) | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(
    private route: ActivatedRoute,
    private api: ApiService,
    private carpool: CarpoolApiService,
    private places: PlacesService,
    private nav: NavController,
  ) {}

  ionViewWillEnter(): void {
    this.id = Number(this.route.snapshot.paramMap.get('id'));
    this.load();
    this.api.get<Me>('/drivers/me').subscribe({ next: (me) => (this.carSeats = me.driver?.carpool_vehicle?.seats ?? 6) });
    this.carpool.config().subscribe((c) => {
      this.horizonDays = c.publish_horizon_days ?? 30;
      this.priceMax = c.price_max ?? 5000;
      this.retentionDays = c.chat_retention_days ?? 1;
    });
  }

  ngOnDestroy(): void {
    this.timers.forEach(clearTimeout);
    this.clearDrawn?.();
  }

  load(): void {
    this.loading = !this.listing;
    this.loadError = false;
    this.carpool.listing(this.id).subscribe({
      next: (l) => {
        this.listing = l;
        this.loading = false;
        setTimeout(() => this.drawSaved());
      },
      error: () => {
        this.loading = false;
        this.loadError = true;
      },
    });
  }

  // ── labels ──

  get when(): string {
    return this.listing ? whenLabel(this.listing.departs_at) : '';
  }

  get statusLabel(): string {
    switch (this.listing?.status) {
      case 'in_progress': return 'In progress';
      case 'completed': return 'Completed';
      case 'cancelled': return 'Cancelled';
      default: return 'Not started';
    }
  }

  get cancelLine(): string | null {
    return this.listing?.status === 'cancelled' ? cancelReasonLabel(this.listing) : null;
  }

  get price(): string {
    return this.listing ? priceLabel(this.listing) : '';
  }

  get drive(): string {
    return this.listing ? durationLabel(this.listing.duration_s) : '';
  }

  get riders(): number {
    return this.listing?.seats_taken ?? 0;
  }

  // ── the ride (M6) ──

  /** The next pickup: the first rider still waiting, once the ride is on the road. */
  get nextRider(): CarpoolJoinRequest | null {
    if (this.listing?.status !== 'in_progress') return null;
    return this.listing.riders?.find((r) => r.ride_state === 'waiting') ?? null;
  }

  /** Riders still on this ride, no-shows left out. */
  get activeCount(): number {
    return (this.listing?.riders ?? []).filter((r) => r.ride_state !== 'no_show').length;
  }

  get pickedCount(): number {
    return (this.listing?.riders ?? []).filter((r) => r.ride_state === 'picked_up' || r.ride_state === 'dropped').length;
  }

  /** Planned arrival, moved by how late the ride really started. */
  get arrival(): string {
    const l = this.listing;
    return l?.started_at ? clock(new Date(new Date(l.started_at).getTime() + l.duration_s * 1000)) : '';
  }

  get ranRange(): string {
    const l = this.listing;
    return l?.started_at && l.completed_at ? `${clock(l.started_at)}–${clock(l.completed_at)}` : '';
  }

  /** The planned distance; there is no live tracking in v1. */
  get km(): string {
    return this.listing ? kmLabel(this.listing.distance_m) : '';
  }

  get showDock(): boolean {
    const l = this.listing;
    return !!l && (l.status === 'published' || l.status === 'in_progress' || (l.status === 'completed' && !!l.group_chat_id));
  }

  starting = false;
  completing = false;
  dropping = false;
  noShowing = false;
  noShown = false;
  rideError: string | null = null;
  rideErrorTitle = '';
  private rideRetry: 'start' | 'complete' | null = null;

  startRide(): void {
    if (!this.listing || this.starting) return;
    this.starting = true;
    this.rideError = null;
    this.rideRetry = 'start';
    this.carpool.startRide(this.id).subscribe({
      next: () => {
        this.starting = false;
        this.load();
      },
      error: (err) => {
        this.starting = false;
        this.rideErrorTitle = "Couldn't start the ride";
        this.rideError = this.message(err, 'No connection. Riders weren\'t told.');
      },
    });
  }

  completeRide(): void {
    if (!this.listing || this.completing) return;
    this.completing = true;
    this.rideError = null;
    this.rideRetry = 'complete';
    this.carpool.completeRide(this.id).subscribe({
      next: () => {
        this.completing = false;
        this.load();
      },
      error: (err) => {
        this.completing = false;
        this.rideErrorTitle = "Couldn't complete the ride";
        this.rideError = this.message(err, 'No connection.');
      },
    });
  }

  retryRide(): void {
    if (this.rideRetry === 'start') this.startRide();
    else if (this.rideRetry === 'complete') this.completeRide();
  }

  openGroup(): void {
    if (this.listing?.group_chat_id) void this.nav.navigateForward(`/carpool/chat/${this.listing.group_chat_id}`);
  }

  /** "Check code and pick up" opens the code screen (mockup 11). */
  goPickup(r: CarpoolJoinRequest): void {
    this.sheet = null;
    void this.nav.navigateForward(`/carpool/listing/${this.id}/pickup/${r.id}`);
  }

  markDropped(r: CarpoolJoinRequest): void {
    if (this.dropping) return;
    this.dropping = true;
    this.riderError = null;
    this.carpool.markDropped(r.id).subscribe({
      next: () => {
        this.dropping = false;
        this.sheet = null;
        this.load();
      },
      error: (err) => {
        this.dropping = false;
        this.riderError = this.message(err, 'No connection.');
      },
    });
  }

  confirmNoShow(): void {
    const r = this.rider;
    if (!r || this.noShowing) return;
    this.noShowing = true;
    this.riderError = null;
    this.carpool.markNoShow(r.id).subscribe({
      next: () => {
        this.noShowing = false;
        this.noShown = true;
        this.later(() => {
          this.sheet = null;
          this.noShown = false;
          this.load();
        }, 1600);
      },
      error: (err) => {
        this.noShowing = false;
        this.riderError = this.message(err, 'No connection.');
      },
    });
  }

  // ── map ──

  private async drawSaved(): Promise<void> {
    const el = this.mapEl?.nativeElement;
    if (!el || !this.listing) return;
    try {
      await loadCarpoolMaps(this.places);
    } catch {
      return;
    }
    if (!this.map) this.map = createMap(el);
    this.clearDrawn?.();
    const path = this.mode === 'route'
      ? null
      : this.draft?.route?.path ?? toPath(this.listing.route_polyline);
    if (path) this.clearDrawn = drawRoutes(this.map, [path], 0);
    else this.clearDrawn = drawRoutes(this.map, this.routes.map((r) => r.path), this.routeChoice, (i) => this.pickRoute(i));
  }

  // ── menu, back ──

  // ── riders (M4: mockup 8, 8b, 8d) ──

  rider: CarpoolJoinRequest | null = null;
  removing = false;
  removed = false;
  riderError: string | null = null;
  readonly clock = clock;

  seatWord(n: number): string {
    return `${n} ${n === 1 ? 'seat' : 'seats'}`;
  }

  openRider(r: CarpoolJoinRequest): void {
    this.rider = r;
    this.riderError = null;
    this.removed = false;
    this.noShown = false;
    this.sheet = 'rider';
  }

  /** The private Paid tick: a reminder for the driver only. */
  togglePaid(r: CarpoolJoinRequest): void {
    const paid = !r.paid_marked;
    r.paid_marked = paid;
    this.carpool.markPaid(r.id, paid).subscribe({
      error: () => {
        r.paid_marked = !paid;
        this.riderError = "Couldn't save the Paid tick. Check your connection.";
      },
    });
  }

  confirmRemove(): void {
    const r = this.rider;
    if (!r || this.removing) return;
    this.removing = true;
    this.riderError = null;
    this.carpool.removeRider(r.id).subscribe({
      next: () => {
        this.removing = false;
        this.removed = true;
        this.later(() => {
          this.sheet = null;
          this.load();
        }, 1600);
      },
      error: (err) => {
        this.removing = false;
        this.riderError = this.message(err, 'No connection.');
      },
    });
  }

  /** Message privately, or Report (opens the private chat with the report sheet up). */
  messageRider(r: CarpoolJoinRequest, report = false): void {
    if (!r.chat_id) return;
    this.sheet = null;
    void this.nav.navigateForward(`/carpool/chat/${r.chat_id}`, report ? { queryParams: { report: 1 } } : undefined);
  }

  openRiderProfile(r: CarpoolJoinRequest): void {
    this.sheet = null;
    void this.nav.navigateForward(`/carpool/listing/${this.id}/rider/${r.id}`);
  }

  toggleMenu(): void {
    this.menuOpen = !this.menuOpen;
  }

  back(): void {
    if (this.mode === 'edit') {
      this.discard();
      return;
    }
    if (this.mode === 'route') {
      this.closeRoutes();
      return;
    }
    void this.nav.navigateBack('/carpool/carpools');
  }

  // ── +10 min delay ──

  delay(): void {
    if (!this.listing || this.delaying) return;
    this.delaying = true;
    this.delayError = null;
    this.delayMsg = null;
    this.carpool.delayListing(this.listing.id).subscribe({
      next: (l) => {
        this.listing = l;
        this.delaying = false;
        this.delayMsg = `Moved to ${clock(l.departs_at)}.`;
        this.later(() => (this.delayMsg = null), 3000);
      },
      error: (err) => {
        this.delaying = false;
        this.delayError = this.message(err, 'No connection.');
      },
    });
  }

  // ── edit (8h) ──

  startEdit(): void {
    const l = this.listing;
    this.menuOpen = false;
    if (!l?.can_edit) return;
    const at = new Date(l.departs_at);
    this.draft = { date: indiaDate(at), time: indiaTime(at), seats: l.seats_total, free: l.is_free, price: l.is_free ? null : l.price_per_seat, route: null };
    this.saveError = null;
    this.saved = false;
    this.mode = 'edit';
  }

  get seatsMin(): number {
    return Math.max(1, this.listing?.seats_taken ?? 0);
  }

  get seatsHint(): string {
    const taken = this.listing?.seats_taken ?? 0;
    return taken ? `${taken} ${taken === 1 ? 'rider is' : 'riders are'} in, so not below ${taken}` : `Your car has ${this.carSeats}`;
  }

  get draftWhen(): string {
    return this.draft ? whenLabel(indiaIso(this.draft.date, this.draft.time)) : '';
  }

  get draftLocal(): string {
    return this.draft ? `${this.draft.date}T${this.draft.time}` : '';
  }

  get minLocal(): string {
    const now = new Date();
    return `${indiaDate(now)}T${indiaTime(now)}`;
  }

  get maxLocal(): string {
    return `${addDays(indiaDate(), this.horizonDays)}T23:59`;
  }

  pickWhen(value: string): void {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value ?? '');
    if (!m || !this.draft) return;
    if (daysFromToday(m[1]) < 0 || daysFromToday(m[1]) > this.horizonDays) return;
    this.draft.date = m[1];
    this.draft.time = m[2];
  }

  onPrice(value: string): void {
    if (!this.draft) return;
    const n = parseInt(value.replace(/\D/g, ''), 10);
    this.draft.price = Number.isFinite(n) ? n : null;
  }

  get draftError(): string | null {
    const d = this.draft;
    if (!d) return null;
    if (d.date === indiaDate() && d.time <= indiaTime(new Date())) return 'Pick a time that is still to come.';
    if (!d.free && (!d.price || d.price < 1)) return 'Set a price per seat, or turn on Free ride.';
    if (!d.free && d.price && d.price > this.priceMax) return `The highest price per seat is ₹${this.priceMax}.`;
    return null;
  }

  /** Only what changed, so nothing else is touched and riders hear only real changes. */
  private changes(): CarpoolEditInput {
    const l = this.listing;
    const d = this.draft;
    if (!l || !d) return {};
    const out: CarpoolEditInput = {};
    const at = new Date(l.departs_at);
    if (d.date !== indiaDate(at) || d.time !== indiaTime(at)) out.departs_at = indiaIso(d.date, d.time);
    if (d.seats !== l.seats_total) out.seats = d.seats;
    if (d.free !== l.is_free) out.is_free = d.free;
    if (!d.free && d.price !== (l.is_free ? null : l.price_per_seat)) {
      out.price_per_seat = d.price;
      out.is_free = false;
    }
    if (d.route) {
      const r = d.route;
      out.route = { polyline: r.polyline, distance_m: r.distance_m, duration_s: r.duration_s, summary: r.summary };
    }
    return out;
  }

  get dirty(): boolean {
    return Object.keys(this.changes()).length > 0;
  }

  save(): void {
    if (!this.listing || this.saving || this.draftError) return;
    const changes = this.changes();
    if (!Object.keys(changes).length) {
      this.endEdit();
      return;
    }
    this.saving = true;
    this.saveError = null;
    this.carpool.editListing(this.listing.id, changes).subscribe({
      next: (l) => {
        this.listing = l;
        this.saving = false;
        this.saved = true;
        this.later(() => this.endEdit(), 2000);
      },
      error: (err) => {
        this.saving = false;
        this.saveError = this.message(err, 'No connection.');
      },
    });
  }

  discard(): void {
    if (this.saving || this.saved) return;
    if (this.dirty) this.sheet = 'discard';
    else this.endEdit();
  }

  confirmDiscard(): void {
    this.sheet = null;
    this.endEdit();
  }

  private endEdit(): void {
    this.mode = 'view';
    this.draft = null;
    this.saved = false;
    this.saveError = null;
    setTimeout(() => this.drawSaved());
  }

  get riderNote(): string {
    const n = this.riders;
    return n ? 'Pickups stay as they are. Riders are told what you change.' : 'Riders who join later see the new details.';
  }

  get savedText(): string {
    return this.riders ? 'Saved. Riders were told what changed.' : 'Saved.';
  }

  get failNote(): string {
    return this.riders ? "Riders weren't told." : 'Nothing was changed.';
  }

  // ── change route (8i) ──

  async openRoutes(): Promise<void> {
    if (!this.listing) return;
    this.mode = 'route';
    this.routesError = null;
    this.routesLoading = true;
    try {
      await loadCarpoolMaps(this.places);
      this.routes = await fetchRouteOptions(this.listing.start, this.listing.end);
      const current = this.draft?.route?.summary ?? this.listing.route_summary;
      const at = this.routes.findIndex((r) => r.summary === current);
      this.routeChoice = at >= 0 ? at : 0;
    } catch {
      this.routes = [];
      this.routesError = "Couldn't find routes. Check your connection and try again.";
    } finally {
      this.routesLoading = false;
      setTimeout(() => this.drawSaved());
    }
  }

  pickRoute(i: number): void {
    this.routeChoice = i;
    this.drawSaved();
  }

  routeNote(r: RouteOption): string {
    const fastest = this.routes.every((o) => o.duration_s >= r.duration_s);
    return `${kmLabel(r.distance_m)}${fastest && this.routes.length > 1 ? ', fastest' : ''}`;
  }

  dur(s: number): string {
    return durationLabel(s);
  }

  useRoute(): void {
    const r = this.routes[this.routeChoice];
    if (r && this.draft) {
      this.draft.route = r.summary === this.listing?.route_summary && r.distance_m === this.listing?.distance_m ? null : r;
    }
    this.closeRoutes();
  }

  closeRoutes(): void {
    this.mode = 'edit';
    setTimeout(() => this.drawSaved());
  }

  get draftRouteLine(): string {
    const r = this.draft?.route;
    return r ? `${r.summary ?? 'New route'}, ${kmLabel(r.distance_m)}, ${durationLabel(r.duration_s)}` : '';
  }

  // ── cancel (8g) ──

  openCancel(): void {
    this.menuOpen = false;
    this.reason = null;
    this.cancelError = null;
    this.swipeX = 0;
    this.sheet = 'cancel';
  }

  closeSheet(): void {
    if (this.cancelling || this.cancelled) return;
    this.sheet = null;
  }

  swipeDown(ev: PointerEvent): void {
    if (this.cancelling || this.cancelled) return;
    const el = this.swipeEl?.nativeElement;
    if (!el) return;
    this.swipeMax = el.clientWidth - 56;
    this.swipeStart = ev.clientX - this.swipeX;
    (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
  }

  swipeMove(ev: PointerEvent): void {
    if (this.swipeStart === null) return;
    this.swipeX = Math.max(0, Math.min(this.swipeMax, ev.clientX - this.swipeStart));
  }

  swipeUp(): void {
    if (this.swipeStart === null) return;
    this.swipeStart = null;
    if (this.swipeMax > 0 && this.swipeX >= this.swipeMax * 0.92) {
      this.swipeX = this.swipeMax;
      this.confirmCancel();
    } else {
      this.swipeX = 0;
    }
  }

  /** Keyboard: End or Enter on the focused slider does the same as sliding all the way. */
  swipeKey(ev: KeyboardEvent): void {
    if (ev.key === 'End' || ev.key === 'Enter') {
      ev.preventDefault();
      const el = this.swipeEl?.nativeElement;
      this.swipeX = el ? el.clientWidth - 56 : 0;
      this.confirmCancel();
    }
  }

  get swipePercent(): number {
    return this.swipeMax ? Math.round((this.swipeX / this.swipeMax) * 100) : 0;
  }

  private confirmCancel(): void {
    if (!this.listing || this.cancelling) return;
    this.cancelling = true;
    this.cancelError = null;
    const note = this.reason !== null ? this.cancelReasons[this.reason] : null;
    this.carpool.cancelListing(this.listing.id, note).subscribe({
      next: (l) => {
        this.listing = l;
        this.cancelling = false;
        this.cancelled = true;
        this.later(() => {
          this.sheet = null;
          void this.nav.navigateRoot('/carpool/carpools', { state: { filter: 'past' } });
        }, 1600);
      },
      error: (err) => {
        this.cancelling = false;
        this.swipeX = 0;
        this.cancelError = this.message(err, 'No connection.');
      },
    });
  }

  get cancelText(): string {
    return this.riders
      ? "Your riders are told it's cancelled by you, and the carpool is removed from search."
      : "Nobody has joined yet. The carpool is removed from search, and this can't be undone.";
  }

  // ── helpers ──

  private message(err: any, offline: string): string {
    const errors = err?.error?.errors ?? {};
    const first = Object.values(errors)[0] as string[] | undefined;
    return first?.[0] ?? (err?.status === 0 ? offline : 'Something went wrong.');
  }

  private later(fn: () => void, ms: number): void {
    this.timers.push(setTimeout(fn, ms));
  }
}
