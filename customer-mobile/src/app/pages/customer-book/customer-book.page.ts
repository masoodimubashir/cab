import { Component, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { Subject, debounceTime, switchMap } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService, PaymentMethod, AuthUser } from '../../core/auth.service';
import { GeolocationService, LatLng } from '../../core/geolocation.service';
import { PlacesService, PlaceSuggestion } from '../../core/places.service';
import { RealtimeService, DispatchRingExpandedPayload } from '../../core/realtime.service';
import { environment } from '../../../environments/environment';

declare const google: any;

type RideType = { id: number; name: string; description?: string | null };
type VehicleType = { id: number; name: string; description?: string | null; image_path?: string | null };

type City = {
  id: number;
  name: string;
  country_code?: string | null;
  center_lat?: number | null;
  center_lng?: number | null;
  boundary_polygon?: { lat: number; lng: number }[] | null;
};

type EstimateResponse = {
  currency?: string;
  distance_km?: number;
  time_min?: number;
  estimated_fare?: number;
  commission_percent?: number;
  fare_breakdown?: {
    base_fare?: number;
    distance_component?: number;
    time_component?: number;
    pickup_component?: number;
    surge_multiplier?: number;
    subtotal_before_tax?: number;
    tax_percent?: number;
    tax_amount?: number;
  };
};

type NearbyDriver = {
  driver_id: number;
  name?: string | null;
  avatar_path?: string | null;
  rating_avg?: number;
  rating_count?: number;
  vehicle?: {
    type?: string | null;
    brand?: string | null;
    model?: string | null;
    color?: string | null;
    reg_no?: string | null;
  } | null;
  lat: number;
  lng: number;
  bearing_deg?: number | null;
  distance_km: number;
};

type DriverOffer = {
  id?: number;
  from_role: 'customer' | 'driver';
  amount: number;
  status: string;
  from_user_id?: number;
  driver_name?: string;
  created_at?: string;
};

/**
 * Flow:
 *   idle    → pick pickup on map (auto from geolocation)
 *   route   → type destination
 *   preview → fare auto-calculated, driver list shown, customer picks a driver
 *   waiting → trip created + driver selected; waiting for driver to ACCEPT
 *   bids    → driver countered; customer accepts/rejects the counter
 *   map-select → focused mode for map-based location selection
 */
// Vehicle step removed — the booking flow is Route → Payment → Match.
type RideState = 'idle' | 'route' | 'payment' | 'preview' | 'waiting' | 'bids' | 'map-select';

@Component({
  selector: 'app-customer-book',
  templateUrl: './customer-book.page.html',
  styleUrls: ['./customer-book.page.scss'],
  standalone: false,
})
export class CustomerBookPage implements OnDestroy {
  get currentUser(): AuthUser | null {
    return this.auth.getUser();
  }

  state: RideState = 'idle';
  loading = false;
  error: string | null = null;

  rideTypes: RideType[] = [];
  selectedRideTypeId: number | null = null;

  // Vehicle catalog (Sedan / SUV / Hatchback / Van / Motorcycle). Pricing
  // rules are keyed by vehicle_type_id + product_kind, so this is what the
  // booking + estimate calls actually send.
  vehicleTypes: VehicleType[] = [];
  selectedVehicleTypeId: number | null = null;

  cities: City[] = [];
  selectedCity: City | null = null;

  /**
   * Ride products are loaded from the `city_ride_products` table — what the
   * operator enabled for the active city (Local / Rental / Out Station …).
   * No more hardcoded list; only the icon mapping stays in the client since
   * the DB stores banners, not Ionicon names.
   */
  productKinds: {
    kind: 'local' | 'outstation' | 'rental';
    label: string;
    description: string | null;
    info: string | null;
    image_url: string | null;
    icon: string;
  }[] = [];
  selectedProductKind: 'local' | 'outstation' | 'rental' = 'local';
  // Outstation packages (One Way / Round Trip …) for the picked ride type.
  outstationPackages: { id: number; name: string }[] = [];
  selectedPackageId: number | null = null;
  // Set when the destination falls outside the selected city's polygon and we
  // auto-switch to Outstation. The banner above the driver list shows this.
  outsideServiceAreaNotice: string | null = null;

  pickup: { lat: number; lng: number; address: string } | null = null;
  drop: { lat: number; lng: number; address: string; place_id?: string } | null = null;

  pickupQuery = '';
  toQuery = '';
  toQuery$ = new Subject<string>();
  activeSearchField: 'pickup' | 'drop' = 'drop';
  suggestions: PlaceSuggestion[] = [];

  estimate: EstimateResponse | null = null;
  paymentMethod: PaymentMethod = 'upi';
  // Review Ride modal — opened from the preview sheet so the customer can see
  // the fare breakdown before picking a driver.
  showReviewModal = false;

  // Driver list shown on the preview sheet (the customer picks one of these).
  drivers: NearbyDriver[] = [];
  loadingDrivers = false;
  private driversPollHandle: any = null;

  pickupError: string | null = null;
  dropError: string | null = null;
  vehicleError: string | null = null;
  paymentError: string | null = null;

  tripId: number | null = null;
  selectedDriverId: number | null = null;
  searchSecondsLeft = 60;
  private searchTimer: any = null;
  // True when the chosen driver hasn't responded within the timeout. UI
  // surfaces a "Find another driver" CTA so the customer can cancel and pick
  // someone else without a fee (pricing rule's cancel grace covers it).
  showFindAnother = false;
  private findAnotherTimeoutHandle: any = null;

  // Real route metrics from Google DirectionsService. When present we pass
  // them to the backend so the estimate reflects the actual driven distance
  // rather than haversine.
  routeDistanceKm: number | null = null;
  routeTimeMin: number | null = null;

  driverOffers: DriverOffer[] = [];
  private unsubscribeRealtime: (() => void) | null = null;
  private pollHandle: any = null;

  private map: any | null = null;
  private pickupMarker: any | null = null;
  private dropMarker: any | null = null;
  // Polylines drawn by Route.createPolylines() — kept so we can detach them
  // from the map when the customer picks a new destination.
  private routePolylines: any[] = [];
  mapsReady = false;
  mapsError: string | null = null;

  // Map markers for nearby drivers (Uber-style icons sliding around).
  private nearbyDriverMarkers = new Map<number, any>();
  private nearbyPollHandle: any = null;

  // Dispatch search-ring (expanding circle on the map while we're waiting
  // for a driver to accept). Each DispatchRingExpanded broadcast bumps the
  // radius; the Circle's radius is animated smoothly via a brief tween.
  private searchCircle: any | null = null;
  private searchCircleTween: any = null;
  dispatchRing: { hop: number; max_hops: number; radius_m: number; eligible: number; hop_interval_sec?: number } | null = null;

  // True while the discovery-only search is running (hop 1 to max_hops).
  // Flips to false when the final hop arrives. Drives the "Search drivers"
  // button state and the "Searching…" UI hint.
  searching = false;

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private router: Router,
    private geo: GeolocationService,
    private places: PlacesService,
    private realtime: RealtimeService,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController
  ) {
    this.toQuery$
      .pipe(
        debounceTime(250),
        switchMap((q) => this.places.autocompleteSearch(q, this.pickup ?? undefined))
      )
      .subscribe({
        next: (results) => (this.suggestions = results),
        error: () => (this.suggestions = []),
      });
  }

  ionViewWillEnter(): void {
    this.loadRideTypes();
    this.loadVehicleTypes();
    this.loadCities();
  }

  ionViewDidEnter(): void {
    void this.initMap();
  }

  ngOnDestroy(): void {
    this.cleanupSearch();
    this.stopNearbyDriversPoll();
    this.stopDriverListPoll();
  }

  // ─────────────────────────────────────────────────────────────────
  // Lookups + initial state
  // ─────────────────────────────────────────────────────────────────

  private loadRideTypes(): void {
    this.api.get<{ data: RideType[] }>('/pricing/ride-types').subscribe({
      next: (res) => {
        this.rideTypes = res.data || [];
        if (this.rideTypes.length && this.selectedRideTypeId == null) {
          this.selectedRideTypeId = this.rideTypes[0].id;
        }
      },
      error: () => {
        this.rideTypes = [];
      },
    });
  }

  private loadVehicleTypes(): void {
    this.api.get<{ data: VehicleType[] }>('/pricing/vehicle-types').subscribe({
      next: (res) => {
        this.vehicleTypes = res.data || [];
        if (this.vehicleTypes.length && this.selectedVehicleTypeId == null) {
          this.selectedVehicleTypeId = this.vehicleTypes[0].id;
        }
      },
      error: () => (this.vehicleTypes = []),
    });
  }

  selectVehicleType(id: number): void {
    this.selectedVehicleTypeId = id;
    this.vehicleError = null;
    void this.fetchEstimate();
    void this.refreshDriverList();
  }

  openReviewModal(): void {
    // The Vehicle step has been retired — only payment needs validation here.
    this.vehicleError = null;
    this.paymentError = null;

    if (!this.paymentMethod) {
      this.paymentError = 'Select a payment method';
    }

    if (this.paymentError) {
      return;
    }

    this.showReviewModal = true;
  }

  closeReviewModal(): void {
    this.showReviewModal = false;
  }

  private loadCities(): void {
    this.api.get<{ data: City[] }>('/pricing/cities').subscribe({
      next: (res) => {
        this.cities = res.data || [];
        if (!this.selectedCity && this.cities.length) {
          // Pick the first city by default; we re-resolve once pickup lands
          // so the right polygon is used for the outstation check.
          this.selectedCity = this.cities[0];
        }
        this.resolveCityForPickup();
        if (this.selectedCity) {
          this.loadRideProducts(this.selectedCity.id);
        }
      },
      error: () => (this.cities = []),
    });
  }

  private resolveCityForPickup(): void {
    if (!this.pickup || !this.cities.length) return;
    // Prefer the city whose polygon contains the pickup; otherwise keep the
    // first city. (Hand-edited polygons may be missing for some cities.)
    const containing = this.cities.find(
      (c) => c.boundary_polygon && this.pointInPolygon(this.pickup!.lat, this.pickup!.lng, c.boundary_polygon)
    );
    if (containing && containing.id !== this.selectedCity?.id) {
      this.selectedCity = containing;
      this.loadRideProducts(containing.id);
    }
  }

  /**
   * Fetch the city's enabled ride products — what powers the chips on the
   * idle screen. The DB holds the labels, descriptions and banners; the
   * client only contributes the Ionicon name (the DB stores banners, not
   * icon names).
   */
  private loadRideProducts(cityId: number): void {
    type ApiProduct = {
      kind: 'local' | 'outstation' | 'rental';
      name: string;
      description: string | null;
      info: string | null;
      image_url: string | null;
    };
    this.api.get<{ data: ApiProduct[] }>(`/pricing/cities/${cityId}/products`).subscribe({
      next: (res) => {
        const rows = res?.data ?? [];
        this.productKinds = rows.map((p) => ({
          kind: p.kind,
          label: p.name,
          description: p.description,
          info: p.info,
          image_url: p.image_url,
          icon: this.iconForKind(p.kind),
        }));
        // Snap to the first enabled product if the current selection isn't.
        if (!this.productKinds.some((p) => p.kind === this.selectedProductKind) && this.productKinds.length) {
          this.selectedProductKind = this.productKinds[0].kind;
        }
      },
      error: () => (this.productKinds = []),
    });
  }

  private iconForKind(kind: 'local' | 'outstation' | 'rental'): string {
    if (kind === 'outstation') return 'airplane-outline';
    if (kind === 'rental') return 'time-outline';
    return 'car-outline';
  }

  private async initMap(): Promise<void> {
    try {
      await this.places.ensureLoaded();
      const div = document.getElementById('ride-map');
      if (!div) return;

      const start = (await this.geo.getCurrentPosition()) ?? { lat: 28.6139, lng: 77.209 };
      this.map = new google.maps.Map(div, {
        center: start,
        zoom: 15,
        disableDefaultUI: true,
        clickableIcons: false,
        // Required for AdvancedMarkerElement to render. DEMO_MAP_ID is
        // Google's public test id; replace with a styled mapId from the
        // Cloud Console when going to production.
        mapId: 'DEMO_MAP_ID',
      });

      this.pickupMarker = new google.maps.marker.AdvancedMarkerElement({
        position: start,
        map: this.map,
        title: 'Pickup',
        gmpDraggable: true,
        content: this.buildPin('A', '#1f8b4c'),
      });

      // AdvancedMarkerElement fires a native DOM-style 'dragend' but exposes
      // the final position via .position (not the legacy ev.latLng helpers).
      this.pickupMarker.addListener('dragend', () => {
        const p = this.pickupMarker?.position;
        if (!p) return;
        const lat = typeof (p as any).lat === 'function' ? (p as any).lat() : (p as any).lat;
        const lng = typeof (p as any).lng === 'function' ? (p as any).lng() : (p as any).lng;
        void this.updatePickupTo(lat, lng);
      });

      this.map.addListener('click', (ev: any) => {
        if (this.state !== 'idle') return;
        const lat = ev.latLng.lat();
        const lng = ev.latLng.lng();
        this.pickupMarker.position = { lat, lng };
        void this.updatePickupTo(lat, lng);
      });

      const address = (await this.places.reverseGeocode(start.lat, start.lng)) ?? 'Current location';
      this.pickup = { lat: start.lat, lng: start.lng, address };
      this.resolveCityForPickup();
      this.mapsReady = true;

      this.startNearbyDriversPoll();
    } catch (e) {
      this.mapsError = (e as Error)?.message || 'Could not load map.';
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Nearby drivers shown on the map (visual only)
  // ─────────────────────────────────────────────────────────────────

  private startNearbyDriversPoll(): void {
    if (this.nearbyPollHandle) return;
    void this.refreshNearbyDrivers();
    this.nearbyPollHandle = setInterval(() => this.refreshNearbyDrivers(), 5000);
  }

  private stopNearbyDriversPoll(): void {
    if (this.nearbyPollHandle) {
      clearInterval(this.nearbyPollHandle);
      this.nearbyPollHandle = null;
    }
    this.clearNearbyDriverMarkers();
  }

  private async refreshNearbyDrivers(): Promise<void> {
    if (!this.map || !this.pickup) return;
    try {
      const lat = this.pickup.lat;
      const lng = this.pickup.lng;
      const res: any = await this.api
        .get(`/drivers/nearby?lat=${lat}&lng=${lng}&radius_km=8&limit=30`)
        .toPromise();
      const drivers: { id: number; lat: number; lng: number; bearing_deg?: number | null }[] =
        res?.data ?? [];
      this.renderNearbyDrivers(drivers);
    } catch {
      // Silent — endpoint may not be available in dev.
    }
  }

  private renderNearbyDrivers(
    drivers: { id: number; lat: number; lng: number; bearing_deg?: number | null }[]
  ): void {
    if (!this.map) return;
    const seen = new Set<number>();
    for (const d of drivers) {
      seen.add(d.id);
      const pos = { lat: d.lat, lng: d.lng };
      const existing = this.nearbyDriverMarkers.get(d.id);
      if (existing) {
        existing.position = pos;
        // Update the rotation by re-spinning the inner arrow element. Stable
        // marker DOM lets us keep the marker between polls.
        const arrow = (existing.content as HTMLElement | null)?.firstElementChild as HTMLElement | null;
        if (arrow) arrow.style.transform = `rotate(${d.bearing_deg ?? 0}deg)`;
      } else {
        const marker = new google.maps.marker.AdvancedMarkerElement({
          position: pos,
          map: this.map,
          title: 'Driver nearby',
          content: this.buildArrow(d.bearing_deg ?? 0, '#000'),
          zIndex: 1,
        });
        this.nearbyDriverMarkers.set(d.id, marker);
      }
    }
    for (const [id, marker] of this.nearbyDriverMarkers) {
      if (!seen.has(id)) {
        marker.map = null;
        this.nearbyDriverMarkers.delete(id);
      }
    }
  }

  private clearNearbyDriverMarkers(): void {
    for (const marker of this.nearbyDriverMarkers.values()) {
      marker.map = null;
    }
    this.nearbyDriverMarkers.clear();
  }

  // ─────────────────────────────────────────────────────────────────
  // Marker content builders — used by AdvancedMarkerElement
  // ─────────────────────────────────────────────────────────────────

  /** Letter pin (A = pickup, B = drop). Returns a styled DOM element. */
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

  /** Direction arrow used for nearby driver pins. CSS rotation = bearing°. */
  private buildArrow(bearingDeg: number, color: string): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'width:22px;height:22px;display:flex;align-items:center;justify-content:center;';
    const arrow = document.createElement('div');
    arrow.style.cssText = [
      `transform:rotate(${bearingDeg}deg)`,
      'width:0',
      'height:0',
      'border-left:6px solid transparent',
      'border-right:6px solid transparent',
      `border-bottom:14px solid ${color}`,
      'filter:drop-shadow(0 1px 2px rgba(0,0,0,0.4))',
    ].join(';');
    wrap.appendChild(arrow);
    return wrap;
  }

  private async updatePickupTo(lat: number, lng: number): Promise<void> {
    const address = (await this.places.reverseGeocode(lat, lng)) ?? 'Selected location';
    this.pickup = { lat, lng, address };
    this.resolveCityForPickup();
    if (this.map) this.map.panTo({ lat, lng });
    if (this.drop) {
      await this.showRouteOnMap();
      await this.onRouteReady();
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Geofence helpers
  // ─────────────────────────────────────────────────────────────────

  /** Ray-casting point-in-polygon (matches DynamicPricingService on the backend). */
  private pointInPolygon(lat: number, lng: number, polygon: { lat: number; lng: number }[]): boolean {
    if (!polygon || polygon.length < 3) return false;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].lng;
      const yi = polygon[i].lat;
      const xj = polygon[j].lng;
      const yj = polygon[j].lat;
      const intersect =
        yi > lat !== yj > lat &&
        lng < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /**
   * Check whether the drop point lies inside the resolved city's polygon.
   * If a polygon isn't configured we conservatively treat the destination as
   * in-area (the backend stays the source of truth via the booking 422).
   */
  private isDropInsideServiceArea(): boolean {
    if (!this.drop || !this.selectedCity?.boundary_polygon) return true;
    return this.pointInPolygon(this.drop.lat, this.drop.lng, this.selectedCity.boundary_polygon);
  }

  // ─────────────────────────────────────────────────────────────────
  // State transitions
  // ─────────────────────────────────────────────────────────────────

  async centerMapToCurrentLocation(): Promise<void> {
    try {
      const pos = await this.geo.getCurrentPosition();
      if (pos) {
        if (this.pickupMarker) {
          this.pickupMarker.position = pos;
        }
        await this.updatePickupTo(pos.lat, pos.lng);
      }
    } catch {
      // Ignored
    }
  }

  goRoute(): void {
    this.state = 'route';
    this.suggestions = [];
    this.toQuery = '';
    this.pickupQuery = this.pickup?.address || '';
    this.activeSearchField = 'drop';
    this.pickupError = null;
    this.dropError = null;
  }

  closeSheet(): void {
    if (this.state === 'waiting' || this.state === 'bids') return;
    this.state = 'idle';
  }

  onSearchInput(ev: any, field: 'pickup' | 'drop'): void {
    this.activeSearchField = field;
    const val = ev?.target?.value ?? '';
    if (field === 'pickup') {
      this.pickupQuery = val;
      this.pickupError = null;
    } else {
      this.toQuery = val;
      this.dropError = null;
    }
    this.toQuery$.next(val);
  }

  swapLocations(): void {
    if (!this.pickup || !this.drop) return;
    const temp = { ...this.pickup };
    this.pickup = { lat: this.drop.lat, lng: this.drop.lng, address: this.drop.address };
    this.drop = { lat: temp.lat, lng: temp.lng, address: temp.address, place_id: undefined };
    
    this.toQuery = this.drop.address;
    this.pickupQuery = this.pickup.address;
    
    void this.showRouteOnMap();
    if (this.state === 'payment' || this.state === 'preview') {
      void this.onRouteReady();
    }
  }

  /**
   * Continue from the Route step. The Vehicle step has been retired — any
   * available driver (Sedan / SUV / Hatchback / Auto) can pick the trip up
   * in the Match step, so we go straight to Payment after validating the
   * pickup + drop addresses.
   */
  goToPayment(): void {
    this.pickupError = null;
    this.dropError = null;

    if (!this.pickup) {
      this.pickupError = 'Pickup location is required';
    }
    if (!this.drop) {
      this.dropError = 'Please select a destination';
    }

    if (this.pickupError || this.dropError) {
      return;
    }

    this.suggestions = [];
    this.state = 'payment';
    void this.showRouteOnMap();
    void this.fetchEstimate();
  }

  goToDrivers(): void {
    this.paymentError = null;

    if (!this.paymentMethod) {
      this.paymentError = 'Select a payment method';
      return;
    }

    this.state = 'preview';
    void this.onRouteReady();
  }

  async pickSuggestion(s: PlaceSuggestion): Promise<void> {
    this.loading = true;
    try {
      const detail = await this.places.getPlaceDetail(s.place_id);
      if (!detail) return;
      
      if (this.activeSearchField === 'pickup') {
         this.pickup = {
           lat: detail.lat,
           lng: detail.lng,
           address: detail.description
         };
         this.pickupQuery = detail.description;
         this.pickupError = null;
      } else {
         this.drop = {
           lat: detail.lat,
           lng: detail.lng,
           address: detail.description,
           place_id: detail.place_id,
         };
         this.toQuery = detail.description;
         this.dropError = null;
      }
      this.suggestions = [];
      // Don't auto-navigate if both aren't set or if they're just editing pickup.
    } finally {
      this.loading = false;
    }
  }

  async setPickupCurrentLocation(): Promise<void> {
    const pos = await this.geo.getCurrentPosition();
    if (pos) {
      if (this.pickupMarker) {
        this.pickupMarker.position = pos;
      }
      await this.updatePickupTo(pos.lat, pos.lng);
      this.pickupQuery = this.pickup?.address || '';
      this.pickupError = null;
    }
  }

  setLocationOnMap(): void {
    this.state = 'map-select';
    const loc = this.activeSearchField === 'pickup' ? this.pickup : this.drop;
    if (loc && this.map) {
      this.map.panTo({ lat: loc.lat, lng: loc.lng });
    }
  }

  async confirmMapLocation(): Promise<void> {
    if (!this.map) return;
    this.loading = true;
    try {
      const center = this.map.getCenter();
      const lat = center.lat();
      const lng = center.lng();
      const address = await this.places.reverseGeocode(lat, lng) ?? 'Selected on map';
      
      if (this.activeSearchField === 'pickup') {
        this.pickup = { lat, lng, address };
        this.pickupQuery = address;
        this.pickupError = null;
        if (this.pickupMarker) {
          this.pickupMarker.position = { lat, lng };
        }
      } else {
        this.drop = { lat, lng, address, place_id: undefined };
        this.toQuery = address;
        this.dropError = null;
      }
      this.state = 'route';
    } catch {
      // Ignored
    } finally {
      this.loading = false;
    }
  }

  cancelMapSelection(): void {
    this.state = 'route';
  }

  addHome(): void {
    // Add logic for saving/booking to home
  }

  addWork(): void {
    // Add logic for saving/booking to work
  }

  addFavorite(): void {
    // Add logic for saved places
  }

  selectProductKind(kind: 'local' | 'outstation' | 'rental'): void {
    this.selectedProductKind = kind;
    // User accepted the suggested kind — drop the banner.
    if (this.outsideServiceAreaNotice && kind !== 'local') {
      this.outsideServiceAreaNotice = null;
    }
    if (kind === 'outstation') {
      void this.loadOutstationPackages();
    } else {
      this.outstationPackages = [];
      this.selectedPackageId = null;
      void this.fetchEstimate();
    }
  }

  selectRideType(id: number): void {
    this.selectedRideTypeId = id;
    void this.refreshDriverList();
    if (this.selectedProductKind === 'outstation') {
      void this.loadOutstationPackages();
    } else {
      void this.fetchEstimate();
    }
  }

  selectPackage(id: number): void {
    this.selectedPackageId = id;
    void this.fetchEstimate();
  }

  /** Loads the outstation packages for the current city + ride type. */
  private async loadOutstationPackages(): Promise<void> {
    const cityId = this.selectedCity?.id ?? this.cities[0]?.id;
    if (!cityId || this.selectedRideTypeId == null) {
      this.outstationPackages = [];
      this.selectedPackageId = null;
      await this.fetchEstimate();
      return;
    }
    try {
      const res = await this.api
        .get<{ data: { id: number; name: string }[] }>(
          `/pricing/outstation-packages?city_id=${cityId}&ride_type_id=${this.selectedRideTypeId}`,
        )
        .toPromise();
      this.outstationPackages = res?.data ?? [];
      if (!this.outstationPackages.some((p) => p.id === this.selectedPackageId)) {
        this.selectedPackageId = this.outstationPackages[0]?.id ?? null;
      }
    } catch {
      this.outstationPackages = [];
      this.selectedPackageId = null;
    }
    await this.fetchEstimate();
  }

  /**
   * Single entry point called whenever pickup+drop are both known. Runs the
   * service-area check, auto-calculates the fare, and (re)loads the list of
   * drivers the customer can pick from.
   */
  private async onRouteReady(): Promise<void> {
    if (!this.pickup || !this.drop) return;

    if (!this.isDropInsideServiceArea()) {
      this.outsideServiceAreaNotice =
        'You have selected a location outside this service area. Switching to Outstation.';
      this.selectedProductKind = 'outstation';
    } else {
      this.outsideServiceAreaNotice = null;
    }

    await this.fetchEstimate();
    await this.refreshDriverList();
  }

  // ─────────────────────────────────────────────────────────────────
  // Map drawing
  // ─────────────────────────────────────────────────────────────────

  private async showRouteOnMap(): Promise<void> {
    if (!this.map || !this.pickup || !this.drop) return;

    if (this.dropMarker) this.dropMarker.map = null;
    this.dropMarker = new google.maps.marker.AdvancedMarkerElement({
      position: { lat: this.drop.lat, lng: this.drop.lng },
      map: this.map,
      title: 'Drop',
      content: this.buildPin('B', '#c0392b'),
    });

    // Clear any polylines from a previous destination before drawing the new
    // route — Route.createPolylines() returns fresh instances each call.
    for (const pl of this.routePolylines) pl.setMap?.(null);
    this.routePolylines = [];

    try {
      // New Routes library (`Route.computeRoutes`) replaces the deprecated
      // `DirectionsService.route` + `DirectionsRenderer` pair. Requires the
      // **Routes API (New)** to be enabled in Google Cloud.
      const { Route } = await (google.maps as any).importLibrary('routes');

      const { routes } = await Route.computeRoutes({
        origin: { location: { latLng: { lat: this.pickup.lat, lng: this.pickup.lng } } },
        destination: { location: { latLng: { lat: this.drop.lat, lng: this.drop.lng } } },
        travelMode: google.maps.TravelMode.DRIVING,
        fields: ['legs', 'path', 'distanceMeters', 'duration'],
      });

      const route = routes?.[0];
      if (!route) throw new Error('no_route');

      // createPolylines() returns Polyline instances we attach ourselves.
      this.routePolylines = route.createPolylines();
      for (const pl of this.routePolylines) {
        pl.setOptions?.({ strokeColor: '#000', strokeWeight: 4 });
        pl.setMap(this.map);
      }

      // Distance + duration are now top-level on the route. Fall back to the
      // first leg if the top-level fields aren't populated.
      const distMeters = route.distanceMeters ?? route.legs?.[0]?.distanceMeters;
      this.routeDistanceKm = typeof distMeters === 'number' ? distMeters / 1000 : null;
      const dur = route.duration ?? route.legs?.[0]?.duration;
      // duration arrives as either `{seconds: number}`, an ISO 8601 "1234s"
      // string, or a plain number of seconds. Handle each shape.
      const seconds = this.parseDurationSeconds(dur);
      this.routeTimeMin = seconds != null ? seconds / 60 : null;
    } catch {
      this.routeDistanceKm = null;
      this.routeTimeMin = null;
      const bounds = new google.maps.LatLngBounds();
      bounds.extend({ lat: this.pickup.lat, lng: this.pickup.lng });
      bounds.extend({ lat: this.drop.lat, lng: this.drop.lng });
      this.map.fitBounds(bounds, 80);
    }
  }

  /**
   * Best-effort extraction of seconds from whatever shape the new Routes API
   * returns for `duration` — has been seen as `{seconds: number}`, ISO
   * "1234s" strings, or plain numbers depending on the runtime.
   */
  private parseDurationSeconds(value: unknown): number | null {
    if (value == null) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const m = /^(\d+(?:\.\d+)?)s?$/.exec(value);
      return m ? Number(m[1]) : null;
    }
    if (typeof value === 'object') {
      const v = value as Record<string, unknown>;
      const s = v['seconds'];
      if (typeof s === 'number') return s;
      if (typeof s === 'string') return Number(s);
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────────────
  // Pricing
  // ─────────────────────────────────────────────────────────────────

  private async fetchEstimate(): Promise<void> {
    if (!this.pickup || !this.drop) return;
    const cityId = this.selectedCity?.id ?? this.cities[0]?.id;
    if (!cityId) return;

    try {
      // The customer no longer picks a vehicle — the server resolves the
      // city's default vehicle for the fare baseline. ride_type_id is only
      // sent for outstation/rental so an outstation rate card is used.
      const res = await this.api
        .post<EstimateResponse>('/pricing/estimate', {
          city_id: cityId,
          ride_type_id:
            this.selectedProductKind !== 'local' ? this.selectedRideTypeId : null,
          outstation_package_id:
            this.selectedProductKind === 'outstation' ? this.selectedPackageId : null,
          pickup_lat: this.pickup.lat,
          pickup_lng: this.pickup.lng,
          drop_lat: this.drop.lat,
          drop_lng: this.drop.lng,
          route_distance_km: this.routeDistanceKm,
          route_time_min: this.routeTimeMin,
        })
        .toPromise();
      this.estimate = res ?? null;
    } catch {
      this.estimate = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Driver list (preview sheet) — customer picks one of these
  // ─────────────────────────────────────────────────────────────────

  /**
   * Loads the candidate driver list for this booking. The /trips/{id}/nearby-drivers
   * endpoint needs a trip, so we create one lazily here (idempotent: re-uses
   * tripId if it already exists from a previous load).
   */
  private async refreshDriverList(): Promise<void> {
    if (!this.pickup || !this.drop) return;
    this.loadingDrivers = true;
    try {
      if (!this.tripId) {
        await this.createTrip();
      }
      if (!this.tripId) return;

      const res = await this.api
        .get<{ data: NearbyDriver[] }>(`/trips/${this.tripId}/nearby-drivers?radius_km=8&limit=20`)
        .toPromise();
      this.drivers = res?.data ?? [];
    } catch (e: any) {
      this.drivers = [];
      this.error = e?.error?.message || null;
    } finally {
      this.loadingDrivers = false;
    }
  }

  private startDriverListPoll(): void {
    if (this.driversPollHandle) return;
    this.driversPollHandle = setInterval(() => this.refreshDriverList(), 6000);
  }

  private stopDriverListPoll(): void {
    if (this.driversPollHandle) {
      clearInterval(this.driversPollHandle);
      this.driversPollHandle = null;
    }
  }

  private async createTrip(): Promise<void> {
    if (!this.pickup || !this.drop) return;
    const cityId = this.selectedCity?.id ?? this.cities[0]?.id;
    if (!cityId) throw new Error('No city configured.');

    const tripRes = await this.api
      .post<{ trip: { id: number } }>('/trips', {
        city_id: cityId,
        // No vehicle is requested — the trip stays open to any-vehicle drivers
        // in the Match step. ride_type_id only goes through for outstation/
        // rental so the right rate card and ride family are used.
        ride_type_id:
          this.selectedProductKind !== 'local' ? this.selectedRideTypeId : null,
        outstation_package_id:
          this.selectedProductKind === 'outstation' ? this.selectedPackageId : null,
        pickup_address: this.pickup.address,
        pickup_lat: this.pickup.lat,
        pickup_lng: this.pickup.lng,
        drop_address: this.drop.address,
        drop_lat: this.drop.lat,
        drop_lng: this.drop.lng,
        payment_method: this.paymentMethod,
        route_distance_km: this.routeDistanceKm,
        route_time_min: this.routeTimeMin,
      })
      .toPromise();
    this.tripId = tripRes?.trip?.id ?? null;
  }

  // ─────────────────────────────────────────────────────────────────
  // Confirm request → select a specific driver
  // ─────────────────────────────────────────────────────────────────

  async openPaymentSheet(): Promise<void> {
    // Cash & QR are temporarily disabled — only Online (UPI) is offered.
    const alert = await this.alertCtrl.create({
      header: 'Payment method',
      inputs: ([
        { type: 'radio', label: 'Online', value: 'upi', checked: true },
      ] as any[]),
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Select',
          handler: (val: PaymentMethod) => {
            if (val) this.paymentMethod = val;
          },
        },
      ],
    });
    await alert.present();
  }

  /**
   * Customer taps a driver row → we send /trips/{id}/select-driver with the
   * estimated fare as the opening offer. The chosen driver gets a direct push.
   */
  async confirmRequest(driver: NearbyDriver): Promise<void> {
    if (!this.estimate?.estimated_fare) {
      const t = await this.toastCtrl.create({
        message: 'Still calculating fare — please wait a moment.',
        duration: 2000,
      });
      await t.present();
      return;
    }

    const amount = Math.round((this.estimate.estimated_fare ?? 0) / 5) * 5;
    const ok = await this.alertCtrl.create({
      header: 'Confirm request',
      message: `Send a ride request to ${driver.name || 'this driver'} at ₹${amount}?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Confirm',
          handler: () => this.doSelectDriver(driver, amount),
        },
      ],
    });
    await ok.present();
  }

  private async doSelectDriver(driver: NearbyDriver, amount: number): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      if (!this.tripId) {
        await this.createTrip();
      }
      if (!this.tripId) throw new Error('Trip creation failed.');

      await this.api
        .post(`/trips/${this.tripId}/select-driver`, {
          driver_id: driver.driver_id,
          amount,
        })
        .toPromise();

      this.selectedDriverId = driver.driver_id;
      this.stopDriverListPoll();
      this.startWaitingForDriver(amount);
    } catch (e: any) {
      this.error = e?.error?.message || e?.message || 'Could not select driver.';
      // If the chosen driver is gone (409), refresh the list so the user can
      // pick someone else.
      await this.refreshDriverList();
    } finally {
      this.loading = false;
    }
  }

  /**
   * Auto-dispatch: POST /customer-offer instead of locking to one specific
   * driver. Backend fires DispatchHopJob which expands the search radius
   * each `hop_interval_sec` and broadcasts DispatchRingExpanded events for
   * the map circle animation. First driver in the ring to accept wins.
   */
  async requestAutoDispatch(): Promise<void> {
    if (!this.estimate?.estimated_fare) {
      const t = await this.toastCtrl.create({
        message: 'Still calculating fare — please wait a moment.',
        duration: 2000,
      });
      await t.present();
      return;
    }

    const amount = Math.round((this.estimate.estimated_fare ?? 0) / 5) * 5;
    this.loading = true;
    this.error = null;
    try {
      if (!this.tripId) {
        await this.createTrip();
      }
      if (!this.tripId) throw new Error('Trip creation failed.');

      // Close the review modal if it was open.
      this.showReviewModal = false;

      await this.api
        .post(`/trips/${this.tripId}/negotiation/customer-offer`, { amount })
        .toPromise();

      this.selectedDriverId = null;
      this.stopDriverListPoll();
      this.startWaitingForDriver(amount);
    } catch (e: any) {
      this.error = e?.error?.message || e?.message || 'Could not start search.';
    } finally {
      this.loading = false;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Waiting for the chosen driver to act
  // ─────────────────────────────────────────────────────────────────

  private startWaitingForDriver(amount: number): void {
    this.state = 'waiting';
    this.driverOffers = [];
    this.searchSecondsLeft = 60;
    this.showFindAnother = false;
    this.searchTimer = setInterval(() => {
      this.searchSecondsLeft = Math.max(0, this.searchSecondsLeft - 1);
      if (this.searchSecondsLeft <= 0) clearInterval(this.searchTimer);
    }, 1000);

    // Escape hatch: if the chosen driver hasn't accepted/countered within 60s,
    // show "Find another driver". Cleared on success in cleanupSearch().
    this.findAnotherTimeoutHandle = setTimeout(() => {
      if (this.state === 'waiting' && !this.driverOffers.length) {
        this.showFindAnother = true;
      }
    }, 60_000);

    // searchDrivers() may have already opened the negotiation subscription
    // for the ring broadcasts — reuse it instead of double-binding.
    if (this.tripId && !this.unsubscribeRealtime) {
      this.unsubscribeRealtime = this.realtime.subscribeNegotiation(
        this.tripId,
        (p) => this.onIncomingOffer(p.offer),
        () => this.onLocked(),
        (p) => this.onDispatchRing(p)
      );
    }

    this.pollHandle = setInterval(() => this.pollNegotiation(), 4000);
  }

  /**
   * Backend just expanded the search ring. Update the UI panel, animate
   * the Google Maps Circle from its current radius up to the new one, and
   * merge any newly-discovered drivers into the selectable list.
   */
  private onDispatchRing(p: DispatchRingExpandedPayload): void {
    // eslint-disable-next-line no-console
    console.log('[dispatch-ring] hop=' + p.hop + '/' + p.max_hops + ' radius=' + p.radius_m + ' eligible_count=' + p.eligible_drivers + ' drivers=' + (p.drivers?.length ?? 0) + ' payload=', p);
    this.dispatchRing = {
      hop: p.hop,
      max_hops: p.max_hops,
      radius_m: p.radius_m,
      eligible: p.eligible_drivers,
      hop_interval_sec: p.hop_interval_sec,
    };
    this.updateSearchCircle(p.radius_m, p.hop_interval_sec * 1000);

    // Merge discovered drivers (discovery mode payload). Dedupe by driver_id.
    if (Array.isArray(p.drivers) && p.drivers.length > 0) {
      const existingIds = new Set(this.drivers.map((d) => d.driver_id));
      for (const d of p.drivers) {
        if (d.driver_id != null && !existingIds.has(d.driver_id)) {
          this.drivers.push({
            driver_id: d.driver_id,
            name: d.name ?? 'Driver',
            vehicle: d.vehicle ? { brand: d.vehicle, model: '', color: '' } : null,
            distance_km: d.distance_km ?? 0,
            rating_avg: null,
            lat: d.lat ?? 0,
            lng: d.lng ?? 0,
          } as any);
          existingIds.add(d.driver_id);
        }
      }
      // Re-plot map markers using the accumulated driver list.
      const markerData = this.drivers
        .filter((d: any) => Number.isFinite(d.lat) && Number.isFinite(d.lng))
        .map((d: any) => ({ id: d.driver_id, lat: d.lat, lng: d.lng, bearing_deg: 0 }));
      if (markerData.length) this.renderNearbyDrivers(markerData);
    }

    // Search complete on the last hop.
    if (p.hop >= p.max_hops) {
      this.searching = false;
    }
  }

  /**
   * Discovery-only search. Triggers DispatchHopJob in discoveryMode = true
   * on the backend — drivers in each expanding ring are revealed to the
   * customer but NOT notified. Customer manually picks one via the existing
   * REQUEST flow (confirmRequest → /select-driver) after search ends.
   */
  async searchDrivers(): Promise<void> {
    if (!this.estimate?.estimated_fare) {
      const t = await this.toastCtrl.create({
        message: 'Still calculating fare — please wait a moment.',
        duration: 2000,
      });
      await t.present();
      return;
    }
    this.loading = true;
    this.error = null;
    try {
      if (!this.tripId) {
        await this.createTrip();
      }
      if (!this.tripId) throw new Error('Trip creation failed.');

      // Reset UI state for a fresh search.
      this.drivers = [];
      this.dispatchRing = null;
      this.clearSearchCircle();
      this.searching = true;

      // Subscribe BEFORE firing the search so we don't miss hop 1.
      if (!this.unsubscribeRealtime) {
        this.unsubscribeRealtime = this.realtime.subscribeNegotiation(
          this.tripId,
          (p) => this.onIncomingOffer(p.offer),
          () => this.onLocked(),
          (p) => this.onDispatchRing(p)
        );
      }

      await this.api.post(`/trips/${this.tripId}/search-drivers`, {}).toPromise();
    } catch (e: any) {
      this.searching = false;
      this.error = e?.error?.message || e?.message || 'Could not start search.';
    } finally {
      this.loading = false;
    }
  }

  private updateSearchCircle(targetRadiusM: number, animMs: number): void {
    if (!this.map || !this.pickupMarker) return;
    const center = this.pickupMarker.position;
    if (!center) return;

    if (!this.searchCircle) {
      this.searchCircle = new google.maps.Circle({
        map: this.map,
        center,
        radius: 0,
        strokeColor: '#10b981',
        strokeOpacity: 0.85,
        strokeWeight: 2,
        fillColor: '#10b981',
        fillOpacity: 0.10,
        clickable: false,
        zIndex: 1,
      });
    } else {
      this.searchCircle.setCenter(center);
    }

    // Smooth radius interpolation so the ring visibly "grows" rather than
    // snapping. 30 fps over animMs milliseconds.
    if (this.searchCircleTween) clearInterval(this.searchCircleTween);
    const startRadius = this.searchCircle.getRadius() || 0;
    const startedAt = performance.now();
    const duration = Math.max(300, Math.min(animMs, 4000));
    this.searchCircleTween = setInterval(() => {
      if (!this.searchCircle) return;
      const t = Math.min(1, (performance.now() - startedAt) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      this.searchCircle.setRadius(startRadius + (targetRadiusM - startRadius) * eased);
      if (t >= 1) {
        clearInterval(this.searchCircleTween);
        this.searchCircleTween = null;
      }
    }, 33);

    try {
      // Keep the ring visible by zooming out a touch as it grows.
      const bounds = this.searchCircle.getBounds?.();
      if (bounds && this.map.fitBounds) this.map.fitBounds(bounds, 80);
    } catch {}
  }

  private clearSearchCircle(): void {
    if (this.searchCircleTween) {
      clearInterval(this.searchCircleTween);
      this.searchCircleTween = null;
    }
    if (this.searchCircle) {
      this.searchCircle.setMap(null);
      this.searchCircle = null;
    }
    this.dispatchRing = null;
  }

  /**
   * Cancel the current trip and return to driver-picking. Cancel grace fields
   * on the PricingRule (cancel_threshold_distance_km / cancel_threshold_time_min)
   * ensure no fee because the chosen driver never moved.
   */
  async findAnotherDriver(): Promise<void> {
    if (!this.tripId) return;
    const tripToCancel = this.tripId;

    try {
      await this.api.post(`/trips/${tripToCancel}/cancel`, { reason: 'driver_unresponsive' }).toPromise();
    } catch {
      // Even if cancel fails, drop local state so the user isn't stuck.
    }
    this.cleanupSearch();
    this.tripId = null;
    this.selectedDriverId = null;
    this.driverOffers = [];
    this.showFindAnother = false;
    this.state = 'preview';
    await this.refreshDriverList();
  }

  private cleanupSearch(): void {
    if (this.searchTimer) {
      clearInterval(this.searchTimer);
      this.searchTimer = null;
    }
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    if (this.unsubscribeRealtime) {
      this.unsubscribeRealtime();
      this.unsubscribeRealtime = null;
    }
    if (this.findAnotherTimeoutHandle) {
      clearTimeout(this.findAnotherTimeoutHandle);
      this.findAnotherTimeoutHandle = null;
    }
    this.clearSearchCircle();
    this.showFindAnother = false;
  }

  private pollNegotiation(): void {
    if (!this.tripId) return;
    this.api
      .get<{ trip_id: number; negotiation: { status: string; final_amount: number; offers: DriverOffer[] } }>(
        `/trips/${this.tripId}/negotiation`
      )
      .subscribe({
        next: (res) => {
          const offers = (res?.negotiation?.offers || []).filter(
            (o) => o.from_role === 'driver' && (o.status === 'PENDING' || o.status === 'ACCEPTED')
          );
          for (const o of offers) this.onIncomingOffer(o);
          if (res?.negotiation?.status === 'LOCKED') this.onLocked();
        },
      });
  }

  private onIncomingOffer(offer: DriverOffer): void {
    if (offer.from_role !== 'driver') return;
    const exists = this.driverOffers.some((o) => o.id != null && o.id === offer.id);
    if (exists) return;
    this.driverOffers = [...this.driverOffers, offer];
    // Driver countered or accepted — surface the bids sheet so the customer
    // can confirm.
    if (this.state === 'waiting') this.state = 'bids';
  }

  private onLocked(): void {
    if (!this.tripId) return;
    this.cleanupSearch();
    this.router.navigateByUrl(`/customer-tabs/trip/${this.tripId}`, { replaceUrl: true });
  }

  async confirmOffer(offer: DriverOffer): Promise<void> {
    if (!this.tripId) return;

    const ok = await this.alertCtrl.create({
      header: 'Confirm fare',
      message: `Accept ₹${offer.amount} from this driver?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Confirm',
          role: 'destructive',
          handler: () => this.lockOffer(offer),
        },
      ],
    });
    await ok.present();
  }

  private async lockOffer(offer: DriverOffer): Promise<void> {
    if (!this.tripId) return;
    if (offer.id == null) {
      const t = await this.toastCtrl.create({
        message: 'Offer is missing an id — refresh and try again.',
        duration: 2500,
        color: 'danger',
      });
      await t.present();
      return;
    }
    try {
      await this.api
        .post(`/trips/${this.tripId}/negotiation/customer-confirm`, {
          final_fare: offer.amount,
          accepted_offer_id: offer.id,
        })
        .toPromise();
      this.onLocked();
    } catch (e: any) {
      const t = await this.toastCtrl.create({
        message: e?.error?.message || 'Could not confirm fare.',
        duration: 2500,
        color: 'danger',
      });
      await t.present();
    }
  }

  async cancelRequest(): Promise<void> {
    if (!this.tripId) {
      this.resetToIdle();
      return;
    }
    const a = await this.alertCtrl.create({
      header: 'Cancel request?',
      message: 'No driver will be assigned. You can request again any time.',
      buttons: [
        { text: 'Keep waiting', role: 'cancel' },
        {
          text: 'Cancel',
          role: 'destructive',
          handler: async () => {
            try {
              await this.api.post(`/trips/${this.tripId}/cancel`, {}).toPromise();
            } catch {
              /* ignore */
            }
            this.resetToIdle();
          },
        },
      ],
    });
    await a.present();
  }

  private resetToIdle(): void {
    this.cleanupSearch();
    this.stopDriverListPoll();
    this.tripId = null;
    this.selectedDriverId = null;
    this.driverOffers = [];
    this.drivers = [];
    this.state = 'idle';
  }
}
