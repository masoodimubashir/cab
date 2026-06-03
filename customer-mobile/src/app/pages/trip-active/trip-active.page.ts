import { Component, NgZone, OnDestroy, OnInit } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ActionSheetController, AlertController, ToastController } from '@ionic/angular';
import { ApiService } from '../../core/api.service';
import { AuthService, PaymentMethod } from '../../core/auth.service';
import { GeoFix, GeolocationService } from '../../core/geolocation.service';
import { PlacesService } from '../../core/places.service';
import {
  RealtimeService,
  TripLocationPayload,
  TripStatusPayload,
} from '../../core/realtime.service';

declare const google: any;
declare const Razorpay: any;

type UpiOrderResponse = {
  payment: { id: number };
  razorpay: { key_id: string; order_id: string; amount_paise: number; currency: string };
};

type TripDetail = {
  id: number;
  status: string;
  final_fare: number | null;
  tip_amount?: number | null;
  payment_method?: PaymentMethod | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  drop_lat?: number | null;
  drop_lng?: number | null;
  pickup_address?: string | null;
  drop_address?: string | null;
  driver?: {
    id: number;
    name?: string | null;
    phone?: string | null;
    // Driver's last-known location — used to render the marker immediately,
    // before any live websocket update arrives. (decimal → string from Laravel)
    current_lat?: number | string | null;
    current_lng?: number | string | null;
    accepted_payment_methods?: PaymentMethod[] | null;
    // Nested driver profile (vehicle info). The relation is User.driver, so on
    // the trip it reads as trip.driver.driver — confusing but correct.
    driver?: {
      vehicle_brand?: string | null;
      vehicle_model?: string | null;
      vehicle_color?: string | null;
      vehicle_reg_no?: string | null;
    } | null;
  };
};

type TippingConfig = {
  values: number[];        // 3 presets: rupees or % depending on `in_percentage`
  in_percentage: boolean;
};

@Component({
  selector: 'app-trip-active',
  templateUrl: './trip-active.page.html',
  styleUrls: ['./trip-active.page.scss'],
  standalone: false,
})
export class TripActivePage implements OnInit, OnDestroy {
  tripId!: number;
  loading = true;
  trip: TripDetail | null = null;
  driverAccepts: PaymentMethod[] = ['cash', 'razorpay'];
  cityAcceptsUpper: string[] = ['CASH', 'RAZORPAY'];
  // Authoritative list the backend computed (city ∩ driver-effective, honoring
  // the operator's "drivers manage own modes" toggle). Preferred over the local
  // city∩driver fallback when present.
  serverAllowedMethods: PaymentMethod[] | null = null;
  selectedPaymentMethod: PaymentMethod | null = null;
  // Per-city "Vehicle make & model" toggle (default ON). When false, the rider
  // sees only the number plate — the make/model line is hidden.
  showVehicleMakeModel = true;

  // Coupon entered on the payment screen. `couponPreview` is the validated
  // server response; until set, the payable amount equals trip.final_fare.
  couponInput = '';
  couponApplying = false;
  couponError: string | null = null;
  couponPreview: { discount: number; final_amount: number; coupon: { assignment_id: number; title: string } } | null = null;
  driverPosition: { lat: number; lng: number } | null = null;
  liveConnected = false;
  etaMinutes: number | null = null;
  etaUpdatedAt: number | null = null;

  // Rating state
  ratingScore = 0;
  ratingComment = '';
  ratingBusy = false;
  ratingSubmitted = false;

  // Tipping state — values pulled from /operator/tipping. Once the user taps
  // any preset / submits a custom amount / taps Skip, this card disappears
  // and won't return for this trip (option-A behaviour).
  tipping: TippingConfig | null = null;
  tipBusy = false;
  tipSkipped = false;
  tipCustomOpen = false;
  tipCustomAmount: number | null = null;

  // SOS / share-link state
  sosBusy = false;
  shareBusy = false;

  // Map-dominant layout: let the user collapse the sheet to see more map.
  sheetCollapsed = false;

  // True once a live driver GPS fix has arrived over the websocket. Until then
  // we keep seeding the marker from the driver's last-known location.
  private liveDriverFix = false;

  // Driver-details modal (fare, ETA, phone, vehicle) — opened by tapping the
  // driver marker on the map or the info button on the sheet.
  showDriverModal = false;

  // Cancel overlay state
  showCancelModal = false;
  cancelReasons = {
    waitingLongTime: false,
    unableToContact: false,
    deniedDestination: false,
    deniedPickup: false,
    wrongAddress: false,
    priceNotReasonable: false,
    carConditionBad: false
  };
  cancelCustomReason = '';

  private poll: any = null;
  private unsubscribeRealtime: (() => void) | null = null;
  private map: any | null = null;
  private driverMarker: any | null = null;
  private pickupMarker: any | null = null;
  private dropMarker: any | null = null;
  // Pickup → drop road route. Only shown once the ride is in progress
  // (EN_ROUTE_DROP / ARRIVED_DROP); faded in via routeFadeHandle.
  private routePolylines: any[] = [];
  private routeFadeHandle: any = null;
  private etaDebounceHandle: any = null;
  private etaInflight = false;
  private readonly etaDebounceMs = 10_000;
  private distanceMatrix: any | null = null;

  // Customer's own location stream (so the driver app can render us moving).
  private geoWatchId: string | null = null;
  private lastCustomerPostAt = 0;
  private readonly customerPostMinIntervalMs = 5_000;
  private selfMarker: any | null = null;
  selfPosition: { lat: number; lng: number } | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private location: Location,
    private api: ApiService,
    private auth: AuthService,
    private alertCtrl: AlertController,
    private actionSheetCtrl: ActionSheetController,
    private toastCtrl: ToastController,
    private places: PlacesService,
    private realtime: RealtimeService,
    private geo: GeolocationService,
    private zone: NgZone,
  ) {}

  // ── Driver details (shown in the map modal) ──────────────────────
  get driverName(): string {
    return this.trip?.driver?.name || 'Driver assigned';
  }
  get driverPhone(): string | null {
    return this.trip?.driver?.phone || null;
  }
  /** "White Maruti Swift" — whatever vehicle fields are populated. */
  get vehicleSummary(): string | null {
    const v = this.trip?.driver?.driver;
    if (!v) return null;
    const parts = [v.vehicle_color, v.vehicle_brand, v.vehicle_model].filter(Boolean);
    return parts.length ? parts.join(' ') : null;
  }
  get vehicleReg(): string | null {
    return this.trip?.driver?.driver?.vehicle_reg_no || null;
  }

  /** Label for the ETA stat — makes clear whether it counts down to pickup or
   *  to the destination, depending on the trip phase. */
  get etaLabel(): string {
    return this.trip?.status === 'EN_ROUTE_DROP' ? 'ETA to drop' : 'ETA to pickup';
  }

  /** A driver is assigned but we have no position to plot yet (no live fix and
   *  no last-known location). Show a "locating…" hint while the trip is active. */
  get awaitingDriverLocation(): boolean {
    if (!this.trip?.driver || this.driverPosition) return false;
    const s = this.trip.status;
    return s !== 'COMPLETED' && s !== 'CANCELLED';
  }

  /** Open the details modal. Safe to call from a Google Maps event (which
   *  fires outside Angular) — re-enters the zone so the binding updates. */
  openDriverDetails(): void {
    this.zone.run(() => { this.showDriverModal = true; });
  }

  /** Dial the driver via the OS dialer. */
  callDriver(): void {
    const phone = this.driverPhone;
    if (!phone) return;
    window.open(`tel:${phone}`, '_system');
  }

  /**
   * Floating back button on the map — return to wherever we came from (the
   * ride-detail page, the booking screen, …). Falls back to the Rides list
   * when there's no history to pop (e.g. a deep link).
   */
  back(): void {
    if (window.history.length > 1) {
      this.location.back();
    } else {
      this.router.navigateByUrl('/customer-tabs/my-trips');
    }
  }

  /**
   * Per-state title + subtitle copy. Replaces the generic enum value with
   * something a customer would actually want to read while watching the trip
   * progress. The ETA chip is still rendered separately when applicable.
   */
  statusCopy(): { title: string; sub: string } {
    const status = this.trip?.status ?? '';
    switch (status) {
      case 'CONFIRMED':
        return { title: 'Driver confirmed', sub: 'Connecting…' };
      case 'ASSIGNED':
      case 'EN_ROUTE_PICKUP':
        return {
          title: 'Driver is on the way',
          sub: this.etaMinutes != null ? `Arriving in ${this.etaMinutes} min` : 'Heading to pickup',
        };
      case 'ARRIVED_PICKUP':
        return { title: 'Driver has arrived', sub: 'Please come to the curb' };
      case 'EN_ROUTE_DROP':
        return {
          title: 'Ride in progress',
          sub: this.etaMinutes != null ? `Arriving in ${this.etaMinutes} min` : "Sit back — you're on your way",
        };
      case 'ARRIVED_DROP':
        return { title: "You've arrived", sub: 'Please complete payment' };
      case 'COMPLETED':
        return { title: 'Trip complete', sub: 'Tap to pay & rate' };
      case 'CANCELLED':
        return { title: 'Trip cancelled', sub: '' };
      default:
        return { title: status || 'Loading…', sub: '' };
    }
  }

  ngOnInit(): void {
    this.tripId = Number(this.route.snapshot.paramMap.get('tripId'));
    if (!this.tripId) {
      this.router.navigateByUrl('/customer-tabs/book', { replaceUrl: true });
      return;
    }
    this.refresh();
    void this.initMap();
    this.subscribeLive();
    this.loadTippingConfig();
    // Slow polling fallback for status, in case Reverb is down.
    this.poll = setInterval(() => this.refresh(), 15000);
  }

  /**
   * Fetch the operator's tipping presets once. Failure is non-fatal — the
   * tip card just won't appear. We don't block the page on this.
   */
  private loadTippingConfig(): void {
    this.api.get<TippingConfig>('/operator/tipping').subscribe({
      next: (cfg) => { this.tipping = cfg; },
      error: () => { this.tipping = null; },
    });
  }

  ngOnDestroy(): void {
    if (this.poll) clearInterval(this.poll);
    if (this.unsubscribeRealtime) this.unsubscribeRealtime();
    if (this.etaDebounceHandle) clearTimeout(this.etaDebounceHandle);
    if (this.routeFadeHandle) clearInterval(this.routeFadeHandle);
    for (const pl of this.routePolylines) pl.setMap?.(null);
    this.routePolylines = [];
    this.stopCustomerLocationStream();
  }

  private subscribeLive(): void {
    this.unsubscribeRealtime = this.realtime.subscribeTracking(
      this.tripId,
      (p) => this.onLocation(p),
      (p) => this.onStatus(p)
    );
    this.liveConnected = !!this.unsubscribeRealtime;
  }

  private async initMap(): Promise<void> {
    try {
      await this.places.ensureLoaded();

      // The map container lives behind *ngIf="!loading", so on a fast script
      // load it may not be in the DOM yet. Wait for it to render (up to ~2s).
      let div = document.getElementById('trip-map');
      for (let i = 0; !div && i < 20; i++) {
        await new Promise((r) => setTimeout(r, 100));
        div = document.getElementById('trip-map');
      }
      if (!div || this.map) return;

      this.map = new google.maps.Map(div, {
        center: { lat: 28.6139, lng: 77.209 },
        zoom: 14,
        disableDefaultUI: true,
        // Required for AdvancedMarkerElement to render. DEMO_MAP_ID is
        // Google's public test id; replace with a styled mapId when going to
        // production.
        mapId: 'DEMO_MAP_ID',
      });

      // Draw whatever we already have (markers + route); otherwise just frame.
      if (this.trip) this.updateRouteMarkers();
      else this.fitMap();
      // A live fix / seed may have landed before the map was ready.
      this.ensureDriverMarker();
    } catch {
      /* maps not available — page still works without it */
    }
  }

  private refresh(): void {
    this.api
      .get<{
        trip_id: number;
        trip?: TripDetail;
        negotiation?: { final_amount: number };
        city_payment_modes?: string[];
        available_payment_methods?: string[];
        show_vehicle_make_model?: boolean;
        driver_location?: { lat: number; lng: number; recorded_at?: string } | null;
      }>(`/trips/${this.tripId}/negotiation`)
      .subscribe({
        next: (res) => {
          this.loading = false;
          if (res?.trip) {
            this.trip = res.trip;
            const driver = res.trip.driver;
            if (driver?.accepted_payment_methods?.length) {
              this.driverAccepts = driver.accepted_payment_methods;
            }
            if (res.city_payment_modes?.length) {
              this.cityAcceptsUpper = res.city_payment_modes;
            }
            if (Array.isArray(res.available_payment_methods)) {
              this.serverAllowedMethods = res.available_payment_methods
                .map((m) => m.toLowerCase())
                .filter((m): m is PaymentMethod => m === 'cash' || m === 'razorpay');
            }
            if (typeof res.show_vehicle_make_model === 'boolean') {
              this.showVehicleMakeModel = res.show_vehicle_make_model;
            }
            if (this.selectedPaymentMethod == null && this.trip.payment_method) {
              this.selectedPaymentMethod = this.trip.payment_method;
            }
            this.seedDriver(
              res.driver_location ??
                (this.trip.driver?.current_lat != null && this.trip.driver?.current_lng != null
                  ? { lat: Number(this.trip.driver.current_lat), lng: Number(this.trip.driver.current_lng) }
                  : null)
            );
            this.updateRouteMarkers();
            this.syncCustomerLocationStream();
            // If the first init bailed (slow API → map div wasn't in the DOM
            // yet), retry now that the page has rendered.
            if (!this.map) void this.initMap();
          }
        },
        error: () => {
          this.loading = false;
        },
      });
  }

  /**
   * Methods the customer can actually use on this trip — intersection of:
   *   • city_settings.allowed_driver_payment_modes (operator-level cap)
   *   • driver.accepted_payment_methods (what this driver opted into)
   */
  get availablePaymentMethods(): PaymentMethod[] {
    // Prefer the backend's authoritative list (it already honors the city cap,
    // the driver's modes, and the operator's "drivers manage own modes" toggle).
    // Fall back to the local city ∩ driver computation for older backends.
    if (this.serverAllowedMethods) return this.serverAllowedMethods;
    const cityLower = this.cityAcceptsUpper
      .map((m) => m.toLowerCase())
      .filter((m): m is PaymentMethod => m === 'cash' || m === 'razorpay');
    return cityLower.filter((m) => this.driverAccepts.includes(m));
  }

  get payableAmount(): number | null {
    if (this.couponPreview) return this.couponPreview.final_amount;
    return this.trip?.final_fare ?? null;
  }

  async applyCoupon(): Promise<void> {
    if (this.couponPreview) {
      this.couponPreview = null;
      this.couponInput = '';
      this.couponError = null;
      return;
    }
    const code = (this.couponInput || '').trim();
    if (!code) return;
    this.couponApplying = true;
    this.couponError = null;
    try {
      const res = await this.api
        .post<{
          discount?: number;
          final_amount?: number;
          coupon?: { assignment_id: number; title: string };
          error?: string;
        }>(`/trips/${this.tripId}/coupon-preview`, { coupon_title: code })
        .toPromise();
      if (res?.error) {
        this.couponError = res.error;
        return;
      }
      if (res?.discount != null && res?.final_amount != null && res?.coupon) {
        this.couponPreview = {
          discount: res.discount,
          final_amount: res.final_amount,
          coupon: res.coupon,
        };
      } else {
        this.couponError = 'Could not apply coupon.';
      }
    } catch (e: any) {
      this.couponError = e?.error?.message || 'Could not apply coupon.';
    } finally {
      this.couponApplying = false;
    }
  }

  private updateRouteMarkers(): void {
    if (!this.map || !this.trip) return;
    const t = this.trip;
    if (t.pickup_lat != null && t.pickup_lng != null) {
      const pos = { lat: Number(t.pickup_lat), lng: Number(t.pickup_lng) };
      if (!this.pickupMarker) {
        this.pickupMarker = new google.maps.marker.AdvancedMarkerElement({
          position: pos,
          map: this.map,
          title: 'Pickup',
          content: this.buildPin('A', '#1f8b4c'),
        });
      } else {
        this.pickupMarker.position = pos;
      }
    }
    if (t.drop_lat != null && t.drop_lng != null) {
      const pos = { lat: Number(t.drop_lat), lng: Number(t.drop_lng) };
      if (!this.dropMarker) {
        this.dropMarker = new google.maps.marker.AdvancedMarkerElement({
          position: pos,
          map: this.map,
          title: 'Drop',
          content: this.buildPin('B', '#c0392b'),
        });
      } else {
        this.dropMarker.position = pos;
      }
    }

    // The trip path is only drawn once the customer is in the car.
    this.syncRoute();

    this.fitMap();
  }

  /**
   * The pickup → drop line is only meaningful once the customer has been
   * picked up. Show it from EN_ROUTE_DROP until the trip completes; hide it in
   * every other state (heading to pickup, arrived at pickup, completed,
   * cancelled). Idempotent — safe to call on every status update / poll.
   */
  private shouldShowRoute(): boolean {
    const s = this.trip?.status;
    return s === 'EN_ROUTE_DROP' || s === 'ARRIVED_DROP';
  }

  private syncRoute(): void {
    if (!this.map || !this.trip) return;
    const t = this.trip;
    const haveEnds =
      t.pickup_lat != null && t.pickup_lng != null &&
      t.drop_lat != null && t.drop_lng != null;

    if (this.shouldShowRoute() && haveEnds) {
      if (!this.routePolylines.length) {
        void this.drawRoute(
          { lat: Number(t.pickup_lat), lng: Number(t.pickup_lng) },
          { lat: Number(t.drop_lat), lng: Number(t.drop_lng) },
        );
      }
    } else {
      this.clearRoute();
    }
  }

  private clearRoute(): void {
    if (this.routeFadeHandle) { clearInterval(this.routeFadeHandle); this.routeFadeHandle = null; }
    for (const pl of this.routePolylines) pl.setMap?.(null);
    this.routePolylines = [];
  }

  /** Ramp the freshly-drawn route from invisible to full opacity so it eases
   *  in when the ride starts instead of popping onto the map. */
  private fadeInRoute(): void {
    if (this.routeFadeHandle) { clearInterval(this.routeFadeHandle); this.routeFadeHandle = null; }
    const lines = this.routePolylines;
    if (!lines.length) return;
    const target = 0.95;
    const steps = 14;
    let i = 0;
    for (const pl of lines) pl.setOptions?.({ strokeOpacity: 0 });
    this.routeFadeHandle = setInterval(() => {
      i++;
      const op = Math.min(target, (i / steps) * target);
      for (const pl of lines) pl.setOptions?.({ strokeOpacity: op });
      if (i >= steps) { clearInterval(this.routeFadeHandle); this.routeFadeHandle = null; }
    }, 22);
  }

  /**
   * Draw the road route between pickup and drop. Routes API (New) first, then
   * the legacy DirectionsService, then a straight line as a last resort.
   */
  private async drawRoute(
    origin: { lat: number; lng: number },
    destination: { lat: number; lng: number },
  ): Promise<void> {
    if (!this.map) return;
    for (const pl of this.routePolylines) pl.setMap?.(null);
    this.routePolylines = [];

    try {
      const { Route } = await (google.maps as any).importLibrary('routes');
      const { routes } = await Route.computeRoutes({
        origin,
        destination,
        travelMode: google.maps.TravelMode.DRIVING,
        fields: ['path'],
      });
      const polylines: any[] = routes?.[0]?.createPolylines?.() ?? [];
      let drew = false;
      for (const pl of polylines) {
        if (pl?.setMap) {
          pl.setOptions?.({ strokeColor: '#0D1B2A', strokeWeight: 5, strokeOpacity: 0.95 });
          pl.setMap(this.map);
          drew = true;
        }
      }
      if (drew) { this.routePolylines = polylines; this.fitMap(); this.fadeInRoute(); return; }
    } catch {
      // fall through
    }

    try {
      const svc = new google.maps.DirectionsService();
      const res: any = await svc.route({
        origin, destination, travelMode: google.maps.TravelMode.DRIVING,
      });
      const r = res?.routes?.[0];
      if (r?.overview_path?.length) {
        const pl = new google.maps.Polyline({
          path: r.overview_path, strokeColor: '#0D1B2A', strokeWeight: 5, strokeOpacity: 0.95, map: this.map,
        });
        this.routePolylines = [pl];
        this.fitMap();
        this.fadeInRoute();
        return;
      }
    } catch {
      // fall through
    }

    const straight = new google.maps.Polyline({
      path: [origin, destination], strokeColor: '#0D1B2A', strokeWeight: 5, strokeOpacity: 0.95, map: this.map,
    });
    this.routePolylines = [straight];
    this.fitMap();
    this.fadeInRoute();
  }

  private fitMap(): void {
    if (!this.map) return;
    const bounds = new google.maps.LatLngBounds();
    let any = false;
    for (const m of [this.pickupMarker, this.dropMarker, this.driverMarker, this.selfMarker]) {
      if (m && m.position) {
        // AdvancedMarkerElement.position is either {lat,lng} or LatLng; extend()
        // accepts both shapes via the LatLngLiteral overload.
        bounds.extend(m.position as any);
        any = true;
      }
    }
    if (any) {
      // The sheet floats over the bottom of the map, so pad the framing to
      // keep pins in the visible band above it.
      const bottomPad = this.isCompleted()
        ? Math.round(window.innerHeight * 0.5)
        : this.sheetCollapsed
          ? 130
          : Math.round(window.innerHeight * 0.4);
      this.map.fitBounds(bounds, { top: 96, right: 56, bottom: bottomPad, left: 56 });
    }
  }

  private onLocation(p: TripLocationPayload): void {
    const loc = p?.location;
    if (!loc || loc.lat == null || loc.lng == null) return;
    // A real live fix arrived — from now on it owns the marker; stop seeding.
    this.liveDriverFix = true;
    this.driverPosition = { lat: Number(loc.lat), lng: Number(loc.lng) };
    this.scheduleEtaUpdate();
    this.ensureDriverMarker();
  }

  /**
   * Create the driver marker (or move it) from the current driverPosition.
   * Safe to call before the map exists or before a position is known — it
   * no-ops until both are available, so it can be driven by live updates, the
   * initial seed, or the map finishing init.
   */
  private ensureDriverMarker(): void {
    if (!this.map || !this.driverPosition) return;
    if (!this.driverMarker) {
      this.driverMarker = new google.maps.marker.AdvancedMarkerElement({
        position: this.driverPosition,
        map: this.map,
        title: this.driverName,
        content: this.buildDriverMarker(this.driverName),
        gmpClickable: true,
      });
      // Tapping the driver (marker or its label) opens the details modal.
      this.driverMarker.addListener('click', () => this.openDriverDetails());
      this.fitMap();
    } else {
      this.driverMarker.position = this.driverPosition;
    }
  }

  /**
   * Seed the driver marker from the last-known location returned by the API
   * (freshest driver_locations ping). Used to show the driver from the
   * confirmation screen onward, before live trip streaming begins. Keeps
   * updating on each poll until a real live fix takes over (liveDriverFix).
   */
  private seedDriver(loc: { lat: number; lng: number } | null | undefined): void {
    if (this.liveDriverFix) return; // a live fix now owns the marker
    if (!loc) return;
    const lat = Number(loc.lat);
    const lng = Number(loc.lng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return;
    this.driverPosition = { lat, lng };
    this.ensureDriverMarker();
    this.scheduleEtaUpdate();
  }

  /**
   * Driver map marker: the driver's name on a pill above a circular car icon.
   * Returns a plain DOM node for AdvancedMarkerElement's `content`.
   */
  private buildDriverMarker(name: string): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;';

    const label = document.createElement('div');
    label.textContent = name;
    label.style.cssText = [
      'max-width:150px', 'white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis',
      'background:#0D1B2A', 'color:#fff', 'font-size:11px', 'font-weight:700',
      'padding:4px 10px', 'border-radius:999px', 'margin-bottom:5px',
      'box-shadow:0 2px 8px rgba(0,0,0,0.3)',
    ].join(';');

    const pin = document.createElement('div');
    pin.style.cssText = [
      'width:36px', 'height:36px', 'border-radius:50%', 'background:#12B35B',
      'border:3px solid #fff', 'box-shadow:0 3px 10px rgba(0,0,0,0.35)',
      'display:flex', 'align-items:center', 'justify-content:center',
    ].join(';');
    pin.innerHTML =
      '<svg width="19" height="19" viewBox="0 0 24 24" fill="#fff">' +
      '<path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01' +
      'L3 12v8a1 1 0 001 1h1a1 1 0 001-1v-1h12v1a1 1 0 001 1h1a1 1 0 001-1v-8l-2.08-5.99zM6.5 16' +
      'a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm11 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3zM5 11l1.5-4.5h11L19 11H5z"/>' +
      '</svg>';

    wrap.appendChild(label);
    wrap.appendChild(pin);
    // Fallback for environments where gmpClickable doesn't forward the tap.
    wrap.addEventListener('click', () => this.openDriverDetails());
    return wrap;
  }

  // ─────────────────────────────────────────────────────────────────
  // Marker content builders for AdvancedMarkerElement
  // ─────────────────────────────────────────────────────────────────

  private buildPin(letter: string, color: string): HTMLElement {
    const el = document.createElement('div');
    el.style.cssText = [
      'width:28px',
      'height:36px',
      'display:flex',
      'align-items:flex-start',
      'justify-content:center',
      'padding-top:4px',
      'font-weight:700',
      'font-size:13px',
      'color:#fff',
      `background:${color}`,
      'border-radius:50% 50% 50% 0',
      'transform:rotate(-45deg) translate(0,-14px)',
      'border:2px solid #fff',
      'box-shadow:0 1px 4px rgba(0,0,0,0.4)',
    ].join(';');
    const inner = document.createElement('span');
    inner.textContent = letter;
    inner.style.cssText = 'transform:rotate(45deg);';
    el.appendChild(inner);
    return el;
  }

  private buildDot(color: string): HTMLElement {
    const el = document.createElement('div');
    el.style.cssText = [
      'width:16px',
      'height:16px',
      'border-radius:50%',
      `background:${color}`,
      'border:2px solid #fff',
      'box-shadow:0 1px 4px rgba(0,0,0,0.4)',
    ].join(';');
    return el;
  }

  /**
   * Throttled ETA refresh. Only runs while the driver is en-route to pickup
   * (ASSIGNED / EN_ROUTE_PICKUP). After ARRIVED_PICKUP we stop estimating.
   *
   * Leading edge: compute immediately when we don't have an ETA yet so it
   * appears right away. Afterwards, throttle to once per interval — crucially
   * WITHOUT resetting a pending timer, so a steady stream of live fixes (every
   * few seconds) can't keep deferring the computation forever.
   */
  private scheduleEtaUpdate(): void {
    if (!this.shouldComputeEta()) return;
    if (!this.driverPosition) return;
    if (this.etaMinutes == null && !this.etaInflight) {
      void this.refreshEta();
      return;
    }
    if (this.etaDebounceHandle) return; // already scheduled — let it fire
    this.etaDebounceHandle = setTimeout(() => {
      this.etaDebounceHandle = null;
      void this.refreshEta();
    }, this.etaDebounceMs);
  }

  private shouldComputeEta(): boolean {
    const s = this.trip?.status;
    return s === 'ASSIGNED' || s === 'EN_ROUTE_PICKUP' || s === 'EN_ROUTE_DROP';
  }

  /** Where the ETA counts down to in the current phase: the pickup while the
   *  driver heads to the customer, the drop-off once the ride is underway. */
  private etaTarget(): { lat: number; lng: number } | null {
    const t = this.trip;
    if (!t) return null;
    if (t.status === 'EN_ROUTE_DROP') {
      if (t.drop_lat == null || t.drop_lng == null) return null;
      return { lat: Number(t.drop_lat), lng: Number(t.drop_lng) };
    }
    if (t.pickup_lat == null || t.pickup_lng == null) return null;
    return { lat: Number(t.pickup_lat), lng: Number(t.pickup_lng) };
  }

  private async refreshEta(): Promise<void> {
    if (this.etaInflight) return;
    if (!this.shouldComputeEta()) return;
    if (!this.driverPosition) return;
    const destination = this.etaTarget();
    if (!destination) return;

    const origin = { lat: this.driverPosition.lat, lng: this.driverPosition.lng };

    // Always have a straight-line estimate ready so the ETA is never blank —
    // the Distance Matrix API may not be enabled on the Maps key.
    const fallback = this.straightLineEtaMin(origin, destination);

    try {
      await this.places.ensureLoaded();
      if (!this.distanceMatrix && typeof google !== 'undefined' && google.maps?.DistanceMatrixService) {
        this.distanceMatrix = new google.maps.DistanceMatrixService();
      }
      if (!this.distanceMatrix) {
        this.applyEta(fallback);
        return;
      }

      this.etaInflight = true;
      this.distanceMatrix.getDistanceMatrix(
        { origins: [origin], destinations: [destination], travelMode: 'DRIVING' },
        (response: any, status: string) => {
          this.etaInflight = false;
          const el = status === 'OK' ? response?.rows?.[0]?.elements?.[0] : null;
          if (el && el.status === 'OK' && el.duration?.value) {
            this.applyEta(Math.max(1, Math.round(el.duration.value / 60)));
          } else {
            // Distance Matrix denied/failed — fall back to the straight-line estimate.
            this.applyEta(fallback);
          }
        }
      );
    } catch {
      this.etaInflight = false;
      this.applyEta(fallback);
    }
  }

  /** Rough ETA in minutes from a straight-line (haversine) distance at an
   *  assumed urban driving speed. Fallback when Distance Matrix is unavailable. */
  private straightLineEtaMin(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
  ): number {
    const R = 6371; // km
    const dLat = ((to.lat - from.lat) * Math.PI) / 180;
    const dLng = ((to.lng - from.lng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((from.lat * Math.PI) / 180) * Math.cos((to.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    const km = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const avgKmh = 22; // conservative city average
    return Math.max(1, Math.round((km / avgKmh) * 60));
  }

  /** Set the ETA inside Angular's zone — these callbacks fire from Google Maps
   *  / websocket handlers outside the zone, so a bare assignment wouldn't
   *  refresh the view. */
  private applyEta(min: number): void {
    this.zone.run(() => {
      this.etaMinutes = min;
      this.etaUpdatedAt = Date.now();
    });
  }

  private onStatus(p: TripStatusPayload): void {
    if (!this.trip) return;
    const changed = this.trip.status !== p.status;
    this.trip = { ...this.trip, status: p.status };

    if (changed) {
      // The ETA target flips between pickup and drop across phases — drop any
      // stale value, then recompute for the new phase (or leave it cleared if
      // ETA no longer applies, e.g. ARRIVED_PICKUP / ARRIVED_DROP).
      this.etaMinutes = null;
      if (this.etaDebounceHandle) {
        clearTimeout(this.etaDebounceHandle);
        this.etaDebounceHandle = null;
      }
      if (this.shouldComputeEta()) this.scheduleEtaUpdate();
    }

    this.syncCustomerLocationStream();
    // Show the trip path the instant the driver starts the ride, hide it on
    // completion/cancel — without waiting for the next status poll.
    this.syncRoute();
  }

  // ─────────────────────────────────────────────────────────────────
  // Customer-side location stream (drives the driver app's customer marker)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Start streaming our GPS while the trip is in any state where the driver
   * needs to see us; stop afterwards. Idempotent — safe to call repeatedly.
   */
  private syncCustomerLocationStream(): void {
    const s = this.trip?.status;
    const shouldStream =
      s === 'CONFIRMED' ||
      s === 'ASSIGNED' ||
      s === 'EN_ROUTE_PICKUP' ||
      s === 'ARRIVED_PICKUP' ||
      s === 'EN_ROUTE_DROP' ||
      s === 'ARRIVED_DROP';
    if (shouldStream) this.startCustomerLocationStream();
    else this.stopCustomerLocationStream();
  }

  private async startCustomerLocationStream(): Promise<void> {
    if (this.geoWatchId !== null) return;
    this.geoWatchId = await this.geo.watchPosition(
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 10_000 },
      (fix, err) => {
        if (err) {
          void this.stopCustomerLocationStream();
          return;
        }
        if (fix) this.onOwnPosition(fix);
      },
    );
  }

  private async stopCustomerLocationStream(): Promise<void> {
    if (this.geoWatchId !== null) {
      await this.geo.clearWatch(this.geoWatchId);
    }
    this.geoWatchId = null;
  }

  private onOwnPosition(fix: GeoFix): void {
    const p = { lat: fix.lat, lng: fix.lng };
    this.selfPosition = p;

    // Render/move our own marker every tick so the customer can visually
    // confirm where they are relative to the driver.
    if (this.map) {
      if (!this.selfMarker) {
        this.selfMarker = new google.maps.marker.AdvancedMarkerElement({
          position: p,
          map: this.map,
          title: 'You',
          content: this.buildDot('#1e6cf0'),
          zIndex: 4,
        });
        this.fitMap();
      } else {
        this.selfMarker.position = p;
      }
    }

    // Throttle the network POST to one per 5s, independent of the marker render.
    const now = Date.now();
    if (now - this.lastCustomerPostAt < this.customerPostMinIntervalMs) return;
    this.lastCustomerPostAt = now;

    const body = {
      lat: fix.lat,
      lng: fix.lng,
      accuracy_m: fix.accuracy,
    };

    this.api.post(`/trips/${this.tripId}/customer-location`, body).subscribe({
      next: () => {},
      error: (err: any) => {
        // 409 = trip is no longer in an active state — stop streaming.
        if (err?.status === 409) this.stopCustomerLocationStream();
        // 429 = throttled; backoff bumps the next-allowed timestamp.
        if (err?.status === 429) this.lastCustomerPostAt = now + 2_000;
      },
    });
  }

  canCancel(): boolean {
    if (!this.trip) return false;
    return ['CONFIRMED', 'ASSIGNED'].includes(this.trip.status);
  }

  isCompleted(): boolean {
    return this.trip?.status === 'COMPLETED';
  }

  /**
   * Minimise the floating sheet to just the status + driver header so the
   * customer can see almost the entire map. No-op once the trip is complete
   * (that view needs the payment / rating content visible).
   */
  toggleSheet(): void {
    if (this.isCompleted()) return;
    this.sheetCollapsed = !this.sheetCollapsed;
    // Re-frame the map after the sheet finishes resizing so pins stay visible.
    setTimeout(() => this.fitMap(), 280);
  }

  // ── Tipping ──────────────────────────────────────────────────────

  /** Show the tip card only on completed trips, with config loaded, where
   *  the user hasn't already tipped or skipped this trip. */
  get showTipCard(): boolean {
    return (
      this.isCompleted() &&
      !!this.tipping &&
      !this.tipSkipped &&
      (this.trip?.tip_amount ?? null) === null
    );
  }

  /** Display label for a preset value — "₹20" or "20%" depending on flag. */
  tipLabel(value: number): string {
    return this.tipping?.in_percentage ? `${value}%` : `₹${value}`;
  }

  /** Resolve a preset (rupee or percent) into actual rupees to send. */
  private tipAmountFor(value: number): number {
    if (!this.tipping?.in_percentage) return value;
    const fare = this.trip?.final_fare ?? 0;
    return Math.max(1, Math.round((fare * value) / 100));
  }

  pickTipPreset(value: number): void {
    const amount = this.tipAmountFor(value);
    this.submitTip(amount);
  }

  openCustomTip(): void {
    this.tipCustomAmount = null;
    this.tipCustomOpen = true;
  }

  submitCustomTip(): void {
    const amt = Number(this.tipCustomAmount);
    if (!Number.isFinite(amt) || amt <= 0) return;
    this.tipCustomOpen = false;
    // In percentage mode the entry is a % of fare; convert to rupees so the
    // server always receives absolute rupees (same as the presets).
    this.submitTip(this.tipAmountFor(amt));
  }

  skipTip(): void {
    this.tipSkipped = true;
  }

  private submitTip(amount: number): void {
    if (this.tipBusy) return;
    this.tipBusy = true;
    this.api.post<{ trip: TripDetail }>(`/trips/${this.tripId}/tip`, { amount }).subscribe({
      next: async (res) => {
        if (this.trip && res.trip?.tip_amount != null) {
          this.trip.tip_amount = res.trip.tip_amount;
        }
        const t = await this.toastCtrl.create({
          message: `Tip of ₹${amount} added. Thank you!`,
          duration: 2000,
          color: 'success',
        });
        await t.present();
        this.tipBusy = false;
      },
      error: async (err) => {
        const t = await this.toastCtrl.create({
          message: err?.error?.message || 'Could not add tip.',
          duration: 2500,
          color: 'danger',
        });
        await t.present();
        this.tipBusy = false;
      },
    });
  }

  cancel(): void {
    this.cancelReasons = {
      waitingLongTime: false,
      unableToContact: false,
      deniedDestination: false,
      deniedPickup: false,
      wrongAddress: false,
      priceNotReasonable: false,
      carConditionBad: false
    };
    this.cancelCustomReason = '';
    this.showCancelModal = true;
  }

  async submitCancellation(): Promise<void> {
    const selected: string[] = [];
    if (this.cancelReasons.waitingLongTime) selected.push('Waiting for long time');
    if (this.cancelReasons.unableToContact) selected.push('Unable to contact driver');
    if (this.cancelReasons.deniedDestination) selected.push('Driver denied to go to destination');
    if (this.cancelReasons.deniedPickup) selected.push('Driver denied to come to pickup');
    if (this.cancelReasons.wrongAddress) selected.push('Wrong address shown');
    if (this.cancelReasons.priceNotReasonable) selected.push('The Price is not reasonable');
    if (this.cancelReasons.carConditionBad) selected.push('Car condition is not good');

    let reasonStr = selected.join(', ');
    if (this.cancelCustomReason?.trim()) {
      reasonStr += (reasonStr ? '. Other: ' : '') + this.cancelCustomReason.trim();
    }

    if (!reasonStr) {
      const t = await this.toastCtrl.create({
        message: 'Please select a reason or write one below.',
        duration: 2000,
        color: 'warning'
      });
      await t.present();
      return;
    }

    try {
      this.loading = true;
      await this.api.post(`/trips/${this.tripId}/cancel`, { reason: reasonStr }).toPromise();
      this.showCancelModal = false;
      const t = await this.toastCtrl.create({
        message: 'Trip cancelled successfully.',
        duration: 2000,
        color: 'success'
      });
      await t.present();
      this.router.navigateByUrl('/customer-tabs/book', { replaceUrl: true });
    } catch (e: any) {
      this.loading = false;
      const t = await this.toastCtrl.create({
        message: e?.error?.message || 'Could not cancel.',
        duration: 2500,
        color: 'danger',
      });
      await t.present();
    }
  }

  async pay(): Promise<void> {
    const allowed = this.availablePaymentMethods;
    if (!allowed.length) {
      const t = await this.toastCtrl.create({
        message: 'No payment methods available for this trip.',
        duration: 2500,
        color: 'danger',
      });
      await t.present();
      return;
    }

    const sheet = await this.actionSheetCtrl.create({
      header: 'Pay with',
      buttons: [
        ...allowed.map((m) => ({
          text: m.toUpperCase(),
          handler: () => this.doPay(m),
        })),
        { text: 'Cancel', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  private async doPay(method: PaymentMethod): Promise<void> {
    if (method === 'razorpay') {
      await this.doPayRazorpay();
      return;
    }
    try {
      await this.api
        .post(`/trips/${this.tripId}/pay/${method}`, {
          coupon_title: this.couponPreview?.coupon.title ?? null,
        })
        .toPromise();
      const t = await this.toastCtrl.create({
        message: 'Payment recorded.',
        duration: 2000,
        color: 'success',
      });
      await t.present();
      this.refresh();
    } catch (e: any) {
      const t = await this.toastCtrl.create({
        message: e?.error?.message || 'Payment failed.',
        duration: 2500,
        color: 'danger',
      });
      await t.present();
    }
  }

  private async doPayRazorpay(): Promise<void> {
    if (typeof Razorpay === 'undefined') {
      const t = await this.toastCtrl.create({
        message: 'Payment library not loaded. Check your connection.',
        duration: 2500,
        color: 'danger',
      });
      await t.present();
      return;
    }

    let order: UpiOrderResponse;
    try {
      order = (await this.api
        .post<UpiOrderResponse>(`/trips/${this.tripId}/pay/razorpay`, {
          coupon_title: this.couponPreview?.coupon.title ?? null,
        })
        .toPromise()) as UpiOrderResponse;
    } catch (e: any) {
      const t = await this.toastCtrl.create({
        message: e?.error?.message || 'Could not start payment.',
        duration: 2500,
        color: 'danger',
      });
      await t.present();
      return;
    }

    const user = this.auth.getUser();
    const rzp = new Razorpay({
      key: order.razorpay.key_id,
      order_id: order.razorpay.order_id,
      amount: order.razorpay.amount_paise,
      currency: order.razorpay.currency,
      name: 'DreamCabs',
      description: `Trip #${this.tripId}`,
      prefill: {
        name: user?.name || '',
        email: user?.email || '',
        contact: user?.phone || '',
      },
      theme: { color: '#000000' },
      handler: (resp: {
        razorpay_payment_id: string;
        razorpay_order_id: string;
        razorpay_signature: string;
      }) => {
        this.verifyUpiPayment(resp);
      },
      modal: {
        ondismiss: async () => {
          const t = await this.toastCtrl.create({
            message: 'Payment cancelled.',
            duration: 2000,
            color: 'warning',
          });
          await t.present();
        },
      },
    });

    rzp.on('payment.failed', async (resp: any) => {
      const t = await this.toastCtrl.create({
        message: resp?.error?.description || 'Payment failed.',
        duration: 3000,
        color: 'danger',
      });
      await t.present();
    });

    rzp.open();
  }

  private async verifyUpiPayment(resp: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }): Promise<void> {
    try {
      await this.api.post(`/trips/${this.tripId}/pay/razorpay/verify`, resp).toPromise();
      const t = await this.toastCtrl.create({
        message: 'Payment successful.',
        duration: 2000,
        color: 'success',
      });
      await t.present();
      this.refresh();
    } catch (e: any) {
      const t = await this.toastCtrl.create({
        message: e?.error?.message || 'Payment verification failed.',
        duration: 3000,
        color: 'danger',
      });
      await t.present();
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Rating (post-trip)
  // ─────────────────────────────────────────────────────────────────

  setRating(score: number): void {
    if (this.ratingSubmitted || this.ratingBusy) return;
    this.ratingScore = score;
  }

  async submitRating(): Promise<void> {
    if (this.ratingScore < 1 || this.ratingScore > 5) {
      const t = await this.toastCtrl.create({
        message: 'Pick a star rating first.',
        duration: 2000,
        color: 'warning',
      });
      await t.present();
      return;
    }
    this.ratingBusy = true;
    try {
      await this.api
        .post(`/trips/${this.tripId}/rating`, {
          score: this.ratingScore,
          comment: this.ratingComment.trim() || null,
        })
        .toPromise();
      this.ratingSubmitted = true;
      const t = await this.toastCtrl.create({
        message: 'Thanks for the rating!',
        duration: 2000,
        color: 'success',
      });
      await t.present();
    } catch (e: any) {
      const msg = e?.error?.message || 'Could not submit rating.';
      // 409 already-rated should still feel like success on the next render.
      if (e?.status === 409) {
        this.ratingSubmitted = true;
      }
      const t = await this.toastCtrl.create({ message: msg, duration: 2500, color: 'danger' });
      await t.present();
    } finally {
      this.ratingBusy = false;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // SOS
  // ─────────────────────────────────────────────────────────────────

  canSOS(): boolean {
    const s = this.trip?.status;
    if (!s) return false;
    return s !== 'COMPLETED' && s !== 'CANCELLED';
  }

  async triggerSOS(): Promise<void> {
    if (this.sosBusy) return;
    const a = await this.alertCtrl.create({
      header: 'Send SOS?',
      message: 'Admins will be alerted with your trip and current location.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Send SOS',
          role: 'destructive',
          handler: () => {
            void this.doTriggerSOS();
          },
        },
      ],
    });
    await a.present();
  }

  private async doTriggerSOS(): Promise<void> {
    this.sosBusy = true;
    const payload: { lat?: number; lng?: number } = {};
    try {
      const pos = await this.getCurrentPosition();
      if (pos) {
        payload.lat = pos.lat;
        payload.lng = pos.lng;
      }
    } catch {
      // best-effort; backend accepts no coords
    }
    try {
      await this.api.post(`/trips/${this.tripId}/sos`, payload).toPromise();
      const t = await this.toastCtrl.create({
        message: 'SOS sent. Help is on the way.',
        duration: 3000,
        color: 'success',
      });
      await t.present();
    } catch (e: any) {
      const t = await this.toastCtrl.create({
        message: e?.error?.message || 'Could not send SOS.',
        duration: 3000,
        color: 'danger',
      });
      await t.present();
    } finally {
      this.sosBusy = false;
    }
  }

  private getCurrentPosition(): Promise<{ lat: number; lng: number } | null> {
    return this.geo.getCurrentPosition();
  }

  // ─────────────────────────────────────────────────────────────────
  // Share trip link
  // ─────────────────────────────────────────────────────────────────

  canShare(): boolean {
    return this.canSOS();
  }

  async shareTrip(): Promise<void> {
    if (this.shareBusy) return;
    this.shareBusy = true;
    try {
      const res: any = await this.api
        .post(`/trips/${this.tripId}/share-link`, {})
        .toPromise();
      const token = res?.token;
      if (!token) throw new Error('No token returned');

      const shareUrl = this.buildShareUrl(token);
      const text = `Track my trip: ${shareUrl}`;

      const nav = (typeof navigator !== 'undefined' ? (navigator as any) : null);
      if (nav?.share) {
        try {
          await nav.share({ title: 'My DreamCabs trip', text, url: shareUrl });
          return;
        } catch {
          // user cancelled or share failed — fall through to clipboard
        }
      }

      if (nav?.clipboard?.writeText) {
        await nav.clipboard.writeText(shareUrl);
        const t = await this.toastCtrl.create({
          message: 'Link copied to clipboard.',
          duration: 2500,
          color: 'success',
        });
        await t.present();
      } else {
        const a = await this.alertCtrl.create({
          header: 'Share this link',
          message: shareUrl,
          buttons: ['OK'],
        });
        await a.present();
      }
    } catch (e: any) {
      const t = await this.toastCtrl.create({
        message: e?.error?.message || 'Could not generate share link.',
        duration: 2500,
        color: 'danger',
      });
      await t.present();
    } finally {
      this.shareBusy = false;
    }
  }

  private buildShareUrl(token: string): string {
    // The backend exposes `GET /trips/share/{token}` returning JSON. Until a
    // dedicated public web view exists, point to the API endpoint.
    return `${this.api.baseUrl()}/trips/share/${token}`;
  }
}
