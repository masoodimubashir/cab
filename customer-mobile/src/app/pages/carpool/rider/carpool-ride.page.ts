import { Component, ElementRef, NgZone, OnDestroy, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NavController } from '@ionic/angular';
import { PlacesService } from '../../../core/places.service';
import { CarpoolApiService } from '../carpool-api.service';
import { CarpoolMyRequest, CarpoolRide, CarpoolRoutePoint } from '../carpool.models';
import { clock, distanceLabel, indiaDate, priceLabel, seatWord, titleWhen } from './rider-format';
import { LatLng, createMap, drawRide, flat, loadRiderMaps, pathLength, pickupPin, placeName, snapToPath, toPath, youMarker } from './rider-map';
import { RiderSearch, fromParams, toParams, toQuery } from './rider-search';

type View = 'open' | 'sent' | 'accepted' | 'started' | 'ended';
type Sheet = 'ask' | 'photo' | 'cancel' | 'leave' | 'rate' | null;

/** A pickup the rider is about to ask for: a point on the route with its name and timing. */
interface AskPoint extends LatLng {
  name: string;
  address: string | null;
  along_m: number;
  walk_m: number;
  at: string;
}

/** A line under the title saying where things stand (mockup .statehead). */
interface Head { text: string; small?: string; icon?: string; cls?: 'ok' | 'grey'; live?: boolean; }

/**
 * The carpool page, rider side, in every state (customer mockup 4, 4b, 8b,
 * 8d, 8j, 8k) with its sheets: Ask to join (5), the photo prompt (5a), Move
 * the pickup (5b), Cancel a request (8c) and Leave (8h). M6 adds the started
 * state (8e: how soon the car reaches you, worked out from the plan), the
 * past page with Rate (8f) and the rating sheet (8g).
 */
@Component({
  selector: 'app-carpool-ride',
  templateUrl: './carpool-ride.page.html',
  styleUrls: ['./carpool-rider.scss'],
  standalone: false,
})
export class CarpoolRidePage implements OnDestroy {
  @ViewChild('mapEl') mapEl?: ElementRef<HTMLElement>;
  @ViewChild('pkEl') pkEl?: ElementRef<HTMLElement>;
  @ViewChild('pinEl') pinEl?: ElementRef<HTMLElement>;

  id = 0;
  search: RiderSearch | null = null;
  ride: CarpoolRide | null = null;
  loading = true;
  loadError = false;
  gone = false;
  mapFailed = false;

  sheet: Sheet = null;
  askSeats = 1;
  askPickup: AskPoint | null = null;
  sending = false;
  sheetError: string | null = null;
  sent = false;
  uploading = false;
  photoPreview: string | null = null;
  working = false;
  done = false;

  pinOpen = false;
  pinDraft: AskPoint | null = null;
  pinNaming = false;
  pinError: string | null = null;

  readonly seatWord = seatWord;
  readonly clock = clock;
  readonly distance = distanceLabel;

  private map: any = null;
  private pkMap: any = null;
  private pinMap: any = null;
  private pin: any = null;
  private clear: (() => void)[] = [];
  private timers: ReturnType<typeof setTimeout>[] = [];
  private poll: ReturnType<typeof setInterval> | null = null;

  // ── Rate the driver (8g) ──
  rateScore = 0;
  rateComment = '';
  rateSending = false;
  rateDone = false;
  rateError: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private nav: NavController,
    private carpool: CarpoolApiService,
    private places: PlacesService,
    private zone: NgZone,
  ) {}

  ionViewWillEnter(): void {
    this.id = Number(this.route.snapshot.paramMap.get('id'));
    this.search = fromParams(this.route.snapshot.queryParams);
    this.load();
    // While you wait for or ride in the car, the page checks for news every 15 seconds.
    this.stopPoll();
    this.poll = setInterval(() => {
      if (this.view === 'started' || (this.view === 'accepted' && this.nearDeparture)) this.refresh();
    }, 15000);
  }

  /** Within an hour of leaving (or past it): the only time an accepted ride can change under you. */
  private get nearDeparture(): boolean {
    return !!this.ride && new Date(this.ride.departs_at).getTime() - Date.now() < 60 * 60 * 1000;
  }

  ionViewWillLeave(): void {
    this.stopPoll();
  }

  private stopPoll(): void {
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
  }

  /** A quiet reload: no spinner, keeps what is on screen if it fails. */
  private refresh(): void {
    this.carpool.ride(this.id, this.search ? toQuery(this.search) : undefined).subscribe({
      next: (r) => {
        this.ride = r;
        this.maybeAskRating();
      },
    });
  }

  ngOnDestroy(): void {
    this.stopPoll();
    this.timers.forEach(clearTimeout);
    this.clear.forEach((c) => c());
  }

  load(): void {
    this.loading = !this.ride;
    this.loadError = false;
    this.carpool.ride(this.id, this.search ? toQuery(this.search) : undefined).subscribe({
      next: (r) => {
        this.ride = r;
        this.loading = false;
        this.gone = false;
        setTimeout(() => void this.drawMain());
        this.maybeAskRating();
      },
      error: (e) => {
        this.loading = false;
        if (e?.status === 404) this.gone = true;
        else this.loadError = true;
      },
    });
  }

  // ── which state ──

  get mine(): CarpoolMyRequest | null {
    return this.ride?.my_request ?? null;
  }

  get view(): View {
    const m = this.mine;
    if (m && !m.past) return m.state as View;
    // An ended request opened from a fresh search can ask again; from My trips it shows how it ended.
    if (m && !(this.search && this.ride?.can_request)) return 'ended';
    return 'open';
  }

  get first(): string {
    return this.ride?.driver.first_name ?? 'The driver';
  }

  get title(): string {
    return this.ride ? titleWhen(this.ride.departs_at) : '';
  }

  /** "Rajbagh to Nigeen with Imran". */
  get subtitle(): string {
    const p = this.points;
    const from = this.view === 'open' ? this.search?.from.name : this.mine?.pickup.name;
    const to = this.view === 'open' ? this.search?.to.name : this.mine?.drop.name;
    if (!p || !from || !to) return this.ride ? `${this.ride.start.name} to ${this.ride.end.name} with ${this.first}` : '';
    return `${from} to ${to} with ${this.first}`;
  }

  /** The pickup and drop shown on the page: suggested from the search, or the request's own. */
  get points(): { pickup: CarpoolRoutePoint; drop: CarpoolRoutePoint } | null {
    if (this.view === 'open') return this.ride?.suggested ?? null;
    return this.mine ? { pickup: this.mine.pickup, drop: this.mine.drop } : null;
  }

  /** Amber line when the driver changed the time or route (customer 8i). */
  get changeLine(): { text: string; small?: string } | null {
    const r = this.ride;
    if (!r?.changed || (this.view !== 'sent' && this.view !== 'accepted')) return null;
    if (r.changed.kind === 'route') return { text: `${this.first} changed the route`, small: 'Check your pickup and drop below.' };
    const was = r.changed.was_at ? `It was ${clock(r.changed.was_at)}.` : undefined;
    return { text: `${this.first} changed the time to ${clock(r.departs_at)}`, small: was };
  }

  get head(): Head | null {
    const r = this.ride;
    const m = this.mine;
    if (!r) return null;
    switch (this.view) {
      case 'open':
        return r.status === 'in_progress' ? this.roadHead() : null;
      case 'sent':
        return { icon: 'time-outline', cls: 'grey', text: `Waiting for ${this.first} to answer` };
      case 'accepted':
        return { icon: 'checkmark-circle', cls: 'ok', text: `${this.first} accepted your request` };
      case 'started':
        return this.startedHead();
    }
    const grey = (text: string, small?: string): Head => ({ icon: 'close-circle-outline', cls: 'grey', text, small });
    switch (m?.state) {
      case 'cancelled':
        if (r.cancel_reason === 'plan_ended') return grey("Cancelled: the driver's plan has ended");
        if (r.cancel_reason === 'admin') return grey('Cancelled by Dream Cabs');
        if (r.cancel_reason === 'missed_departure') return grey("Cancelled: it didn't start that day");
        return grey(`Cancelled by ${this.first}`, r.cancel_note ? `Reason: ${r.cancel_note.charAt(0).toLowerCase()}${r.cancel_note.slice(1)}` : undefined);
      case 'declined': return grey(`${this.first} couldn't take this request`, 'You can still find other carpools for this trip.');
      case 'removed': return grey(`${this.first} removed you from this carpool`);
      case 'filled': return grey(`This carpool filled up before ${this.first} answered`);
      case 'ended': return grey(`This carpool ended before ${this.first} answered`);
      case 'left': return grey('You left this carpool');
      case 'withdrawn': return grey('You cancelled this request');
      case 'no_show': return grey('Marked as a no-show');
      case 'completed': return { icon: 'checkmark-circle', cls: 'grey', text: `Dropped at ${m.drop.name}` };
      default: return null;
    }
  }

  /** 4b: the car left already; how soon it reaches the suggested pickup, from the plan. */
  private roadHead(): Head {
    const mins = this.ride?.on_road?.minutes_to_pickup;
    if (mins == null) return { live: true, text: 'Already on the road', small: `It left at ${clock(this.ride!.departs_at)}.` };
    if (mins < 0) return { live: true, text: 'Already on the road', small: 'The car has probably passed your pickup. Ask before you request.' };
    return { live: true, text: 'Already on the road', small: mins < 1 ? 'It is at your pickup now.' : `About ${mins} min from your pickup.` };
  }

  /** 8e: where the car is and how soon it reaches you, then the drop time once you're in. */
  private startedHead(): Head {
    const p = this.mine?.ride;
    if (!p) return { live: true, text: `${this.first} is on the way` };
    if (p.picked_up) return { live: true, text: `You're on your way to ${this.mine?.drop.name}`, small: `Drop about ${clock(p.drop_at)}.` };
    if (p.minutes_away < 1) return { live: true, text: `${this.first} is at your pickup` };
    return { live: true, text: `${this.first} is ${p.minutes_away} min from your pickup` };
  }

  /** Dropped off and not rated: the sheet opens once (8g); Not now keeps the button on the past page. */
  private maybeAskRating(): void {
    const m = this.mine;
    if (!m?.can_rate || this.sheet || this.rateDone) return;
    try {
      if (localStorage.getItem(`carpool_rate_skipped_${this.ride?.id}`)) return;
    } catch {
      /* storage can be blocked; the sheet then shows once per visit */
    }
    this.openRate();
  }

  openRate(): void {
    this.rateScore = 0;
    this.rateComment = '';
    this.rateError = null;
    this.rateDone = false;
    this.sheet = 'rate';
  }

  skipRate(): void {
    try {
      localStorage.setItem(`carpool_rate_skipped_${this.ride?.id}`, '1');
    } catch {
      /* fine */
    }
    this.sheet = null;
  }

  sendRate(): void {
    if (!this.rateScore || this.rateSending || !this.ride) return;
    this.rateSending = true;
    this.rateError = null;
    this.carpool.rateDriver(this.ride.id, this.rateScore, this.rateComment.trim() || null).subscribe({
      next: () => {
        this.rateSending = false;
        this.rateDone = true;
        this.load();
      },
      error: (e) => {
        this.rateSending = false;
        this.rateError = (Object.values(e?.error?.errors ?? {})[0] as string[] | undefined)?.[0] ?? "Couldn't send your rating. Check your connection.";
      },
    });
  }

  /** Group chat and Rate, shown on the past page of a trip you rode (8f). */
  get rode(): boolean {
    return this.view === 'ended' && this.mine?.state === 'completed';
  }

  openGroup(): void {
    const id = this.ride?.group_chat_id;
    if (id) void this.nav.navigateForward(`/carpool/chat/${id}`);
  }

  get pickupLabel(): string {
    const at = this.points?.pickup.at;
    switch (this.view) {
      case 'open': return at ? `Suggested pickup, about ${clock(at)}` : 'Suggested pickup';
      case 'sent': return at ? `Your pickup, about ${clock(at)}` : 'Your pickup';
      case 'ended': return this.mine?.picked_up_at ? `Picked up ${clock(this.mine.picked_up_at)}` : 'Pickup';
      default: return at ? `Pickup, about ${clock(at)}` : 'Pickup';
    }
  }

  get dropLabel(): string {
    const at = this.points?.drop.at;
    if (this.view === 'ended' && this.mine?.dropped_at) return `Dropped ${clock(this.mine.dropped_at)}`;
    return this.view === 'ended' || !at ? 'Drop' : `Drop, about ${clock(at)}`;
  }

  get pickupName(): string {
    if (this.view !== 'open') return this.mine?.pickup.name ?? '';
    const walk = this.ride?.suggested?.pickup.walk_m;
    return `${this.search?.from.name ?? ''}${walk != null ? `, ${distanceLabel(walk)} from you` : ''}`;
  }

  get dropName(): string {
    return this.view === 'open' ? this.search?.to.name ?? '' : this.mine?.drop.name ?? '';
  }

  /** "₹120, paid to Imran", "₹120" or "Free ride". */
  get moneyLine(): string {
    const m = this.mine;
    if (!m) return '';
    if (m.is_free) return 'Free ride';
    return this.view === 'accepted' || this.view === 'started' ? `₹${m.total}, paid to ${this.first}` : `₹${m.total}`;
  }

  get priceTag(): string {
    return this.ride ? priceLabel(this.ride) : '';
  }

  /** What the bottom button says while asking isn't possible. */
  get blockedLabel(): string | null {
    const r = this.ride;
    if (!r) return null;
    switch (r.blocked) {
      case 'full': return 'Full';
      case 'seats': return `Not enough seats for ${this.search?.seats ?? 1}`;
      case 'off': return 'Not taking requests right now';
      case 'own': return 'This is your own carpool';
      case 'ended': return 'This carpool has ended';
      default: return null;
    }
  }

  // ── map ──

  private async drawMain(): Promise<void> {
    const el = this.mapEl?.nativeElement;
    if (!el || !this.ride) return;
    try {
      await loadRiderMaps(this.places);
    } catch {
      this.zone.run(() => (this.mapFailed = true));
      return;
    }
    if (!this.map) this.map = createMap(el);
    this.clear.forEach((c) => c());
    this.clear = [drawRide(this.map, toPath(this.ride.route_polyline), this.points, this.view === 'ended')];
  }

  // ── Ask to join (5) ──

  openAsk(): void {
    const s = this.ride?.suggested;
    if (!this.ride || !s) return;
    this.askSeats = Math.max(1, Math.min(this.search?.seats ?? 1, this.ride.seats_free, 6));
    this.askPickup = {
      lat: s.pickup.lat, lng: s.pickup.lng, name: this.search?.from.name ?? 'Your pickup', address: this.search?.from.address ?? null,
      along_m: s.pickup.along_m ?? 0, walk_m: s.pickup.walk_m ?? 0, at: s.pickup.at,
    };
    this.sheetError = null;
    this.sent = false;
    this.sheet = 'ask';
    setTimeout(() => void this.drawPk());
  }

  get askMax(): number {
    return Math.max(1, Math.min(this.ride?.seats_free ?? 1, 6));
  }

  setAskSeats(n: number): void {
    this.askSeats = Math.max(1, Math.min(n, this.askMax));
  }

  get askLine(): string {
    return this.ride?.is_free ? seatWord(this.askSeats) : `${seatWord(this.askSeats)} × ₹${this.ride?.price_per_seat ?? 0}`;
  }

  get askTotal(): string {
    return this.ride?.is_free ? 'Free' : `₹${this.askSeats * (this.ride?.price_per_seat ?? 0)}`;
  }

  get askNote(): string {
    return this.ride?.is_free
      ? "A free ride. Dream Cabs doesn't take payment. Any change is agreed in chat."
      : `${this.first}'s fixed price. Pay ${this.first} directly; Dream Cabs doesn't take payment. Any change is agreed in chat.`;
  }

  get askWhen(): string {
    return this.ride ? `${titleWhen(this.ride.departs_at)}${this.ride.car ? ` · ${this.ride.car.label}` : ''}` : '';
  }

  private async drawPk(): Promise<void> {
    const el = this.pkEl?.nativeElement;
    if (!el || !this.ride || !this.askPickup) return;
    try {
      await loadRiderMaps(this.places);
    } catch {
      return;
    }
    this.pkMap = createMap(el);
    const path = toPath(this.ride.route_polyline);
    const g = (window as any).google;
    new g.maps.Polyline({ map: this.pkMap, path, strokeColor: '#087f50', strokeWeight: 6, clickable: false });
    const ring = document.createElement('div');
    ring.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#fff;border:3px solid #101a2c';
    new g.maps.marker.AdvancedMarkerElement({ map: this.pkMap, position: this.askPickup, content: ring, zIndex: 3 });
    if (this.search?.from) youMarker(this.pkMap, this.search.from);
    this.pkMap.setCenter(this.askPickup);
    this.pkMap.setZoom(16);
  }

  send(): void {
    if (!this.ride || !this.askPickup || this.sending) return;
    const s = this.ride.suggested;
    if (!s) return;
    this.sending = true;
    this.sheetError = null;
    this.carpool.join(this.ride.id, {
      seats: this.askSeats,
      pickup: { lat: this.askPickup.lat, lng: this.askPickup.lng, name: this.askPickup.name, address: this.askPickup.address },
      drop: { lat: s.drop.lat, lng: s.drop.lng, name: this.search?.to.name ?? this.ride.end.name, address: this.search?.to.address ?? null },
    }).subscribe({
      next: () => {
        this.sending = false;
        this.sent = true;
        this.timers.push(setTimeout(() => {
          this.sheet = null;
          this.nav.navigateRoot('/customer-tabs/trips');
        }, 1400));
      },
      error: (e) => {
        this.sending = false;
        const errors = e?.error?.errors ?? {};
        if (errors.photo) {
          this.photoPreview = null;
          this.sheet = 'photo';
          return;
        }
        this.sheetError = (Object.values(errors)[0] as string[] | undefined)?.[0] ?? e?.error?.message ?? "Couldn't send the request. Check your connection.";
        this.load();
      },
    });
  }

  // ── Add a profile photo (5a) ──

  onPhoto(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.uploading = true;
    this.sheetError = null;
    const reader = new FileReader();
    reader.onload = () => this.zone.run(() => (this.photoPreview = reader.result as string));
    reader.readAsDataURL(file);
    this.carpool.uploadPhoto(file, file.name || 'photo.jpg').subscribe({
      next: () => {
        this.uploading = false;
        // After the photo is added, the request sends.
        this.sheet = 'ask';
        setTimeout(() => void this.drawPk());
        this.send();
      },
      error: (e) => {
        this.uploading = false;
        this.sheetError = e?.error?.errors?.photo?.[0] ?? "Couldn't upload the photo. Try again.";
      },
    });
  }

  cancelPhoto(): void {
    this.sheet = 'ask';
    this.sheetError = null;
    setTimeout(() => void this.drawPk());
  }

  // ── Move the pickup (5b) ──

  openPin(): void {
    if (!this.askPickup) return;
    this.pinDraft = { ...this.askPickup };
    this.pinError = null;
    this.pinOpen = true;
    setTimeout(() => void this.drawPin());
  }

  closePin(): void {
    this.pinOpen = false;
    this.pinMap = null;
    this.pin = null;
  }

  usePin(): void {
    if (!this.pinDraft || this.pinError) return;
    this.askPickup = { ...this.pinDraft };
    this.closePin();
    setTimeout(() => void this.drawPk());
  }

  get pinLine(): string {
    const p = this.pinDraft;
    if (!p) return '';
    return `On ${this.first}'s route · ${distanceLabel(p.walk_m)} from you · about ${clock(p.at)}`;
  }

  private async drawPin(): Promise<void> {
    const el = this.pinEl?.nativeElement;
    if (!el || !this.ride || !this.pinDraft) return;
    try {
      await loadRiderMaps(this.places);
    } catch {
      return;
    }
    const path = toPath(this.ride.route_polyline);
    this.pinMap = createMap(el, true);
    drawRide(this.pinMap, path, null, false, false);
    if (this.search?.from) youMarker(this.pinMap, this.search.from);
    this.pin = pickupPin(this.pinMap, this.pinDraft, (p) => this.zone.run(() => void this.movePin(p)));
    this.pinMap.addListener('click', (ev: any) => this.zone.run(() => void this.movePin({ lat: ev.latLng.lat(), lng: ev.latLng.lng() })));
    this.pinMap.setCenter(this.pinDraft);
    this.pinMap.setZoom(16);
  }

  /** Snaps a dragged or tapped spot onto the route, names it and times it. */
  private async movePin(spot: LatLng): Promise<void> {
    if (!this.ride || !this.pinDraft) return;
    const path = toPath(this.ride.route_polyline);
    const snap = snapToPath(path, spot);
    this.pin.position = { lat: snap.lat, lng: snap.lng };
    const dropAlong = this.ride.suggested?.drop.along_m ?? Infinity;
    this.pinError = snap.along_m > dropAlong - 300 ? 'Pick a spot before your drop.' : null;
    const len = pathLength(path) || 1;
    const at = new Date(new Date(this.ride.departs_at).getTime() + (this.ride.duration_s * 1000 * snap.along_m) / len).toISOString();
    const walk = this.search?.from ? flat(this.search.from, snap) : 0;
    this.pinDraft = { ...this.pinDraft, lat: snap.lat, lng: snap.lng, along_m: snap.along_m, walk_m: walk, at };
    this.pinNaming = true;
    const named = await placeName({ lat: snap.lat, lng: snap.lng }).catch(() => null);
    this.zone.run(() => {
      this.pinNaming = false;
      if (this.pinDraft && named) this.pinDraft = { ...this.pinDraft, name: named.name, address: named.address };
    });
  }

  // ── Cancel a request (8c), Leave (8h) ──

  openSheet(which: 'cancel' | 'leave'): void {
    this.sheetError = null;
    this.done = false;
    this.sheet = which;
  }

  /** "Thu 12 Nov · Rajbagh to Nigeen". */
  get rateTrip(): string {
    const m = this.mine;
    return this.ride && m ? `${titleWhen(this.ride.departs_at)} · ${m.pickup.name} to ${m.drop.name}` : '';
  }

  get sheetTrip(): string {
    const m = this.mine;
    if (!this.ride || !m) return '';
    return this.sheet === 'leave'
      ? `${titleWhen(this.ride.departs_at)} · ${m.pickup.name} to ${m.drop.name} · ${this.ride.driver.name}`
      : `${m.pickup.name} to ${m.drop.name} · ${titleWhen(this.ride.departs_at)} · ${this.ride.driver.name}`;
  }

  confirmSheet(): void {
    const m = this.mine;
    if (!m || this.working) return;
    this.working = true;
    this.sheetError = null;
    const call = this.sheet === 'leave' ? this.carpool.leaveCarpool(m.id) : this.carpool.withdrawRequest(m.id);
    call.subscribe({
      next: () => {
        this.working = false;
        this.done = true;
        this.timers.push(setTimeout(() => {
          this.sheet = null;
          this.nav.navigateRoot('/customer-tabs/trips', { queryParams: { tab: 'past' } });
        }, 1400));
      },
      error: (e) => {
        this.working = false;
        this.sheetError = (Object.values(e?.error?.errors ?? {})[0] as string[] | undefined)?.[0] ?? 'Something went wrong. Try again.';
        this.load();
      },
    });
  }

  closeSheet(): void {
    if (this.sending || this.working || this.uploading || this.rateSending) return;
    if (this.sheet === 'rate') {
      this.skipRate();
      return;
    }
    this.sheet = null;
  }

  // ── navigation ──

  back(): void {
    if (this.search) this.nav.navigateBack('/carpool/results', { queryParams: toParams(this.search) });
    else this.nav.navigateBack('/customer-tabs/trips');
  }

  messageDriver(): void {
    const id = this.mine?.chat_id;
    if (id) void this.nav.navigateForward(`/carpool/chat/${id}`);
  }

  openDriver(): void {
    void this.router.navigate(['/carpool/ride', this.id, 'driver'], { queryParamsHandling: 'preserve' });
  }

  /** Search with the same trip and seats filled in (8j, 8k). */
  findAnother(): void {
    if (this.search) {
      this.nav.navigateBack('/carpool/search', { queryParams: toParams(this.search) });
      return;
    }
    const m = this.mine;
    const r = this.ride;
    if (!m || !r) {
      this.nav.navigateRoot('/carpool/search');
      return;
    }
    const s: RiderSearch = {
      from: { lat: m.pickup.lat, lng: m.pickup.lng, name: m.pickup.name ?? r.start.name, address: m.pickup.address ?? m.pickup.name ?? '' },
      to: { lat: m.drop.lat, lng: m.drop.lng, name: m.drop.name ?? r.end.name, address: m.drop.address ?? m.drop.name ?? '' },
      date: indiaDate(),
      seats: m.seats,
    };
    this.nav.navigateRoot('/carpool/search', { queryParams: toParams(s) });
  }

  /** Without a search (a shared link), start one along this driver's route. */
  searchThisRoute(): void {
    const r = this.ride;
    if (!r) return;
    const s: RiderSearch = { from: { ...r.start }, to: { ...r.end }, date: indiaDate(new Date(r.departs_at)), seats: 1 };
    this.nav.navigateForward('/carpool/search', { queryParams: toParams(s) });
  }
}
