import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { ApiService } from '../../core/api.service';
import { PlacesService } from '../../core/places.service';
import { GeolocationService } from '../../core/geolocation.service';

declare const google: any;

interface RouteStop {
  id: number;
  seq: number;
  name: string;
  lat: number;
  lng: number;
  is_pickup: boolean;
  is_drop: boolean;
}

interface SharedRoute {
  id: number;
  name: string;
  scope: 'local' | 'outstation';
  mode: 'fixed' | 'shuttle';
  origin_name: string;
  dest_name: string;
  origin_lat: number;
  origin_lng: number;
  dest_lat: number;
  dest_lng: number;
  path_polyline: number[][] | null;
  seat_fare: number | null;
  advance_required: boolean;
  board_anywhere: boolean;
  corridor_buffer_m: number;
  stops: RouteStop[];
}

interface Departure {
  id: number;
  service_date: string | null;
  depart_at: string | null;
  capacity: number;
  seats_taken: number;
  seats_remaining: number;
  status: string;
}

type Step = 'routes' | 'departures' | 'seats' | 'done';

/**
 * Shared-ride seat booking (Fixed / Shuttle). Opened from the booking screen
 * when the rider taps a shared product. Shuttle is bookable end to end (route →
 * departure → stops → confirm); Fixed lists routes but on-spot booking opens
 * with dispatch (Phase 8). The private metered flow is unaffected.
 */
@Component({
  selector: 'app-shared-book',
  templateUrl: './shared-book.page.html',
  styleUrls: ['./shared-book.page.scss'],
  standalone: false,
})
export class SharedBookPage implements OnInit, OnDestroy {
  cityId: number | null = null;
  scope = '';
  mode = '';

  // Which point the next map tap sets.
  pinTarget: 'board' | 'drop' = 'board';
  // Fixed-corridor drop pin (board pin already exists below).
  dropLat: number | null = null;
  dropLng: number | null = null;

  private map: any = null;
  private routeLine: any = null;
  private endpointMarkers: any[] = [];
  private stopMarkers: { id: number; marker: any }[] = [];
  private boardMarker: any = null;
  private dropMarker: any = null;
  private mapClickListener: any = null;
  private mapTries = 0;

  // Real walking path from the rider's device → their pickup, with an ETA.
  etaText: string | null = null;
  deviceLoc: { lat: number; lng: number } | null = null;
  private deviceMarker: any = null;
  private connectorLine: any = null;
  private directionsSvc: any = null;
  private connectorSeq = 0;

  step: Step = 'routes';
  loading = false;
  error: string | null = null;

  routes: SharedRoute[] = [];
  selectedRoute: SharedRoute | null = null;
  departures: Departure[] = [];
  selectedDeparture: Departure | null = null;

  seats = 1;
  boardStopId: number | null = null;
  dropStopId: number | null = null;
  // Fixed-corridor board pin (the rider's boarding point along the corridor).
  boardLat: number | null = null;
  boardLng: number | null = null;
  boardAddress: string | null = null;
  locating = false;
  booking = false;
  confirmation: { id: number; fare_amount: number | null; seats: number } | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    private toast: ToastController,
    private places: PlacesService,
    private geo: GeolocationService,
  ) {}

  ngOnDestroy(): void { this.teardownMap(); }

  private entered = false;

  ngOnInit(): void { this.enter(); } // first load

  // Ionic can REUSE this page instance, so ngOnInit doesn't re-run on a fresh
  // navigation (e.g. tapping Shuttle after Fixed). On a re-entry, re-read the
  // query params so the right mode/scope always loads. (Skip the very first
  // ionViewWillEnter, which fires right after ngOnInit already loaded.)
  ionViewWillEnter(): void {
    if (this.entered) this.enter();
    this.entered = true;
  }

  /** (Re)read the product params and reset the whole flow to a clean start. */
  private enter(): void {
    const q = this.route.snapshot.queryParamMap;
    this.teardownMap();
    this.cityId = q.get('city_id') ? Number(q.get('city_id')) : null;
    this.scope = q.get('scope') || '';
    this.mode = q.get('mode') || '';
    this.step = 'routes';
    this.selectedRoute = null;
    this.selectedDeparture = null;
    this.departures = [];
    this.seats = 1;
    this.boardStopId = null; this.dropStopId = null;
    this.boardLat = null; this.boardLng = null; this.dropLat = null; this.dropLng = null;
    this.boardAddress = null; this.pinTarget = 'board';
    this.confirmation = null;
    this.loadRoutes();
  }

  get title(): string {
    return this.mode === 'fixed' ? 'Fixed ride' : this.mode === 'shuttle' ? 'Shuttle' : 'Shared ride';
  }
  get pickupStops(): RouteStop[] {
    return (this.selectedRoute?.stops || []).filter((s) => s.is_pickup);
  }
  get dropStops(): RouteStop[] {
    return (this.selectedRoute?.stops || []).filter((s) => s.is_drop);
  }
  get fareEstimate(): number {
    return (this.selectedRoute?.seat_fare ?? 0) * Math.max(1, this.seats);
  }
  get boardLabel(): string {
    if (this.isFixed) return this.boardLat != null ? (this.boardAddress || 'Pinned on the route') : '';
    return this.selectedRoute?.stops.find((x) => x.id === this.boardStopId)?.name ?? '';
  }
  get dropLabel(): string {
    if (this.isFixed) return this.dropLat != null ? 'Pinned on the route' : '';
    return this.selectedRoute?.stops.find((x) => x.id === this.dropStopId)?.name ?? '';
  }

  loadRoutes(): void {
    if (this.cityId == null) {
      return;
    }
    this.loading = true;
    this.error = null;
    const modeParam = this.mode ? `&mode=${this.mode}` : '';
    this.api.get<{ data: SharedRoute[] }>(`/shared/routes?city_id=${this.cityId}${modeParam}`).subscribe({
      next: (res) => {
        let rows = res?.data || [];
        if (this.scope) rows = rows.filter((r) => r.scope === this.scope);
        this.routes = rows;
        this.loading = false;
      },
      error: () => {
        this.routes = [];
        this.loading = false;
        this.error = 'Could not load routes for this city.';
      },
    });
  }

  pickRoute(r: SharedRoute): void {
    this.selectedRoute = r;
    this.selectedDeparture = null;
    this.boardStopId = this.pickupStops[0]?.id ?? null;
    this.dropStopId = this.dropStops.length ? this.dropStops[this.dropStops.length - 1].id : null;
    this.seats = 1;
    this.boardLat = null; this.boardLng = null; this.boardAddress = null;
    this.dropLat = null; this.dropLng = null; this.pinTarget = 'board';
    if (r.mode === 'shuttle') {
      this.step = 'departures';
      this.loadDepartures(r);
    } else {
      // Fixed corridor: on-spot booking lands with dispatch (Phase 8).
      this.step = 'seats';
    }
    this.scheduleMapInit(); // the route map appears once a route is chosen
  }

  loadDepartures(r: SharedRoute): void {
    this.loading = true;
    this.api.get<{ data: Departure[] }>(`/shared/routes/${r.id}/departures`).subscribe({
      next: (res) => {
        this.departures = (res?.data || []).filter((d) => d.seats_remaining > 0);
        this.loading = false;
      },
      error: () => {
        this.departures = [];
        this.loading = false;
      },
    });
  }

  pickDeparture(d: Departure): void {
    this.selectedDeparture = d;
    if (this.seats > d.seats_remaining) {
      this.seats = d.seats_remaining;
    }
    this.step = 'seats';
    // Re-fit/resize the map for the seats step (or init it if it isn't up yet).
    if (this.map) { setTimeout(() => { google.maps.event.trigger(this.map, 'resize'); this.fitRoute(); }, 250); }
    else { this.scheduleMapInit(); }
  }

  get maxSeats(): number {
    return Math.min(10, this.selectedDeparture?.seats_remaining ?? 10);
  }

  get isFixed(): boolean {
    return this.selectedRoute?.mode === 'fixed';
  }

  canBook(): boolean {
    if (!this.selectedRoute || this.seats < 1) {
      return false;
    }
    if (this.isFixed) {
      return this.boardLat != null && this.boardLng != null;
    }
    return (
      !!this.selectedDeparture &&
      this.boardStopId != null &&
      this.seats <= (this.selectedDeparture.seats_remaining ?? 0)
    );
  }

  /** Capture the rider's current position as the corridor board pin (Fixed). */
  async captureLocation(): Promise<void> {
    this.locating = true;
    try {
      // Native Capacitor geolocation (handles Android permissions); falls back
      // to the browser API internally. Returns null when it can't get a fix.
      const fix = await this.geo.getCurrentPosition();
      if (!fix) {
        await this.showToast('Could not get your location. Make sure location is on and the app has permission.');
        return;
      }
      this.setDeviceLoc(fix.lat, fix.lng); // raw device location (where the rider is)
      let lat = fix.lat, lng = fix.lng;
      if (this.isFixed && this.selectedRoute) {
        const path = this.routePathPairs();
        if (path.length) { const s = this.nearestPointOnPath(lat, lng, path); lat = s.lat; lng = s.lng; }
      }
      this.boardLat = lat; this.boardLng = lng;
      this.boardAddress = 'My location (snapped to route)';
      this.renderSelections(); // redraws pins + the device→pickup connector
      this.map?.panTo({ lat, lng });
    } finally {
      this.locating = false;
    }
  }

  book(): void {
    if (!this.canBook() || this.booking || !this.selectedRoute) {
      return;
    }
    this.booking = true;
    const body: Record<string, unknown> = { seats: this.seats };
    if (this.isFixed) {
      body['route_id'] = this.selectedRoute.id;
      body['booking_channel'] = 'on_spot';
      body['board_lat'] = this.boardLat;
      body['board_lng'] = this.boardLng;
      if (this.boardAddress) body['board_address'] = this.boardAddress;
      if (this.dropLat != null) { body['drop_lat'] = this.dropLat; body['drop_lng'] = this.dropLng; }
    } else {
      body['route_departure_id'] = this.selectedDeparture!.id;
      body['board_stop_id'] = this.boardStopId;
      if (this.dropStopId != null) {
        body['drop_stop_id'] = this.dropStopId;
      }
    }

    this.api
      .post<{ reservation: { id: number; fare_amount: number | null; seats: number } }>(
        '/shared/seat-reservations',
        body,
        { 'Idempotency-Key': this.uuid() },
      )
      .subscribe({
        next: (res) => {
          this.booking = false;
          this.confirmation = res?.reservation ?? null;
          this.step = 'done';
        },
        error: async (err) => {
          this.booking = false;
          await this.showToast(err?.error?.message || 'Booking failed. Please try again.');
        },
      });
  }

  back(): void {
    if (this.step === 'seats') {
      this.step = this.selectedRoute?.mode === 'shuttle' ? 'departures' : 'routes';
      if (this.step === 'routes') { this.teardownMap(); this.selectedRoute = null; }
      return;
    }
    if (this.step === 'departures') {
      this.step = 'routes';
      this.teardownMap();
      this.selectedRoute = null;
      this.selectedDeparture = null;
      return;
    }
    this.router.navigateByUrl('/customer-tabs');
  }

  // ─── Route map: show the admin-designed path + stops; pick board/drop on it ───
  private scheduleMapInit(): void { this.mapTries = 0; setTimeout(() => this.initMap(), 90); }

  private routePathPairs(): number[][] {
    const r = this.selectedRoute;
    if (!r) return [];
    if (r.path_polyline && r.path_polyline.length) return r.path_polyline;
    if (r.origin_lat != null && r.dest_lat != null) return [[r.origin_lat, r.origin_lng], [r.dest_lat, r.dest_lng]];
    return [];
  }

  private async initMap(): Promise<void> {
    if (!this.selectedRoute) return;
    const el = document.getElementById('sb-map');
    if (!el) { if (this.selectedRoute && this.mapTries++ < 14) setTimeout(() => this.initMap(), 90); return; }
    try { await this.places.ensureLoaded(); } catch { return; }
    if (!this.selectedRoute) return;
    const r = this.selectedRoute;
    const center = r.origin_lat != null ? { lat: r.origin_lat, lng: r.origin_lng } : { lat: 34.0837, lng: 74.7973 };
    this.map = new google.maps.Map(el, {
      center, zoom: 13, disableDefaultUI: true, zoomControl: true, gestureHandling: 'greedy', clickableIcons: false,
    });
    this.mapClickListener = this.map.addListener('click', (e: any) => { if (e.latLng) this.onMapTap(e.latLng.lat(), e.latLng.lng()); });
    this.renderRoute();
    // Ionic's page/sheet animation can leave the map sized wrong at first paint,
    // so tiles + stop pins don't show. Nudge it once the container has settled.
    setTimeout(() => { if (this.map) { google.maps.event.trigger(this.map, 'resize'); this.fitRoute(); } }, 320);
    void this.ensureDeviceLoc(); // get the rider's location so we can draw the connector
  }

  private setDeviceLoc(lat: number, lng: number): void {
    this.deviceLoc = { lat, lng };
    if (!this.map) return;
    this.deviceMarker?.setMap(null);
    this.deviceMarker = new google.maps.Marker({
      position: this.deviceLoc, map: this.map, title: 'You are here', zIndex: 900,
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: '#2563eb', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2.5 },
    });
  }

  /** Best-effort: fetch the rider's location so the device→pickup path can show. */
  private async ensureDeviceLoc(): Promise<void> {
    if (this.deviceLoc) { this.updateConnector(); return; }
    const fix = await this.geo.getCurrentPosition();
    if (!fix) return;
    this.setDeviceLoc(fix.lat, fix.lng);
    this.updateConnector();
  }

  private pickupPoint(): { lat: number; lng: number } | null {
    if (this.isFixed) return this.boardLat != null ? { lat: this.boardLat, lng: this.boardLng as number } : null;
    const s = this.selectedRoute?.stops.find((x) => x.id === this.boardStopId);
    return s ? { lat: s.lat, lng: s.lng } : null;
  }

  /** Draw the real walking path from the device to the pickup, with an ETA. */
  private updateConnector(): void {
    const seq = ++this.connectorSeq;
    this.connectorLine?.setMap(null); this.connectorLine = null;
    this.etaText = null;
    const pu = this.pickupPoint();
    if (!this.map || !pu) return;
    // No location yet? Fetch it now (prompts once) — ensureDeviceLoc re-runs this
    // so the ETA appears as soon as a pickup is chosen, and refreshes on change.
    if (!this.deviceLoc) { void this.ensureDeviceLoc(); return; }

    const draw = (path: { lat: number; lng: number }[], eta: string | null) => {
      if (seq !== this.connectorSeq || !this.map) return;
      this.connectorLine = new google.maps.Polyline({
        path, map: this.map, strokeOpacity: 0, zIndex: 80,
        // dashed, semi-transparent blue — distinct from the green route line.
        icons: [{ icon: { path: 'M 0,-1 0,1', strokeColor: '#2563eb', strokeOpacity: 0.75, scale: 3 }, offset: '0', repeat: '11px' }],
      });
      this.etaText = eta;
    };
    const fallback = () => draw([this.deviceLoc!, pu], this.roughEta(this.deviceLoc!, pu));

    if (!this.directionsSvc) { try { this.directionsSvc = new google.maps.DirectionsService(); } catch { this.directionsSvc = null; } }
    if (!this.directionsSvc) { fallback(); return; }

    this.directionsSvc.route(
      { origin: this.deviceLoc, destination: pu, travelMode: google.maps.TravelMode.WALKING },
      (res: any, status: any) => {
        if (seq !== this.connectorSeq) return;
        if (status === 'OK' && res?.routes?.[0]) {
          const path = res.routes[0].overview_path.map((ll: any) => ({ lat: ll.lat(), lng: ll.lng() }));
          draw(path, res.routes[0].legs?.[0]?.duration?.text ?? this.roughEta(this.deviceLoc!, pu));
        } else {
          fallback(); // Directions unavailable → straight line + rough estimate
        }
      },
    );
  }

  private roughEta(a: { lat: number; lng: number }, b: { lat: number; lng: number }): string {
    const m = this.haversineMeters(a.lat, a.lng, b.lat, b.lng);
    if (m < 60) return 'right here';
    return `${Math.max(1, Math.round(m / 80))} min walk`; // ~80 m/min walking
  }

  private haversineMeters(la: number, lo: number, lb: number, lob: number): number {
    const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lb - la), dLng = toRad(lob - lo);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(la)) * Math.cos(toRad(lb)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  private stopIcon(color: string, scale = 12) {
    return { path: google.maps.SymbolPath.CIRCLE, scale, fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2.5 };
  }

  private renderRoute(): void {
    if (!this.map || !this.selectedRoute) return;
    const r = this.selectedRoute;
    this.routeLine?.setMap(null); this.routeLine = null;
    this.endpointMarkers.forEach((m) => m.setMap(null)); this.endpointMarkers = [];
    this.stopMarkers.forEach((sm) => sm.marker.setMap(null)); this.stopMarkers = [];

    const line = this.routePathPairs().map((p) => ({ lat: p[0], lng: p[1] }));
    if (line.length) this.routeLine = new google.maps.Polyline({ path: line, map: this.map, strokeColor: '#12B35B', strokeWeight: 5, strokeOpacity: 0.95 });

    if (r.origin_lat != null) this.endpointMarkers.push(new google.maps.Marker({ position: { lat: r.origin_lat, lng: r.origin_lng }, map: this.map, title: r.origin_name, icon: this.stopIcon('#0f5132', 8) }));
    if (r.dest_lat != null) this.endpointMarkers.push(new google.maps.Marker({ position: { lat: r.dest_lat, lng: r.dest_lng }, map: this.map, title: r.dest_name, icon: this.stopIcon('#b91c1c', 8) }));

    if (r.mode === 'shuttle') {
      r.stops.forEach((s, i) => {
        const marker = new google.maps.Marker({
          position: { lat: s.lat, lng: s.lng }, map: this.map, title: s.name, zIndex: 50,
          label: { text: String(i + 1), color: '#fff', fontSize: '11px', fontWeight: '700' },
          icon: this.stopIcon('#4338ca', 12),
        });
        marker.addListener('click', () => this.selectStop(s));
        this.stopMarkers.push({ id: s.id, marker });
      });
    }

    this.fitRoute();
    this.renderSelections();
  }

  private fitRoute(): void {
    if (!this.map || !this.selectedRoute) return;
    const b = new google.maps.LatLngBounds();
    this.routePathPairs().forEach((p) => b.extend({ lat: p[0], lng: p[1] }));
    this.selectedRoute.stops.forEach((s) => b.extend({ lat: s.lat, lng: s.lng }));
    if (!b.isEmpty()) this.map.fitBounds(b, 60);
  }

  private onMapTap(lat: number, lng: number): void {
    if (this.step !== 'seats' || !this.selectedRoute) return;
    if (this.isFixed) {
      const path = this.routePathPairs();
      const s = path.length ? this.nearestPointOnPath(lat, lng, path) : { lat, lng };
      if (this.pinTarget === 'board') { this.boardLat = s.lat; this.boardLng = s.lng; this.boardAddress = 'Pinned on the route'; }
      else { this.dropLat = s.lat; this.dropLng = s.lng; }
      this.renderSelections();
    } else {
      const s = this.nearestStop(lat, lng, this.selectedRoute.stops);
      if (s) this.selectStop(s);
    }
  }

  private selectStop(s: RouteStop): void {
    if (this.pinTarget === 'board') this.boardStopId = s.id; else this.dropStopId = s.id;
    this.renderSelections();
  }

  /** Public so the stop <ion-select> can re-sync the map highlight on change. */
  renderSelections(): void {
    if (!this.map) return;
    if (this.isFixed) {
      // Fixed: free pins on the corridor (P = pickup, D = drop).
      this.boardMarker?.setMap(null); this.boardMarker = null;
      this.dropMarker?.setMap(null); this.dropMarker = null;
      const pin = (pos: any, color: string, text: string) => new google.maps.Marker({
        position: pos, map: this.map, zIndex: 999,
        label: { text, color: '#fff', fontSize: '10px', fontWeight: '700' },
        icon: this.stopIcon(color, 13),
      });
      if (this.boardLat != null) this.boardMarker = pin({ lat: this.boardLat, lng: this.boardLng }, '#16a34a', 'P');
      if (this.dropLat != null) this.dropMarker = pin({ lat: this.dropLat, lng: this.dropLng }, '#ef4444', 'D');
    } else {
      // Shuttle: recolor the stop pins in place — chosen pickup green, drop red,
      // the rest stay indigo (so every stop stays visible and obviously tappable).
      for (const sm of this.stopMarkers) {
        const chosen = sm.id === this.boardStopId || sm.id === this.dropStopId;
        const color = sm.id === this.boardStopId ? '#16a34a' : (sm.id === this.dropStopId ? '#ef4444' : '#4338ca');
        sm.marker.setIcon(this.stopIcon(color, chosen ? 13 : 12));
        sm.marker.setZIndex(chosen ? 999 : 50);
      }
    }
    this.updateConnector(); // device → pickup walking path + ETA
  }

  private nearestStop(lat: number, lng: number, stops: RouteStop[]): RouteStop | null {
    let best: RouteStop | null = null, bestD = Infinity;
    for (const s of stops) { const d = this.dist2(lat, lng, s.lat, s.lng); if (d < bestD) { bestD = d; best = s; } }
    return best;
  }

  private nearestPointOnPath(lat: number, lng: number, path: number[][]): { lat: number; lng: number } {
    if (!path.length) return { lat, lng };
    if (path.length === 1) return { lat: path[0][0], lng: path[0][1] };
    let best = { lat: path[0][0], lng: path[0][1] }, bestD = Infinity;
    for (let i = 0; i < path.length - 1; i++) {
      const proj = this.projectOnSegment(lat, lng, { lat: path[i][0], lng: path[i][1] }, { lat: path[i + 1][0], lng: path[i + 1][1] });
      const d = this.dist2(lat, lng, proj.lat, proj.lng);
      if (d < bestD) { bestD = d; best = proj; }
    }
    return best;
  }

  private projectOnSegment(plat: number, plng: number, a: { lat: number; lng: number }, b: { lat: number; lng: number }): { lat: number; lng: number } {
    const cos = Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180) || 1e-6;
    const ax = a.lng * cos, ay = a.lat, bx = b.lng * cos, by = b.lat, px = plng * cos, py = plat;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1e-12;
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return { lat: ay + t * dy, lng: (ax + t * dx) / cos };
  }

  private dist2(la: number, lo: number, lb: number, lob: number): number {
    const cos = Math.cos(((la + lb) / 2) * Math.PI / 180) || 1e-6;
    const dx = (lo - lob) * cos, dy = la - lb;
    return dx * dx + dy * dy;
  }

  private teardownMap(): void {
    this.mapClickListener?.remove?.(); this.mapClickListener = null;
    this.routeLine?.setMap(null); this.routeLine = null;
    this.endpointMarkers.forEach((m) => m.setMap(null)); this.endpointMarkers = [];
    this.stopMarkers.forEach((sm) => sm.marker.setMap(null)); this.stopMarkers = [];
    this.boardMarker?.setMap(null); this.boardMarker = null;
    this.dropMarker?.setMap(null); this.dropMarker = null;
    this.deviceMarker?.setMap(null); this.deviceMarker = null;
    this.connectorLine?.setMap(null); this.connectorLine = null;
    this.deviceLoc = null; this.etaText = null; this.directionsSvc = null;
    this.map = null;
  }

  done(): void {
    this.router.navigateByUrl('/customer-tabs');
  }

  private uuid(): string {
    try {
      return (crypto as unknown as { randomUUID: () => string }).randomUUID();
    } catch {
      return `k-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    }
  }

  private async showToast(message: string): Promise<void> {
    const t = await this.toast.create({ message, duration: 2600, color: 'danger', position: 'bottom' });
    await t.present();
  }
}
