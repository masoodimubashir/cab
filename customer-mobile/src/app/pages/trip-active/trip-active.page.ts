import { Component, OnDestroy, OnInit } from '@angular/core';
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
  driver?: { id: number; name?: string | null; accepted_payment_methods?: PaymentMethod[] | null };
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
  selectedPaymentMethod: PaymentMethod | null = null;

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
  // Pickup → drop road route, drawn once (coords don't change mid-trip).
  private routePolylines: any[] = [];
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
  ) {}

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
        return { title: 'Ride in progress', sub: "Sit back — you're on your way" };
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
            if (this.selectedPaymentMethod == null && this.trip.payment_method) {
              this.selectedPaymentMethod = this.trip.payment_method;
            }
            this.updateRouteMarkers();
            this.syncCustomerLocationStream();
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

    // Draw the pickup → drop path once both ends are known.
    if (
      !this.routePolylines.length &&
      t.pickup_lat != null && t.pickup_lng != null &&
      t.drop_lat != null && t.drop_lng != null
    ) {
      void this.drawRoute(
        { lat: Number(t.pickup_lat), lng: Number(t.pickup_lng) },
        { lat: Number(t.drop_lat), lng: Number(t.drop_lng) },
      );
    }

    this.fitMap();
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
      if (drew) { this.routePolylines = polylines; this.fitMap(); return; }
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
    if (any) this.map.fitBounds(bounds, 80);
  }

  private onLocation(p: TripLocationPayload): void {
    this.driverPosition = { lat: p.lat, lng: p.lng };
    this.scheduleEtaUpdate();
    if (!this.map) return;
    if (!this.driverMarker) {
      this.driverMarker = new google.maps.marker.AdvancedMarkerElement({
        position: this.driverPosition,
        map: this.map,
        title: 'Driver',
        content: this.buildDot('#1f8b4c'),
      });
      this.fitMap();
    } else {
      this.driverMarker.position = this.driverPosition;
    }
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
   * Debounced ETA refresh. Only runs while the driver is en-route to pickup
   * (ASSIGNED / EN_ROUTE_PICKUP). After ARRIVED_PICKUP we stop estimating.
   */
  private scheduleEtaUpdate(): void {
    if (!this.shouldComputeEta()) return;
    if (this.etaDebounceHandle) clearTimeout(this.etaDebounceHandle);
    this.etaDebounceHandle = setTimeout(() => {
      this.etaDebounceHandle = null;
      void this.refreshEta();
    }, this.etaDebounceMs);
  }

  private shouldComputeEta(): boolean {
    const s = this.trip?.status;
    return s === 'ASSIGNED' || s === 'EN_ROUTE_PICKUP';
  }

  private async refreshEta(): Promise<void> {
    if (this.etaInflight) return;
    if (!this.shouldComputeEta()) return;
    if (!this.driverPosition) return;
    const t = this.trip;
    if (!t || t.pickup_lat == null || t.pickup_lng == null) return;

    try {
      await this.places.ensureLoaded();
      if (!this.distanceMatrix && typeof google !== 'undefined') {
        this.distanceMatrix = new google.maps.DistanceMatrixService();
      }
      if (!this.distanceMatrix) return;

      this.etaInflight = true;
      const origin = { lat: this.driverPosition.lat, lng: this.driverPosition.lng };
      const destination = { lat: Number(t.pickup_lat), lng: Number(t.pickup_lng) };

      this.distanceMatrix.getDistanceMatrix(
        {
          origins: [origin],
          destinations: [destination],
          travelMode: 'DRIVING',
        },
        (response: any, status: string) => {
          this.etaInflight = false;
          if (status !== 'OK' || !response?.rows?.[0]?.elements?.[0]) return;
          const el = response.rows[0].elements[0];
          if (el.status !== 'OK' || !el.duration?.value) return;
          this.etaMinutes = Math.max(1, Math.round(el.duration.value / 60));
          this.etaUpdatedAt = Date.now();
        }
      );
    } catch {
      this.etaInflight = false;
    }
  }

  private onStatus(p: TripStatusPayload): void {
    if (!this.trip) return;
    this.trip = { ...this.trip, status: p.status };
    if (!this.shouldComputeEta()) {
      this.etaMinutes = null;
      if (this.etaDebounceHandle) {
        clearTimeout(this.etaDebounceHandle);
        this.etaDebounceHandle = null;
      }
    }
    this.syncCustomerLocationStream();
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
    this.submitTip(Math.round(amt));
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
